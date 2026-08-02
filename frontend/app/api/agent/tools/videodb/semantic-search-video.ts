import { tool } from 'ai'
import { z } from 'zod'
import { videodb } from '@/lib/videodb/backend-client'
import { formatRange } from '@/lib/videodb/format'

export const semanticSearchVideoTool = tool({
  description:
    'Vector search against a named index. Use instead of search_video_moments when you know whether the answer is in the speech ("transcript") or in what is visible ("scene"), or when you need a relevance floor. Available index names: "transcript", "scene". You can target one field with a dotted path, e.g. "scene.setting.location_type".',
  inputSchema: z.object({
    video_ids: z.array(z.string()).min(1).describe('VideoDB video ids to search'),
    query: z.string().describe('Descriptive natural-language query'),
    index_names: z
      .array(z.string())
      .optional()
      .describe('Indexes to search, e.g. ["scene"]. Omit to search every semantic index.'),
    top_k: z.number().int().min(1).max(25).default(8),
    score_threshold: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe('Minimum similarity, e.g. 0.7 to keep only strong matches'),
  }),
  execute: async ({ video_ids, query, index_names, top_k, score_threshold }) => {
    try {
      const result = await videodb.semanticSearch({
        video_ids,
        query,
        index_names,
        top_k,
        score_threshold,
      })

      return {
        query,
        index_names: index_names ?? 'all',
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
      }
    } catch (error: any) {
      return { error: error.message, moments: [] }
    }
  },
})
