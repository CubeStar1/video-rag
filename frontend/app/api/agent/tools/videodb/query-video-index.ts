import { tool } from 'ai'
import { z } from 'zod'
import { videodb } from '@/lib/videodb/backend-client'
import { formatRange } from '@/lib/videodb/format'

export const queryVideoIndexTool = tool({
  description:
    'Filter indexed moments on exact field values — no natural-language interpretation. Use for precise attribute questions ("every outdoor scene", "scenes tagged conversation"). The "scene" index has fields: activity, setting.location_type, setting.environment, visible_objects, scene_description, on_screen_text.',
  inputSchema: z.object({
    video_id: z.string().describe('VideoDB video id'),
    index_name: z.enum(['scene', 'transcript']).describe('Index to filter'),
    filter: z
      .array(
        z.object({
          field: z.string().describe('Field path, e.g. "setting.environment"'),
          op: z
            .enum(['==', '!=', 'contains', 'in', 'exists'])
            .describe('Comparison operator'),
          value: z
            .union([z.string(), z.number(), z.boolean(), z.array(z.string())])
            .describe('Value to compare against'),
        })
      )
      .describe('Conditions, ANDed together'),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  execute: async ({ video_id, index_name, filter, limit }) => {
    try {
      const shots = await videodb.query({ video_id, index_name, filter, limit })

      return {
        index_name,
        count: shots.length,
        moments: shots.map((shot) => ({
          timestamp: formatRange(shot.start, shot.end),
          start: shot.start,
          end: shot.end,
          text: shot.text,
          stream_url: shot.stream_url,
          metadata: shot.metadata,
        })),
      }
    } catch (error: any) {
      return { error: error.message, moments: [] }
    }
  },
})
