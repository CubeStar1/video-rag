'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  ArrowLeft,
  Braces,
  CheckCircle2,
  ExternalLink,
  Layers,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  RefreshCw,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { formatBytes, formatDuration } from '@/lib/core/format'
import { describeChunking } from '@/lib/core/chunking'
import { useVideoDetails } from '@/hooks/use-video-details'
import { useVideoMutations } from '@/hooks/use-project-videos'
import { VideoPlayer, type VideoPlayerHandle } from '@/app/agent/components/video-player'
import type { AnalyzerId, ProjectVideo } from '@/lib/core/types'
import { ChunkPanel } from './chunk-panel'
import { OverviewPanel } from './overview-panel'
import { EntitiesPanel } from './entities-panel'
import { SpeechPanel } from './speech-panel'
import { RawPanel } from './raw-panel'
import { Chips } from './detail-primitives'

interface VideoDetailClientProps {
  projectId: string
  projectName: string
  initialVideo: ProjectVideo
}

/**
 * Everything stored for one video, on one page.
 *
 * The player stays pinned beside the analysis rather than above it, because
 * every timestamp here is a seek — a chunk, a turn, a sighting and an event are
 * all "this moment in the file", and reading them next to the frame they
 * describe is the whole point of the page.
 */
export function VideoDetailClient({
  projectId,
  projectName,
  initialVideo,
}: VideoDetailClientProps) {
  const router = useRouter()
  const playerRef = useRef<VideoPlayerHandle>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [tab, setTab] = useState('overview')
  const [focusChunkId, setFocusChunkId] = useState<number | null>(null)

  const { details, isLoading, isFetching, error, refetch } = useVideoDetails(initialVideo.id)
  const { remove, reindex, reaggregate } = useVideoMutations(projectId)

  const video = details?.video ?? initialVideo
  const chunks = details?.chunks ?? []
  const aggregates = details?.aggregates ?? {}

  const analyzers = useMemo<AnalyzerId[]>(
    () => (details?.core?.analyzers ?? video.analyzers ?? []) as AnalyzerId[],
    [details?.core?.analyzers, video.analyzers]
  )

  // The row's duration can be null for a video whose ingest never reported one;
  // the last chunk's end is the next best thing every panel can share.
  const duration =
    video.duration || details?.core?.duration || chunks.at(-1)?.end || 0

  const seek = useCallback((seconds: number) => {
    playerRef.current?.seekTo(seconds)
    setCurrentTime(seconds)
  }, [])

  const openChunk = useCallback((chunkId: number) => {
    setTab('chunks')
    // A new object each time, so re-clicking the same chunk scrolls again.
    setFocusChunkId(chunkId)
  }, [])

  const handleTimeUpdate = useCallback((seconds: number) => {
    setCurrentTime(Math.round(seconds * 10) / 10)
  }, [])

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-400 flex-wrap items-center gap-3 px-4 py-2.5 lg:px-6">
          <Link
            href={`/projects/${projectId}`}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            {projectName}
          </Link>

          <span className="text-muted-foreground/40">/</span>

          <h1 className="min-w-0 flex-1 truncate text-[13px] font-medium" title={video.title}>
            {video.title}
          </h1>

          <StatusPill video={video} />

          {isFetching && !isLoading && (
            <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
          )}

          <div className="flex items-center gap-1.5">
            <Button asChild variant="outline" size="sm" className="h-8">
              <Link href={`/projects/${projectId}`}>
                <MessageSquare className="size-3.5" />
                Ask about it
              </Link>
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <MoreHorizontal className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => void refetch()}>
                  <RefreshCw className="size-4" />
                  Reload analysis
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    reaggregate.mutate(
                      { videoId: video.id },
                      {
                        onSuccess: () =>
                          toast.success('Re-running video-level passes', {
                            description: 'Summary, chapters, events and entities bill LLM calls.',
                          }),
                        onError: (mutationError: any) => toast.error(mutationError.message),
                      }
                    )
                  }
                >
                  <Sparkles className="size-4" />
                  Re-run aggregates
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    reindex.mutate(video.id, {
                      onSuccess: () => toast.success('Re-indexing started'),
                      onError: (mutationError: any) => toast.error(mutationError.message),
                    })
                  }
                >
                  <RefreshCw className="size-4" />
                  Re-index from scratch
                </DropdownMenuItem>
                {video.playback_url && (
                  <DropdownMenuItem asChild>
                    <a href={video.playback_url} target="_blank" rel="noreferrer">
                      <ExternalLink className="size-4" />
                      Open the mp4
                    </a>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-red-600 focus:text-red-600"
                  onClick={() =>
                    remove.mutate(video.id, {
                      onSuccess: () => {
                        toast.success('Video deleted')
                        router.push(`/projects/${projectId}`)
                      },
                      onError: (mutationError: any) => toast.error(mutationError.message),
                    })
                  }
                >
                  <Trash2 className="size-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-400 gap-6 px-4 py-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:px-6">
        {/* Player and the facts about the file */}
        <aside className="lg:sticky lg:top-16 lg:self-start">
          <div className="overflow-hidden rounded-xl border bg-card">
            <VideoPlayer
              ref={playerRef}
              src={video.playback_url}
              poster={video.poster_url}
              className="w-full rounded-none"
              onTimeUpdate={handleTimeUpdate}
            />
            <div className="border-t px-3 py-2 text-[11px] tabular-nums text-muted-foreground">
              {formatDuration(currentTime)} / {formatDuration(duration)}
            </div>
          </div>

          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-xl border bg-card p-3">
            <Meta label="Chunks">
              {details?.chunk_total || video.chunk_count || 0}
              {details && details.chunk_total > chunks.length && (
                <span className="text-muted-foreground"> ({chunks.length} loaded)</span>
              )}
            </Meta>
            <Meta label="Duration">{formatDuration(duration)}</Meta>
            <Meta label="Size">{formatBytes(video.size_bytes ?? details?.core?.size_bytes)}</Meta>
            <Meta label="Chunking">{video.chunk_config ?? details?.core?.chunk_config ?? '—'}</Meta>
            <div className="col-span-2">
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Analyzers
              </dt>
              <dd className="mt-1">
                {analyzers.length > 0 ? (
                  <Chips items={analyzers} tone="outline" />
                ) : (
                  <span className="text-[12px] text-muted-foreground">none recorded</span>
                )}
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Aggregates
              </dt>
              <dd className="mt-1">
                {Object.keys(aggregates).length > 0 ? (
                  <Chips items={Object.keys(aggregates).sort()} tone="muted" />
                ) : (
                  <span className="text-[12px] text-muted-foreground">none stored</span>
                )}
              </dd>
            </div>
            {video.ingest_config && (
              <div className="col-span-2 border-t pt-2">
                <p className="text-[11px] text-muted-foreground">
                  {describeChunking(video.ingest_config)}
                </p>
              </div>
            )}
          </dl>
        </aside>

        {/* The analysis */}
        <main className="min-w-0">
          {error && (
            <Banner tone="error">
              {(error as Error).message || 'Could not load this video’s analysis.'}
            </Banner>
          )}

          {details?.errors.map((message) => (
            <Banner key={message} tone="warning">
              {message}
            </Banner>
          ))}

          {isLoading ? (
            <LoadingSkeleton />
          ) : (
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="mb-4 h-9 w-full justify-start overflow-x-auto">
                <TabsTrigger value="overview" className="gap-1.5 text-xs">
                  <Sparkles className="size-3.5" />
                  Overview
                </TabsTrigger>
                <TabsTrigger value="chunks" className="gap-1.5 text-xs">
                  <Layers className="size-3.5" />
                  Chunks
                  <span className="tabular-nums text-muted-foreground">{chunks.length}</span>
                </TabsTrigger>
                <TabsTrigger value="speech" className="gap-1.5 text-xs">
                  <MessageSquare className="size-3.5" />
                  Speech
                </TabsTrigger>
                <TabsTrigger value="entities" className="gap-1.5 text-xs">
                  <Users className="size-3.5" />
                  People &amp; objects
                </TabsTrigger>
                <TabsTrigger value="raw" className="gap-1.5 text-xs">
                  <Braces className="size-3.5" />
                  Record
                </TabsTrigger>
              </TabsList>

              <TabsContent value="overview">
                <OverviewPanel aggregates={aggregates} onSeek={seek} onOpenChunk={openChunk} />
              </TabsContent>

              <TabsContent value="chunks">
                <ChunkPanel
                  chunks={chunks}
                  chunkTotal={details?.chunk_total ?? chunks.length}
                  analyzers={analyzers}
                  currentTime={currentTime}
                  focusChunkId={focusChunkId}
                  onSeek={seek}
                />
              </TabsContent>

              <TabsContent value="speech">
                <SpeechPanel
                  chunks={chunks}
                  aggregates={aggregates}
                  currentTime={currentTime}
                  onSeek={seek}
                  onOpenChunk={openChunk}
                />
              </TabsContent>

              <TabsContent value="entities">
                <EntitiesPanel
                  aggregates={aggregates}
                  duration={duration}
                  onSeek={seek}
                  onOpenChunk={openChunk}
                />
              </TabsContent>

              <TabsContent value="raw">
                {details && <RawPanel details={details} />}
              </TabsContent>
            </Tabs>
          )}
        </main>
      </div>
    </div>
  )
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 truncate text-[13px] tabular-nums">{children}</dd>
    </div>
  )
}

function StatusPill({ video }: { video: ProjectVideo }) {
  if (video.status === 'ready') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="size-3" />
        Ready
      </span>
    )
  }

  if (video.status === 'failed') {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-600 dark:text-red-400"
        title={video.error ?? undefined}
      >
        <AlertTriangle className="size-3" />
        Failed
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
      <Loader2 className="size-3 animate-spin" />
      {video.stage ?? video.status}
    </span>
  )
}

function Banner({ tone, children }: { tone: 'error' | 'warning'; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        'mb-3 flex items-start gap-2 rounded-lg px-3 py-2 text-[12px]',
        tone === 'error'
          ? 'bg-red-500/10 text-red-600 dark:text-red-400'
          : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
      )}
    >
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0">{children}</span>
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3">
      <div className="h-9 w-96 animate-pulse rounded-lg bg-muted" />
      {[280, 180, 220].map((height, index) => (
        <div
          key={index}
          className="animate-pulse rounded-xl bg-muted"
          style={{ height }}
        />
      ))}
    </div>
  )
}
