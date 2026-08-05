export type VideoStatus = 'pending' | 'ingesting' | 'indexing' | 'ready' | 'failed'

export type SegmentationType = 'shot' | 'time'

/**
 * How VideoDB cuts a video into the scenes the analyzers run on. `shot` splits on
 * the video's own cuts, `time` into fixed-length ranges. Mirrors the backend's
 * `SegmentationConfig`.
 */
export interface SegmentationConfig {
  type: SegmentationType
  /** `time` only — scene length in seconds. */
  seconds?: number
  /** `shot` only — cut-detection sensitivity. */
  threshold?: number
  /** `shot` only — floor on how short a scene may be. */
  min_scene_len?: number
}

/** The understanding settings a video was ingested with, replayed on re-index. */
export interface VideoIndexConfig {
  segmentation?: SegmentationConfig
}

export interface ProjectVideo {
  id: string
  project_id: string
  user_id: string
  title: string
  source_type: 'upload' | 'url'
  storage_path: string | null
  source_url: string
  videodb_video_id: string | null
  videodb_collection_id: string | null
  stream_url: string | null
  player_url: string | null
  thumbnail_url: string | null
  duration: number | null
  status: VideoStatus
  index_status: IndexStatus | null
  index_config: VideoIndexConfig | null
  error: string | null
  created_at: string
  updated_at: string
}

export interface IndexStatus {
  step?: string
  message?: string
  segmentation?: SegmentationConfig
  analyzers?: { name?: string; status?: string }[]
  indexes?: { name?: string; status?: string; record_count?: number; error?: string }[]
}

/** A retrieved moment. Mirrors the backend's `ShotOut`. */
export interface Shot {
  video_id: string
  video_title?: string | null
  start: number
  end: number
  text?: string | null
  score?: number | null
  stream_url?: string | null
  player_url?: string | null
  metadata?: Record<string, unknown> | null
}

export interface SearchResponse {
  query: string
  shots: Shot[]
  compiled_stream_url?: string | null
  compiled_player_url?: string | null
  errors: string[]
}

export interface AskResponse {
  question: string
  answer: string
  sources: Shot[]
  errors: string[]
}

export interface AggregateResponse {
  index_name: string
  group_by?: string | null
  metric: string
  rows: Record<string, unknown>[]
}

export interface ClipResponse {
  video_id: string
  stream_url: string
  player_url: string
  timestamps: [number, number][]
}

export interface IngestResponse {
  videodb_video_id: string
  collection_id: string
  title?: string | null
  duration?: number | null
  thumbnail_url?: string | null
  stream_url?: string | null
  player_url?: string | null
  status: string
  /** What the backend actually resolved after applying its defaults. */
  segmentation?: SegmentationConfig | null
}

export interface TranscriptSegment {
  start: number
  end: number
  text: string
}

export interface TranscriptResponse {
  videodb_video_id: string
  start?: number | null
  end?: number | null
  segmenter: string
  text: string
  segments: TranscriptSegment[]
}

/** Clip payload handed to the artifact panel by the `show_clips` tool. */
export interface ClipItem {
  label?: string
  video_id: string
  video_title?: string
  start: number
  end: number
  text?: string
  score?: number
  stream_url: string
  thumbnail_url?: string
}

/**
 * One moment on the timeline, merged from the analyzers that share a segmentation.
 * The VLM runs on its default prompt, so `scene` holds prose and nothing structured —
 * the labels come from the task-specific analyzers instead.
 */
export interface SceneSegment {
  id: string
  start: number
  end: number
  /** From the `scene` index. */
  description: string
  /** From the `ocr` index. */
  on_screen_text?: string | null
  /** Short labels merged from the `activity` and `location` indexes. */
  tags: string[]
  /** From the `objects` index. */
  visible_objects?: string[]
}

/** Everything the studio timeline needs for one video. */
export interface VideoTimeline {
  video_id: string
  videodb_video_id: string
  title: string
  duration: number | null
  stream_url: string | null
  thumbnail_url: string | null
  scenes: SceneSegment[]
  transcript: TranscriptSegment[]
  /** Per-index failures — the panel still renders whatever did load. */
  errors: string[]
}

export interface ShowClipsArgs {
  title: string
  identifier?: string
  compiled_stream_url?: string
  clips: ClipItem[]
}
