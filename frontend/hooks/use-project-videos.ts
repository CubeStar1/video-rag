'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ProjectVideo } from '@/lib/videodb/types'

const IN_FLIGHT: ProjectVideo['status'][] = ['pending', 'ingesting', 'indexing']

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
    // Poll only while something is still being ingested or indexed.
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

  return { remove, reindex, invalidate }
}
