'use client'

import { useCallback, useDeferredValue, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowDownWideNarrow,
  Clock,
  Crosshair,
  Film,
  LayoutGrid,
  ListVideo,
  Rows3,
  Scissors,
  Search,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatRange, formatTimestamp } from '@/lib/core/format'
import { VideoPlayer, type VideoPlayerHandle } from '@/app/agent/components/video-player'
import {
  ClipDownloadButton,
  ClipResultCard,
  ClipThumb,
} from '@/app/agent/components/artifact-panels/clip-result-card'
import { useClipCut } from '@/hooks/use-clip-cut'
import { useAgentStore } from '@/app/agent/store/agent-store'
import type { ClipItem } from '@/lib/core/types'

interface ClipReelPanelProps {
  clips: ClipItem[]
}

type SortMode = 'relevance' | 'timeline'
type ViewMode = 'grid' | 'list'

/**
 * The results surface for a natural-language clip search: a player pinned at the
 * top and, beneath it, every retrieved moment as a browsable thumbnail. Standalone
 * (props only, no store access beyond the timeline hand-off) so it can be reused
 * outside the artifact panel — the panel header supplies the title.
 */
export function ClipReelPanel({ clips }: ClipReelPanelProps) {
  const playerRef = useRef<VideoPlayerHandle>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  // "Play all" is a client-side sequencer now: there is no compiled stream to
  // fetch, so playing every moment back to back means advancing the range as
  // each one ends. Clips from the same video do not even reload the source.
  const [isPlayingAll, setIsPlayingAll] = useState(false)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortMode>('relevance')
  const [view, setView] = useState<ViewMode>('grid')
  const seekStudio = useAgentStore((state) => state.seekStudio)

  // The rank shown on a card is its position in the retrieval result, so it stays
  // pinned to the clip even when the list is re-sorted or filtered.
  const ranked = useMemo(
    () => clips.map((clip, index) => ({ clip, id: String(index), rank: index + 1 })),
    [clips]
  )

  const deferredQuery = useDeferredValue(query)
  const results = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase()
    const matched = needle
      ? ranked.filter(({ clip }) =>
          [clip.label, clip.text, clip.video_title]
            .filter(Boolean)
            .some((field) => field!.toLowerCase().includes(needle))
        )
      : ranked

    return sort === 'timeline'
      ? [...matched].sort((a, b) => a.clip.start - b.clip.start)
      : matched
  }, [ranked, deferredQuery, sort])

  const active = clips[activeIndex] ?? clips[0]

  // The selected clip is cut for real before it plays. While playing through
  // the reel the next one is cut in the background, so the hand-off between
  // clips is not a stall per clip.
  const cut = useClipCut(active)
  const upcoming = isPlayingAll ? clips[activeIndex + 1] : undefined
  useClipCut(upcoming, Boolean(upcoming))

  const cutUnavailable = !cut.supported || cut.status === 'error'

  const select = useCallback((index: number) => {
    setActiveIndex(index)
    setIsPlayingAll(false)
  }, [])

  // Advance to the next clip when one finishes, but only while playing all —
  // otherwise a clip ending should simply stop, as it did when each clip was
  // its own stream.
  const handleRangeEnd = useCallback(() => {
    if (!isPlayingAll) return
    setActiveIndex((index) => {
      const next = index + 1
      if (next >= clips.length) {
        setIsPlayingAll(false)
        return index
      }
      return next
    })
  }, [isPlayingAll, clips.length])

  const totalSeconds = useMemo(
    () => clips.reduce((sum, clip) => sum + Math.max(0, clip.end - clip.start), 0),
    [clips]
  )

  if (clips.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Film className="size-8" />
        <p className="text-sm">No clips to show.</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Player — stays put while the results below scroll */}
      <div className="shrink-0 border-b bg-muted/20 p-4">
        {cut.url ? (
          // The real thing: an mp4 of just this moment, so the scrubber spans
          // the clip and there is nothing outside it to scrub into.
          <VideoPlayer
            ref={playerRef}
            key={cut.url}
            src={cut.url}
            poster={active?.poster_url}
            onRangeEnd={handleRangeEnd}
            autoPlay
          />
        ) : cutUnavailable ? (
          // No WebCodecs, or the cut failed: fall back to fencing the playhead
          // inside the clip's span of the whole file, which always works.
          <VideoPlayer
            ref={playerRef}
            key={active?.url}
            src={active?.url}
            poster={active?.poster_url}
            range={active ? [active.start, active.end] : null}
            onRangeEnd={handleRangeEnd}
            autoPlay
          />
        ) : (
          <CuttingPlaceholder poster={active?.poster_url} progress={cut.progress} />
        )}

        {cutUnavailable && (
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <AlertTriangle className="size-3 shrink-0 text-amber-500" />
            <span>
              {cut.supported
                ? 'This clip could not be cut, so it is playing as a range of the full video.'
                : 'This browser cannot cut video, so clips play as ranges of the full video.'}
            </span>
            {cut.supported && (
              <button
                type="button"
                onClick={cut.retry}
                className="shrink-0 underline underline-offset-2 hover:text-foreground"
              >
                Try again
              </button>
            )}
          </p>
        )}

        <div className="mt-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {active?.label || active?.text || active?.video_title || 'Clip'}
            </p>
            <p className="truncate text-xs tabular-nums text-muted-foreground">
              {active
                ? `${formatRange(active.start, active.end)}${
                    active.video_title ? ` · ${active.video_title}` : ''
                  }${isPlayingAll ? ` · ${activeIndex + 1} of ${clips.length}` : ''}`
                : ''}
            </p>
          </div>
          {clips.length > 1 && (
            <button
              type="button"
              onClick={() => {
                setActiveIndex(0)
                setIsPlayingAll(true)
              }}
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                isPlayingAll
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'bg-background hover:bg-accent'
              )}
            >
              <ListVideo className="size-3.5" />
              Play all
            </button>
          )}
        </div>
      </div>

      {/* Results toolbar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
        <div className="relative min-w-[9rem] flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter these results…"
            className="h-7 w-full rounded-md border bg-background pl-7 pr-7 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              title="Clear filter"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          )}
        </div>

        <ToggleGroup
          value={sort}
          onChange={setSort}
          options={[
            { value: 'relevance', icon: <ArrowDownWideNarrow className="size-3.5" />, title: 'Sort by relevance' },
            { value: 'timeline', icon: <Clock className="size-3.5" />, title: 'Sort by position in the video' },
          ]}
        />
        <ToggleGroup
          value={view}
          onChange={setView}
          options={[
            { value: 'grid', icon: <LayoutGrid className="size-3.5" />, title: 'Grid view' },
            { value: 'list', icon: <Rows3 className="size-3.5" />, title: 'List view' },
          ]}
        />
      </div>

      <div className="flex shrink-0 items-center justify-between px-4 py-1.5 text-[11px] text-muted-foreground">
        <span>
          {results.length === clips.length
            ? `${clips.length} clip${clips.length === 1 ? '' : 's'}`
            : `${results.length} of ${clips.length} clips`}
        </span>
        <span className="tabular-nums">{formatTimestamp(totalSeconds)} total</span>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {results.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <Search className="size-6 text-muted-foreground" />
            <p className="text-sm font-medium">No clips match “{query}”</p>
            <p className="text-xs text-muted-foreground">
              Clear the filter, or ask for a different moment in the chat.
            </p>
          </div>
        ) : view === 'grid' ? (
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(210px,1fr))]">
            {results.map(({ clip, id, rank }) => (
              <ClipResultCard
                key={`${clip.video_id}-${clip.start}-${id}`}
                clip={clip}
                rank={rank}
                isActive={activeIndex === Number(id)}
                onSelect={() => select(Number(id))}
                onLocate={() => seekStudio(clip.start, clip.video_id)}
              />
            ))}
          </div>
        ) : (
          <ul className="divide-y">
            {results.map(({ clip, id, rank }) => (
              <ClipResultRow
                key={`${clip.video_id}-${clip.start}-${id}`}
                clip={clip}
                rank={rank}
                isActive={activeIndex === Number(id)}
                onSelect={() => select(Number(id))}
                onLocate={() => seekStudio(clip.start, clip.video_id)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/**
 * Stands in for the player while the clip is being cut out of its video.
 *
 * Deliberately not the full video playing the range in the meantime: swapping
 * the source out from under someone a second into watching is worse than a
 * short, honest wait.
 */
function CuttingPlaceholder({
  poster,
  progress,
}: {
  poster?: string | null
  progress: number
}) {
  return (
    <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-lg bg-black">
      {poster && (
        // eslint-disable-next-line @next/next/no-img-element -- same source the player uses for its poster
        <img src={poster} alt="" className="absolute inset-0 size-full object-cover opacity-30" />
      )}
      <div className="relative flex w-2/3 max-w-64 flex-col items-center gap-2 text-white">
        <Scissors className="size-5 animate-pulse" />
        <p className="text-xs font-medium">Cutting this clip…</p>
        <div className="h-1 w-full overflow-hidden rounded-full bg-white/20">
          <div
            className="h-full rounded-full bg-white transition-[width] duration-200"
            style={{ width: `${Math.max(3, Math.round(progress * 100))}%` }}
          />
        </div>
      </div>
    </div>
  )
}

/** Compact row for the list view — same result, thumbnail shrunk to a strip. */
function ClipResultRow({
  clip,
  rank,
  isActive,
  onSelect,
  onLocate,
}: {
  clip: ClipItem
  rank: number
  isActive: boolean
  onSelect: () => void
  onLocate: () => void
}) {
  return (
    <li>
      <div
        className={cn(
          'group flex items-start gap-3 py-2.5 transition-colors',
          isActive && 'bg-primary/5'
        )}
      >
        <button
          type="button"
          onClick={onSelect}
          className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-md bg-muted"
        >
          <ClipThumb clip={clip} />
          <span className="absolute bottom-0.5 right-0.5 rounded bg-black/65 px-1 text-[9px] font-medium tabular-nums text-white">
            {formatTimestamp(Math.max(0, clip.end - clip.start))}
          </span>
        </button>

        <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">
              #{rank}
            </span>
            <span className="text-xs font-medium tabular-nums">
              {formatRange(clip.start, clip.end)}
            </span>
            {typeof clip.score === 'number' && (
              <span
                title="Relevance score"
                className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground"
              >
                {clip.score.toFixed(2)}
              </span>
            )}
          </div>
          <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-muted-foreground">
            {clip.label || clip.text || clip.video_title || 'Matched moment'}
          </p>
        </button>

        <div className="mt-1 flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <button
            type="button"
            onClick={onLocate}
            title="Show in the timeline"
            className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Crosshair className="size-3.5" />
          </button>
          <ClipDownloadButton clip={clip} className="p-1.5" />
        </div>
      </div>
    </li>
  )
}

function ToggleGroup<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (value: T) => void
  options: { value: T; icon: React.ReactNode; title: string }[]
}) {
  return (
    <div className="flex shrink-0 items-center rounded-md border p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          title={option.title}
          aria-pressed={value === option.value}
          className={cn(
            'rounded p-1 transition-colors',
            value === option.value
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {option.icon}
        </button>
      ))}
    </div>
  )
}
