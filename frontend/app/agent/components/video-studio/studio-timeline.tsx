'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Minus, Plus, Scan } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatTimestamp } from '@/lib/core/format'
import type { SceneSegment, TranscriptSegment } from '@/lib/core/types'

interface StudioTimelineProps {
  duration: number
  scenes: SceneSegment[]
  transcript: TranscriptSegment[]
  currentTime: number
  isPlaying: boolean
  selectedSceneId?: string | null
  onSeek: (seconds: number) => void
  onSelectScene: (scene: SceneSegment) => void
  onSelectTranscript: (segment: TranscriptSegment) => void
}

const MIN_ZOOM = 1
const MAX_ZOOM = 24
const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]

/** Pick a tick interval that lands labels roughly every 90px. */
function tickStep(duration: number, width: number): number {
  const target = (duration / Math.max(width, 1)) * 90
  return TICK_STEPS.find((step) => step >= target) ?? 3600
}

/**
 * Editor-style scrubber: a time ruler over a scene track and a speech track.
 * Every block is clickable — clicking seeks the player and selects the segment.
 */
export function StudioTimeline({
  duration,
  scenes,
  transcript,
  currentTime,
  isPlaying,
  selectedSceneId,
  onSeek,
  onSelectScene,
  onSelectTranscript,
}: StudioTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [viewportWidth, setViewportWidth] = useState(0)
  const [zoom, setZoom] = useState(1)

  useLayoutEffect(() => {
    const node = scrollRef.current
    if (!node) return

    const observer = new ResizeObserver(([entry]) => {
      setViewportWidth(entry.contentRect.width)
    })
    observer.observe(node)
    setViewportWidth(node.clientWidth)

    return () => observer.disconnect()
  }, [])

  const safeDuration = duration > 0 ? duration : 1
  const contentWidth = Math.max(viewportWidth * zoom, 1)
  const xOf = useCallback(
    (seconds: number) => (Math.min(Math.max(seconds, 0), safeDuration) / safeDuration) * contentWidth,
    [contentWidth, safeDuration]
  )
  const widthOf = useCallback(
    (start: number, end: number) => Math.max(xOf(end) - xOf(start), 2),
    [xOf]
  )

  // Keep the playhead on screen while zoomed in and playing.
  useEffect(() => {
    const node = scrollRef.current
    if (!node || !isPlaying || zoom <= 1) return

    const x = xOf(currentTime)
    const { scrollLeft, clientWidth } = node
    if (x < scrollLeft + 40 || x > scrollLeft + clientWidth - 40) {
      node.scrollTo({ left: Math.max(0, x - clientWidth / 2), behavior: 'smooth' })
    }
  }, [currentTime, isPlaying, zoom, xOf])

  const seekFromPointer = (event: React.MouseEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const ratio = (event.clientX - bounds.left) / Math.max(bounds.width, 1)
    onSeek(Math.min(Math.max(ratio, 0), 1) * safeDuration)
  }

  const step = tickStep(safeDuration, contentWidth)
  const ticks: number[] = []
  for (let time = 0; time <= safeDuration; time += step) ticks.push(time)

  const isEmpty = scenes.length === 0 && transcript.length === 0

  return (
    <div className="flex flex-col border-y bg-muted/20">
      {/* Zoom controls */}
      <div className="flex items-center justify-between gap-2 px-3 py-1.5">
        <div className="flex items-center gap-2 text-[11px] font-medium tabular-nums text-muted-foreground">
          <span className="text-foreground">{formatTimestamp(currentTime)}</span>
          <span>/</span>
          <span>{formatTimestamp(duration)}</span>
        </div>

        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setZoom((value) => Math.max(MIN_ZOOM, value / 1.5))}
            disabled={zoom <= MIN_ZOOM}
            title="Zoom out"
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            <Minus className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setZoom(1)}
            title="Fit to width"
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Scan className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setZoom((value) => Math.min(MAX_ZOOM, value * 1.5))}
            disabled={zoom >= MAX_ZOOM}
            title="Zoom in"
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            <Plus className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="flex">
        {/* Track labels live outside the scroller so they never sit over a block. */}
        <div className="w-16 shrink-0 border-r bg-muted/30">
          <div className="h-6 border-b border-border/60" />
          <TrackLabel>Scenes</TrackLabel>
          <TrackLabel>Speech</TrackLabel>
        </div>

        <div ref={scrollRef} className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
          <div className="relative select-none" style={{ width: contentWidth }}>
            {/* Ruler */}
            <div
              onClick={seekFromPointer}
              className="relative h-6 cursor-pointer border-b border-border/60"
            >
              {ticks.map((time) => (
                <div
                  key={time}
                  className="absolute top-0 flex h-full flex-col justify-end"
                  style={{ left: xOf(time) }}
                >
                  <span className="absolute top-0.5 left-1 text-[10px] tabular-nums text-muted-foreground">
                    {formatTimestamp(time)}
                  </span>
                  <div className="h-1.5 w-px bg-border" />
                </div>
              ))}
            </div>

            {/* Scene track — numbered blocks; the description lives in the list below. */}
            <TrackRow onBackgroundClick={seekFromPointer}>
              {scenes.map((scene, index) => {
                const isActive = currentTime >= scene.start && currentTime < scene.end
                const isSelected = selectedSceneId === scene.id

                return (
                  <button
                    key={scene.id}
                    type="button"
                    onClick={() => onSelectScene(scene)}
                    title={`${index + 1}. ${formatTimestamp(scene.start)} — ${
                      scene.description || 'Scene'
                    }`}
                    style={{
                      left: xOf(scene.start),
                      width: widthOf(scene.start, scene.end),
                    }}
                    className={cn(
                      'absolute top-1 bottom-1 flex items-center justify-center overflow-hidden rounded-[3px] border transition-colors',
                      isSelected
                        ? 'border-primary bg-primary/40 ring-1 ring-primary'
                        : isActive
                          ? 'border-primary/50 bg-primary/25'
                          : 'border-primary/25 bg-primary/10 hover:bg-primary/25'
                    )}
                  >
                    <span
                      className={cn(
                        'text-[10px] font-semibold tabular-nums',
                        isSelected || isActive ? 'text-foreground' : 'text-foreground/60'
                      )}
                    >
                      {index + 1}
                    </span>
                  </button>
                )
              })}
            </TrackRow>

            {/* Speech track */}
            <TrackRow onBackgroundClick={seekFromPointer}>
              {transcript.map((segment, index) => (
                <button
                  key={`${segment.start}-${index}`}
                  type="button"
                  onClick={() => onSelectTranscript(segment)}
                  title={`${formatTimestamp(segment.start)} — ${segment.text}`}
                  style={{
                    left: xOf(segment.start),
                    width: widthOf(segment.start, segment.end),
                  }}
                  className={cn(
                    'absolute top-1.5 bottom-1.5 overflow-hidden rounded-[3px] border transition-colors',
                    currentTime >= segment.start && currentTime < segment.end
                      ? 'border-emerald-500/60 bg-emerald-500/35'
                      : 'border-emerald-500/25 bg-emerald-500/15 hover:bg-emerald-500/25'
                  )}
                />
              ))}
            </TrackRow>

            {isEmpty && (
              <div className="pointer-events-none absolute inset-x-0 top-6 bottom-0 flex items-center justify-center">
                <span className="rounded bg-background/80 px-2 py-1 text-[11px] text-muted-foreground">
                  No indexed segments yet
                </span>
              </div>
            )}

            {/* Playhead — eased so the 10Hz time updates read as continuous motion. */}
            <div
              className={cn(
                'pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-red-500',
                isPlaying && 'transition-[left] duration-100 ease-linear'
              )}
              style={{ left: xOf(currentTime) }}
            >
              <div className="absolute -left-[3px] top-0 size-[7px] rounded-full bg-red-500" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function TrackLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-8 items-center border-b border-border/40 px-2 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground last:border-b-0">
      {children}
    </div>
  )
}

function TrackRow({
  onBackgroundClick,
  children,
}: {
  onBackgroundClick: (event: React.MouseEvent<HTMLDivElement>) => void
  children: React.ReactNode
}) {
  return (
    <div className="relative h-8 border-b border-border/40 last:border-b-0">
      <div onClick={onBackgroundClick} className="absolute inset-0 cursor-pointer bg-muted/30" />
      {children}
    </div>
  )
}
