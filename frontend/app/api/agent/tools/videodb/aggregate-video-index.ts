import { tool } from 'ai'
import { z } from 'zod'
import { videodb } from '@/lib/videodb/backend-client'

export const aggregateVideoIndexTool = tool({
  description:
    'Count and group indexed moments. Use for "how many / how often / what appears most" questions instead of retrieving everything and counting by hand. Good group_by fields on the "scene" index: activity, setting.location_type, setting.environment.',
  inputSchema: z.object({
    video_id: z.string().describe('VideoDB video id'),
    index_name: z.enum(['scene', 'transcript']).describe('Index to aggregate over'),
    group_by: z
      .string()
      .describe('Field to group by, e.g. "activity" or "setting.environment"'),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  execute: async ({ video_id, index_name, group_by, limit }) => {
    try {
      const result = await videodb.aggregate({
        video_id,
        index_name,
        group_by,
        metric: 'count',
        limit,
      })

      return {
        index_name,
        group_by,
        rows: result.rows,
        ...(result.rows.length === 0
          ? { note: 'No rows. The field may not be indexed for aggregation on this video.' }
          : {}),
      }
    } catch (error: any) {
      return { error: error.message, rows: [] }
    }
  },
})
