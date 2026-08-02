'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowUp, Folder, Loader2, Plus, Sparkles, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { useSidebar } from '@/components/ui/sidebar'
import { ModeToggle } from '@/components/global/theme-switcher'
import { VideoPlayer } from '@/app/agent/components/video-player'
import { useProjectVideos, useVideoMutations } from '@/hooks/use-project-videos'
import { formatDuration } from '@/lib/videodb/format'
import type { Project } from '@/app/agent/types'
import type { ProjectVideo } from '@/lib/videodb/types'
import { MediaGrid } from './media-grid'
import { SuggestionCards } from './suggestion-cards'
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

  const { videos, readyVideos, isLoading } = useProjectVideos(project.id, initialVideos)
  const { remove, reindex, invalidate } = useVideoMutations(project.id)

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
      // Pre-tag every ready video so the first question has something to search.
      if (readyVideos.length > 0) {
        params.set('videos', readyVideos.map((video) => video.videodb_video_id).join(','))
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
          <Folder className="size-4" />
        </button>
        <div className="ml-auto flex items-center gap-2">
          <ModeToggle />
          <Button size="sm" onClick={() => setUploadOpen(true)}>
            <Upload className="size-4" />
            Upload file
          </Button>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 pb-20 pt-10">
        <div className="flex items-center justify-center gap-2.5">
          <Folder className="size-5 text-muted-foreground" />
          <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
        </div>
        {project.description && (
          <p className="mt-2 text-center text-sm text-muted-foreground">{project.description}</p>
        )}

        {/* Prompt launcher */}
        <div className="mx-auto mt-8 max-w-2xl">
          <div className="rounded-2xl border bg-muted/30 p-3 shadow-sm transition-colors focus-within:border-primary/40 focus-within:bg-background">
            <Textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void startChat(prompt)
                }
              }}
              placeholder="Ask anything across your videos — find a moment, summarize, or pull clips."
              className="min-h-13 resize-none border-0 bg-transparent p-2 shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
            <div className="flex items-center justify-between gap-2 px-1">
              <Button
                variant="outline"
                size="sm"
                className="rounded-full"
                onClick={() => setUploadOpen(true)}
              >
                <Plus className="size-3.5" />
                Add video
              </Button>
              <div className="flex items-center gap-2">
                {readyVideos.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {readyVideos.length} video{readyVideos.length === 1 ? '' : 's'} ready
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
        </div>

        <div className="mt-10">
          <p className="mb-4 flex items-center gap-1.5 text-sm text-muted-foreground">
            <Sparkles className="size-3.5" />
            Explore this project. Choose a prompt to get started.
          </p>
          <SuggestionCards onSelect={(suggestion) => void startChat(suggestion)} />
        </div>

        <MediaGrid
          videos={videos}
          isLoading={isLoading}
          onPreview={setPreview}
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
          <VideoPlayer streamUrl={preview?.stream_url} poster={preview?.thumbnail_url} autoPlay />
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
