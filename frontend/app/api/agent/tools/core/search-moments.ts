import { tool } from 'ai'
import { z } from 'zod'
import { core } from '@/lib/core/client'
import { formatRange } from '@/lib/core/format'
import { resolveScope, titleMap, urlMap, type VideoToolContext } from './scope'

/**
 * Tracing for the "search returns nothing but curl returns hits" class of bug.
 *
 * The interesting gap is between what the model emitted and what core received:
 * a filter the model invented, a default the schema forced it to fill, or a
 * value this layer passed through unchanged all look identical from the chat
 * transcript. Logging both ends plus the schema the model was given makes the
 * difference visible without guessing.
 */
const TRACE = process.env.AGENT_TOOL_TRACE === '0' ? false : process.env.NODE_ENV !== 'production'

function trace(label: string, payload: unknown) {
  if (!TRACE) return
  console.log(`[search_moments] ${label}\n${JSON.stringify(payload, null, 2)}`)
}

/**
 * Filters that cannot match anything given the analyzer in play. These are not
 * errors — core applies them exactly as asked and correctly returns nothing.
 * Surfacing them here is what turns a silent empty result into a diagnosis.
 */
function suspectFilters(analyzer: string, filters: Record<string, any> | undefined): string[] {
  if (!filters) return []
  const warnings: string[] = []
  const hasCount = filters.min_people !== undefined || filters.max_people !== undefined
  if (hasCount && analyzer !== 'people') {
    warnings.push(
      `min_people/max_people sent with analyzer="${analyzer}" — only the people analyzer stores people_count, so this matches ZERO chunks`
    )
  }
  for (const key of ['objects', 'people', 'tags'] as const) {
    const phrases = (filters[key] ?? []).filter((value: string) => value.includes(' '))
    if (phrases.length) {
      warnings.push(
        `filters.${key} contains descriptive phrases ${JSON.stringify(phrases)} — these match stored labels exactly, so a phrase matches nothing`
      )
    }
  }
  return warnings
}

let schemaTraced = false

/**
 * One search tool where there used to be three.
 *
 * The old surface split "search naturally", "search a named index" and "filter
 * on exact values" into separate tools because VideoDB modelled each as a
 * different call. Core's `/query` takes all three at once — a query string, an
 * analyzer and vector field to compare it against, and a filter dict validated
 * server-side — so splitting them here would just be three ways to reach the
 * same endpoint with a worse chance of the model picking the right one.
 */
const searchMomentsInput = z.object({
  query: z
    .string()
    .describe('Descriptive natural-language query. Full phrases beat keywords here.'),
  video_ids: z
    .array(z.string())
    .optional()
    .describe('Restrict to these video ids. Omit to search every searchable video.'),
  analyzer: z
    .enum(['default_video', 'transcript', 'diarization', 'ocr', 'people', 'object_detection'])
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
    .describe('Minimum cosine similarity. ~0.55–0.6 separates present from absent content.'),
  detail: z
    .enum(['minimal', 'standard'])
    .default('standard')
    .describe(
      'Use `minimal` when you intend to follow up with read_chunks on the few that matter — it returns ids, timecodes and a short snippet at a fraction of the context cost.'
    ),
  filters: z
    .object({
      objects: z.array(z.string()).optional().describe('Chunks where these objects appear'),
      tags: z.array(z.string()).optional(),
      people: z.array(z.string()).optional().describe('Short person labels'),
      speakers: z.array(z.string()).optional().describe('e.g. ["SPEAKER_00"]'),
      min_people: z.number().int().optional().describe('At least this many people present'),
      max_people: z.number().int().optional(),
      after: z.number().optional().describe('Only chunks ending after this second'),
      before: z.number().optional().describe('Only chunks starting before this second'),
    })
    .optional()
    .describe('Exact-value restrictions, ANDed with the semantic query.'),
})

export function createSearchMomentsTool(context: VideoToolContext) {
  // Once per process: the schema as JSON, which is what the model is actually
  // shown. If optional fields arrive marked required, that is the reason the
  // model keeps inventing values for them.
  if (TRACE && !schemaTraced) {
    schemaTraced = true
    try {
      trace('input schema (as the model sees it)', z.toJSONSchema(searchMomentsInput, { io: 'input' }))
    } catch (error: any) {
      trace('input schema conversion failed', { message: error.message })
    }
  }

  return tool({
    description:
      'Find moments in the project\'s analysed videos using natural language. Returns timestamped moments you can pass to show_clips. ' +
      'Narrow it three ways when a plain query is not enough: `analyzer` picks which pass to search (`default_video` for what is shown, `diarization`/`transcript` for what is said, `ocr` for on-screen text, `people` for who is present, `object_detection` for objects); ' +
      '`field` compares against one part of a record instead of the whole thing, so a short precise match is not diluted; ' +
      'and `filters` restricts to exact attributes. Use `score_threshold` around 0.55–0.6 when you need "no match" to be expressible — cosine similarity always ranks something, so without it a query for absent content returns weak neighbours instead of nothing.',
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
        .describe('Minimum cosine similarity. ~0.55–0.6 separates present from absent content.'),
      detail: z
        .enum(['minimal', 'standard'])
        .default('standard')
        .describe(
          'Use `minimal` when you intend to follow up with read_chunks on the few that matter — it returns ids, timecodes and a short snippet at a fraction of the context cost.'
        ),
      filters: z
        .object({
          objects: z.array(z.string()).optional().describe('Chunks where these objects appear'),
          tags: z.array(z.string()).optional(),
          people: z.array(z.string()).optional().describe('Short person labels'),
          speakers: z.array(z.string()).optional().describe('e.g. ["SPEAKER_00"]'),
          min_people: z.number().int().optional().describe('At least this many people present'),
          max_people: z.number().int().optional(),
          after: z.number().optional().describe('Only chunks ending after this second'),
          before: z.number().optional().describe('Only chunks starting before this second'),
        })
        .optional()
        .describe('Exact-value restrictions, ANDed with the semantic query.'),
    }),
    execute: async ({
      query,
      video_ids,
      analyzer,
      field,
      limit,
      score_threshold,
      detail,
      filters,
    }) => {
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
          filters: filters ?? {},
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
