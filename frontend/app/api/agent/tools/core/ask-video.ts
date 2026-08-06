import { tool } from 'ai'
import { z } from 'zod'
import { core } from '@/lib/core/client'
import { formatRange } from '@/lib/core/format'
import { resolveScope, titleMap, urlMap, type VideoToolContext } from './scope'

export function createAskVideoTool(context: VideoToolContext) {
  return tool({
    description:
      'Ask a question about the project\'s videos and get an answer grounded in what was actually said and shown, plus the source moments. ' +
      'This is your default for "what / why / how / summarize" questions. It is stronger than searching moments because the question is routed to whichever video-level results can address it — entity narratives for questions about a person, novelty for "what stands out", statistics for counts — and those contain cross-segment reasoning that reading chunks one at a time cannot recover.',
    inputSchema: z.object({
      question: z.string().describe('The question, phrased in full'),
      video_ids: z
        .array(z.string())
        .optional()
        .describe('Restrict to these video ids. Omit to answer from every searchable video.'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(20)
        .default(6)
        .describe('How many supporting segments to retrieve per video'),
    }),
    execute: async ({ question, video_ids, limit }) => {
      const { ids, videos, note } = await resolveScope(context, video_ids)
      if (ids.length === 0) return { answer: '', sources: [], note: note ?? 'Nothing analysed yet.' }

      const titles = titleMap(videos)
      const urls = urlMap(videos)

      try {
        const result = await core.ask({ question, video_ids: ids, limit })

        return {
          question,
          answer: result.answer || 'The analysis returned no answer for this question.',
          // Which video-level results core consulted, per video. Worth reporting:
          // it explains why an answer knows something no single segment says.
          consulted: result.sources,
          sources: result.results.map((hit) => ({
            video_id: hit.video_id,
            video_title: titles.get(hit.video_id),
            url: urls.get(hit.video_id),
            chunk_id: hit.chunk_id,
            timestamp: formatRange(hit.start, hit.end),
            start: hit.start,
            end: hit.end,
            text: hit.description ?? hit.snippet,
          })),
          ...(result.error ? { warning: result.error } : {}),
          ...(note ? { scope_warning: note } : {}),
        }
      } catch (error: any) {
        return { error: error.message, answer: '', sources: [] }
      }
    },
  })
}
