'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { AlertTriangle, ExternalLink } from 'lucide-react'
import { createPlayer, selectError } from '@videojs/react'
import { Video, VideoSkin, videoFeatures } from '@videojs/react/video'
import { cn } from '@/lib/utils'

/** One store definition, but `Provider` builds a fresh store per mounted player. */
const Player = createPlayer({ features: videoFeatures, displayName: 'CoreVideoPlayer' })

export interface VideoPlayerHandle {
  /** Jump to a position (seconds) in the loaded video. */
  seekTo: (seconds: number) => void
  play: () => void
  pause: () => void
  getCurrentTime: () => number
  isPaused: () => boolean
}

interface VideoPlayerProps {
  /** The whole video's mp4. There is no per-clip source — clips are ranges of this. */
  src: string | null | undefined
  poster?: string | null
  /**
   * Play only this span. The player seeks here on load and stops (or loops) at
   * the end, which is what replaced being handed a pre-cut stream per clip.
   */
  range?: [number, number] | null
  loopRange?: boolean
  autoPlay?: boolean
  className?: string
  /** Fires on `timeupdate` and, while playing, once per animation frame. */
  onTimeUpdate?: (seconds: number) => void
  onDurationChange?: (seconds: number) => void
  onPlayingChange?: (isPlaying: boolean) => void
  /** Fires when a bounded range plays through to its end. */
  onRangeEnd?: () => void
}

/**
 * Player for core's mp4s, on the Video.js v10 React skin.
 *
 * Everything HLS is gone: core serves one plain mp4 per video and Supabase
 * Storage honours `Range`, so seeking to a moment is a byte-range request
 * rather than a manifest fetch. That also means a clip costs no extra load —
 * the same element seeks within the file it already has buffered.
 */
export const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(
  function VideoPlayer(
    {
      src,
      poster,
      range,
      loopRange = false,
      autoPlay = false,
      className,
      onTimeUpdate,
      onDurationChange,
      onPlayingChange,
      onRangeEnd,
    },
    ref
  ) {
    const videoRef = useRef<HTMLVideoElement>(null)
    const [failed, setFailed] = useState(false)

    useEffect(() => setFailed(false), [src])

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
    }, [onTimeUpdate, onDurationChange, onPlayingChange, src, failed])

    // Range enforcement. A clip is a span of the whole file, so nothing stops
    // playback at its end but this: seek in on load, and pull back (or stop) at
    // the boundary. Kept separate from the reporting effect above so changing
    // clips does not tear down the listeners that drive the timeline.
    const start = range?.[0]
    const end = range?.[1]
    useEffect(() => {
      const video = videoRef.current
      if (!video || start === undefined || end === undefined) return

      const enterRange = () => {
        // Only pull the playhead in when it is outside the clip, so a user who
        // deliberately scrubbed within it is not fought by this.
        if (video.currentTime < start || video.currentTime > end) {
          video.currentTime = start
        }
      }

      const guard = () => {
        if (video.currentTime < end) return
        if (loopRange) {
          video.currentTime = start
          return
        }
        video.pause()
        onRangeEnd?.()
      }

      if (video.readyState >= 1) enterRange()
      video.addEventListener('loadedmetadata', enterRange)
      video.addEventListener('timeupdate', guard)

      return () => {
        video.removeEventListener('loadedmetadata', enterRange)
        video.removeEventListener('timeupdate', guard)
      }
    }, [start, end, loopRange, onRangeEnd, src])

    if (!src) {
      return (
        <div
          className={cn(
            'flex aspect-video items-center justify-center rounded-lg border bg-muted/40 text-sm text-muted-foreground',
            className
          )}
        >
          No video available
        </div>
      )
    }

    if (failed) {
      return (
        <div
          className={cn(
            'flex aspect-video flex-col items-center justify-center gap-3 rounded-lg border bg-muted/40 p-6 text-center',
            className
          )}
        >
          <AlertTriangle className="size-6 text-amber-500" />
          <p className="text-sm text-muted-foreground">
            This browser could not play the video inline.
          </p>
          <a
            href={src}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent"
          >
            <ExternalLink className="size-3.5" />
            Open the file directly
          </a>
        </div>
      )
    }

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
            <Video ref={videoRef} src={src} autoPlay={autoPlay} playsInline preload="metadata" />
            <ErrorWatcher onFail={setFailed} />
          </VideoSkin>
        </Player.Provider>
      </div>
    )
  }
)

/**
 * The skin renders its own error dialog, but a file this browser cannot decode
 * should offer the raw URL — core's bucket is public, so the link always works
 * even when the embedded player does not.
 */
function ErrorWatcher({ onFail }: { onFail: (failed: boolean) => void }) {
  const error = Player.usePlayer(selectError)?.error

  useEffect(() => {
    if (error) onFail(true)
  }, [error, onFail])

  return null
}
