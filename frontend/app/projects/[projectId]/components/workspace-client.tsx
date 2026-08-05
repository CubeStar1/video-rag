'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowUp, Loader2, PanelLeft, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { useSidebar } from '@/components/ui/sidebar'
import { ModeToggle } from '@/components/global/theme-switcher'
import { VideoPlayer } from '@/app/agent/components/video-player'
import { VideoPicker, VideoChips } from '@/app/agent/components/video-picker'
import { useProjectVideos, useVideoMutations } from '@/hooks/use-project-videos'
import { formatDuration } from '@/lib/core/format'
import type { Project } from '@/app/agent/types'
import type { ProjectVideo } from '@/lib/core/types'
import { MediaGrid } from './media-grid'
import { PromptSuggestions } from './prompt-suggestions'
import { UploadDialog } from './upload-dialog'

interface WorkspaceClientProps {
  project: Project
  initialVideos: ProjectVideo[]
}

export function WorkspaceClient({ project, initialVideos }: WorkspaceClientProps) {
  const router = useRouter()
  const { toggleSidebar } = useSidebar()
  const [prompt, setPrompt] = useState('')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [preview, setPreview] = useState<ProjectVideo | null>(null)
  const [isStarting, setIsStarting] = useState(false)
  const [selectedVideoIds, setSelectedVideoIds] = useState<string[]>([])
  const promptRef = useRef<HTMLTextAreaElement>(null)

  const { videos, readyVideos, isLoading } = useProjectVideos(project.id, initialVideos)
  const { remove, reindex, invalidate } = useVideoMutations(project.id)

  /** How much footage is actually searchable — the only number worth surfacing up top. */
  const indexedHours = useMemo(
    () => readyVideos.reduce((total, video) => total + (video.duration ?? 0), 0) / 3600,
    [readyVideos]
  )

  /** Suggestions seed the box and hand the caret over — the user still hits send. */
  const fillPrompt = useCallback((suggestion: string) => {
    setPrompt(suggestion)
    const input = promptRef.current
    if (!input) return
    input.focus()
    input.setSelectionRange(suggestion.length, suggestion.length)
  }, [])

  const toggleVideo = useCallback((videoId: string) => {
    setSelectedVideoIds((current) =>
      current.includes(videoId)
        ? current.filter((item) => item !== videoId)
        : [...current, videoId]
    )
  }, [])

  /**
   * Start a chat: create the conversation up front so the workspace and the chat
   * page agree on the id, then hand the prompt over through the URL.
   */
  const startChat = async (text: string) => {
    const message = text.trim()
    if (!message) return

    if (videos.length === 0) {
      toast.error('Upload a video first', {
        description: 'The agent answers from videos indexed in this project.',
      })
      return
    }

    setIsStarting(true)
    try {
      const response = await fetch(`/api/projects/${project.id}/conversations`, {
        method: 'POST',
      })

      if (!response.ok) throw new Error(await response.text())

      const { conversationId } = await response.json()
      const params = new URLSearchParams({ q: message })
      // Whatever the user tagged, or every ready video if they tagged nothing.
      const scope =
        selectedVideoIds.length > 0
          ? selectedVideoIds
          : readyVideos.map((video) => video.core_video_id as string)
      if (scope.length > 0) {
        params.set('videos', scope.join(','))
      }
      router.push(`/projects/${project.id}/conversations/${conversationId}?${params}`)
    } catch (error: any) {
      toast.error('Could not start the chat', { description: error.message })
      setIsStarting(false)
    }
  }

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-20 flex items-center gap-2 border-b bg-background/80 px-4 py-2 backdrop-blur">
        <button
          onClick={() => toggleSidebar()}
          className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="Toggle sidebar"
        >
          <PanelLeft className="size-4" />
        </button>
        <div className="ml-auto">
          <ModeToggle />
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 pb-20 pt-16">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="text-balance text-3xl font-semibold tracking-tight">{project.name}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {project.description || summarizeLibrary(readyVideos.length, indexedHours)}
          </p>
        </div>

        {/* Prompt launcher */}
        <div className="mx-auto mt-8 max-w-2xl rounded-2xl border bg-card p-2.5 shadow-sm transition-colors focus-within:border-foreground/20">
          <div className="-mx-2.5 -mt-2.5 mb-1">
            <VideoChips videos={videos} selectedIds={selectedVideoIds} onRemove={toggleVideo} />
          </div>
          <Textarea
            ref={promptRef}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void startChat(prompt)
              }
            }}
            placeholder="Describe a moment, ask a question, or request a clip"
            className="min-h-13 resize-none border-0 bg-transparent p-2 shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          <div className="flex items-center justify-between gap-2 px-1">
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                className="rounded-full"
                onClick={() => setUploadOpen(true)}
              >
                <Plus className="size-3.5" />
                Add video
              </Button>
              <VideoPicker
                videos={videos}
                selectedIds={selectedVideoIds}
                onToggle={toggleVideo}
                onClear={() => setSelectedVideoIds([])}
              />
            </div>
            <div className="flex items-center gap-2">
              {selectedVideoIds.length === 0 && readyVideos.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  searching all {readyVideos.length}
                </span>
              )}
              <Button
                size="icon"
                className="size-8 rounded-full"
                disabled={!prompt.trim() || isStarting}
                onClick={() => void startChat(prompt)}
              >
                {isStarting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ArrowUp className="size-4" />
                )}
              </Button>
            </div>
          </div>
        </div>

        <div className="mx-auto mt-5 max-w-3xl">
          <PromptSuggestions onSelect={fillPrompt} />
        </div>

        <MediaGrid
          videos={videos}
          isLoading={isLoading}
          onPreview={setPreview}
          onUpload={() => setUploadOpen(true)}
          onDelete={(videoId) =>
            remove.mutate(videoId, {
              onSuccess: () => toast.success('Video deleted'),
              onError: (error: any) => toast.error(error.message),
            })
          }
          onReindex={(videoId) =>
            reindex.mutate(videoId, {
              onSuccess: () => toast.success('Re-indexing started'),
              onError: (error: any) => toast.error(error.message),
            })
          }
        />
      </div>

      <UploadDialog
        projectId={project.id}
        projectName={project.name}
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onComplete={invalidate}
      />

      <Dialog open={Boolean(preview)} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="truncate pr-6">{preview?.title}</DialogTitle>
          </DialogHeader>
          <VideoPlayer src={preview?.playback_url} poster={preview?.poster_url} autoPlay />
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>{formatDuration(preview?.duration)}</span>
            <span>·</span>
            <span className="capitalize">{preview?.status}</span>
            {preview?.error && <span className="truncate text-red-500">{preview.error}</span>}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** Stands in for the project description: what's actually searchable right now. */
function summarizeLibrary(readyCount: number, hours: number): string {
  if (readyCount === 0) return 'Add a video to start asking questions about it.'

  const label = `${readyCount} video${readyCount === 1 ? '' : 's'} indexed`
  if (hours < 0.02) return label

  const length = hours < 1 ? `${Math.round(hours * 60)} min` : `${hours.toFixed(1)} h`
  return `${label} · ${length} of video`
}
