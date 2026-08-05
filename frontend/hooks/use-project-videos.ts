'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { IN_FLIGHT, type ProjectVideo } from '@/lib/core/types'

export const projectVideosKey = (projectId: string) => ['project-videos', projectId]

async function fetchVideos(projectId: string): Promise<ProjectVideo[]> {
  const response = await fetch(`/api/videos?projectId=${projectId}`)
  if (!response.ok) throw new Error(await response.text())
  const { videos } = await response.json()
  return videos
}

export function useProjectVideos(projectId: string, initialVideos?: ProjectVideo[]) {
  const query = useQuery({
    queryKey: projectVideosKey(projectId),
    queryFn: () => fetchVideos(projectId),
    initialData: initialVideos,
    enabled: Boolean(projectId),
    staleTime: 0,
    // Poll while anything is still being analysed. Core pushes nothing, so this
    // poll is also what advances each row's progress — the route reconciles
    // against core's job on every read.
    refetchInterval: (q) =>
      (q.state.data ?? []).some((video) => IN_FLIGHT.includes(video.status)) ? 5000 : false,
  })

  return {
    ...query,
    videos: query.data ?? [],
    readyVideos: (query.data ?? []).filter((video) => video.status === 'ready'),
    isIndexing: (query.data ?? []).some((video) => IN_FLIGHT.includes(video.status)),
  }
}

export function useVideoMutations(projectId: string) {
  const queryClient = useQueryClient()
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: projectVideosKey(projectId) })

  const remove = useMutation({
    mutationFn: async (videoId: string) => {
      const response = await fetch(`/api/videos/${videoId}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(await response.text())
    },
    onSuccess: invalidate,
  })

  const reindex = useMutation({
    mutationFn: async (videoId: string) => {
      const response = await fetch(`/api/videos/${videoId}/reindex`, { method: 'POST' })
      if (!response.ok) throw new Error(await response.text())
    },
    onSuccess: invalidate,
  })

  /**
   * Re-run the video-level passes without re-analysing. Cheap next to a
   * re-index — aggregators read stored analyzer output rather than the video —
   * though five of them do bill LLM calls.
   */
  const reaggregate = useMutation({
    mutationFn: async ({
      videoId,
      aggregators,
    }: {
      videoId: string
      aggregators?: string[]
    }) => {
      const response = await fetch(`/api/videos/${videoId}/aggregates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aggregators }),
      })
      if (!response.ok) throw new Error(await response.text())
    },
    onSuccess: invalidate,
  })

  return { remove, reindex, reaggregate, invalidate }
}
