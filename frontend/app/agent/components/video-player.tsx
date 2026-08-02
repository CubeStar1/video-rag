'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { AlertTriangle, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toPlayerUrl } from '@/lib/videodb/format'

export interface VideoPlayerHandle {
  /** Jump to a position (seconds) in the currently loaded stream. */
  seekTo: (seconds: number) => void
  play: () => void
  pause: () => void
}

interface VideoPlayerProps {
  streamUrl: string | null | undefined
  poster?: string | null
  autoPlay?: boolean
  className?: string
}

/**
 * HLS player for VideoDB streams. Uses hls.js where MSE is available and falls
 * back to native playback (Safari/iOS), then to the VideoDB console player.
 */
export const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(
  function VideoPlayer({ streamUrl, poster, autoPlay = false, className }, ref) {
    const videoRef = useRef<HTMLVideoElement>(null)
    const [failed, setFailed] = useState(false)

    useImperativeHandle(ref, () => ({
      seekTo: (seconds: number) => {
        if (videoRef.current) {
          videoRef.current.currentTime = Math.max(0, seconds)
          void videoRef.current.play().catch(() => {})
        }
      },
      play: () => void videoRef.current?.play().catch(() => {}),
      pause: () => videoRef.current?.pause(),
    }))

    useEffect(() => {
      const video = videoRef.current
      if (!video || !streamUrl) return

      setFailed(false)
      let hls: import('hls.js').default | null = null
      let cancelled = false

      const attach = async () => {
        // Safari plays HLS natively and does not need (or want) hls.js.
        if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = streamUrl
          if (autoPlay) void video.play().catch(() => {})
          return
        }

        const { default: Hls } = await import('hls.js')
        if (cancelled) return

        if (!Hls.isSupported()) {
          setFailed(true)
          return
        }

        hls = new Hls({ enableWorker: true, lowLatencyMode: false })
        hls.loadSource(streamUrl)
        hls.attachMedia(video)
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (autoPlay) void video.play().catch(() => {})
        })
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) setFailed(true)
        })
      }

      void attach()

      return () => {
        cancelled = true
        hls?.destroy()
      }
    }, [streamUrl, autoPlay])

    if (!streamUrl) {
      return (
        <div
          className={cn(
            'flex aspect-video items-center justify-center rounded-lg border bg-muted/40 text-sm text-muted-foreground',
            className
          )}
        >
          No stream available
        </div>
      )
    }

    if (failed) {
      const fallback = toPlayerUrl(streamUrl)
      return (
        <div
          className={cn(
            'flex aspect-video flex-col items-center justify-center gap-3 rounded-lg border bg-muted/40 p-6 text-center',
            className
          )}
        >
          <AlertTriangle className="size-6 text-amber-500" />
          <p className="text-sm text-muted-foreground">
            This browser could not play the stream inline.
          </p>
          {fallback && (
            <a
              href={fallback}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent"
            >
              <ExternalLink className="size-3.5" />
              Open in VideoDB player
            </a>
          )}
        </div>
      )
    }

    return (
      <video
        ref={videoRef}
        controls
        playsInline
        poster={poster ?? undefined}
        className={cn('aspect-video w-full rounded-lg bg-black', className)}
      />
    )
  }
)
