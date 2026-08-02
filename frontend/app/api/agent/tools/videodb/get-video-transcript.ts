import { tool } from 'ai'
import { z } from 'zod'
import { videodb } from '@/lib/videodb/backend-client'

const MAX_CHARS = 12000

export const getVideoTranscriptTool = tool({
  description:
    'Get the spoken-word transcript of a video, optionally limited to a time range. Use this when the user wants exact wording or a quote, or to read a specific stretch of the video in full.',
  inputSchema: z.object({
    video_id: z.string().describe('VideoDB video id'),
    start: z.number().min(0).optional().describe('Start of the range, in seconds'),
    end: z.number().min(0).optional().describe('End of the range, in seconds'),
  }),
  execute: async ({ video_id, start, end }) => {
    try {
      const result = await videodb.transcript(video_id, start, end)
      const truncated = result.text.length > MAX_CHARS

      return {
        video_id,
        range: start !== undefined || end !== undefined ? { start, end } : 'full',
        text: truncated ? `${result.text.slice(0, MAX_CHARS)}…` : result.text,
        ...(truncated
          ? { note: 'Transcript truncated. Request a narrower time range for the rest.' }
          : {}),
      }
    } catch (error: any) {
      return { error: error.message, text: '' }
    }
  },
})
