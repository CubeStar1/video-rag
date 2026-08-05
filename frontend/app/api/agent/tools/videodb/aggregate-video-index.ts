import { tool } from 'ai'
import { z } from 'zod'
import { videodb } from '@/lib/videodb/backend-client'
import { INDEX, INDEX_CATALOGUE, INDEX_NAMES } from '@/lib/videodb/indexes'

export const aggregateVideoIndexTool = tool({
  description:
    'Count and group indexed moments. Use for "how many / how often / what appears most" questions instead of retrieving everything and counting by hand. Group on a short label field — ' +
    `"${INDEX.objects}" grouped by frames.detections.label answers "what appears most", ` +
    `"${INDEX.brands}" by brand_names answers "which brands". Indexes: ${INDEX_CATALOGUE}.`,
  inputSchema: z.object({
    video_id: z.string().describe('VideoDB video id'),
    index_name: z.enum(INDEX_NAMES).describe('Index to aggregate over'),
    group_by: z
      .string()
      .describe('Field to group by, e.g. "activity" or "frames.detections.label"'),
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
