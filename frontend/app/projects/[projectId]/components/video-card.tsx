'use client'

import { useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Film,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { formatDuration } from '@/lib/core/format'
import { describeChunking } from '@/lib/core/chunking'
import type { ProjectVideo } from '@/lib/core/types'

interface VideoCardProps {
  video: ProjectVideo
  onDelete: (videoId: string) => void
  onReindex: (videoId: string) => void
  onPreview: (video: ProjectVideo) => void
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

  // Core reports which pipeline stage it is on; that is more informative than a
  // generic spinner on a job that runs for minutes.
  const STAGE_LABELS: Record<string, string> = {
    fetching: 'Downloading',
    chunking: 'Splitting',
    chunked: 'Splitting',
    analyzing: 'Analysing',
    indexing: 'Indexing',
    aggregating: 'Summarising',
    complete: 'Finishing',
  }

  const label =
    video.status === 'pending' || video.status === 'uploading'
      ? 'Uploading'
      : video.status === 'queued'
        ? 'Queued'
        : (video.stage && STAGE_LABELS[video.stage]) || 'Analysing'

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
      <Loader2 className="size-3 animate-spin" />
      {label}
    </span>
  )
}

export function VideoCard({ video, onDelete, onReindex, onPreview }: VideoCardProps) {
  const [imageFailed, setImageFailed] = useState(false)
  const isReady = video.status === 'ready'
  // Absent while a video is still queued — show nothing rather than implying a
  // config we can't vouch for.
  const chunking = video.ingest_config

  return (
    <div className="group flex flex-col gap-2">
      <button
        type="button"
        onClick={() => onPreview(video)}
        className={cn(
          'relative aspect-video w-full overflow-hidden rounded-xl border bg-muted transition-all',
          'hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
        )}
      >
        {video.poster_url && !imageFailed ? (
          // eslint-disable-next-line @next/next/no-img-element -- the poster is written by core into its own bucket
          <img
            src={video.poster_url}
            alt={video.title}
            className="size-full object-cover"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <div className="flex size-full items-center justify-center bg-gradient-to-br from-muted to-muted/40">
            <Film className="size-8 text-muted-foreground/50" />
          </div>
        )}

        {!isReady && <div className="absolute inset-0 bg-background/50 backdrop-blur-[1px]" />}

        {video.duration ? (
          <span className="absolute bottom-2 right-2 rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white">
            {formatDuration(video.duration)}
          </span>
        ) : null}
      </button>

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={video.title}>
            {video.title}
          </p>
          <div className="mt-1">
            <StatusPill video={video} />
          </div>
          {chunking && (
            <p className="mt-1 truncate text-[11px] text-muted-foreground/70">
              {describeChunking(chunking)}
            </p>
          )}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger className="rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100 data-[state=open]:opacity-100">
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onReindex(video.id)}>
              <RefreshCw className="size-4" />
              Re-index
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onDelete(video.id)}
              className="text-red-600 focus:text-red-600"
            >
              <Trash2 className="size-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
