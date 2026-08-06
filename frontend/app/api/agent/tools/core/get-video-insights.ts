import { tool } from 'ai'
import { z } from 'zod'
import { core } from '@/lib/core/client'
import { resolveScope, type VideoToolContext } from './scope'

/**
 * Video-level results, and the replacement for the old aggregate/count tool.
 *
 * Not a port: the previous pipeline could only group indexed rows by a field.
 * These are whole passes over every chunk at once, several of them LLM-written,
 * and they answer the questions retrieval structurally cannot — "how busy was
 * it", "what stands out", "what happened, in order".
 */
const AGGREGATORS = [
  'summary',
  'chapters',
  'events',
  'stats',
  'novelty',
  'ner',
  'sentiment',
  'speaker_stats',
  'entities',
  'entity_timelines',
  'cooccurrence',
  'object_entities',
] as const

const CATALOGUE = [
  '`summary` — tiered summaries, key points and topics, finest tier first',
  '`chapters` — consecutive sections with titles',
  '`events` — discrete timestamped events with actor and category',
  '`stats` — counts over time, busiest and quietest moments, speech totals; use for "how busy / how many / how often"',
  '`novelty` — which segments are unlike the rest, and the outliers; use for "what stands out / anything unusual"',
  '`ner` — named entities across speech, scene text and on-screen text; use for "which brands / who is mentioned / what places"',
  '`sentiment` — sentiment of speech, per speaker and over time (needs diarization)',
  '`speaker_stats` — talk time, turns, handovers and share per speaker (needs diarization)',
  '`entities` — people linked across the video with narratives (needs the people analyzer)',
  '`entity_timelines` — presence and dwell time per person',
  '`cooccurrence` — which people appear together',
  '`object_entities` — objects tracked across chunks',
].join('; ')

export function createGetVideoInsightsTool(context: VideoToolContext) {
  return tool({
    description:
      'Read a video-level result — analysis over the whole video rather than a single moment. Use this instead of retrieving many moments and reasoning over them by hand: counts, summaries, chapter structure, what stands out, who talked most, which brands appear. ' +
      `Available: ${CATALOGUE}. ` +
      'Call list_project_videos first if you are unsure which of these a video has: one whose analyzer never ran is skipped rather than computed, and asking for it returns what does exist instead.',
    inputSchema: z.object({
      video_id: z.string().describe('Video id'),
      insight: z
        .enum(AGGREGATORS)
        .optional()
        .describe('Which result to read. Omit to see everything this video has.'),
    }),
    execute: async ({ video_id, insight }) => {
      const { ids, note } = await resolveScope(context, [video_id])
      if (ids.length === 0) {
        return { note: note ?? `Video ${video_id} is not searchable in this project.` }
      }

      try {
        const result = await core.aggregates(ids[0], insight)

        if (insight) {
          return { video_id, insight, result: result.result }
        }
        // No specific one asked for: name what exists rather than returning
        // twelve full results, which would swamp the context for nothing.
        return {
          video_id,
          available: result.available ?? [],
          note: 'Call again with `insight` set to read one of these in full.',
        }
      } catch (error: any) {
        // Core's 400 for a missing aggregate lists what the video does have,
        // which is exactly the correction the model needs.
        return { error: error.message }
      }
    },
  })
}
