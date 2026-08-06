'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Boxes,
  Captions,
  Eye,
  Film,
  LayoutList,
  Rows3,
  Search,
  Type,
  Users,
  X,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatTimestamp } from '@/lib/core/format'
import type { AnalyzerId, ChunkOut } from '@/lib/core/types'
import { Chips, EmptyNote, JsonView, RawDisclosure, TimeLink } from './detail-primitives'

/** Rendering 500 expanded chunks at once is what makes this page feel slow. */
const INITIAL_RENDER = 25

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

/**
 * One hue per analyzer, reused everywhere that analyzer's output appears.
 *
 * Colour is doing real work here rather than decoration: a chunk is six passes
 * merged into one record, and the only way to read it at a glance is for
 * "this came from OCR" to be visible without reading the label.
 */
const ANALYZER_TONES: Record<string, { chip: string; bar: string; ring: string }> = {
  default_video: {
    chip: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
    bar: 'bg-sky-500',
    ring: 'border-sky-500/30',
  },
  diarization: {
    chip: 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
    bar: 'bg-violet-500',
    ring: 'border-violet-500/30',
  },
  transcript: {
    chip: 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
    bar: 'bg-violet-500',
    ring: 'border-violet-500/30',
  },
  ocr: {
    chip: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
    bar: 'bg-amber-500',
    ring: 'border-amber-500/30',
  },
  people: {
    chip: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    bar: 'bg-emerald-500',
    ring: 'border-emerald-500/30',
  },
  object_detection: {
    chip: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
    bar: 'bg-rose-500',
    ring: 'border-rose-500/30',
  },
}

const FACET_TONES: Record<string, string> = {
  Setting: 'bg-teal-500/10 text-teal-700 dark:text-teal-300',
  People: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  Actions: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  Objects: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
  Tags: 'bg-muted text-muted-foreground',
}

/** Stable per-speaker colour, so the same voice looks the same in every chunk. */
const SPEAKER_TONES = [
  'bg-violet-500',
  'bg-sky-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-teal-500',
]

function speakerTone(speaker: string | undefined) {
  if (!speaker) return 'bg-muted-foreground'
  const index = Number(speaker.replace(/\D/g, '')) || 0
  return SPEAKER_TONES[index % SPEAKER_TONES.length]
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

/** A one-line stand-in for a chunk, for the compact rows and the timeline tooltip. */
function chunkGist(chunk: ChunkOut): string {
  return (
    chunk.default_video?.description ||
    chunk.ocr?.summary ||
    chunk.transcript?.text ||
    (chunk.diarization?.turns ?? []).map((turn) => turn.text).join(' ') ||
    (chunk.object_detection?.objects ?? []).join(', ') ||
    'No description'
  )
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
  duration: number
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
  duration,
  currentTime,
  focusChunkId,
  onSeek,
}: ChunkPanelProps) {
  const [search, setSearch] = useState('')
  const [analyzerFilter, setAnalyzerFilter] = useState<AnalyzerId | 'all'>('all')
  const [dense, setDense] = useState(false)
  const [rendered, setRendered] = useState(INITIAL_RENDER)
  const [selected, setSelected] = useState<number | null>(null)

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

  const matched = useMemo(
    () => new Set(filtered.map((chunk) => chunk.chunk_id)),
    [filtered]
  )

  useEffect(() => setRendered(INITIAL_RENDER), [search, analyzerFilter, dense])

  // A jump from another tab must survive the render cap, or the target chunk is
  // simply not on the page to scroll to.
  useEffect(() => {
    if (focusChunkId === null) return
    setSelected(focusChunkId)
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
  const positions = useMemo(
    () => new Map(chunks.map((chunk, index) => [chunk.chunk_id, index])),
    [chunks]
  )

  return (
    <div className="space-y-3">
      {duration > 0 && chunks.length > 0 && (
        <ChunkTimeline
          chunks={chunks}
          duration={duration}
          currentTime={currentTime}
          matched={matched}
          isFiltered={filtered.length !== chunks.length}
          selected={selected}
          onPick={(chunk) => {
            setSelected(chunk.chunk_id)
            onSeek(chunk.start)
            const position = filtered.findIndex((row) => row.chunk_id === chunk.chunk_id)
            if (position >= 0) setRendered((current) => Math.max(current, position + 5))
            window.setTimeout(
              () =>
                document
                  .getElementById(`chunk-${chunk.chunk_id}`)
                  ?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
              60
            )
          }}
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
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

        <button
          type="button"
          onClick={() => setDense((value) => !value)}
          title={dense ? 'Switch to full detail' : 'Switch to compact rows'}
          className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {dense ? <LayoutList className="size-3.5" /> : <Rows3 className="size-3.5" />}
          {dense ? 'Detail' : 'Compact'}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <FilterPill
          active={analyzerFilter === 'all'}
          onClick={() => setAnalyzerFilter('all')}
          label="All passes"
        />
        {analyzers.map((id) => (
          <FilterPill
            key={id}
            active={analyzerFilter === id}
            onClick={() => setAnalyzerFilter(id)}
            label={ANALYZER_LABELS[id] ?? id}
            icon={ANALYZER_ICONS[id]}
            tone={ANALYZER_TONES[id]?.chip}
          />
        ))}
        <span className="ml-auto text-[11px] text-muted-foreground">
          {visible.length} of {filtered.length}
          {filtered.length !== chunks.length && ` · filtered from ${chunks.length}`}
          {chunkTotal > chunks.length && ` · core holds ${chunkTotal}`}
        </span>
      </div>

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
      ) : dense ? (
        <ul className="overflow-hidden rounded-xl border bg-card">
          {visible.map((chunk) => (
            <CompactRow
              key={`${chunk.chunk_id}-${chunk.start}`}
              chunk={chunk}
              index={positions.get(chunk.chunk_id) ?? 0}
              isActive={currentTime >= chunk.start && currentTime < chunk.end}
              isSelected={selected === chunk.chunk_id}
              onSelect={() => {
                setSelected(chunk.chunk_id)
                onSeek(chunk.start)
              }}
            />
          ))}
        </ul>
      ) : (
        <ul className="space-y-3">
          {visible.map((chunk) => (
            <ChunkCard
              key={`${chunk.chunk_id}-${chunk.start}`}
              chunk={chunk}
              index={positions.get(chunk.chunk_id) ?? 0}
              duration={duration}
              isActive={currentTime >= chunk.start && currentTime < chunk.end}
              isSelected={selected === chunk.chunk_id}
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
            onClick={() => setRendered((current) => current + 40)}
          >
            Show {Math.min(remaining, 40)} more ({remaining} left)
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * The whole video as one strip, a block per chunk.
 *
 * Chunks are not fixed spans — the boundary detectors cut where the content
 * changes — so their widths are the clearest picture of how the video was
 * divided, and where the analysis is dense or thin.
 */
function ChunkTimeline({
  chunks,
  duration,
  currentTime,
  matched,
  isFiltered,
  selected,
  onPick,
}: {
  chunks: ChunkOut[]
  duration: number
  currentTime: number
  matched: Set<number>
  isFiltered: boolean
  selected: number | null
  onPick: (chunk: ChunkOut) => void
}) {
  const [hovered, setHovered] = useState<ChunkOut | null>(null)

  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Chunk map
        </span>
        <span className="truncate text-[11px] text-muted-foreground">
          {hovered
            ? `${formatTimestamp(hovered.start)}–${formatTimestamp(hovered.end)} · ${chunkGist(
                hovered
              ).slice(0, 90)}`
            : `${chunks.length} chunks over ${formatTimestamp(duration)}`}
        </span>
      </div>

      <div
        className="relative h-14 w-full overflow-hidden rounded-lg bg-muted/50"
        onMouseLeave={() => setHovered(null)}
      >
        {chunks.map((chunk) => {
          const present = analyzersOn(chunk)
          const left = (chunk.start / duration) * 100
          const width = Math.max(0.15, ((chunk.end - chunk.start) / duration) * 100)
          const isActive = currentTime >= chunk.start && currentTime < chunk.end
          const dimmed = isFiltered && !matched.has(chunk.chunk_id)

          return (
            <button
              key={chunk.chunk_id}
              type="button"
              onMouseEnter={() => setHovered(chunk)}
              onClick={() => onPick(chunk)}
              title={`Chunk ${chunk.chunk_id}`}
              className={cn(
                'absolute bottom-0 top-0 flex flex-col justify-end gap-px overflow-hidden border-r border-background/60 px-px pb-px transition-opacity',
                dimmed ? 'opacity-20' : 'hover:opacity-80',
                isActive && 'bg-primary/10',
                selected === chunk.chunk_id && 'bg-primary/15'
              )}
              style={{ left: `${left}%`, width: `${width}%` }}
            >
              {/* One band per pass that produced output — a tall stack is a
                  richly analysed moment, a short one is a gap. */}
              {ANALYZER_ORDER.filter((id) => present.includes(id)).map((id) => (
                <span
                  key={id}
                  className={cn('h-1.5 w-full rounded-sm', ANALYZER_TONES[id]?.bar ?? 'bg-primary')}
                />
              ))}
            </button>
          )
        })}

        <div
          className="pointer-events-none absolute bottom-0 top-0 z-10 w-0.5 bg-foreground"
          style={{ left: `${Math.min(100, (currentTime / duration) * 100)}%` }}
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {ANALYZER_ORDER.filter((id) => chunks.some((chunk) => analyzersOn(chunk).includes(id))).map(
          (id) => (
            <span
              key={id}
              className="flex items-center gap-1 text-[10px] text-muted-foreground"
            >
              <span className={cn('size-2 rounded-sm', ANALYZER_TONES[id]?.bar)} />
              {ANALYZER_LABELS[id] ?? id}
            </span>
          )
        )}
        <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
          {formatTimestamp(currentTime)}
        </span>
      </div>
    </div>
  )
}

function FilterPill({
  active,
  onClick,
  label,
  icon,
  tone,
}: {
  active: boolean
  onClick: () => void
  label: string
  icon?: React.ReactNode
  tone?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
        active
          ? cn('border-transparent', tone ?? 'bg-primary/10 text-primary')
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      )}
    >
      {icon}
      {label}
    </button>
  )
}

/** One line per chunk, for scanning a long video rather than reading it. */
function CompactRow({
  chunk,
  index,
  isActive,
  isSelected,
  onSelect,
}: {
  chunk: ChunkOut
  index: number
  isActive: boolean
  isSelected: boolean
  onSelect: () => void
}) {
  const present = analyzersOn(chunk)

  return (
    <li id={`chunk-${chunk.chunk_id}`} className="scroll-mt-24 border-b last:border-0">
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'flex w-full items-center gap-3 px-3 py-2 text-left transition-colors',
          isSelected ? 'bg-primary/5' : isActive ? 'bg-muted/60' : 'hover:bg-muted/40'
        )}
      >
        <span className="w-8 shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {index + 1}
        </span>
        <span
          className={cn(
            'w-24 shrink-0 text-[11px] tabular-nums',
            isActive ? 'font-semibold text-primary' : 'text-muted-foreground'
          )}
        >
          {formatTimestamp(chunk.start)}–{formatTimestamp(chunk.end)}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px]">{chunkGist(chunk)}</span>
        <span className="flex shrink-0 gap-1">
          {present.map((id) => (
            <span
              key={id}
              title={ANALYZER_LABELS[id] ?? id}
              className={cn('size-2 rounded-sm', ANALYZER_TONES[id]?.bar)}
            />
          ))}
        </span>
      </button>
    </li>
  )
}

function ChunkCard({
  chunk,
  index,
  duration,
  isActive,
  isSelected,
  analyzerFilter,
  onSeek,
}: {
  chunk: ChunkOut
  index: number
  duration: number
  isActive: boolean
  isSelected: boolean
  analyzerFilter: AnalyzerId | 'all'
  onSeek: (seconds: number) => void
}) {
  const present = analyzersOn(chunk)
  const shows = (id: AnalyzerId) => analyzerFilter === 'all' || analyzerFilter === id

  const scene = chunk.default_video
  const people = chunk.people
  const objects = chunk.object_detection
  const length = chunk.end - chunk.start

  return (
    <li
      id={`chunk-${chunk.chunk_id}`}
      className={cn(
        'group scroll-mt-24 overflow-hidden rounded-xl border bg-card transition-colors',
        isActive && 'border-primary/50 shadow-sm',
        isSelected && 'ring-2 ring-primary/30'
      )}
    >
      {/* Where this chunk sits in the video — the strip fills as it plays. */}
      {duration > 0 && (
        <div className="relative h-0.5 w-full bg-muted">
          <span
            className={cn('absolute h-full', isActive ? 'bg-primary' : 'bg-primary/30')}
            style={{
              left: `${(chunk.start / duration) * 100}%`,
              width: `${Math.max(0.3, (length / duration) * 100)}%`,
            }}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 bg-muted/30 px-4 py-2">
        <span
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-semibold tabular-nums',
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
          className="text-xs font-semibold text-foreground"
        />
        <span className="rounded-full bg-background px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
          {length.toFixed(1)}s
        </span>
        <span className="text-[10px] text-muted-foreground">id {chunk.chunk_id}</span>

        <div className="ml-auto flex flex-wrap items-center gap-1">
          {present.map((id) => (
            <span
              key={id}
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                ANALYZER_TONES[id]?.chip ?? 'bg-muted text-muted-foreground'
              )}
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
            <div className="mt-2.5 space-y-1.5">
              <FacetRow label="Setting" items={scene.setting ? [scene.setting] : undefined} />
              <FacetRow label="People" items={scene.people} />
              <FacetRow label="Actions" items={scene.actions} />
              <FacetRow label="Objects" items={scene.objects} />
              <FacetRow label="Tags" items={scene.tags} />
            </div>
          </Block>
        )}

        {chunk.diarization && shows('diarization') && (
          <Block
            id="diarization"
            note={
              (chunk.diarization.speakers ?? []).length
                ? `${(chunk.diarization.speakers ?? []).length} speaker${
                    (chunk.diarization.speakers ?? []).length === 1 ? '' : 's'
                  }`
                : undefined
            }
          >
            {(chunk.diarization.turns ?? []).length === 0 ? (
              <EmptyNote>No speech in this chunk.</EmptyNote>
            ) : (
              <ul className="space-y-1.5">
                {(chunk.diarization.turns ?? []).map((turn, turnIndex) => (
                  <li
                    key={`${turn.start}-${turnIndex}`}
                    className="flex items-start gap-2 rounded-lg bg-muted/40 px-2.5 py-1.5"
                  >
                    <span
                      className={cn(
                        'mt-1 size-2 shrink-0 rounded-full',
                        speakerTone(turn.speaker)
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {turn.speaker?.replace(/^SPEAKER_/, 'Speaker ') ?? 'Unattributed'}
                        </span>
                        <TimeLink seconds={turn.start} end={turn.end} onSeek={onSeek} />
                      </div>
                      <p className="text-[13px] leading-snug">{turn.text}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Block>
        )}

        {chunk.transcript && shows('transcript') && (
          <Block id="transcript">
            {chunk.transcript.text?.trim() ? (
              <p className="rounded-lg bg-muted/40 px-2.5 py-2 text-[13px] leading-relaxed">
                {chunk.transcript.text}
              </p>
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
              <ul className="flex flex-wrap gap-1.5">
                {(chunk.ocr.texts ?? []).map((entry, textIndex) => (
                  <li
                    key={textIndex}
                    className="rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1"
                    title={entry.context}
                  >
                    <span className="font-mono text-[12px] leading-none">{entry.text}</span>
                    {entry.context && (
                      <span className="mt-0.5 block text-[10px] text-muted-foreground">
                        {entry.context}
                      </span>
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
              people.people_count !== undefined ? `${people.people_count} detected` : undefined
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
                  <li
                    key={detectionIndex}
                    className="rounded-lg border-l-2 border-rose-500/40 bg-rose-500/5 py-1 pl-2.5 text-[13px] leading-snug"
                  >
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
    <div className={cn('border-l-2 pl-3', ANALYZER_TONES[id]?.ring ?? 'border-muted')}>
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {ANALYZER_ICONS[id]}
        {ANALYZER_LABELS[id] ?? id}
        {note && <span className="font-normal normal-case tracking-normal">· {note}</span>}
      </div>
      {children}
    </div>
  )
}

function FacetRow({ label, items }: { label: string; items?: string[] }) {
  if (!items || items.length === 0) return null

  return (
    <div className="flex flex-wrap items-baseline gap-1.5">
      <span className="w-14 shrink-0 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
        {label}
      </span>
      {items.map((item, index) => (
        <span
          key={`${item}-${index}`}
          className={cn(
            'rounded-md px-1.5 py-0.5 text-[11px] leading-snug',
            FACET_TONES[label] ?? 'bg-muted text-muted-foreground'
          )}
        >
          {item}
        </span>
      ))}
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
    <li className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2.5">
      <div className="flex items-center gap-2">
        <span className="flex size-6 items-center justify-center rounded-full bg-emerald-500/15 text-[10px] font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">
          {(person.box_id as number) ?? index + 1}
        </span>
        {Boolean(person.role) && (
          <span className="text-[12px] font-medium capitalize">{String(person.role)}</span>
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
        <div className="mt-2 border-t border-emerald-500/20 pt-1.5">
          <JsonView value={extra} depth={1} />
        </div>
      )}
    </li>
  )
}
