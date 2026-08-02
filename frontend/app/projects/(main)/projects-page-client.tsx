'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { FolderGit2, MessageSquare, PlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { Project, Conversation } from '@/app/agent/types'

interface ProjectsPageClientProps {
  projects: Project[]
  conversations: Pick<Conversation, 'id' | 'project_id'>[]
}

export function ProjectsPageClient({
  projects,
  conversations,
}: ProjectsPageClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [open, setOpen] = useState(searchParams.get('create') === '1')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  const projectCards = useMemo(() => {
    return projects.map((project) => {
      const projectConversations = conversations.filter((conversation) => conversation.project_id === project.id)

      return {
        project,
        conversationCount: projectConversations.length,
        latestConversationId: projectConversations[0]?.id,
      }
    })
  }, [projects, conversations])

  const handleCreateProject = async () => {
    if (!name.trim()) {
      toast.error('Project name is required')
      return
    }

    setIsCreating(true)
    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
        }),
      })

      if (!response.ok) {
        throw new Error(await response.text())
      }

      const { projectId, conversationId } = await response.json()
      setOpen(false)
      router.push(`/projects/${projectId}/conversations/${conversationId}`)
      router.refresh()
    } catch (error: any) {
      toast.error(error.message || 'Failed to create project')
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-8 rounded-3xl border bg-gradient-to-br from-sky-500/10 via-background to-emerald-500/10 p-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">Projects</p>
              <h1 className="mt-3 text-4xl font-semibold tracking-tight">Your workspaces</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                Create a project to group related conversations, then pick up any thread from one place.
              </p>
            </div>
            <Button className="rounded-full" onClick={() => setOpen(true)}>
              <PlusIcon className="size-4" />
              New Project
            </Button>
          </div>
        </div>

        {projectCards.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {projectCards.map(({ project, conversationCount, latestConversationId }) => (
              <Link
                key={project.id}
                href={
                  latestConversationId
                    ? `/projects/${project.id}/conversations/${latestConversationId}`
                    : `/projects/${project.id}`
                }
                className="rounded-3xl border bg-card p-6 transition-colors hover:bg-accent/30"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold truncate">{project.name}</h2>
                    {project.description ? (
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{project.description}</p>
                    ) : null}
                  </div>
                  <FolderGit2 className="size-5 shrink-0 text-muted-foreground" />
                </div>
                <div className="mt-5 space-y-2 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="size-4" />
                    <span>{conversationCount} conversation{conversationCount === 1 ? '' : 's'}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="rounded-3xl border border-dashed p-10 text-center">
            <h2 className="text-xl font-semibold">No projects yet</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Create your first project and the app will open its chat workspace immediately.
            </p>
            <Button className="mt-5 rounded-full" onClick={() => setOpen(true)}>
              <PlusIcon className="size-4" />
              Create Project
            </Button>
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create project</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Project name</label>
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="My project" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Description (optional)</label>
              <Input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What this project is about"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateProject} disabled={isCreating}>
              {isCreating ? 'Creating...' : 'Create Project'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
