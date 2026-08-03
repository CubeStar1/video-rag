import type {
  AggregateResponse,
  AskResponse,
  ClipResponse,
  IngestResponse,
  SearchResponse,
  SegmentationConfig,
  Shot,
  TranscriptResponse,
} from './types'

const BACKEND_URL = process.env.VIDEODB_BACKEND_URL || 'http://localhost:8000'

export class VideoDBBackendError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'VideoDBBackendError'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${BACKEND_URL}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      cache: 'no-store',
    })
  } catch (error: any) {
    throw new VideoDBBackendError(
      `Cannot reach the video backend at ${BACKEND_URL}. Is it running? (${error.message})`,
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
    throw new VideoDBBackendError(detail || response.statusText, response.status)
  }

  return response.json() as Promise<T>
}

const post = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body) })

export const videodb = {
  ingest: (body: {
    db_video_id: string
    source_url: string
    title?: string
    segmentation?: SegmentationConfig
  }) => post<IngestResponse>('/api/videos/ingest', body),

  detail: (videodbVideoId: string) =>
    request<{
      videodb_video_id: string
      title?: string
      duration?: number
      thumbnail_url?: string
      stream_url?: string
      player_url?: string
      indexes: { name?: string; status?: string; record_count?: number }[]
    }>(`/api/videos/${videodbVideoId}`),

  status: (videodbVideoId: string) =>
    request<{
      videodb_video_id: string
      status: string
      step?: string
      analyzers: { name?: string; status?: string }[]
      indexes: { name?: string; status?: string; record_count?: number }[]
    }>(`/api/videos/${videodbVideoId}/status`),

  reindex: (videodbVideoId: string, dbVideoId?: string, segmentation?: SegmentationConfig) =>
    post<{ status: string }>(
      `/api/videos/${videodbVideoId}/reindex${dbVideoId ? `?db_video_id=${dbVideoId}` : ''}`,
      { segmentation }
    ),

  remove: (videodbVideoId: string) =>
    request<{ deleted: boolean }>(`/api/videos/${videodbVideoId}`, { method: 'DELETE' }),

  transcript: (
    videodbVideoId: string,
    options: { start?: number; end?: number; segmenter?: 'sentence' | 'word' | 'time' } = {}
  ) => {
    const { start, end, segmenter } = options
    const params = new URLSearchParams()
    if (start !== undefined) params.set('start', String(start))
    if (end !== undefined) params.set('end', String(end))
    if (segmenter !== undefined) params.set('segmenter', segmenter)
    const query = params.toString()
    return request<TranscriptResponse>(
      `/api/videos/${videodbVideoId}/transcript${query ? `?${query}` : ''}`
    )
  },

  search: (body: { video_ids: string[]; query: string; top_k?: number }) =>
    post<SearchResponse>('/api/retrieval/search', body),

  ask: (body: { video_ids: string[]; question: string; top_k?: number }) =>
    post<AskResponse>('/api/retrieval/ask', body),

  semanticSearch: (body: {
    video_ids: string[]
    query: string
    index_names?: string[]
    top_k?: number
    score_threshold?: number
  }) => post<SearchResponse>('/api/retrieval/semantic-search', body),

  query: (body: {
    video_id: string
    index_name: string
    filter?: unknown
    limit?: number
    sort?: [string, string][]
    /** Index rows to hydrate onto each shot, e.g. `['scene']` or `'all'`. */
    return_fields?: unknown
  }) => post<Shot[]>('/api/retrieval/query', body),

  aggregate: (body: {
    video_id: string
    index_name: string
    group_by?: string
    metric?: string
    filter?: unknown
    limit?: number
  }) => post<AggregateResponse>('/api/retrieval/aggregate', body),

  clip: (body: { video_id: string; timestamps: [number, number][] }) =>
    post<ClipResponse>('/api/retrieval/clip', body),
}
