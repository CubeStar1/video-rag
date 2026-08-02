'use client'

import { useMemo, useRef, useState } from 'react'
import {
  Check,
  Copy,
  Crosshair,
  ExternalLink,
  Film,
  ListVideo,
  Play,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatRange, formatTimestamp, toPlayerUrl } from '@/lib/videodb/format'
import { VideoPlayer, type VideoPlayerHandle } from '@/app/agent/components/video-player'
import { useAgentStore } from '@/app/agent/store/agent-store'
import type { ClipItem } from '@/lib/videodb/types'

interface ClipReelPanelProps {
  clips: ClipItem[]
  /** Optional stream of every clip concatenated — powers "Play all". */
  compiledStreamUrl?: string
}

const PLAY_ALL = '__play_all__'

/**
 * Player + clip list. Standalone (props only, no store access) so it can be
 * reused outside the artifact panel. The panel header supplies the title.
 */
export function ClipReelPanel({ clips, compiledStreamUrl }: ClipReelPanelProps) {
  const playerRef = useRef<VideoPlayerHandle>(null)
  const [activeId, setActiveId] = useState<string>(() =>
    compiledStreamUrl ? PLAY_ALL : '0'
  )
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const seekStudio = useAgentStore((state) => state.seekStudio)

  const active = useMemo(() => {
    if (activeId === PLAY_ALL && compiledStreamUrl) {
      return {
        streamUrl: compiledStreamUrl,
        heading: 'All clips',
        subheading: `${clips.length} moment${clips.length === 1 ? '' : 's'}, played back to back`,
        poster: clips[0]?.thumbnail_url,
      }
    }
    const clip = clips[Number(activeId)] ?? clips[0]
    return {
      streamUrl: clip?.stream_url,
      heading: clip?.label || clip?.video_title || 'Clip',
      subheading: clip ? formatRange(clip.start, clip.end) : '',
      poster: clip?.thumbnail_url,
    }
  }, [activeId, clips, compiledStreamUrl])

  const totalSeconds = useMemo(
    () => clips.reduce((sum, clip) => sum + Math.max(0, clip.end - clip.start), 0),
    [clips]
  )

  const copyUrl = async (id: string, url: string) => {
    await navigator.clipboard.writeText(url)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

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
      {/* Player */}
      <div className="shrink-0 border-b bg-muted/20 p-4">
        <VideoPlayer
          ref={playerRef}
          key={active.streamUrl}
          streamUrl={active.streamUrl}
          poster={active.poster}
          autoPlay
        />
        <div className="mt-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{active.heading}</p>
            <p className="text-xs tabular-nums text-muted-foreground">{active.subheading}</p>
          </div>
          {compiledStreamUrl && (
            <button
              type="button"
              onClick={() => setActiveId(PLAY_ALL)}
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                activeId === PLAY_ALL
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

      {/* Clip list */}
      <div className="flex items-center justify-between border-b px-4 py-2">
        <span className="text-xs font-medium text-muted-foreground">
          {clips.length} clip{clips.length === 1 ? '' : 's'}
        </span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {formatTimestamp(totalSeconds)} total
        </span>
      </div>

      <ul className="flex-1 divide-y overflow-y-auto">
        {clips.map((clip, index) => {
          const id = String(index)
          const isActive = activeId === id
          const playerLink = toPlayerUrl(clip.stream_url)

          return (
            <li key={`${clip.video_id}-${clip.start}-${index}`}>
              <div
                className={cn(
                  'group flex w-full items-start gap-3 px-4 py-3 text-left transition-colors',
                  isActive ? 'bg-primary/5' : 'hover:bg-muted/40'
                )}
              >
                <button
                  type="button"
                  onClick={() => setActiveId(id)}
                  className="flex min-w-0 flex-1 items-start gap-3 text-left"
                >
                  <span
                    className={cn(
                      'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums',
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground group-hover:bg-primary/10'
                    )}
                  >
                    {isActive ? <Play className="size-3 fill-current" /> : index + 1}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-xs font-medium tabular-nums">
                        {formatRange(clip.start, clip.end)}
                      </span>
                      {clip.video_title && (
                        <span className="truncate text-xs text-muted-foreground">
                          {clip.video_title}
                        </span>
                      )}
                      {typeof clip.score === 'number' && (
                        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                          {clip.score.toFixed(2)}
                        </span>
                      )}
                    </div>
                    {(clip.label || clip.text) && (
                      <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-muted-foreground">
                        {clip.label || clip.text}
                      </p>
                    )}
                  </div>
                </button>

                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <button
                    type="button"
                    onClick={() => seekStudio(clip.start, clip.video_id)}
                    title="Show in the timeline"
                    className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <Crosshair className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void copyUrl(id, clip.stream_url)}
                    title="Copy stream URL"
                    className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    {copiedId === id ? (
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
                      className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <ExternalLink className="size-3.5" />
                    </a>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
