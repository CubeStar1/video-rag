import { tool } from 'ai'
import { z } from 'zod'
import { videodb } from '@/lib/videodb/backend-client'
import { formatRange } from '@/lib/videodb/format'

export const createVideoClipTool = tool({
  description:
    'Stitch one or more time ranges of a single video into a playable clip. Use this to build a highlight reel, or to turn a set of moments into one continuous clip. Pass the resulting stream_url to show_clips so the user can watch it.',
  inputSchema: z.object({
    video_id: z.string().describe('VideoDB video id'),
    timestamps: z
      .array(
        z.object({
          start: z.number().min(0).describe('Start in seconds'),
          end: z.number().min(0).describe('End in seconds'),
        })
      )
      .min(1)
      .describe('Ranges to include, in playback order'),
  }),
  execute: async ({ video_id, timestamps }) => {
    try {
      const result = await videodb.clip({
        video_id,
        timestamps: timestamps.map(({ start, end }) => [start, end] as [number, number]),
      })

      const total = timestamps.reduce((sum, range) => sum + (range.end - range.start), 0)

      return {
        video_id,
        stream_url: result.stream_url,
        segments: timestamps.map((range) => formatRange(range.start, range.end)),
        total_duration_seconds: Math.round(total),
      }
    } catch (error: any) {
      return { error: error.message }
    }
  },
})
