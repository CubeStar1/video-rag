'use client'

import { Boxes, Link2, UserRound, Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDuration } from '@/lib/core/format'
import { Chips, Section, ShareBar, Stat, TimeLink } from './detail-primitives'
import {
  asArray,
  asRecord,
  counted,
  num,
  readEntities,
  str,
  withTimelines,
  type EntityRow,
} from './aggregate-shapes'

interface EntitiesPanelProps {
  aggregates: Record<string, unknown>
  duration: number
  onSeek: (seconds: number) => void
  onOpenChunk: (chunkId: number) => void
}

/**
 * People and objects followed across chunks.
 *
 * These are the aggregates with the most caveats attached, and they are stated
 * where they matter: `entities` clusters on clothing, so someone who changes
 * jacket splits into two; anyone too generically described to identify is left
 * unlinked; and static fixtures are counted rather than tracked.
 */
export function EntitiesPanel({
  aggregates,
  duration,
  onSeek,
  onOpenChunk,
}: EntitiesPanelProps) {
  const entities = asRecord(aggregates.entities)
  const people = withTimelines(readEntities(entities, 'people'), aggregates.entity_timelines)
  const objectsRaw = asRecord(aggregates.object_entities)
  const objects = readEntities(objectsRaw, 'objects')
  const cooccurrence = asRecord(aggregates.cooccurrence)

  if (people.length === 0 && objects.length === 0) {
    return (
      <div className="rounded-xl border border-dashed py-16 text-center">
        <Users className="mx-auto size-6 text-muted-foreground/60" />
        <p className="mt-2 text-sm font-medium">Nobody and nothing linked</p>
        <p className="mx-auto mt-1 max-w-md text-[13px] text-muted-foreground">
          Linking people needs the <code className="text-[12px]">people</code> analyzer and linking
          objects needs <code className="text-[12px]">object_detection</code>. Neither ran on this
          video, so both aggregators were skipped.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {people.length > 0 && (
        <Section
          title="People"
          icon={<UserRound className="size-4" />}
          count={people.length}
          subtitle={`${num(entities.linked)} linked across chunks · ${num(
            entities.unlinked
          )} seen once`}
        >
          <div className="mb-3 grid gap-2 sm:grid-cols-4">
            <Stat label="Distinct people" value={num(entities.total, people.length)} />
            <Stat label="Observations" value={num(entities.observations)} />
            <Stat label="Narrated" value={num(entities.narrated)} hint="LLM-written stories" />
            <Stat
              label="Link threshold"
              value={num(asRecord(entities.params).link_threshold).toFixed(2)}
              hint="clothing similarity"
            />
          </div>

          <ul className="space-y-2">
            {people.map((person) => (
              <EntityCard
                key={person.id}
                entity={person}
                duration={duration}
                onSeek={onSeek}
                onOpenChunk={onOpenChunk}
              />
            ))}
          </ul>
        </Section>
      )}

      {asArray(cooccurrence.pairs).length > 0 && (
        <Section
          title="Seen together"
          icon={<Link2 className="size-4" />}
          count={num(cooccurrence.pair_count, asArray(cooccurrence.pairs).length)}
          subtitle="pairs sharing a chunk"
        >
          <ul className="space-y-1.5">
            {asArray(cooccurrence.pairs).map((row, index) => {
              const pair = asRecord(row)
              return (
                <li key={index} className="rounded-lg border bg-background p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
                      {str(pair.a)} + {str(pair.b)}
                    </span>
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                      {num(pair.count)} chunk{num(pair.count) === 1 ? '' : 's'}
                    </span>
                  </div>
                  <p className="mt-1 text-[12px] leading-snug">
                    {str(pair.a_description)}
                    <span className="text-muted-foreground"> · with · </span>
                    {str(pair.b_description)}
                  </p>
                  <button
                    type="button"
                    onClick={() => onOpenChunk(num(asArray(pair.chunks)[0]))}
                    className="mt-1 text-[10px] text-muted-foreground underline-offset-2 hover:text-primary hover:underline"
                  >
                    chunks {asArray(pair.chunks).slice(0, 10).join(', ')}
                    {asArray(pair.chunks).length > 10 ? ' …' : ''}
                  </button>
                </li>
              )
            })}
          </ul>
        </Section>
      )}

      {objects.length > 0 && (
        <Section
          title="Objects tracked"
          icon={<Boxes className="size-4" />}
          count={objects.length}
          subtitle={`${num(objectsRaw.linked)} linked · ${num(objectsRaw.unlinked)} seen once`}
        >
          <ul className="space-y-2">
            {objects.map((object) => (
              <EntityCard
                key={object.id}
                entity={object}
                duration={duration}
                onSeek={onSeek}
                onOpenChunk={onOpenChunk}
              />
            ))}
          </ul>

          {counted(objectsRaw.fixtures).length > 0 && (
            <div className="mt-4 border-t pt-3">
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Fixtures — counted, not tracked
              </div>
              <p className="mb-2 text-[11px] text-muted-foreground">
                Static things like counters and shelves are present in nearly every frame, so
                following them tells a search nothing.
              </p>
              <ul className="flex flex-wrap gap-1">
                {counted(objectsRaw.fixtures).map((fixture) => (
                  <li
                    key={fixture.name}
                    className="rounded-md border bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground"
                  >
                    {fixture.name}
                    <span className="ml-1 tabular-nums opacity-60">{fixture.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>
      )}

      {counted(cooccurrence.objects_present).length > 0 && (
        <Section title="Objects present" icon={<Boxes className="size-4" />}>
          <ul className="space-y-1">
            {counted(cooccurrence.objects_present).map((object, index, all) => (
              <li key={object.name} className="flex items-center gap-2">
                <span className="w-40 shrink-0 truncate text-[12px]">{object.name}</span>
                <ShareBar value={object.count / Math.max(1, all[0].count)} />
                <span className="w-8 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                  {object.count}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  )
}

/** One linked person or object: who they are, what they did, and when they were there. */
function EntityCard({
  entity,
  duration,
  onSeek,
  onOpenChunk,
}: {
  entity: EntityRow
  duration: number
  onSeek: (seconds: number) => void
  onOpenChunk: (chunkId: number) => void
}) {
  const spans = entity.spans ?? entity.observations.map((o) => ({ start: o.start, end: o.end }))

  return (
    <li className="rounded-lg border bg-background p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          {entity.id}
        </span>
        {entity.label && entity.label !== entity.id && (
          <span className="text-[13px] font-medium capitalize">{entity.label}</span>
        )}
        {entity.distinctive && (
          <span
            className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400"
            title="Described specifically enough to be identified across chunks"
          >
            distinctive
          </span>
        )}
        <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
          {entity.appearances} appearance{entity.appearances === 1 ? '' : 's'}
        </span>
      </div>

      {entity.description && (
        <p className="mt-1.5 text-[13px] leading-relaxed">{entity.description}</p>
      )}

      {entity.narrative && (
        <p className="mt-1.5 border-l-2 border-primary/30 pl-2.5 text-[13px] leading-relaxed text-muted-foreground">
          {entity.narrative}
        </p>
      )}

      <Chips items={entity.roles} tone="outline" className="mt-2" />

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span>
          First <TimeLink seconds={entity.first_seen} onSeek={onSeek} />
        </span>
        <span>
          Last <TimeLink seconds={entity.last_seen} onSeek={onSeek} />
        </span>
        {entity.observed_seconds !== undefined && (
          <span title="Observed presence, not first-to-last">
            Present {formatDuration(entity.observed_seconds)}
          </span>
        )}
      </div>

      {duration > 0 && spans.length > 0 && (
        <PresenceStrip spans={spans} duration={duration} onSeek={onSeek} />
      )}

      {entity.observations.length > 0 && (
        <ul className="mt-2 space-y-1 border-t pt-2">
          {entity.observations.map((observation, index) => (
            <li key={index} className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
              <TimeLink
                seconds={observation.start}
                end={observation.end}
                onSeek={onSeek}
                className="shrink-0"
              />
              <button
                type="button"
                onClick={() => onOpenChunk(observation.chunk_id)}
                className="shrink-0 text-[10px] text-muted-foreground underline-offset-2 hover:text-primary hover:underline"
              >
                chunk {observation.chunk_id}
              </button>
              <span className="min-w-0 leading-snug">
                {[observation.clothing, observation.action, observation.context]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

/** Where in the video this entity was actually observed. */
function PresenceStrip({
  spans,
  duration,
  onSeek,
}: {
  spans: { start: number; end: number }[]
  duration: number
  onSeek: (seconds: number) => void
}) {
  return (
    <div className="relative mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
      {spans.map((span, index) => {
        const left = (span.start / duration) * 100
        const width = Math.max(0.4, ((span.end - span.start) / duration) * 100)
        return (
          <button
            key={index}
            type="button"
            onClick={() => onSeek(span.start)}
            title={`${formatDuration(span.start)} – ${formatDuration(span.end)}`}
            className={cn('absolute top-0 h-full rounded-full bg-primary/70 hover:bg-primary')}
            style={{ left: `${left}%`, width: `${width}%` }}
          />
        )
      })}
    </div>
  )
}
