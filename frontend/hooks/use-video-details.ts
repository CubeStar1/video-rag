'use client'

import { useQuery } from '@tanstack/react-query'
import { IN_FLIGHT, type VideoDetails } from '@/lib/core/types'

export const videoDetailsKey = (videoId: string) => ['video-details', videoId]

async function fetchDetails(videoId: string): Promise<VideoDetails> {
  const response = await fetch(`/api/videos/${videoId}/details`)
  if (!response.ok) throw new Error(await response.text())
  return response.json()
}

/**
 * Everything stored for one video. Heavier than the timeline — every chunk with
 * every analyzer's output — so it is cached rather than refetched on focus, and
 * only polls while the video is still being analysed.
 */
export function useVideoDetails(videoId: string | undefined) {
  const query = useQuery({
    queryKey: videoDetailsKey(videoId ?? ''),
    queryFn: () => fetchDetails(videoId as string),
    enabled: Boolean(videoId),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
    refetchInterval: (q) =>
      q.state.data && IN_FLIGHT.includes(q.state.data.video.status) ? 5000 : false,
  })

  return {
    ...query,
    details: query.data,
    chunks: query.data?.chunks ?? [],
    aggregates: query.data?.aggregates ?? {},
  }
}
