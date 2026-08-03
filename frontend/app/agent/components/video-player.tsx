'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { AlertTriangle, ExternalLink } from 'lucide-react'
import { createPlayer, selectError } from '@videojs/react'
import { Video, VideoSkin, videoFeatures } from '@videojs/react/video'
import { HlsJsVideo } from '@videojs/react/media/hlsjs-video'
import { cn } from '@/lib/utils'
import { toPlayerUrl } from '@/lib/videodb/format'

/** One store definition, but `Provider` builds a fresh store per mounted player. */
const Player = createPlayer({ features: videoFeatures, displayName: 'VideoDBPlayer' })

export interface VideoPlayerHandle {
  /** Jump to a position (seconds) in the currently loaded stream. */
  seekTo: (seconds: number) => void
  play: () => void
  pause: () => void
  getCurrentTime: () => number
  isPaused: () => boolean
}

interface VideoPlayerProps {
  streamUrl: string | null | undefined
  poster?: string | null
  autoPlay?: boolean
  className?: string
  /** Fires on `timeupdate` and, while playing, once per animation frame. */
  onTimeUpdate?: (seconds: number) => void
  onDurationChange?: (seconds: number) => void
  onPlayingChange?: (isPlaying: boolean) => void
}

const isHls = (url: string) => /\.m3u8(\?|#|$)/i.test(url)

/**
 * Player for VideoDB streams, built on the Video.js v10 React skin. HLS runs
 * through hls.js; anything else falls back to the plain media element. A stream
 * the browser cannot play at all falls back to the VideoDB console player.
 */
export const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(
  function VideoPlayer(
    {
      streamUrl,
      poster,
      autoPlay = false,
      className,
      onTimeUpdate,
      onDurationChange,
      onPlayingChange,
    },
    ref
  ) {
    const videoRef = useRef<HTMLVideoElement>(null)
    const [failed, setFailed] = useState(false)

    useEffect(() => setFailed(false), [streamUrl])

    useImperativeHandle(ref, () => ({
      seekTo: (seconds: number) => {
        if (videoRef.current) {
          videoRef.current.currentTime = Math.max(0, seconds)
          void videoRef.current.play().catch(() => {})
        }
      },
      play: () => void videoRef.current?.play().catch(() => {}),
      pause: () => videoRef.current?.pause(),
      getCurrentTime: () => videoRef.current?.currentTime ?? 0,
      isPaused: () => videoRef.current?.paused ?? true,
    }))

    // The skin owns the controls, but the timeline outside this component still
    // reads playback state off the underlying media element.
    //
    // `timeupdate` only fires ~4x/sec, which reads as a stuttering playhead — drive
    // the reported time off animation frames while the video is actually playing.
    useEffect(() => {
      const video = videoRef.current
      if (!video) return

      let frame = 0

      const tick = () => {
        onTimeUpdate?.(video.currentTime)
        frame = requestAnimationFrame(tick)
      }

      const emitTime = () => onTimeUpdate?.(video.currentTime)
      const emitDuration = () => {
        if (Number.isFinite(video.duration)) onDurationChange?.(video.duration)
      }
      const handlePlay = () => {
        onPlayingChange?.(true)
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(tick)
      }
      const handleStop = () => {
        onPlayingChange?.(false)
        cancelAnimationFrame(frame)
        emitTime()
      }

      video.addEventListener('timeupdate', emitTime)
      video.addEventListener('seeked', emitTime)
      video.addEventListener('loadedmetadata', emitDuration)
      video.addEventListener('durationchange', emitDuration)
      video.addEventListener('play', handlePlay)
      video.addEventListener('playing', handlePlay)
      video.addEventListener('pause', handleStop)
      video.addEventListener('ended', handleStop)

      return () => {
        cancelAnimationFrame(frame)
        video.removeEventListener('timeupdate', emitTime)
        video.removeEventListener('seeked', emitTime)
        video.removeEventListener('loadedmetadata', emitDuration)
        video.removeEventListener('durationchange', emitDuration)
        video.removeEventListener('play', handlePlay)
        video.removeEventListener('playing', handlePlay)
        video.removeEventListener('pause', handleStop)
        video.removeEventListener('ended', handleStop)
      }
    }, [onTimeUpdate, onDurationChange, onPlayingChange, streamUrl, failed])

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

    const Media = isHls(streamUrl) ? HlsJsVideo : Video

    return (
      <div
        className={cn(
          'relative aspect-video w-full overflow-hidden rounded-lg bg-black',
          className
        )}
      >
        <Player.Provider>
          <VideoSkin
            poster={poster ?? undefined}
            className="size-full [--media-border-radius:0px]"
          >
            <Media ref={videoRef} src={streamUrl} autoPlay={autoPlay} playsInline />
            <ErrorWatcher onFail={setFailed} />
          </VideoSkin>
        </Player.Provider>
      </div>
    )
  }
)

/**
 * The skin renders its own error dialog, but a stream this browser simply cannot
 * decode should hand the user off to the VideoDB console player instead.
 */
function ErrorWatcher({ onFail }: { onFail: (failed: boolean) => void }) {
  const error = Player.usePlayer(selectError)?.error

  useEffect(() => {
    if (error) onFail(true)
  }, [error, onFail])

  return null
}
