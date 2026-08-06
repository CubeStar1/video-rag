'use client'

import { useEffect, useMemo, useRef } from 'react'
import { Captions, Eye, MapPin, Play, Type } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatRange, formatTimestamp } from '@/lib/core/format'
import type { SceneSegment, TranscriptSegment } from '@/lib/core/types'

/** Scroll a row into view when it becomes the selected/active one. */
function useScrollIntoView(shouldScroll: boolean) {
  const ref = useRef<HTMLLIElement>(null)

  useEffect(() => {
    if (shouldScroll) {
      ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [shouldScroll])

  return ref
}

interface SceneListProps {
  scenes: SceneSegment[]
  transcript: TranscriptSegment[]
  currentTime: number
  selectedSceneId: string | null
  followPlayhead: boolean
  onSelect: (scene: SceneSegment) => void
  onSeek: (seconds: number) => void
}

export function SceneList({
  scenes,
  transcript,
  currentTime,
  selectedSceneId,
  followPlayhead,
  onSelect,
  onSeek,
}: SceneListProps) {
  if (scenes.length === 0) {
    return (
      <EmptyState
        icon={<Eye className="size-6" />}
        title="No scenes indexed"
        detail="The scene index is still building, or this video was indexed without it."
      />
    )
  }

  return (
    <ul className="divide-y">
      {scenes.map((scene, index) => (
        <SceneRow
          key={scene.id}
          scene={scene}
          index={index}
          transcript={transcript}
          isSelected={selectedSceneId === scene.id}
          isActive={currentTime >= scene.start && currentTime < scene.end}
          followPlayhead={followPlayhead}
          onSelect={onSelect}
          onSeek={onSeek}
        />
      ))}
    </ul>
  )
}

function SceneRow({
  scene,
  index,
  transcript,
  isSelected,
  isActive,
  followPlayhead,
  onSelect,
  onSeek,
}: {
  scene: SceneSegment
  index: number
  transcript: TranscriptSegment[]
  isSelected: boolean
  isActive: boolean
  followPlayhead: boolean
  onSelect: (scene: SceneSegment) => void
  onSeek: (seconds: number) => void
}) {
  const ref = useScrollIntoView(isSelected || (followPlayhead && isActive))

  // Lines spoken while this scene is on screen — computed only once it is opened.
  const spoken = useMemo(
    () =>
      isSelected
        ? transcript.filter((line) => line.end > scene.start && line.start < scene.end)
        : [],
    [isSelected, transcript, scene.start, scene.end]
  )

  const tags = scene.tags ?? []

  return (
    <li ref={ref}>
      <button
        type="button"
        onClick={() => onSelect(scene)}
        className={cn(
          'flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors',
          isSelected ? 'bg-primary/5' : isActive ? 'bg-muted/50' : 'hover:bg-muted/40'
        )}
      >
        <span
          className={cn(
            'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums',
            isActive
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground'
          )}
        >
          {isActive ? <Play className="size-3 fill-current" /> : index + 1}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-xs font-medium tabular-nums">
              {formatRange(scene.start, scene.end)}
            </span>
            {tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
              >
                {tag.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
          <p
            className={cn(
              'mt-1 text-[13px] leading-snug',
              isSelected ? 'text-foreground' : 'line-clamp-2 text-muted-foreground'
            )}
          >
            {scene.description || 'No description'}
          </p>
        </div>
      </button>

      {isSelected && (
        <div className="space-y-3 border-t bg-muted/20 px-3 py-3 pl-12">
          {scene.on_screen_text && (
            <DetailBlock icon={<Type className="size-3.5" />} label="On-screen text">
              <p className="text-[13px] leading-snug text-foreground">{scene.on_screen_text}</p>
            </DetailBlock>
          )}

          {scene.visible_objects && scene.visible_objects.length > 0 && (
            <DetailBlock icon={<MapPin className="size-3.5" />} label="Visible objects">
              <div className="flex flex-wrap gap-1">
                {scene.visible_objects.map((object) => (
                  <span
                    key={object}
                    className="rounded-md border bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground"
                  >
                    {object}
                  </span>
                ))}
              </div>
            </DetailBlock>
          )}

          <DetailBlock icon={<Captions className="size-3.5" />} label="Transcript in this scene">
            {spoken.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">No speech in this scene.</p>
            ) : (
              <ul className="space-y-1">
                {spoken.map((line, lineIndex) => (
                  <li key={`${line.start}-${lineIndex}`}>
                    <button
                      type="button"
                      onClick={() => onSeek(line.start)}
                      className="flex w-full items-start gap-2 rounded px-1 py-0.5 text-left hover:bg-muted"
                    >
                      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                        {formatTimestamp(line.start)}
                      </span>
                      <span className="text-[13px] leading-snug">{line.text}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </DetailBlock>
        </div>
      )}
    </li>
  )
}

function DetailBlock({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      {children}
    </div>
  )
}

interface TranscriptListProps {
  transcript: TranscriptSegment[]
  currentTime: number
  followPlayhead: boolean
  onSeek: (seconds: number) => void
}

export function TranscriptList({
  transcript,
  currentTime,
  followPlayhead,
  onSeek,
}: TranscriptListProps) {
  if (transcript.length === 0) {
    return (
      <EmptyState
        icon={<Captions className="size-6" />}
        title="No transcript"
        detail="Either this video has no speech, or the transcript index is still building."
      />
    )
  }

  return (
    <ul className="divide-y">
      {transcript.map((line, index) => (
        <TranscriptRow
          key={`${line.start}-${index}`}
          line={line}
          isActive={currentTime >= line.start && currentTime < line.end}
          followPlayhead={followPlayhead}
          onSeek={onSeek}
        />
      ))}
    </ul>
  )
}

function TranscriptRow({
  line,
  isActive,
  followPlayhead,
  onSeek,
}: {
  line: TranscriptSegment
  isActive: boolean
  followPlayhead: boolean
  onSeek: (seconds: number) => void
}) {
  const ref = useScrollIntoView(followPlayhead && isActive)

  return (
    <li ref={ref}>
      <button
        type="button"
        onClick={() => onSeek(line.start)}
        className={cn(
          'flex w-full items-start gap-3 px-3 py-2 text-left transition-colors',
          isActive ? 'bg-primary/5' : 'hover:bg-muted/40'
        )}
      >
        <span
          className={cn(
            'mt-0.5 shrink-0 text-[11px] tabular-nums',
            isActive ? 'font-semibold text-primary' : 'text-muted-foreground'
          )}
        >
          {formatTimestamp(line.start)}
        </span>
        <span className="min-w-0 text-[13px] leading-snug">
          {/* Only present when the video was analysed with `diarization` —
              the plain transcript analyzer produces the same words with no
              attribution, so this is absent rather than empty. */}
          {line.speaker && (
            <span className="mr-1.5 rounded bg-muted px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {line.speaker.replace(/^SPEAKER_/, 'S')}
            </span>
          )}
          {line.text}
        </span>
      </button>
    </li>
  )
}

function EmptyState({
  icon,
  title,
  detail,
}: {
  icon: React.ReactNode
  title: string
  detail: string
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <div className="text-muted-foreground">{icon}</div>
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-xs text-xs text-muted-foreground">{detail}</p>
    </div>
  )
}
