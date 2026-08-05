import { tool } from 'ai'
import { z } from 'zod'
import { videodb } from '@/lib/videodb/backend-client'
import { formatRange } from '@/lib/videodb/format'
import { INDEX_CATALOGUE, INDEX_NAMES } from '@/lib/videodb/indexes'

export const queryVideoIndexTool = tool({
  description:
    'Filter indexed moments on exact field values — no natural-language interpretation. Use for precise attribute questions ("every outdoor scene", "every moment showing a laptop"). Pick the index that owns the attribute, then filter on one of its fields. ' +
    `Indexes: ${INDEX_CATALOGUE}.`,
  inputSchema: z.object({
    video_id: z.string().describe('VideoDB video id'),
    index_name: z.enum(INDEX_NAMES).describe('Index to filter'),
    filter: z
      .array(
        z.object({
          field: z
            .string()
            .describe(
              'Field path on that index, e.g. "activity" or "frames.detections.label"'
            ),
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
