import { tool } from 'ai'
import { z } from 'zod'
import { core } from '@/lib/core/client'
import { resolveScope, type VideoToolContext } from './scope'

const MAX_IDS = 12

export function createReadChunksTool(context: VideoToolContext) {
  return tool({
    description:
      'Read the full stored analysis for specific moments of one video — every analyzer\'s output for those chunks, not a search snippet. ' +
      'This is the second half of the cheap retrieval pattern: run search_moments with detail="minimal" to decide which moments matter, then read only those here. Reading five moments in full this way costs a fraction of asking for full detail on every search hit. ' +
      'Also works as a plain reader: give a time range instead of chunk ids to see what happened between two points.',
    inputSchema: z.object({
      video_id: z.string().describe('Video id, from list_project_videos or a search result'),
      chunk_ids: z
        .array(z.number().int())
        .max(MAX_IDS)
        .optional()
        .describe('The chunk ids to read, from a search result. Preferred over a time range.'),
      after: z.number().optional().describe('Only chunks ending after this second'),
      before: z.number().optional().describe('Only chunks starting before this second'),
      analyzer: z
        .enum(['default_video', 'transcript', 'diarization', 'ocr', 'people', 'object_detection'])
        .optional()
        .describe('Restrict to one analyzer\'s output. Omit for everything.'),
      limit: z.number().int().min(1).max(20).default(8),
    }),
    execute: async ({ video_id, chunk_ids, after, before, analyzer, limit }) => {
      const { ids, note } = await resolveScope(context, [video_id])
      if (ids.length === 0) {
        return { chunks: [], note: note ?? `Video ${video_id} is not searchable in this project.` }
      }

      try {
        const result = await core.chunks(ids[0], {
          chunk_ids: chunk_ids?.length ? chunk_ids.join(',') : undefined,
          after,
          before,
          analyzer,
          limit,
        })

        return {
          video_id,
          analyzers: result.analyzers,
          count: result.chunks.length,
          total_matching: result.total,
          chunks: result.chunks,
          ...(result.chunks.length === 0
            ? { note: 'No chunks matched. Check the ids, or widen the time range.' }
            : {}),
        }
      } catch (error: any) {
        // Core answers a request for an analyzer the video does not have with a
        // 400 that lists what it *does* have — pass that through, it is the most
        // useful correction available.
        return { error: error.message, chunks: [] }
      }
    },
  })
}
