import { tool } from 'ai'
import { z } from 'zod'
import { core } from '@/lib/core/client'
import { formatTimestamp } from '@/lib/core/format'
import { resolveScope, type VideoToolContext } from './scope'

export function createGetVideoEntitiesTool(context: VideoToolContext) {
  return tool({
    description:
      'List the people identified in a video, linked across the whole thing rather than per moment: each one\'s description, what they did (a written narrative), when they first and last appear, and how long they were present. ' +
      'Use this for "who was in this", "what did the woman in the grey shirt do", "how long was he there". A single moment can only say "a person in grey is at the counter"; this is what connects those sightings into one person. ' +
      'Only available when the video was analysed with the `people` analyzer — check list_project_videos.',
    inputSchema: z.object({
      video_id: z.string().describe('Video id'),
      min_appearances: z
        .number()
        .int()
        .min(1)
        .default(2)
        .describe(
          'Only people seen in at least this many chunks. 2 is the useful default — someone seen once is already fully described by that moment.'
        ),
    }),
    execute: async ({ video_id, min_appearances }) => {
      const { ids, note } = await resolveScope(context, [video_id])
      if (ids.length === 0) {
        return { entities: [], note: note ?? `Video ${video_id} is not searchable here.` }
      }

      try {
        const result = await core.entities(ids[0], min_appearances)

        return {
          video_id,
          total: result.total,
          entities: result.entities.map((entity) => ({
            entity_id: entity.entity_id,
            description: entity.description,
            narrative: entity.narrative,
            appearances: entity.appearances,
            chunk_ids: entity.chunk_ids,
            first_seen: formatTimestamp(entity.first_seen),
            last_seen: formatTimestamp(entity.last_seen),
            start: entity.first_seen,
            end: entity.last_seen,
            ...(entity.timeline
              ? { present_for: formatTimestamp(entity.timeline.observed_seconds) }
              : {}),
          })),
          ...(result.entities.length === 0
            ? { note: 'Nobody met that threshold. Try min_appearances=1.' }
            : {}),
        }
      } catch (error: any) {
        return {
          error: error.message,
          entities: [],
          note: 'If this says the video has no `entities` result, it was analysed without the people analyzer — say so rather than guessing at who was present.',
        }
      }
    },
  })
}
