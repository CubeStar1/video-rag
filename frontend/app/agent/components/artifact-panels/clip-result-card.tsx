'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Copy, Crosshair, ExternalLink, Film, Play } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatRange, formatTimestamp, toFragmentUrl } from '@/lib/core/format'
import type { ClipItem } from '@/lib/core/types'

interface ClipResultCardProps {
  clip: ClipItem
  /** 1-based position in the result set, shown like a search-result rank. */
  rank: number
  isActive: boolean
  onSelect: () => void
  onLocate?: () => void
}

/**
 * One retrieved moment, rendered as a search result: a frame from the clip as
 * its thumbnail, over the timestamp and the matched description. Clicking loads
 * it into the panel's player.
 */
export function ClipResultCard({
  clip,
  rank,
  isActive,
  onSelect,
  onLocate,
}: ClipResultCardProps) {
  const [copied, setCopied] = useState(false)

  const duration = Math.max(0, clip.end - clip.start)
  const caption = clip.label || clip.text || 'Matched moment'
  const deepLink = toFragmentUrl(clip.url, clip.start, clip.end)

  const copyUrl = async () => {
    if (!deepLink) return
    await navigator.clipboard.writeText(deepLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-xl border bg-card transition-all',
        isActive
          ? 'border-primary/60 ring-2 ring-primary/30'
          : 'hover:border-foreground/20 hover:shadow-md'
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-label={`Play clip ${rank}, ${formatRange(clip.start, clip.end)}`}
        className="relative block aspect-video w-full overflow-hidden bg-muted"
      >
        <ClipThumb clip={clip} />

        {/* Legibility wash behind the overlaid metadata */}
        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/75 to-transparent" />

        <span
          className={cn(
            'absolute left-2 top-2 flex size-5 items-center justify-center rounded-md text-[10px] font-semibold tabular-nums backdrop-blur',
            isActive ? 'bg-primary text-primary-foreground' : 'bg-black/55 text-white'
          )}
        >
          {rank}
        </span>

        {typeof clip.score === 'number' && (
          <span
            title="Relevance score"
            className="absolute right-2 top-2 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-white backdrop-blur"
          >
            {clip.score.toFixed(2)}
          </span>
        )}

        <span className="absolute bottom-2 left-2 text-[11px] font-medium tabular-nums text-white drop-shadow">
          {formatRange(clip.start, clip.end)}
        </span>
        <span className="absolute bottom-2 right-2 rounded bg-black/65 px-1 py-0.5 text-[10px] font-medium tabular-nums text-white">
          {formatTimestamp(duration)}
        </span>

        <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
          <span className="flex size-10 items-center justify-center rounded-full bg-black/60 backdrop-blur">
            <Play className="size-4 translate-x-px fill-white text-white" />
          </span>
        </span>
      </button>

      <div className="flex min-w-0 flex-1 flex-col gap-1 px-3 py-2.5">
        <button type="button" onClick={onSelect} className="min-w-0 text-left">
          <p
            className={cn(
              'line-clamp-2 text-[13px] font-medium leading-snug',
              isActive && 'text-primary'
            )}
          >
            {caption}
          </p>
        </button>

        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          {clip.video_title ? (
            <span className="truncate text-[11px] text-muted-foreground">
              {clip.video_title}
            </span>
          ) : (
            <span />
          )}

          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            {onLocate && (
              <button
                type="button"
                onClick={onLocate}
                title="Show in the timeline"
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Crosshair className="size-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => void copyUrl()}
              title="Copy a link to this moment"
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {copied ? (
                <Check className="size-3.5 text-emerald-500" />
              ) : (
                <Copy className="size-3.5" />
              )}
            </button>
            {deepLink && (
              <a
                href={deepLink}
                target="_blank"
                rel="noreferrer"
                title="Open this moment in a new tab"
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <ExternalLink className="size-3.5" />
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * A frame from the clip, as its own thumbnail.
 *
 * The media fragment `#t=start` is what makes this cheap: the browser range-
 * requests only the bytes around that offset and paints the frame, so a grid of
 * twenty results does not download twenty videos. Only attached once the card
 * scrolls into view, and only played (muted, looping the clip's own span) on
 * hover — a grid of simultaneously playing videos is a lot of decode for a
 * preview nobody is watching yet.
 */
export function ClipThumb({ clip, className }: { clip: ClipItem; className?: string }) {
  const containerRef = useRef<HTMLSpanElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isVisible, setIsVisible] = useState(false)
  const [hasFrame, setHasFrame] = useState(false)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(entry.isIntersecting),
      { rootMargin: '200px' }
    )
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  // Hover preview: loop the clip's own span rather than playing on into the
  // next scene, which is what a thumbnail of *this moment* has to mean.
  useEffect(() => {
    const container = containerRef.current
    const video = videoRef.current
    if (!isVisible || !container || !video) return

    const loop = () => {
      if (video.currentTime >= clip.end || video.currentTime < clip.start - 0.25) {
        video.currentTime = clip.start
      }
    }
    const enter = () => {
      video.currentTime = clip.start
      video.addEventListener('timeupdate', loop)
      void video.play().catch(() => {})
    }
    const leave = () => {
      video.pause()
      video.removeEventListener('timeupdate', loop)
      video.currentTime = clip.start
    }

    container.addEventListener('pointerenter', enter)
    container.addEventListener('pointerleave', leave)
    return () => {
      container.removeEventListener('pointerenter', enter)
      container.removeEventListener('pointerleave', leave)
      video.removeEventListener('timeupdate', loop)
    }
  }, [isVisible, clip.start, clip.end])

  return (
    <span ref={containerRef} className={cn('block size-full', className)}>
      {isVisible && (
        <video
          ref={videoRef}
          src={`${clip.url.split('#')[0]}#t=${clip.start.toFixed(2)}`}
          muted
          playsInline
          preload="metadata"
          poster={clip.poster_url ?? undefined}
          onLoadedData={() => setHasFrame(true)}
          className="size-full object-cover"
        />
      )}
      {!hasFrame && !clip.poster_url && (
        <span className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-muted to-muted/40">
          <Film className="size-6 animate-pulse text-muted-foreground/50" />
        </span>
      )}
    </span>
  )
}
