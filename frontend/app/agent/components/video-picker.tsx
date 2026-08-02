'use client'

import { Check, Film, Loader2, Video, X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { formatDuration } from '@/lib/videodb/format'
import type { ProjectVideo } from '@/lib/videodb/types'

interface VideoPickerProps {
  videos: ProjectVideo[]
  selectedIds: string[]
  onToggle: (videodbVideoId: string) => void
  onClear: () => void
  disabled?: boolean
}

/** Tag videos so the agent knows which ones to retrieve from. */
export function VideoPicker({
  videos,
  selectedIds,
  onToggle,
  onClear,
  disabled,
}: VideoPickerProps) {
  const selectable = videos.filter((video) => video.videodb_video_id)

  return (
    <Popover>
      <PopoverTrigger
        disabled={disabled}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
          'text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50',
          selectedIds.length > 0 && 'text-foreground'
        )}
      >
        <Video className="size-4" />
        {selectedIds.length > 0 ? `${selectedIds.length} tagged` : 'Videos'}
      </PopoverTrigger>

      <PopoverContent align="start" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-xs font-medium">Tag videos for this chat</span>
          {selectedIds.length > 0 && (
            <button
              onClick={onClear}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>

        {selectable.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            No videos in this project yet. Upload one from the project page.
          </p>
        ) : (
          <ul className="max-h-72 overflow-y-auto py-1">
            {selectable.map((video) => {
              const id = video.videodb_video_id as string
              const isSelected = selectedIds.includes(id)
              const isReady = video.status === 'ready'

              return (
                <li key={video.id}>
                  <button
                    onClick={() => isReady && onToggle(id)}
                    disabled={!isReady}
                    className={cn(
                      'flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors',
                      isReady ? 'hover:bg-muted' : 'cursor-not-allowed opacity-60'
                    )}
                  >
                    <span
                      className={cn(
                        'flex size-4 shrink-0 items-center justify-center rounded border',
                        isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-input'
                      )}
                    >
                      {isSelected && <Check className="size-3" />}
                    </span>

                    <Film className="size-3.5 shrink-0 text-muted-foreground" />

                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">{video.title}</span>
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        {!isReady && <Loader2 className="size-2.5 animate-spin" />}
                        {isReady ? formatDuration(video.duration) : video.status}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** Removable chips shown above the textarea. */
export function VideoChips({
  videos,
  selectedIds,
  onRemove,
}: {
  videos: ProjectVideo[]
  selectedIds: string[]
  onRemove: (videodbVideoId: string) => void
}) {
  if (selectedIds.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1.5 px-3 pt-2">
      {selectedIds.map((id) => {
        const video = videos.find((item) => item.videodb_video_id === id)
        return (
          <span
            key={id}
            className="inline-flex max-w-[200px] items-center gap-1.5 rounded-full bg-muted px-2 py-1 text-xs"
          >
            <Film className="size-3 shrink-0 text-muted-foreground" />
            <span className="truncate">{video?.title ?? id}</span>
            <button
              onClick={() => onRemove(id)}
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          </span>
        )
      })}
    </div>
  )
}
