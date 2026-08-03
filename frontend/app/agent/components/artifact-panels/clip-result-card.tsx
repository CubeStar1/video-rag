'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Copy, Crosshair, ExternalLink, Film, Play } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatRange, formatTimestamp, toPlayerUrl } from '@/lib/videodb/format'
import type { ClipItem } from '@/lib/videodb/types'

const isHls = (url: string) => /\.m3u8(\?|#|$)/i.test(url)

interface ClipResultCardProps {
  clip: ClipItem
  /** 1-based position in the result set, shown like a search-result rank. */
  rank: number
  isActive: boolean
  onSelect: () => void
  onLocate?: () => void
}

/**
 * One retrieved moment, rendered as a search result: the clip itself loops muted
 * as its own thumbnail, over the timestamp and the matched description. Clicking
 * loads it into the panel's player.
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
  const playerLink = toPlayerUrl(clip.stream_url)

  const copyUrl = async () => {
    await navigator.clipboard.writeText(clip.stream_url)
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
              title="Copy stream URL"
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {copied ? (
                <Check className="size-3.5 text-emerald-500" />
              ) : (
                <Copy className="size-3.5" />
              )}
            </button>
            {playerLink && (
              <a
                href={playerLink}
                target="_blank"
                rel="noreferrer"
                title="Open in VideoDB player"
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
 * The clip playing as its own thumbnail: muted and looping, and only attached
 * once the card scrolls into view so a long result grid loads a handful of
 * streams rather than all of them at once.
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

  useEffect(() => {
    const video = videoRef.current
    if (!isVisible || !video) return

    let cancelled = false
    let hls: { destroy: () => void } | null = null
    const play = () => void video.play().catch(() => {})

    // Safari plays HLS natively; everywhere else hls.js is loaded on demand so the
    // grid does not pay for it until a card is actually on screen.
    if (!isHls(clip.stream_url) || video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = clip.stream_url
      play()
    } else {
      void import('hls.js').then(({ default: Hls }) => {
        if (cancelled || !Hls.isSupported()) return
        const instance = new Hls({ maxBufferLength: 10 })
        hls = instance
        instance.loadSource(clip.stream_url)
        instance.attachMedia(video)
        instance.on(Hls.Events.MANIFEST_PARSED, play)
      })
    }

    return () => {
      cancelled = true
      hls?.destroy()
      video.removeAttribute('src')
    }
  }, [isVisible, clip.stream_url])

  return (
    <span ref={containerRef} className={cn('block size-full', className)}>
      {isVisible && (
        <video
          ref={videoRef}
          muted
          loop
          playsInline
          preload="metadata"
          poster={clip.thumbnail_url ?? undefined}
          onLoadedData={() => setHasFrame(true)}
          className="size-full object-cover"
        />
      )}
      {!hasFrame && !clip.thumbnail_url && (
        <span className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-muted to-muted/40">
          <Film className="size-6 animate-pulse text-muted-foreground/50" />
        </span>
      )}
    </span>
  )
}
