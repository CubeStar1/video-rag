'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Boxes,
  Captions,
  Eye,
  Film,
  Search,
  Type,
  Users,
  X,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { AnalyzerId, ChunkOut } from '@/lib/core/types'
import { Chips, EmptyNote, JsonView, RawDisclosure, TimeLink } from './detail-primitives'

/** Rendering 500 expanded chunks at once is what makes this page feel slow. */
const INITIAL_RENDER = 40

const ANALYZER_LABELS: Record<string, string> = {
  default_video: 'Scene',
  transcript: 'Transcript',
  diarization: 'Speech',
  ocr: 'On-screen text',
  people: 'People',
  object_detection: 'Objects',
}

const ANALYZER_ICONS: Record<string, React.ReactNode> = {
  default_video: <Eye className="size-3.5" />,
  transcript: <Captions className="size-3.5" />,
  diarization: <Captions className="size-3.5" />,
  ocr: <Type className="size-3.5" />,
  people: <Users className="size-3.5" />,
  object_detection: <Boxes className="size-3.5" />,
}

const ANALYZER_ORDER: AnalyzerId[] = [
  'default_video',
  'diarization',
  'transcript',
  'ocr',
  'people',
  'object_detection',
]

/** Which analyzers actually left output on this chunk. */
function analyzersOn(chunk: ChunkOut): AnalyzerId[] {
  return ANALYZER_ORDER.filter((id) => {
    const output = (chunk as unknown as Record<string, unknown>)[id]
    return output !== undefined && output !== null && Object.keys(output as object).length > 0
  })
}

/** Everything textual in a chunk, flattened once so search can scan it. */
function searchableText(chunk: ChunkOut): string {
  const scene = chunk.default_video ?? {}
  return [
    scene.description,
    scene.setting,
    ...(scene.people ?? []),
    ...(scene.objects ?? []),
    ...(scene.actions ?? []),
    ...(scene.tags ?? []),
    chunk.transcript?.text,
    ...(chunk.diarization?.turns ?? []).map((turn) => `${turn.speaker} ${turn.text}`),
    ...(chunk.ocr?.texts ?? []).map((entry) => entry.text),
    chunk.ocr?.summary,
    ...(chunk.people?.people ?? []).map((person) =>
      ['appearance', 'clothing', 'role', 'action']
        .map((key) => (person as Record<string, unknown>)[key])
        .join(' ')
    ),
    ...(chunk.object_detection?.detections ?? []).map(
      (detection) => `${detection.object} ${detection.description ?? ''}`
    ),
    ...(chunk.object_detection?.objects ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

interface ChunkPanelProps {
  chunks: ChunkOut[]
  chunkTotal: number
  analyzers: AnalyzerId[]
  currentTime: number
  focusChunkId: number | null
  onSeek: (seconds: number) => void
}

/**
 * Every chunk, with every analyzer's output on it.
 *
 * Core already merges the analyzers onto the chunk before returning it, so a
 * chunk is one row here rather than one row per pass — which is also how it is
 * stored, and the reason the same moment can be read across passes at all.
 */
export function ChunkPanel({
  chunks,
  chunkTotal,
  analyzers,
  currentTime,
  focusChunkId,
  onSeek,
}: ChunkPanelProps) {
  const [search, setSearch] = useState('')
  const [analyzerFilter, setAnalyzerFilter] = useState<AnalyzerId | 'all'>('all')
  const [rendered, setRendered] = useState(INITIAL_RENDER)

  // Searchable text is the expensive part of filtering, and it never changes.
  const indexed = useMemo(
    () => chunks.map((chunk) => ({ chunk, text: searchableText(chunk) })),
    [chunks]
  )

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return indexed
      .filter(({ chunk, text }) => {
        if (analyzerFilter !== 'all' && !analyzersOn(chunk).includes(analyzerFilter)) return false
        return term ? text.includes(term) : true
      })
      .map(({ chunk }) => chunk)
  }, [indexed, search, analyzerFilter])

  useEffect(() => setRendered(INITIAL_RENDER), [search, analyzerFilter])

  // A jump from another tab must survive the render cap, or the target chunk is
  // simply not on the page to scroll to.
  useEffect(() => {
    if (focusChunkId === null) return
    const position = filtered.findIndex((chunk) => chunk.chunk_id === focusChunkId)
    if (position >= 0) setRendered((current) => Math.max(current, position + 5))

    const timer = window.setTimeout(() => {
      document
        .getElementById(`chunk-${focusChunkId}`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, 60)
    return () => window.clearTimeout(timer)
  }, [focusChunkId, filtered])

  const visible = filtered.slice(0, rendered)
  const remaining = filtered.length - visible.length

  return (
    <div className="space-y-3">
      <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center gap-2 bg-background/95 px-1 py-2 backdrop-blur">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search descriptions, speech, on-screen text, people, objects"
            className="h-9 pl-9 pr-8 text-sm"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <FilterPill
            active={analyzerFilter === 'all'}
            onClick={() => setAnalyzerFilter('all')}
            label="All"
          />
          {analyzers.map((id) => (
            <FilterPill
              key={id}
              active={analyzerFilter === id}
              onClick={() => setAnalyzerFilter(id)}
              label={ANALYZER_LABELS[id] ?? id}
              icon={ANALYZER_ICONS[id]}
            />
          ))}
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Showing {visible.length} of {filtered.length}
        {filtered.length !== chunks.length && ` filtered from ${chunks.length}`}
        {chunkTotal > chunks.length && ` · core holds ${chunkTotal}`}
        {' chunks'}
      </p>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed py-16 text-center">
          <Film className="mx-auto size-6 text-muted-foreground/60" />
          <p className="mt-2 text-sm font-medium">
            {chunks.length === 0 ? 'No chunks stored' : 'No chunks match'}
          </p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {chunks.length === 0
              ? 'This video has not been chunked yet, or the analysis backend is unreachable.'
              : 'Try a different search term or analyzer.'}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {visible.map((chunk, index) => (
            <ChunkCard
              key={`${chunk.chunk_id}-${chunk.start}`}
              chunk={chunk}
              index={filtered.length === chunks.length ? index : chunks.indexOf(chunk)}
              isActive={currentTime >= chunk.start && currentTime < chunk.end}
              isFocused={focusChunkId === chunk.chunk_id}
              analyzerFilter={analyzerFilter}
              onSeek={onSeek}
            />
          ))}
        </ul>
      )}

      {remaining > 0 && (
        <div className="pt-1 text-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRendered((current) => current + 60)}
          >
            Show {Math.min(remaining, 60)} more ({remaining} left)
          </Button>
        </div>
      )}
    </div>
  )
}

function FilterPill({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean
  onClick: () => void
  label: string
  icon?: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
        active
          ? 'border-primary/30 bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      )}
    >
      {icon}
      {label}
    </button>
  )
}

function ChunkCard({
  chunk,
  index,
  isActive,
  isFocused,
  analyzerFilter,
  onSeek,
}: {
  chunk: ChunkOut
  index: number
  isActive: boolean
  isFocused: boolean
  analyzerFilter: AnalyzerId | 'all'
  onSeek: (seconds: number) => void
}) {
  const ref = useRef<HTMLLIElement>(null)
  const present = analyzersOn(chunk)
  const shows = (id: AnalyzerId) => analyzerFilter === 'all' || analyzerFilter === id

  const scene = chunk.default_video
  const people = chunk.people
  const objects = chunk.object_detection

  return (
    <li
      ref={ref}
      id={`chunk-${chunk.chunk_id}`}
      className={cn(
        'scroll-mt-24 overflow-hidden rounded-xl border bg-card transition-colors',
        isActive && 'border-primary/40',
        isFocused && 'ring-2 ring-primary/40'
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b bg-muted/30 px-4 py-2">
        <span
          className={cn(
            'flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums',
            isActive ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
          )}
        >
          {index + 1}
        </span>
        <TimeLink
          seconds={chunk.start}
          end={chunk.end}
          onSeek={onSeek}
          showIcon
          className="text-xs font-medium text-foreground"
        />
        <span className="text-[11px] text-muted-foreground">
          {(chunk.end - chunk.start).toFixed(1)}s
        </span>
        <span className="text-[11px] text-muted-foreground">chunk {chunk.chunk_id}</span>

        <div className="ml-auto flex flex-wrap items-center gap-1">
          {present.map((id) => (
            <span
              key={id}
              className="inline-flex items-center gap-1 rounded-full bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground"
              title={id}
            >
              {ANALYZER_ICONS[id]}
              {ANALYZER_LABELS[id] ?? id}
            </span>
          ))}
        </div>
      </div>

      <div className="space-y-4 p-4">
        {present.length === 0 && (
          <EmptyNote>No analyzer produced output for this chunk.</EmptyNote>
        )}

        {scene && shows('default_video') && (
          <Block id="default_video">
            {scene.description && (
              <p className="text-[13px] leading-relaxed">{scene.description}</p>
            )}
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {scene.setting && <Facet label="Setting" items={[scene.setting]} />}
              <Facet label="People" items={scene.people} />
              <Facet label="Actions" items={scene.actions} />
              <Facet label="Objects" items={scene.objects} />
              <Facet label="Tags" items={scene.tags} />
            </div>
          </Block>
        )}

        {chunk.diarization && shows('diarization') && (
          <Block id="diarization">
            <Chips
              items={(chunk.diarization.speakers ?? []).map((s) => s.replace(/^SPEAKER_/, 'Speaker '))}
              tone="accent"
              className="mb-2"
            />
            {(chunk.diarization.turns ?? []).length === 0 ? (
              <EmptyNote>No speech in this chunk.</EmptyNote>
            ) : (
              <ul className="space-y-1.5">
                {(chunk.diarization.turns ?? []).map((turn, turnIndex) => (
                  <li key={`${turn.start}-${turnIndex}`} className="flex items-start gap-2">
                    <TimeLink seconds={turn.start} onSeek={onSeek} className="mt-0.5 shrink-0" />
                    <span className="mt-0.5 shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {turn.speaker?.replace(/^SPEAKER_/, 'S') ?? '—'}
                    </span>
                    <span className="min-w-0 text-[13px] leading-snug">{turn.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </Block>
        )}

        {chunk.transcript && shows('transcript') && (
          <Block id="transcript">
            {chunk.transcript.text?.trim() ? (
              <p className="text-[13px] leading-relaxed">{chunk.transcript.text}</p>
            ) : (
              <EmptyNote>No speech in this chunk.</EmptyNote>
            )}
          </Block>
        )}

        {chunk.ocr && shows('ocr') && (
          <Block id="ocr">
            {chunk.ocr.summary && (
              <p className="mb-2 text-[13px] leading-relaxed text-muted-foreground">
                {chunk.ocr.summary}
              </p>
            )}
            {(chunk.ocr.texts ?? []).length === 0 ? (
              <EmptyNote>No text detected on screen.</EmptyNote>
            ) : (
              <ul className="space-y-1">
                {(chunk.ocr.texts ?? []).map((entry, textIndex) => (
                  <li key={textIndex} className="text-[13px] leading-snug">
                    <span className="rounded bg-muted px-1 py-0.5 font-medium">{entry.text}</span>
                    {entry.context && (
                      <span className="ml-2 text-muted-foreground">{entry.context}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Block>
        )}

        {people && shows('people') && (
          <Block
            id="people"
            note={
              people.people_count !== undefined
                ? `${people.people_count} detected`
                : undefined
            }
          >
            {(people.people ?? []).length === 0 ? (
              <EmptyNote>Nobody described in this chunk.</EmptyNote>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {(people.people ?? []).map((person, personIndex) => (
                  <PersonCard
                    key={personIndex}
                    person={person as Record<string, unknown>}
                    index={personIndex}
                  />
                ))}
              </ul>
            )}
          </Block>
        )}

        {objects && shows('object_detection') && (
          <Block id="object_detection">
            {(objects.detections ?? []).length === 0 ? (
              <Chips items={objects.objects ?? []} tone="outline" />
            ) : (
              <ul className="space-y-1.5">
                {(objects.detections ?? []).map((detection, detectionIndex) => (
                  <li key={detectionIndex} className="text-[13px] leading-snug">
                    <span className="font-medium">{detection.object}</span>
                    {detection.description && (
                      <span className="text-muted-foreground"> — {detection.description}</span>
                    )}
                    {(detection as Record<string, any>).context && (
                      <span className="block text-[12px] text-muted-foreground">
                        {(detection as Record<string, any>).context}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Block>
        )}

        <RawDisclosure label="Raw chunk record" value={chunk} />
      </div>
    </li>
  )
}

function Block({
  id,
  note,
  children,
}: {
  id: AnalyzerId
  note?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {ANALYZER_ICONS[id]}
        {ANALYZER_LABELS[id] ?? id}
        {note && <span className="font-normal normal-case tracking-normal">· {note}</span>}
      </div>
      {children}
    </div>
  )
}

function Facet({ label, items }: { label: string; items?: string[] }) {
  if (!items || items.length === 0) return null
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
        {label}
      </div>
      <Chips items={items} tone="outline" className="mt-1" />
    </div>
  )
}

/**
 * One person as the analyzer described them. `box_id` is shown because it is
 * how the description ties back to a box in the frame — but it is a referent
 * within this chunk, not an identity across the video.
 */
function PersonCard({ person, index }: { person: Record<string, unknown>; index: number }) {
  const known = ['box_id', 'appearance', 'clothing', 'role', 'action']
  const extra = Object.fromEntries(
    Object.entries(person).filter(([key]) => !known.includes(key) && key !== 'locations')
  )

  return (
    <li className="rounded-lg border bg-background p-2.5">
      <div className="flex items-center gap-2">
        <span className="flex size-5 items-center justify-center rounded bg-muted text-[10px] font-semibold tabular-nums">
          {(person.box_id as number) ?? index + 1}
        </span>
        {Boolean(person.role) && (
          <span className="text-[11px] font-medium capitalize">{String(person.role)}</span>
        )}
      </div>
      <dl className="mt-1.5 space-y-1">
        {(['clothing', 'appearance', 'action'] as const).map((key) =>
          person[key] ? (
            <div key={key} className="flex gap-2">
              <dt className="w-16 shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                {key}
              </dt>
              <dd className="min-w-0 flex-1 text-[12px] leading-snug">{String(person[key])}</dd>
            </div>
          ) : null
        )}
      </dl>
      {Object.keys(extra).length > 0 && (
        <div className="mt-2 border-t pt-1.5">
          <JsonView value={extra} depth={1} />
        </div>
      )}
    </li>
  )
}
