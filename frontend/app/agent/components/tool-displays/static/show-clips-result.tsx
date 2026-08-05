import { memo, useCallback, useEffect, useRef } from 'react'
import { Film } from 'lucide-react'
import { useArtifact } from '@/app/agent/hooks/use-artifact'
import { useAgentStore } from '@/app/agent/store/agent-store'
import { ClipReelPanel } from '@/app/agent/components/artifact-panels/clip-reel-panel'
import type { ShowClipsArgs } from '@/lib/core/types'

const isDone = (state: string) => state === 'result' || state === 'output-available'

function normalise(args: any): ShowClipsArgs | null {
  if (!args || !Array.isArray(args.clips) || args.clips.length === 0) return null
  return {
    title: args.title || 'Clips',
    identifier: args.identifier,
    // A clip without its video's URL cannot be played — the range is a range
    // *of* something, and there is no per-clip stream to fall back on.
    clips: args.clips.filter((clip: any) => clip?.url),
  }
}

function useShowClips(args: any) {
  const { showArtifact } = useArtifact()

  return useCallback(() => {
    const payload = normalise(args)
    if (!payload) return

    showArtifact(
      <ClipReelPanel clips={payload.clips} />,
      {
        title: payload.title,
        displayType: 'custom',
        identifier: payload.identifier ?? `clips-${payload.clips[0].video_id}-${payload.clips[0].start}`,
        metadata: { kind: 'clips', count: payload.clips.length },
      }
    )
  }, [args, showArtifact])
}

/** Headless: opens the panel once when the tool call resolves. */
export function ShowClipsAutoOpen({ args, state }: { args: any; state: string }) {
  const open = useShowClips(args)
  const hasAutoOpened = useRef(false)

  useEffect(() => {
    if (!isDone(state) || hasAutoOpened.current) return
    if (!normalise(args)) return

    hasAutoOpened.current = true
    open()
  }, [open, state, args])

  return null
}

function ShowClipsResultInternal({ args, state }: { args: any; state: string }) {
  const open = useShowClips(args)
  const { closeArtifact, isOpen } = useArtifact()
  const currentIdentifier = useAgentStore((store) => store.artifactState.identifier)

  if (!isDone(state)) return null

  const payload = normalise(args)
  if (!payload) return null

  const identifier =
    payload.identifier ?? `clips-${payload.clips[0].video_id}-${payload.clips[0].start}`
  const isThisOpen = isOpen && currentIdentifier === identifier

  return (
    <div className="flex w-full items-center gap-4 rounded-xl border border-border bg-secondary/10 p-3 transition-colors hover:bg-secondary/20">
      <div className="flex h-12 w-10 shrink-0 items-center justify-center rounded-md bg-secondary/50 text-muted-foreground">
        <Film className="size-5" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-foreground">{payload.title}</span>
        <span className="mt-0.5 text-xs text-muted-foreground">
          {payload.clips.length} clip{payload.clips.length === 1 ? '' : 's'}
        </span>
      </div>
      <button
        onClick={(event) => {
          event.stopPropagation()
          if (isThisOpen) closeArtifact()
          else open()
        }}
        className="flex h-8 shrink-0 items-center justify-center rounded-md border border-border bg-background px-4 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {isThisOpen ? 'Close' : 'Open'}
      </button>
    </div>
  )
}

export const ShowClipsResult = memo(ShowClipsResultInternal)
