import type { SegmentationConfig, SegmentationType } from './types'

/**
 * Segmentation decides how a video is cut into the scenes every analyzer runs on,
 * so it is the single biggest lever on how good the understanding pass turns out.
 * The right choice depends on the footage, which is why the upload dialog asks.
 */

export const SEGMENTATION_DEFAULTS = {
  type: 'shot' as SegmentationType,
  seconds: 10,
  threshold: 30,
  min_scene_len: 15,
}

/** Guard rails shared by the dialog sliders and the API-route sanitiser. */
export const SEGMENTATION_LIMITS = {
  seconds: { min: 2, max: 120 },
  threshold: { min: 5, max: 100 },
  min_scene_len: { min: 0, max: 60 },
} as const

export const SEGMENTATION_OPTIONS: {
  type: SegmentationType
  label: string
  hint: string
  bestFor: string
}[] = [
  {
    type: 'shot',
    label: 'Shot-based',
    hint: 'Splits on the video’s own scene changes.',
    bestFor: 'Edited videos, films, ads, sports clips, trailers',
  },
  {
    type: 'time',
    label: 'Time-based',
    hint: 'Splits into fixed-length ranges.',
    bestFor: 'Lectures, live streams, surveillance, long unedited footage',
  },
]

function clamp(value: number, { min, max }: { min: number; max: number }) {
  return Math.min(max, Math.max(min, Math.round(value)))
}

function toNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' ? Number(value) : value
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : fallback
}

/**
 * Coerce untrusted input into a config the backend will accept, keeping only the
 * keys that mean something for the chosen type — a `threshold` on a `time` run is
 * ignored server-side and only muddies the stored record.
 */
export function normalizeSegmentation(input: unknown): SegmentationConfig {
  const raw = (input ?? {}) as Record<string, unknown>
  const type: SegmentationType = raw.type === 'time' ? 'time' : 'shot'

  if (type === 'time') {
    return {
      type,
      seconds: clamp(toNumber(raw.seconds, SEGMENTATION_DEFAULTS.seconds), SEGMENTATION_LIMITS.seconds),
    }
  }

  return {
    type,
    threshold: clamp(
      toNumber(raw.threshold, SEGMENTATION_DEFAULTS.threshold),
      SEGMENTATION_LIMITS.threshold
    ),
    min_scene_len: clamp(
      toNumber(raw.min_scene_len, SEGMENTATION_DEFAULTS.min_scene_len),
      SEGMENTATION_LIMITS.min_scene_len
    ),
  }
}

/** One-line summary for status surfaces, e.g. "Shot-based · threshold 30". */
export function describeSegmentation(config?: SegmentationConfig | null): string {
  const normalized = normalizeSegmentation(config)
  return normalized.type === 'time'
    ? `Time-based · ${normalized.seconds}s scenes`
    : `Shot-based · threshold ${normalized.threshold}`
}
