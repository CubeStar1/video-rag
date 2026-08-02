import { tool } from 'ai'
import { z } from 'zod'
import { videodb } from '@/lib/videodb/backend-client'
import { formatRange } from '@/lib/videodb/format'

export const searchVideoMomentsTool = tool({
  description:
    'Find moments in one or more indexed videos using natural language. VideoDB plans the retrieval across the transcript and scene indexes. Returns timestamped moments with a playable stream URL for each. Use this for "find the part where…" / "show me when…" questions.',
  inputSchema: z.object({
    video_ids: z
      .array(z.string())
      .min(1)
      .describe('VideoDB video ids to search. Get them from list_project_videos.'),
    query: z
      .string()
      .describe('Descriptive natural-language query. Full phrases beat keywords here.'),
    top_k: z.number().int().min(1).max(25).default(8).describe('How many moments to return'),
  }),
  execute: async ({ video_ids, query, top_k }) => {
    try {
      const result = await videodb.search({ video_ids, query, top_k })

      return {
        query,
        count: result.shots.length,
        moments: result.shots.map((shot) => ({
          video_id: shot.video_id,
          video_title: shot.video_title,
          timestamp: formatRange(shot.start, shot.end),
          start: shot.start,
          end: shot.end,
          text: shot.text,
          score: shot.score,
          stream_url: shot.stream_url,
        })),
        compiled_stream_url: result.compiled_stream_url,
        ...(result.errors.length ? { warnings: result.errors } : {}),
        ...(result.shots.length === 0
          ? { note: 'No matching moments. The video may still be indexing, or try rephrasing.' }
          : {}),
      }
    } catch (error: any) {
      return { error: error.message, moments: [] }
    }
  },
})
