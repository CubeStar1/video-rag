import { tool } from 'ai'
import { z } from 'zod'
import { core } from '@/lib/core/client'
import { formatRange } from '@/lib/core/format'
import { resolveScope, titleMap, urlMap, type VideoToolContext } from './scope'

/**
 * One search tool where there used to be three.
 *
 * The old surface split "search naturally", "search a named index" and "filter
 * on exact values" into separate tools because VideoDB modelled each as a
 * different call. Core's `/query` takes them at once — a query string plus an
 * analyzer and vector field to compare it against — so splitting them here
 * would just be three ways to reach the same endpoint with a worse chance of
 * the model picking the right one.
 *
 * Core's `filters` dict is deliberately not exposed. Every filter is a hard AND
 * against exact stored labels, so it can only ever remove results — and the
 * model reliably sent speculative ones ("white shirt" as an object, a people
 * count on an analyzer that stores none), each of which silently reduced a good
 * result set to nothing. Prose in the tool description did not stop it. The
 * semantic query already covers what those filters were being used to express,
 * so removing the parameter removes the failure mode outright.
 */
export function createSearchMomentsTool(context: VideoToolContext) {
  return tool({
    description:
      'Find moments in the project\'s analysed videos using natural language. Returns timestamped moments you can pass to show_clips. ' +
      'The query is matched semantically against the whole record, so descriptions of appearance, clothing, actions, objects and setting all belong in `query` as a full phrase. ' +
      'Use `analyzer` to pick which pass to search (`default_video` for what is shown, `diarization`/`transcript` for what is said, `ocr` for on-screen text, `people` for who is present, `object_detection` for objects), ' +
      'and `field` to compare against one part of a record instead of the whole thing, so a short precise match is not diluted.',
    inputSchema: z.object({
      query: z
        .string()
        .describe('Descriptive natural-language query. Full phrases beat keywords here.'),
      video_ids: z
        .array(z.string())
        .optional()
        .describe('Restrict to these video ids. Omit to search every searchable video.'),
      analyzer: z
        .enum([
          'default_video',
          'transcript',
          'diarization',
          'ocr',
          'people',
          'object_detection',
        ])
        .default('default_video')
        .describe('Which analysis pass to search. Must be one the video actually ran.'),
      field: z
        .enum(['combined', 'description', 'people', 'actions', 'objects'])
        .default('combined')
        .describe(
          'Which part of the record to compare against. `combined` is the whole thing; the others match one part only. A chunk missing that part is excluded rather than matched on empty text.'
        ),
      limit: z.number().int().min(1).max(25).default(8),
      score_threshold: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe(
          'Leave this unset for a normal search: correct matches routinely score 0.55-0.60, so a threshold deletes them. Set it only when the user is asking whether something is absent and an empty result has to mean "not present".'
        ),
      detail: z
        .enum(['minimal', 'standard'])
        .default('standard')
        .describe(
          'Use `minimal` when you intend to follow up with read_chunks on the few that matter — it returns ids, timecodes and a short snippet at a fraction of the context cost.'
        ),
    }),
    execute: async ({ query, video_ids, analyzer, field, limit, score_threshold, detail }) => {
      const { ids, videos, note } = await resolveScope(context, video_ids)
      if (ids.length === 0) return { moments: [], note: note ?? 'Nothing searchable here yet.' }

      const titles = titleMap(videos)
      const urls = urlMap(videos)

      try {
        const result = await core.query({
          text: query,
          video_ids: ids,
          analyzer,
          field,
          limit,
          score_threshold: score_threshold ?? null,
          detail,
          // The chat message does the explaining; a second model call here would
          // pay for prose the agent is about to rewrite anyway.
          synthesize: false,
        })

        return {
          query,
          analyzer,
          field,
          count: result.results.length,
          moments: result.results.map((hit) => ({
            video_id: hit.video_id,
            video_title: titles.get(hit.video_id),
            // Every moment carries the video's mp4 plus its range — that pair is
            // what show_clips needs, and there is no per-clip URL to pass along.
            url: urls.get(hit.video_id),
            chunk_id: hit.chunk_id,
            timestamp: formatRange(hit.start, hit.end),
            start: hit.start,
            end: hit.end,
            score: hit.score,
            text: hit.snippet ?? hit.description,
            ...(detail === 'standard'
              ? {
                  people: hit.people,
                  objects: hit.objects,
                  actions: hit.actions,
                  tags: hit.tags,
                  speakers: hit.speakers,
                }
              : {}),
          })),
          ...(note ? { warning: note } : {}),
          ...(result.results.length === 0
            ? {
                note: 'No matching moments. Try rephrasing, dropping the score_threshold, or a different analyzer — this one may not have run on these videos.',
              }
            : {}),
        }
      } catch (error: any) {
        return { error: error.message, moments: [] }
      }
    },
  })
}
