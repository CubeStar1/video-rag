'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Captions,
  Crosshair,
  Film,
  Loader2,
  PanelRightClose,
  RefreshCw,
} from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { formatDuration } from '@/lib/videodb/format'
import { useProjectVideos } from '@/hooks/use-project-videos'
import { useVideoTimeline } from '@/hooks/use-video-timeline'
import { useAgentStore } from '@/app/agent/store/agent-store'
import { VideoPlayer, type VideoPlayerHandle } from '@/app/agent/components/video-player'
import { StudioTimeline } from './studio-timeline'
import { SceneList, TranscriptList } from './segment-lists'
import type { SceneSegment, TranscriptSegment } from '@/lib/videodb/types'

interface VideoStudioPanelProps {
  projectId?: string
}

/**
 * The persistent middle panel: one player for the whole project workspace, with
 * an editor-style timeline over the video's indexed scenes and transcript.
 */
export function VideoStudioPanel({ projectId }: VideoStudioPanelProps) {
  const playerRef = useRef<VideoPlayerHandle>(null)

  const activeVideoId = useAgentStore((state) => state.studioState.activeVideoId)
  const seekRequest = useAgentStore((state) => state.studioState.seekRequest)
  const setActiveVideo = useAgentStore((state) => state.setActiveVideo)
  const setStudioOpen = useAgentStore((state) => state.setStudioOpen)

  const { videos, isLoading: videosLoading } = useProjectVideos(projectId ?? '')

  const playable = useMemo(
    () => videos.filter((video) => video.videodb_video_id),
    [videos]
  )

  const activeVideo = useMemo(
    () => playable.find((video) => video.id === activeVideoId),
    [playable, activeVideoId]
  )

  // Fall back to the first ready video whenever the selection is empty or stale.
  useEffect(() => {
    if (activeVideo || playable.length === 0) return
    const fallback = playable.find((video) => video.status === 'ready') ?? playable[0]
    setActiveVideo(fallback.id)
  }, [activeVideo, playable, setActiveVideo])

  const { timeline, scenes, transcript, isLoading, isFetching, refetch, error } =
    useVideoTimeline(activeVideo?.id)

  const [currentTime, setCurrentTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playerDuration, setPlayerDuration] = useState(0)
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null)
  const [follow, setFollow] = useState(true)
  const [tab, setTab] = useState('scenes')

  // Reset playback state when the loaded video changes.
  useEffect(() => {
    setCurrentTime(0)
    setIsPlaying(false)
    setPlayerDuration(0)
    setSelectedSceneId(null)
  }, [activeVideo?.id])

  // Rounding caps state churn at ~10 updates/sec; the playhead eases between them.
  const handleTimeUpdate = useCallback((seconds: number) => {
    setCurrentTime(Math.round(seconds * 10) / 10)
  }, [])

  const seek = useCallback((seconds: number) => {
    playerRef.current?.seekTo(seconds)
    setCurrentTime(seconds)
  }, [])

  // A seek that arrives while another video is loaded has to wait for the new
  // stream's metadata before the position sticks.
  const pendingSeek = useRef<number | null>(null)

  const handleDurationChange = useCallback(
    (seconds: number) => {
      setPlayerDuration(seconds)
      if (pendingSeek.current !== null) {
        seek(pendingSeek.current)
        pendingSeek.current = null
      }
    },
    [seek]
  )

  // A clip result in the chat can drive this player.
  const handledSeek = useRef<number>(0)
  useEffect(() => {
    if (!seekRequest || seekRequest.nonce === handledSeek.current) return
    handledSeek.current = seekRequest.nonce

    const target = seekRequest.videodbVideoId
      ? playable.find((video) => video.videodb_video_id === seekRequest.videodbVideoId)
      : activeVideo

    if (!target) return

    if (target.id !== activeVideo?.id) {
      pendingSeek.current = seekRequest.seconds
      setActiveVideo(target.id)
      return
    }

    seek(seekRequest.seconds)
  }, [seekRequest, activeVideo, playable, seek, setActiveVideo])

  const handleSelectScene = useCallback(
    (scene: SceneSegment) => {
      setSelectedSceneId((current) => (current === scene.id ? null : scene.id))
      setTab('scenes')
      seek(scene.start)
    },
    [seek]
  )

  const handleSelectTranscript = useCallback(
    (segment: TranscriptSegment) => {
      setTab('transcript')
      seek(segment.start)
    },
    [seek]
  )

  const duration = timeline?.duration || activeVideo?.duration || playerDuration || 0

  if (!projectId) {
    return <StudioEmpty message="Open a project workspace to load its videos." />
  }

  if (playable.length === 0) {
    return (
      <StudioEmpty
        message={
          videosLoading
            ? 'Loading project videos…'
            : 'No videos in this project yet. Upload one from the project page.'
        }
      />
    )
  }

  return (
    <div className="flex h-full min-w-0 flex-col bg-background">
      {/* Header — video selector */}
      <div className="flex h-[57px] shrink-0 items-center gap-2 border-b px-3">
        <Select value={activeVideo?.id ?? ''} onValueChange={setActiveVideo}>
          <SelectTrigger className="h-9 min-w-0 flex-1 text-xs">
            <SelectValue placeholder="Select a video" />
          </SelectTrigger>
          <SelectContent>
            {playable.map((video) => (
              <SelectItem key={video.id} value={video.id} className="text-xs">
                <span className="flex items-center gap-2">
                  <Film className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{video.title}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {video.status === 'ready' ? formatDuration(video.duration) : video.status}
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <button
          type="button"
          onClick={() => setFollow((value) => !value)}
          title={follow ? 'Following playhead' : 'Not following playhead'}
          className={cn(
            'rounded-md p-2 transition-colors hover:bg-muted active:scale-95',
            follow ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <Crosshair className="size-4" />
        </button>

        <button
          type="button"
          onClick={() => void refetch()}
          title="Reload scenes and transcript"
          className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
        >
          <RefreshCw className={cn('size-4', isFetching && 'animate-spin')} />
        </button>

        <button
          type="button"
          onClick={() => setStudioOpen(false)}
          title="Hide the video panel"
          className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
        >
          <PanelRightClose className="size-4" />
        </button>
      </div>

      {/* Player */}
      <div className="shrink-0 bg-black">
        <VideoPlayer
          ref={playerRef}
          key={activeVideo?.id}
          streamUrl={activeVideo?.stream_url}
          poster={activeVideo?.thumbnail_url}
          className="mx-auto max-h-[45vh] w-full rounded-none object-contain"
          onTimeUpdate={handleTimeUpdate}
          onDurationChange={handleDurationChange}
          onPlayingChange={setIsPlaying}
        />
      </div>

      {/* Timeline */}
      <StudioTimeline
        duration={duration}
        scenes={scenes}
        transcript={transcript}
        currentTime={currentTime}
        isPlaying={isPlaying}
        selectedSceneId={selectedSceneId}
        onSeek={seek}
        onSelectScene={handleSelectScene}
        onSelectTranscript={handleSelectTranscript}
      />

      {/* Index detail */}
      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-1.5">
          <TabsList className="h-8">
            <TabsTrigger value="scenes" className="gap-1.5 text-xs">
              <Film className="size-3.5" />
              Scenes
              <span className="tabular-nums text-muted-foreground">{scenes.length}</span>
            </TabsTrigger>
            <TabsTrigger value="transcript" className="gap-1.5 text-xs">
              <Captions className="size-3.5" />
              Transcript
              <span className="tabular-nums text-muted-foreground">{transcript.length}</span>
            </TabsTrigger>
          </TabsList>

          {isLoading && (
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              Loading index…
            </span>
          )}
        </div>

        {(error || (timeline?.errors.length ?? 0) > 0) && (
          <div className="flex shrink-0 items-start gap-2 border-b bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span className="min-w-0 break-words">
              {error ? (error as Error).message : timeline?.errors.join(' · ')}
            </span>
          </div>
        )}

        <TabsContent value="scenes" className="min-h-0 flex-1 overflow-y-auto">
          <SceneList
            scenes={scenes}
            transcript={transcript}
            currentTime={currentTime}
            selectedSceneId={selectedSceneId}
            followPlayhead={follow}
            onSelect={handleSelectScene}
            onSeek={seek}
          />
        </TabsContent>

        <TabsContent value="transcript" className="min-h-0 flex-1 overflow-y-auto">
          <TranscriptList
            transcript={transcript}
            currentTime={currentTime}
            followPlayhead={follow}
            onSeek={seek}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function StudioEmpty({ message }: { message: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-background px-6 text-center">
      <div className="rounded-full bg-muted p-4">
        <Film className="size-6 text-muted-foreground" />
      </div>
      <p className="max-w-xs text-sm text-muted-foreground">{message}</p>
    </div>
  )
}
