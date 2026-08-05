import type {
  AggregatesResponse,
  AskResponse,
  CapabilitiesResponse,
  ChunkConfig,
  ChunkOut,
  ChunksResponse,
  CoreIngestResult,
  CoreJob,
  CoreVideo,
  EntitiesResponse,
  QueryResponse,
} from './types'

/**
 * Server-side client for core/ (VideoMind). Never import this into a client
 * component: core has no per-user auth, so every call is made by a route that
 * has already checked ownership and resolved which video ids the caller may
 * touch.
 */

const CORE_URL = process.env.CORE_API_URL || 'http://127.0.0.1:8077'
const CORE_TOKEN = process.env.CORE_API_TOKEN || ''

export class CoreApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'CoreApiError'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${CORE_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(CORE_TOKEN ? { 'X-Core-Token': CORE_TOKEN } : {}),
        ...(init?.headers ?? {}),
      },
      cache: 'no-store',
    })
  } catch (error: any) {
    throw new CoreApiError(
      `Cannot reach the analysis backend at ${CORE_URL}. Is it running? (${error.message})`,
      503
    )
  }

  if (!response.ok) {
    const body = await response.text()
    let detail = body
    try {
      detail = JSON.parse(body).detail ?? body
    } catch {
      // Not JSON — the raw body is the best message we have.
    }
    throw new CoreApiError(detail || response.statusText, response.status)
  }

  return response.json() as Promise<T>
}

const post = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body) })

const params = (values: Record<string, unknown>) => {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value))
  }
  const query = search.toString()
  return query ? `?${query}` : ''
}

/** The chunking half of a `ChunkConfig`, flattened the way both ingest routes take it. */
function ingestBody(config: ChunkConfig) {
  const { analyzers, mode, preset, weights, interval, min_duration, max_duration } = config
  return {
    analyzers: analyzers.join(','),
    mode,
    ...(mode === 'preset' ? { preset: preset ?? 'audio_video' } : {}),
    ...(mode === 'weights' ? (weights ?? {}) : {}),
    ...(mode === 'interval' ? { interval } : {}),
    min_duration: min_duration ?? 5,
    max_duration: max_duration ?? 20,
  }
}

export const core = {
  /**
   * Start ingestion from a URL. Returns 202 and a job id — the video's own id is
   * the hash of its bytes, so it does not exist until the download finishes and
   * arrives in the job result.
   */
  ingestUrl: (url: string, config: ChunkConfig) =>
    post<{ job_id: string; status: string; source: string }>('/videos/url', {
      url,
      ...ingestBody(config),
    }),

  job: (jobId: string) => request<CoreJob>(`/jobs/${jobId}`),

  video: (videoId: string) => request<CoreVideo>(`/videos/${videoId}`),

  remove: (videoId: string) =>
    request<{ video_id: string; deleted: boolean }>(`/videos/${videoId}`, { method: 'DELETE' }),

  chunks: (
    videoId: string,
    options: {
      analyzer?: string
      after?: number
      before?: number
      chunk_ids?: string
      limit?: number
      offset?: number
      verbose?: boolean
    } = {}
  ) => request<ChunksResponse>(`/videos/${videoId}/chunks${params(options)}`),

  chunk: (videoId: string, chunkId: number) =>
    request<ChunkOut>(`/videos/${videoId}/chunks/${chunkId}`),

  aggregates: (videoId: string, aggregator?: string) =>
    request<AggregatesResponse>(`/videos/${videoId}/aggregates${params({ aggregator })}`),

  /**
   * Re-run aggregators without re-analysing. Aggregators read stored analyzer
   * output rather than the video, so re-summarising costs no re-analysis —
   * though five of them do bill LLM calls, which is what `force` controls.
   */
  runAggregates: (videoId: string, aggregators?: string[], force = true) => {
    const body = new URLSearchParams()
    if (aggregators?.length) body.set('aggregators', aggregators.join(','))
    return request<{ job_id: string; status: string; video_id: string }>(
      `/videos/${videoId}/aggregates${params({ force })}`,
      {
        method: 'POST',
        body: body.toString(),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }
    )
  },

  entities: (videoId: string, minAppearances = 1) =>
    request<EntitiesResponse>(
      `/videos/${videoId}/entities${params({ min_appearances: minAppearances })}`
    ),

  /** Vector search. `filters` is validated against core's FILTER_SPEC — a typo is a 400, not silence. */
  query: (body: {
    text: string
    video_ids?: string[] | null
    analyzer?: string
    field?: string
    limit?: number
    score_threshold?: number | null
    synthesize?: boolean
    detail?: 'minimal' | 'standard' | 'full'
    filters?: Record<string, unknown>
  }) => post<QueryResponse>('/query', body),

  /** Question answering, routed to the aggregates that can address the question. */
  ask: (body: {
    question: string
    video_ids?: string[] | null
    analyzer?: string | null
    limit?: number
  }) => post<AskResponse>('/ask', body),

  capabilities: async (): Promise<CapabilitiesResponse> => {
    const [analyzers, schema] = await Promise.all([
      request<{ analyzers: any[]; fields: string[]; exclusive_groups: string[][] }>('/analyzers'),
      request<{ aggregators: any; filters: any }>('/schema'),
    ])
    return {
      analyzers: analyzers.analyzers,
      fields: analyzers.fields,
      exclusive_groups: analyzers.exclusive_groups,
      aggregators: schema.aggregators,
      filters: schema.filters,
    }
  },
}

/**
 * Map a core job onto the row fields it should write.
 *
 * Core's stages are pipeline-shaped (`fetching`, `chunking`, `analyzing`,
 * `indexing`, `aggregating`); the UI only needs to know whether it is working,
 * done, or broken.
 */
export function statusFromJob(job: CoreJob): {
  status: 'queued' | 'analyzing' | 'ready' | 'failed'
  stage: string | null
} {
  if (job.status === 'failed') return { status: 'failed', stage: job.stage }
  if (job.status === 'done') return { status: 'ready', stage: 'complete' }
  if (job.status === 'queued') return { status: 'queued', stage: job.stage }
  return { status: 'analyzing', stage: job.stage }
}
