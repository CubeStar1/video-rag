'use client'

import { useQuery } from '@tanstack/react-query'
import type { VideoTimeline } from '@/lib/videodb/types'

export const videoTimelineKey = (videoId: string) => ['video-timeline', videoId]

async function fetchTimeline(videoId: string): Promise<VideoTimeline> {
  const response = await fetch(`/api/videos/${videoId}/timeline`)
  if (!response.ok) throw new Error(await response.text())
  return response.json()
}

/**
 * Scenes and transcript for one video. Indexing is slow, so an empty result is
 * retried on a slow poll rather than cached as "this video has no scenes".
 */
export function useVideoTimeline(videoId: string | undefined) {
  const query = useQuery({
    queryKey: videoTimelineKey(videoId ?? ''),
    queryFn: () => fetchTimeline(videoId as string),
    enabled: Boolean(videoId),
    staleTime: 5 * 60 * 1000,
    retry: 1,
    refetchInterval: (q) => {
      const data = q.state.data
      if (!data) return false
      return data.scenes.length === 0 && data.transcript.length === 0 ? 20000 : false
    },
  })

  return {
    ...query,
    timeline: query.data,
    scenes: query.data?.scenes ?? [],
    transcript: query.data?.transcript ?? [],
  }
}
