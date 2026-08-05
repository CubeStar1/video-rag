import { tool } from 'ai'
import { z } from 'zod'
import { formatDuration } from '@/lib/core/format'
import { describeChunking } from '@/lib/core/chunking'
import { resolveScope, type VideoToolContext } from './scope'

export function createListProjectVideosTool(context: VideoToolContext) {
  return tool({
    description:
      'List every video in the current project with its id, duration, status, and — importantly — which analyzers ran on it and which video-level results exist. Use this to resolve a video the user named in words into the id the other tools need, and to check what can actually be asked of it: a video analysed without the `people` analyzer cannot answer questions about who was there.',
    inputSchema: z.object({}),
    execute: async () => {
      const { videos, note } = await resolveScope(context)
      if (note && videos.length === 0) return { videos: [], note }

      return {
        videos: videos.map((video) => ({
          video_id: video.core_video_id,
          title: video.title,
          duration: formatDuration(video.duration),
          status: video.status,
          searchable: video.status === 'ready' && Boolean(video.core_video_id),
          // What the video can answer questions about at all.
          analyzers: video.analyzers ?? [],
          // Video-level passes with stored results: summary, chapters, events,
          // entities, stats, ner, novelty, and so on.
          insights: video.aggregates ?? [],
          chunking: video.ingest_config ? describeChunking(video.ingest_config) : null,
          ...(video.status !== 'ready' && video.stage ? { progress: video.stage } : {}),
          ...(video.error ? { error: video.error } : {}),
        })),
      }
    },
  })
}
