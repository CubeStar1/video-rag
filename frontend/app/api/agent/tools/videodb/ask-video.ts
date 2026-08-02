import { tool } from 'ai'
import { z } from 'zod'
import { videodb } from '@/lib/videodb/backend-client'
import { formatRange } from '@/lib/videodb/format'

export const askVideoTool = tool({
  description:
    'Ask a question about one or more indexed videos and get an answer grounded in what was actually said and shown, along with the source moments. Use this for "what / why / how / summarize" questions rather than moment lookup.',
  inputSchema: z.object({
    video_ids: z.array(z.string()).min(1).describe('VideoDB video ids to answer from'),
    question: z.string().describe('The question, phrased in full'),
    top_k: z
      .number()
      .int()
      .min(1)
      .max(30)
      .default(12)
      .describe('How many source moments to ground the answer in'),
  }),
  execute: async ({ video_ids, question, top_k }) => {
    try {
      const result = await videodb.ask({ video_ids, question, top_k })

      return {
        question,
        answer: result.answer || 'The indexes returned no answer for this question.',
        sources: result.sources.map((shot) => ({
          video_id: shot.video_id,
          video_title: shot.video_title,
          timestamp: formatRange(shot.start, shot.end),
          start: shot.start,
          end: shot.end,
          text: shot.text,
          stream_url: shot.stream_url,
        })),
        ...(result.errors.length ? { warnings: result.errors } : {}),
      }
    } catch (error: any) {
      return { error: error.message, answer: '', sources: [] }
    }
  },
})
