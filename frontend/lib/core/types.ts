/**
 * The shapes core/ speaks, plus the application's row type.
 *
 * The big difference from the VideoDB types this replaces: there is no
 * `stream_url` anywhere. A video is one mp4; a moment is that mp4 plus a
 * `(start, end)` pair. Anything that used to be handed a per-clip stream is
 * now handed a range and seeks into the same file.
 */

export type VideoStatus =
  | 'pending'
  | 'uploading'
  | 'queued'
  | 'analyzing'
  | 'ready'
  | 'failed'

/** Statuses that mean core is still working, so the client should keep polling. */
export const IN_FLIGHT: VideoStatus[] = ['pending', 'uploading', 'queued', 'analyzing']

/** Core's analyzer ids. Authoritative list comes from `GET /analyzers` at runtime. */
export type AnalyzerId =
  | 'default_video'
  | 'transcript'
  | 'diarization'
  | 'ocr'
  | 'people'
  | 'object_detection'

export type ChunkMode = 'preset' | 'weights' | 'interval'
export type ChunkPreset = 'audio' | 'video' | 'audio_video'

/**
 * How core cuts a video into the chunks every analyzer runs on. Three modes:
 * a named weighting of the four boundary signals, your own weighting, or fixed
 * spans with no detectors at all.
 */
export interface ChunkConfig {
  analyzers: AnalyzerId[]
  mode: ChunkMode
  /** `preset` mode only. */
  preset?: ChunkPreset
  /** `weights` mode only — at least one required, ratios are what matter. */
  weights?: { speaker?: number; silence?: number; cut?: number; semantic?: number }
  /** `interval` mode only — seconds per chunk. min/max are not applied. */
  interval?: number
  min_duration?: number
  max_duration?: number
}

/** One row of `video_core`. */
export interface ProjectVideo {
  id: string
  project_id: string
  user_id: string
  title: string
  source_type: 'upload' | 'url'
  storage_path: string | null
  source_url: string
  core_video_id: string | null
  playback_url: string | null
  poster_url: string | null
  duration: number | null
  size_bytes: number | null
  status: VideoStatus
  job_id: string | null
  stage: string | null
  progress: Record<string, unknown> | null
  error: string | null
  ingest_config: ChunkConfig | null
  analyzers: AnalyzerId[]
  aggregates: string[]
  chunk_config: string | null
  chunk_count: number
  created_at: string
  updated_at: string
}

// ---------------------------------------------------------------- core wire types

export interface CoreJob {
  job_id: string
  status: 'queued' | 'running' | 'done' | 'failed'
  stage: string | null
  detail: Record<string, unknown>
  result: CoreIngestResult | null
  error: string | null
  created_at: string
  updated_at: string
}

export interface CoreIngestResult {
  video_id: string
  video_url: string
  poster_url: string | null
  storage_path: string
  filename: string
  duration: number | null
  size_bytes: number | null
  chunk_config: string
  chunks: number
  analyzers: AnalyzerId[]
  /** Vectors written per analyzer. A zero is normal — a silent video has no transcript. */
  indexed: Record<string, number>
  aggregated?: { ran?: string[]; reused?: string[]; aggregates?: string[]; error?: string }
}

export interface CoreVideo {
  video_id: string
  filename: string
  video_url: string
  poster_url: string | null
  storage_path: string
  source_url: string | null
  size_bytes: number | null
  preset: string | null
  params: Record<string, unknown>
  chunk_config: string | null
  analyzers: AnalyzerId[]
  aggregates: string[]
  chunks: number
  duration: number
}

/**
 * A search hit. `detail` decides how much of this is populated — `minimal` for
 * an agent choosing what to read, `standard` for the UI, `full` for everything.
 */
export interface SearchHit {
  video_id: string
  chunk_id: number
  start: number
  end: number
  timecode: string
  score: number
  /** `minimal` only. */
  snippet?: string
  /** `standard` and above. */
  video_url?: string
  description?: string
  people?: string[]
  objects?: string[]
  actions?: string[]
  tags?: string[]
  speakers?: string[]
  people_count?: number | null
  turns?: SpeakerTurn[]
  /** `full` only. */
  text?: string
  persons?: Record<string, unknown>[]
  detections?: Record<string, unknown>[]
  texts?: { text: string; context?: string }[]
}

export interface SpeakerTurn {
  speaker: string
  start: number
  end: number
  text: string
}

export interface QueryResponse {
  query: string
  analyzer: string
  field: string
  detail: string
  answer: string | null
  results: SearchHit[]
}

export interface AskResponse {
  question: string
  answer: string | null
  sources: Record<string, Record<string, unknown>>
  results: SearchHit[]
  error?: string
}

/** One chunk with whatever each analyzer produced for it, merged. */
export interface ChunkOut {
  chunk_id: number
  start: number
  end: number
  timecode: string
  default_video?: {
    description?: string
    setting?: string
    people?: string[]
    objects?: string[]
    actions?: string[]
    tags?: string[]
  }
  transcript?: { text?: string }
  diarization?: { turns?: SpeakerTurn[]; speakers?: string[] }
  ocr?: { texts?: { text: string; context?: string }[]; summary?: string }
  people?: { people?: Record<string, unknown>[]; people_count?: number }
  object_detection?: { detections?: { object: string; description?: string }[]; objects?: string[] }
}

export interface ChunksResponse {
  video_id: string
  analyzers: AnalyzerId[]
  total: number
  offset: number
  limit: number
  chunks: ChunkOut[]
}

export interface AggregatesResponse {
  video_id: string
  available?: string[]
  aggregates?: Record<string, unknown>
  aggregator?: string
  result?: unknown
}

export interface EntitiesResponse {
  video_id: string
  total: number
  entities: {
    entity_id: string
    appearances: number
    chunk_ids: number[]
    first_seen: number
    last_seen: number
    description: string
    narrative?: string
    timeline?: { observed_seconds: number; spans: [number, number][] }
  }[]
}

export interface CapabilitiesResponse {
  analyzers: AnalyzerId[]
  fields: string[]
  exclusive_groups: string[][]
  aggregators: Record<string, { depends_on: string[]; uses_llm: boolean }>
  filters: Record<string, { type: string; matches: string; payload_field: string }>
}

// ------------------------------------------------------------------- UI shapes

/**
 * A moment to play: the video's mp4 plus the range within it. This is the type
 * that used to carry `stream_url`, and the reason every playback surface
 * changed — the clip is no longer a URL of its own.
 */
export interface ClipItem {
  label?: string
  video_id: string
  video_title?: string
  /** The whole video's mp4. Playback seeks; it does not load a per-clip source. */
  url: string
  start: number
  end: number
  text?: string
  score?: number
  poster_url?: string
}

export interface ShowClipsArgs {
  title: string
  identifier?: string
  clips: ClipItem[]
}

/**
 * One moment on the studio timeline, merged from every analyzer that ran on
 * that chunk. Unchanged in shape from the VideoDB era on purpose: only the
 * route that fills it was rewritten, so the timeline components did not have to
 * be.
 */
export interface SceneSegment {
  id: string
  start: number
  end: number
  /** `default_video.description`. */
  description: string
  /** `ocr.texts`, joined. */
  on_screen_text?: string | null
  /** Short labels from `default_video`: tags, actions, setting. */
  tags: string[]
  /** `default_video.objects` / `object_detection.detections[].object`. */
  visible_objects?: string[]
}

export interface TranscriptSegment {
  start: number
  end: number
  text: string
  /** Present when the video was analysed with `diarization` rather than `transcript`. */
  speaker?: string
}

/** A titled span from the `chapters` aggregate — a lane VideoDB never produced. */
export interface Chapter {
  title: string
  start: number
  end: number
  summary?: string
}

/** A timestamped occurrence from the `events` aggregate. */
export interface VideoEvent {
  time: number
  description: string
  actor?: string
  category?: string
}

/** Everything the studio timeline needs for one video, in one round trip. */
export interface VideoTimeline {
  video_id: string
  core_video_id: string
  title: string
  duration: number | null
  playback_url: string | null
  poster_url: string | null
  scenes: SceneSegment[]
  transcript: TranscriptSegment[]
  chapters: Chapter[]
  events: VideoEvent[]
  /** Per-source failures — the panel still renders whatever did load. */
  errors: string[]
}
