/**
 * Typed views over core's aggregate output.
 *
 * Aggregates arrive as `Record<string, unknown>` on purpose: aggregators are
 * added to core without the frontend knowing, and the LLM-written ones
 * (`summary`, `chapters`, `events`, `entities`, `object_entities`) are only as
 * well-shaped as the model's last response. So nothing here asserts — each
 * reader coerces what it needs and drops what it cannot use, and anything with
 * no reader still renders through `JsonView`.
 */

export const asRecord = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {}

export const asArray = (value: unknown): any[] => (Array.isArray(value) ? value : [])

export const num = (value: unknown, fallback = 0): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export const str = (value: unknown): string =>
  value === null || value === undefined ? '' : String(value).trim()

/** `[name, count]` pairs — how core returns every "most common" list. */
export function counted(value: unknown): { name: string; count: number }[] {
  return asArray(value)
    .map((entry) =>
      Array.isArray(entry)
        ? { name: str(entry[0]), count: num(entry[1]) }
        : { name: str(asRecord(entry).name), count: num(asRecord(entry).count) }
    )
    .filter((entry) => entry.name)
}

export interface SummaryTier {
  level: number
  section_count: number
  sections: { summary: string; start: number; end: number; chunk_ids: number[] }[]
}

export interface SummaryAggregate {
  summary: string
  key_points: string[]
  topics: string[]
  depth: number
  tiers: SummaryTier[]
  based_on: string[]
}

export function readSummary(value: unknown): SummaryAggregate | null {
  const raw = asRecord(value)
  if (!raw.summary && !asArray(raw.tiers).length) return null

  return {
    summary: str(raw.summary),
    key_points: asArray(raw.key_points).map(str).filter(Boolean),
    topics: asArray(raw.topics).map(str).filter(Boolean),
    depth: num(raw.depth, asArray(raw.tiers).length),
    based_on: asArray(raw.based_on).map(str),
    tiers: asArray(raw.tiers).map((tier) => {
      const entry = asRecord(tier)
      return {
        level: num(entry.level),
        section_count: num(entry.section_count, asArray(entry.sections).length),
        sections: asArray(entry.sections).map((section) => {
          const s = asRecord(section)
          return {
            summary: str(s.summary),
            start: num(s.start),
            end: num(s.end),
            chunk_ids: asArray(s.chunk_ids).map((id) => num(id)),
          }
        }),
      }
    }),
  }
}

export interface ChapterRow {
  title: string
  summary: string
  start: number
  end: number
  chunk_ids: number[]
}

export function readChapters(value: unknown): ChapterRow[] {
  return asArray(asRecord(value).chapters)
    .map((row) => {
      const chapter = asRecord(row)
      return {
        title: str(chapter.title) || 'Untitled',
        summary: str(chapter.summary),
        start: num(chapter.start),
        end: num(chapter.end),
        chunk_ids: asArray(chapter.chunk_ids).map((id) => num(id)),
      }
    })
    .filter((chapter) => chapter.end > chapter.start)
    .sort((a, b) => a.start - b.start)
}

export interface EventRow {
  event: string
  actor: string
  category: string
  chunk_id: number
  start: number
  end: number
}

export function readEvents(value: unknown): EventRow[] {
  return asArray(asRecord(value).events)
    .map((row) => {
      const event = asRecord(row)
      return {
        event: str(event.event) || str(event.description),
        actor: str(event.actor),
        category: str(event.category),
        chunk_id: num(event.chunk_id, -1),
        start: num(event.start),
        end: num(event.end),
      }
    })
    .filter((event) => event.event)
    .sort((a, b) => a.start - b.start)
}

export interface EntityRow {
  id: string
  label: string
  description: string
  narrative: string
  role: string
  roles: string[]
  appearances: number
  chunk_ids: number[]
  first_seen: number
  last_seen: number
  distinctive: boolean
  observations: {
    chunk_id: number
    start: number
    end: number
    clothing?: string
    role?: string
    action?: string
    context?: string
  }[]
  /** Filled from `entity_timelines` when that aggregator ran. */
  observed_seconds?: number
  spans?: { start: number; end: number }[]
}

/**
 * People (`entities`) and objects (`object_entities`) come out of the same
 * clusterer with two different key names, so one reader covers both.
 */
export function readEntities(value: unknown, kind: 'people' | 'objects'): EntityRow[] {
  const raw = asRecord(value)
  const rows = kind === 'people' ? asArray(raw.entities) : asArray(raw.objects)

  return rows.map((row) => {
    const entity = asRecord(row)
    const id = str(entity.entity_id) || str(entity.object_id)
    return {
      id,
      label: str(entity.name) || str(entity.role) || id,
      description: str(entity.description) || str(entity.signature),
      narrative: str(entity.narrative),
      role: str(entity.role),
      roles: asArray(entity.roles).map(str).filter(Boolean),
      appearances: num(entity.appearances),
      chunk_ids: asArray(entity.chunk_ids).map((chunkId) => num(chunkId)),
      first_seen: num(entity.first_seen),
      last_seen: num(entity.last_seen),
      distinctive: Boolean(entity.distinctive),
      observations: asArray(entity.observations).map((row) => {
        const observation = asRecord(row)
        return {
          chunk_id: num(observation.chunk_id),
          start: num(observation.start),
          end: num(observation.end),
          clothing: str(observation.clothing) || undefined,
          role: str(observation.role) || undefined,
          action: str(observation.action) || undefined,
          context: str(observation.context) || undefined,
        }
      }),
    }
  })
}

/** Merge `entity_timelines` presence onto the people it describes. */
export function withTimelines(entities: EntityRow[], timelines: unknown): EntityRow[] {
  const byId = new Map<string, Record<string, any>>()
  for (const row of asArray(asRecord(timelines).timelines)) {
    const timeline = asRecord(row)
    byId.set(str(timeline.entity_id), timeline)
  }
  if (byId.size === 0) return entities

  return entities.map((entity) => {
    const timeline = byId.get(entity.id)
    if (!timeline) return entity
    return {
      ...entity,
      observed_seconds: num(timeline.observed_seconds),
      spans: asArray(timeline.spans).map((span) => ({
        start: num(asRecord(span).start),
        end: num(asRecord(span).end),
      })),
    }
  })
}

export interface SpeakerRow {
  speaker: string
  turns: number
  seconds: number
  words: number
  share: number
  longest_turn: number
  words_per_second: number
  first_seen: number
  last_seen: number
  chunks: number[]
}

export function readSpeakers(value: unknown): SpeakerRow[] {
  return asArray(asRecord(value).speakers).map((row) => {
    const speaker = asRecord(row)
    return {
      speaker: str(speaker.speaker),
      turns: num(speaker.turns),
      seconds: num(speaker.seconds),
      words: num(speaker.words),
      share: num(speaker.share),
      longest_turn: num(speaker.longest_turn),
      words_per_second: num(speaker.words_per_second),
      first_seen: num(speaker.first_seen),
      last_seen: num(speaker.last_seen),
      chunks: asArray(speaker.chunks).map((chunk) => num(chunk)),
    }
  })
}

/** `SPEAKER_00` → `Speaker 00`. The raw label is what filters use; this is for reading. */
export const speakerLabel = (speaker: string) =>
  speaker.replace(/^SPEAKER_/, 'Speaker ') || 'Unattributed'
