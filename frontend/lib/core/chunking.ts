import type { AnalyzerId, ChunkConfig, ChunkMode, ChunkPreset } from './types'

/**
 * Chunking decides how a video is cut into the spans every analyzer runs on, so
 * it is the single biggest lever on how good the analysis turns out — which is
 * why the upload dialog asks rather than defaulting silently.
 *
 * This replaces the VideoDB shot/time segmentation. The difference is not
 * cosmetic: core detects four boundary signals (speaker changes, silence, hard
 * cuts, semantic shifts) and fuses them under a weighting, so "how should this
 * be cut" and "which signals does this footage actually have" are the same
 * question.
 */

export const ANALYZER_CATALOGUE: {
  id: AnalyzerId
  label: string
  description: string
  /** Whether it bills per chunk. Costs differ wildly, which is why the choice is per upload. */
  billed: boolean
}[] = [
  {
    id: 'default_video',
    label: 'Scene description',
    description: 'What is happening: description, setting, people, objects, actions, tags.',
    billed: false,
  },
  {
    id: 'transcript',
    label: 'Transcript',
    description: 'Speech as plain text, per chunk.',
    billed: false,
  },
  {
    id: 'diarization',
    label: 'Transcript with speakers',
    description: 'Speech attributed to who said it. A superset of the transcript.',
    billed: false,
  },
  {
    id: 'ocr',
    label: 'On-screen text',
    description: 'Text visible in frame. Gated on cheap detection, so blank frames cost nothing.',
    billed: false,
  },
  {
    id: 'people',
    label: 'People',
    description: 'Per person: appearance, clothing, role, action. Required for entity linking.',
    billed: false,
  },
  {
    id: 'object_detection',
    label: 'Objects',
    description: 'Objects with their appearance and purpose, gated on a detector.',
    billed: false,
  },
]

/**
 * Analyzer sets that cannot be selected together. Core returns this from
 * `GET /analyzers` and rejects a bad pair with a 400; this local copy is what
 * lets the dialog grey the option out instead of failing on submit.
 */
export const EXCLUSIVE_GROUPS: AnalyzerId[][] = [['diarization', 'transcript']]

export const PRESET_OPTIONS: { type: ChunkPreset; label: string; hint: string; bestFor: string }[] =
  [
    {
      type: 'audio_video',
      label: 'Audio + video',
      hint: 'Weighs speech and visual boundaries together.',
      bestFor: 'Most footage — interviews, meetings, edited video',
    },
    {
      type: 'audio',
      label: 'Audio-led',
      hint: 'Cuts on speaker changes and silences.',
      bestFor: 'Podcasts, calls, lectures — anything carried by speech',
    },
    {
      type: 'video',
      label: 'Video-led',
      hint: 'Cuts on shot changes and visual shifts.',
      bestFor: 'Surveillance, silent footage, b-roll, sports',
    },
  ]

export const MODE_OPTIONS: { mode: ChunkMode; label: string; hint: string }[] = [
  { mode: 'preset', label: 'Preset', hint: 'A named weighting of the four signals.' },
  { mode: 'weights', label: 'Custom weights', hint: 'Set the balance yourself.' },
  { mode: 'interval', label: 'Fixed interval', hint: 'Equal spans, no detection.' },
]

export const CHUNK_DEFAULTS: ChunkConfig = {
  analyzers: ['default_video', 'diarization'],
  mode: 'preset',
  preset: 'audio_video',
  interval: 20,
  weights: { speaker: 1, silence: 1, cut: 1, semantic: 1 },
  min_duration: 5,
  max_duration: 20,
}

export const CHUNK_LIMITS = {
  interval: { min: 2, max: 300 },
  min_duration: { min: 1, max: 60 },
  max_duration: { min: 2, max: 300 },
  weight: { min: 0, max: 3 },
} as const

function clamp(value: number, { min, max }: { min: number; max: number }) {
  return Math.min(max, Math.max(min, value))
}

function toNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' ? Number(value) : value
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : fallback
}

const KNOWN_ANALYZERS = new Set(ANALYZER_CATALOGUE.map((a) => a.id))

/** Whether a selection breaks an exclusive group, and which one. */
export function exclusiveConflict(analyzers: AnalyzerId[]): AnalyzerId[] | null {
  for (const group of EXCLUSIVE_GROUPS) {
    const chosen = group.filter((id) => analyzers.includes(id))
    if (chosen.length > 1) return chosen
  }
  return null
}

/**
 * Coerce untrusted input into a config core will accept, keeping only the keys
 * that mean something for the chosen mode — an `interval` on a preset run is
 * ignored server-side and only muddies the stored config.
 */
export function normalizeChunkConfig(input: unknown): ChunkConfig {
  const raw = (input ?? {}) as Record<string, any>

  let analyzers = Array.isArray(raw.analyzers)
    ? (raw.analyzers.filter((a: unknown) => KNOWN_ANALYZERS.has(a as AnalyzerId)) as AnalyzerId[])
    : CHUNK_DEFAULTS.analyzers
  if (analyzers.length === 0) analyzers = ['default_video']

  // Resolve rather than reject: the caller gets a working run, and core would
  // have 400'd on the pair anyway. The first listed wins, and diarization is a
  // strict superset of transcript, so dropping the latter loses nothing.
  const conflict = exclusiveConflict(analyzers)
  if (conflict) analyzers = analyzers.filter((id) => id === conflict[0] || !conflict.includes(id))

  const mode: ChunkMode =
    raw.mode === 'weights' || raw.mode === 'interval' ? raw.mode : 'preset'

  const base = {
    analyzers,
    mode,
    min_duration: clamp(
      toNumber(raw.min_duration, CHUNK_DEFAULTS.min_duration!),
      CHUNK_LIMITS.min_duration
    ),
    max_duration: clamp(
      toNumber(raw.max_duration, CHUNK_DEFAULTS.max_duration!),
      CHUNK_LIMITS.max_duration
    ),
  }

  if (mode === 'interval') {
    return {
      ...base,
      interval: clamp(toNumber(raw.interval, CHUNK_DEFAULTS.interval!), CHUNK_LIMITS.interval),
    }
  }

  if (mode === 'weights') {
    const source = (raw.weights ?? {}) as Record<string, unknown>
    const weights: Record<string, number> = {}
    for (const key of ['speaker', 'silence', 'cut', 'semantic'] as const) {
      if (source[key] !== undefined && source[key] !== null) {
        weights[key] = clamp(toNumber(source[key], 1), CHUNK_LIMITS.weight)
      }
    }
    // Core requires at least one signal; a config with none would 400.
    if (Object.values(weights).every((value) => value === 0) || Object.keys(weights).length === 0) {
      return { ...base, mode: 'preset', preset: 'audio_video' }
    }
    return { ...base, weights }
  }

  const preset: ChunkPreset =
    raw.preset === 'audio' || raw.preset === 'video' ? raw.preset : 'audio_video'
  return { ...base, preset }
}

/** One-line summary for status surfaces, e.g. "Audio + video · 5–20s · 2 analyzers". */
export function describeChunking(config?: ChunkConfig | null): string {
  const normalized = normalizeChunkConfig(config)
  const count = `${normalized.analyzers.length} analyzer${normalized.analyzers.length === 1 ? '' : 's'}`

  if (normalized.mode === 'interval') {
    return `Fixed ${normalized.interval}s chunks · ${count}`
  }
  if (normalized.mode === 'weights') {
    const active = Object.entries(normalized.weights ?? {})
      .filter(([, value]) => value > 0)
      .map(([key]) => key)
      .join(', ')
    return `Custom weights (${active || 'none'}) · ${normalized.min_duration}–${normalized.max_duration}s · ${count}`
  }
  const label = PRESET_OPTIONS.find((option) => option.type === normalized.preset)?.label
  return `${label} · ${normalized.min_duration}–${normalized.max_duration}s · ${count}`
}
