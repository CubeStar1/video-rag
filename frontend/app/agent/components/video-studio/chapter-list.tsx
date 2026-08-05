'use client'

import { BookOpen, Circle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatRange, formatTimestamp } from '@/lib/core/format'
import type { Chapter, VideoEvent } from '@/lib/core/types'

interface ChapterListProps {
  chapters: Chapter[]
  events: VideoEvent[]
  currentTime: number
  onSeek: (seconds: number) => void
}

/**
 * Chapters and events — video-level structure rather than per-chunk output.
 *
 * Both come from aggregators that read every chunk at once, which is the class
 * of result the previous pipeline had no equivalent for: searching chunks one
 * at a time cannot recover "this section is about X" or "the handover happened
 * here".
 */
export function ChapterList({ chapters, events, currentTime, onSeek }: ChapterListProps) {
  if (chapters.length === 0 && events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center text-muted-foreground">
        <BookOpen className="size-6" />
        <p className="text-sm font-medium">No chapters yet</p>
        <p className="text-xs">
          Chapters and events are written by the video-level passes. Re-run them from the
          project page if this video was analysed before they existed.
        </p>
      </div>
    )
  }

  // A single chapter spanning the whole video is a real result on unbroken
  // footage, and a lone full-width bar reads as a bug — say what happened.
  const isDegenerate =
    chapters.length === 1 &&
    events.length === 0 &&
    chapters[0].end - chapters[0].start > 0

  return (
    <div className="flex flex-col">
      {isDegenerate && (
        <p className="border-b bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
          One chapter for the whole video — the footage never changes location or subject
          enough to split.
        </p>
      )}

      {chapters.map((chapter, index) => {
        const isActive = currentTime >= chapter.start && currentTime < chapter.end
        const within = events.filter(
          (event) => event.time >= chapter.start && event.time < chapter.end
        )

        return (
          <div key={`${chapter.start}-${index}`} className="border-b last:border-b-0">
            <button
              type="button"
              onClick={() => onSeek(chapter.start)}
              className={cn(
                'flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors',
                isActive ? 'bg-primary/5' : 'hover:bg-muted/40'
              )}
            >
              <span
                className={cn(
                  'mt-0.5 shrink-0 text-[11px] tabular-nums',
                  isActive ? 'font-semibold text-primary' : 'text-muted-foreground'
                )}
              >
                {formatTimestamp(chapter.start)}
              </span>
              <span className="min-w-0">
                <span
                  className={cn(
                    'block text-[13px] font-medium leading-snug',
                    isActive && 'text-primary'
                  )}
                >
                  {chapter.title}
                </span>
                <span className="mt-0.5 block text-[11px] tabular-nums text-muted-foreground">
                  {formatRange(chapter.start, chapter.end)}
                </span>
                {chapter.summary && (
                  <span className="mt-1 block text-[12px] leading-snug text-muted-foreground">
                    {chapter.summary}
                  </span>
                )}
              </span>
            </button>

            {within.length > 0 && (
              <ul className="pb-2 pl-12 pr-3">
                {within.map((event, position) => (
                  <li key={`${event.time}-${position}`}>
                    <button
                      type="button"
                      onClick={() => onSeek(event.time)}
                      className="flex w-full items-start gap-2 rounded px-1 py-1 text-left hover:bg-muted/40"
                    >
                      <Circle className="mt-1 size-2 shrink-0 fill-muted-foreground/40 text-muted-foreground/40" />
                      <span className="min-w-0 text-[12px] leading-snug">
                        <span className="mr-1.5 tabular-nums text-muted-foreground">
                          {formatTimestamp(event.time)}
                        </span>
                        {event.actor && (
                          <span className="mr-1 font-medium">{event.actor}:</span>
                        )}
                        {event.description}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}

      {/* Events outside every chapter — or all of them, when chapters never ran. */}
      {(() => {
        const orphans = events.filter(
          (event) =>
            !chapters.some((chapter) => event.time >= chapter.start && event.time < chapter.end)
        )
        if (orphans.length === 0) return null
        return (
          <ul className="divide-y">
            {orphans.map((event, index) => (
              <li key={`${event.time}-orphan-${index}`}>
                <button
                  type="button"
                  onClick={() => onSeek(event.time)}
                  className="flex w-full items-start gap-3 px-3 py-2 text-left hover:bg-muted/40"
                >
                  <span className="mt-0.5 shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    {formatTimestamp(event.time)}
                  </span>
                  <span className="min-w-0 text-[13px] leading-snug">
                    {event.actor && <span className="mr-1 font-medium">{event.actor}:</span>}
                    {event.description}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )
      })()}
    </div>
  )
}
