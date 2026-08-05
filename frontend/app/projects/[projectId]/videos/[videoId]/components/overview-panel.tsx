'use client'

import { useState } from 'react'
import {
  Activity,
  BookOpen,
  FileText,
  Layers,
  ListTree,
  Sparkles,
  Tag,
  Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDuration } from '@/lib/core/format'
import {
  Chips,
  EmptyNote,
  Section,
  ShareBar,
  Stat,
  TimeLink,
} from './detail-primitives'
import {
  asArray,
  asRecord,
  counted,
  num,
  readChapters,
  readEvents,
  readSummary,
  str,
} from './aggregate-shapes'

interface OverviewPanelProps {
  aggregates: Record<string, unknown>
  onSeek: (seconds: number) => void
  onOpenChunk: (chunkId: number) => void
}

/**
 * The video-level read: what it is about, how it is divided, what happened, and
 * the counts embeddings cannot produce.
 *
 * Everything here is an aggregate, and an aggregate whose analyzer never ran is
 * absent rather than empty — so each block renders a reason it is missing
 * instead of an empty shell.
 */
export function OverviewPanel({ aggregates, onSeek, onOpenChunk }: OverviewPanelProps) {
  const summary = readSummary(aggregates.summary)
  const chapters = readChapters(aggregates.chapters)
  const events = readEvents(aggregates.events)
  const stats = asRecord(aggregates.stats)
  const ner = asRecord(aggregates.ner)
  const novelty = asRecord(aggregates.novelty)

  const hasAnything =
    summary || chapters.length || events.length || Object.keys(stats).length || Object.keys(ner).length

  if (!hasAnything) {
    return (
      <div className="rounded-xl border border-dashed py-16 text-center">
        <Sparkles className="mx-auto size-6 text-muted-foreground/60" />
        <p className="mt-2 text-sm font-medium">No video-level results yet</p>
        <p className="mx-auto mt-1 max-w-md text-[13px] text-muted-foreground">
          Aggregators run after analysis and are skipped when the analyzer they depend on was not
          selected. Re-run them from the header to fill this in.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {summary && <SummarySection summary={summary} onSeek={onSeek} onOpenChunk={onOpenChunk} />}

      {Object.keys(stats).length > 0 && <StatsSection stats={stats} onSeek={onSeek} />}

      {chapters.length > 0 && (
        <Section title="Chapters" icon={<BookOpen className="size-4" />} count={chapters.length}>
          <ol className="space-y-2">
            {chapters.map((chapter, index) => (
              <li key={`${chapter.start}-${index}`} className="rounded-lg border bg-background p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <h4 className="text-[13px] font-medium">{chapter.title}</h4>
                  <TimeLink
                    seconds={chapter.start}
                    end={chapter.end}
                    onSeek={onSeek}
                    showIcon
                    className="ml-auto"
                  />
                </div>
                {chapter.summary && (
                  <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                    {chapter.summary}
                  </p>
                )}
                {chapter.chunk_ids.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onOpenChunk(chapter.chunk_ids[0])}
                    className="mt-1.5 text-[11px] text-muted-foreground underline-offset-2 hover:text-primary hover:underline"
                  >
                    chunks {chapter.chunk_ids[0]}–{chapter.chunk_ids.at(-1)}
                  </button>
                )}
              </li>
            ))}
          </ol>
        </Section>
      )}

      {events.length > 0 && (
        <EventsSection events={events} onSeek={onSeek} onOpenChunk={onOpenChunk} />
      )}

      {Object.keys(novelty).length > 0 && <NoveltySection novelty={novelty} onSeek={onSeek} />}

      {Object.keys(ner).length > 0 && <NamedEntitiesSection ner={ner} />}
    </div>
  )
}

function SummarySection({
  summary,
  onSeek,
  onOpenChunk,
}: {
  summary: NonNullable<ReturnType<typeof readSummary>>
  onSeek: (seconds: number) => void
  onOpenChunk: (chunkId: number) => void
}) {
  // `tiers[0]` is the finest level and the last is the whole video, so the
  // useful default is the coarsest one that is still more than a single block.
  const [tier, setTier] = useState(() => Math.max(0, summary.tiers.length - 2))
  const sections = summary.tiers[tier]?.sections ?? []

  return (
    <Section
      title="Summary"
      icon={<FileText className="size-4" />}
      subtitle={summary.based_on.length ? `from ${summary.based_on.join(', ')}` : undefined}
    >
      <p className="text-sm leading-relaxed">{summary.summary}</p>

      {summary.key_points.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Key points
          </div>
          <ul className="space-y-1">
            {summary.key_points.map((point, index) => (
              <li key={index} className="flex gap-2 text-[13px] leading-relaxed">
                <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary/60" />
                {point}
              </li>
            ))}
          </ul>
        </div>
      )}

      {summary.topics.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Topics
          </div>
          <Chips items={summary.topics} tone="accent" />
        </div>
      )}

      {summary.tiers.length > 0 && (
        <div className="mt-4 border-t pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <ListTree className="size-3.5" />
              Sections
            </div>
            <div className="flex flex-wrap gap-1">
              {summary.tiers.map((level, index) => (
                <button
                  key={level.level}
                  type="button"
                  onClick={() => setTier(index)}
                  className={cn(
                    'rounded-full border px-2 py-0.5 text-[11px] tabular-nums transition-colors',
                    tier === index
                      ? 'border-primary/30 bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-muted'
                  )}
                >
                  {level.section_count} part{level.section_count === 1 ? '' : 's'}
                </button>
              ))}
            </div>
            <span className="text-[11px] text-muted-foreground">
              finest first · depth {summary.depth}
            </span>
          </div>

          <ol className="mt-2 space-y-1.5">
            {sections.map((section, index) => (
              <li key={index} className="rounded-lg bg-muted/40 p-2.5">
                <div className="flex items-center gap-2">
                  <TimeLink
                    seconds={section.start}
                    end={section.end}
                    onSeek={onSeek}
                    showIcon
                    className="font-medium"
                  />
                  {section.chunk_ids.length > 0 && (
                    <button
                      type="button"
                      onClick={() => onOpenChunk(section.chunk_ids[0])}
                      className="text-[11px] text-muted-foreground underline-offset-2 hover:text-primary hover:underline"
                    >
                      {section.chunk_ids.length} chunk{section.chunk_ids.length === 1 ? '' : 's'}
                    </button>
                  )}
                </div>
                <p className="mt-1 text-[13px] leading-relaxed">{section.summary}</p>
              </li>
            ))}
          </ol>
        </div>
      )}
    </Section>
  )
}

function StatsSection({
  stats,
  onSeek,
}: {
  stats: Record<string, any>
  onSeek: (seconds: number) => void
}) {
  const people = asRecord(stats.people)
  const objects = asRecord(stats.objects)
  const speech = asRecord(stats.speech)
  const series = asArray(people.series)

  return (
    <Section
      title="Statistics"
      icon={<Activity className="size-4" />}
      subtitle="counted, not inferred"
    >
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Duration" value={formatDuration(num(stats.duration))} />
        <Stat label="Chunks" value={num(stats.chunks)} />
        {Object.keys(people).length > 0 && (
          <>
            <Stat
              label="People per chunk"
              value={num(people.mean).toFixed(1)}
              hint={`${num(people.min)}–${num(people.max)} range`}
            />
            <Stat label="Sightings" value={num(people.total_observations)} />
          </>
        )}
        {Object.keys(speech).length > 0 && (
          <>
            <Stat
              label="Speech"
              value={formatDuration(num(speech.spoken_seconds))}
              hint={
                speech.speech_ratio !== null && speech.speech_ratio !== undefined
                  ? `${Math.round(num(speech.speech_ratio) * 100)}% of runtime`
                  : undefined
              }
            />
            <Stat
              label="Words"
              value={num(speech.words)}
              hint={`across ${num(speech.chunks_with_speech)} chunks`}
            />
          </>
        )}
        {Object.keys(objects).length > 0 && (
          <Stat label="Distinct objects" value={num(objects.distinct)} />
        )}
      </div>

      {(people.busiest || people.quietest) && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {[
            { label: 'Busiest moment', value: asRecord(people.busiest) },
            { label: 'Quietest moment', value: asRecord(people.quietest) },
          ].map(({ label, value }) =>
            Object.keys(value).length ? (
              <div
                key={label}
                className="flex items-center justify-between rounded-lg border bg-background px-3 py-2"
              >
                <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
                <span className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold tabular-nums">
                    {num(value.count)} people
                  </span>
                  <TimeLink
                    seconds={num(value.start)}
                    end={num(value.end)}
                    onSeek={onSeek}
                    showIcon
                  />
                </span>
              </div>
            ) : null
          )}
        </div>
      )}

      {series.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            People over time
          </div>
          <PeopleSparkline series={series} max={num(people.max, 1)} onSeek={onSeek} />
        </div>
      )}

      {counted(objects.most_common).length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Most common objects
          </div>
          <ul className="space-y-1">
            {counted(objects.most_common).map((object) => (
              <li key={object.name} className="flex items-center gap-2">
                <span className="w-40 shrink-0 truncate text-[12px]">{object.name}</span>
                <ShareBar value={object.count / counted(objects.most_common)[0].count} />
                <span className="w-8 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                  {object.count}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  )
}

/** One bar per chunk, height by headcount. Click a bar to play that moment. */
function PeopleSparkline({
  series,
  max,
  onSeek,
}: {
  series: any[]
  max: number
  onSeek: (seconds: number) => void
}) {
  return (
    <div className="flex h-16 items-end gap-px overflow-hidden rounded-lg border bg-background p-1">
      {series.map((point, index) => {
        const count = num(asRecord(point).people_count)
        const start = num(asRecord(point).start)
        return (
          <button
            key={index}
            type="button"
            onClick={() => onSeek(start)}
            title={`${count} people at ${formatDuration(start)}`}
            className="min-w-px flex-1 rounded-sm bg-primary/30 transition-colors hover:bg-primary"
            style={{ height: `${Math.max(4, (count / Math.max(1, max)) * 100)}%` }}
          />
        )
      })}
    </div>
  )
}

function EventsSection({
  events,
  onSeek,
  onOpenChunk,
}: {
  events: ReturnType<typeof readEvents>
  onSeek: (seconds: number) => void
  onOpenChunk: (chunkId: number) => void
}) {
  const categories = [...new Set(events.map((event) => event.category).filter(Boolean))]
  const [category, setCategory] = useState<string | null>(null)
  const shown = category ? events.filter((event) => event.category === category) : events

  return (
    <Section
      title="Events"
      icon={<Zap className="size-4" />}
      count={events.length}
      actions={
        categories.length > 1 ? (
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => setCategory(null)}
              className={cn(
                'rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                category === null
                  ? 'border-primary/30 bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted'
              )}
            >
              All
            </button>
            {categories.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setCategory(value)}
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[11px] capitalize transition-colors',
                  category === value
                    ? 'border-primary/30 bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted'
                )}
              >
                {value}
              </button>
            ))}
          </div>
        ) : undefined
      }
    >
      <ul className="relative space-y-2 border-l pl-4">
        {shown.map((event, index) => (
          <li key={`${event.start}-${index}`} className="relative">
            <span className="absolute -left-[21px] top-2 size-2 rounded-full bg-primary/60 ring-4 ring-card" />
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <TimeLink seconds={event.start} onSeek={onSeek} showIcon className="font-medium" />
              {event.category && (
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] capitalize text-muted-foreground">
                  {event.category}
                </span>
              )}
              {event.chunk_id >= 0 && (
                <button
                  type="button"
                  onClick={() => onOpenChunk(event.chunk_id)}
                  className="text-[10px] text-muted-foreground underline-offset-2 hover:text-primary hover:underline"
                >
                  chunk {event.chunk_id}
                </button>
              )}
            </div>
            <p className="mt-0.5 text-[13px] leading-snug">{event.event}</p>
            {event.actor && (
              <p className="text-[11px] text-muted-foreground">by {event.actor}</p>
            )}
          </li>
        ))}
      </ul>
    </Section>
  )
}

function NoveltySection({
  novelty,
  onSeek,
}: {
  novelty: Record<string, any>
  onSeek: (seconds: number) => void
}) {
  const ranked = asArray(novelty.ranked)
  const outliers = asArray(novelty.outliers)
  const top = ranked.slice(0, 10)
  const highest = num(asRecord(top[0]).novelty, 1)

  return (
    <Section
      title="Unusual moments"
      defaultOpen={false}
      icon={<Layers className="size-4" />}
      subtitle={`ranked against ${str(novelty.basis) || 'the video'} · mean distance ${num(
        novelty.mean_distance
      ).toFixed(3)}`}
    >
      {top.length === 0 ? (
        <EmptyNote>Too few chunks for &ldquo;unlike the rest&rdquo; to mean anything.</EmptyNote>
      ) : (
        <ul className="space-y-1.5">
          {top.map((row, index) => {
            const entry = asRecord(row)
            const isOutlier = outliers.some(
              (outlier) => num(asRecord(outlier).chunk_id) === num(entry.chunk_id)
            )
            return (
              <li key={index} className="rounded-lg border bg-background p-2.5">
                <div className="flex items-center gap-2">
                  <TimeLink
                    seconds={num(entry.start)}
                    end={num(entry.end)}
                    onSeek={onSeek}
                    showIcon
                    className="font-medium"
                  />
                  {isOutlier && (
                    <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                      outlier
                    </span>
                  )}
                  <span className="ml-auto flex w-32 items-center gap-2">
                    <ShareBar value={num(entry.novelty) / Math.max(highest, 0.0001)} />
                    <span className="text-[10px] tabular-nums text-muted-foreground">
                      {num(entry.novelty).toFixed(3)}
                    </span>
                  </span>
                </div>
                {entry.description && (
                  <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
                    {str(entry.description)}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Section>
  )
}

function NamedEntitiesSection({ ner }: { ner: Record<string, any> }) {
  const byLabel = asRecord(ner.by_label)
  const entities = asArray(ner.entities)

  return (
    <Section
      title="Named entities"
      defaultOpen={false}
      icon={<Tag className="size-4" />}
      count={entities.length}
      subtitle={
        asArray(ner.based_on).length ? `from ${asArray(ner.based_on).join(', ')}` : undefined
      }
    >
      <div className="space-y-3">
        {Object.entries(byLabel).map(([label, values]) => (
          <div key={label}>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {label}
            </div>
            <Chips items={asArray(values).map(str)} tone="outline" />
          </div>
        ))}
      </div>

      {entities.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-[12px]">
            <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr className="border-b">
                <th className="py-1.5 pr-3 font-medium">Entity</th>
                <th className="py-1.5 pr-3 font-medium">Label</th>
                <th className="py-1.5 pr-3 text-right font-medium">Mentions</th>
                <th className="py-1.5 pr-3 text-right font-medium">Score</th>
                <th className="py-1.5 font-medium">Chunks</th>
              </tr>
            </thead>
            <tbody>
              {entities.map((row, index) => {
                const entity = asRecord(row)
                return (
                  <tr key={index} className="border-b last:border-0">
                    <td className="py-1.5 pr-3 font-medium">{str(entity.text)}</td>
                    <td className="py-1.5 pr-3 text-muted-foreground">{str(entity.label)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{num(entity.mentions)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">
                      {num(entity.score).toFixed(2)}
                    </td>
                    <td className="py-1.5 text-muted-foreground">
                      {asArray(entity.chunk_ids).slice(0, 12).join(', ')}
                      {asArray(entity.chunk_ids).length > 12 && ' …'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  )
}
