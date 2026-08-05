/**
 * The indexes every ingested video gets, one per analyzer in the understanding run
 * (see `backend/app/services/ingest.py`). Each analyzer runs on VideoDB's default
 * prompt and output shape, so these field names come from the platform rather than
 * from a schema of ours.
 *
 * An index name is a schema contract for the whole collection, and VideoDB keeps that
 * contract even after every matching index and video is deleted — a name whose field
 * shape has changed can never be reused. Hence the generation suffix: bump it to claim
 * a fresh set. **It must match `INDEX_GENERATION` in the backend settings.**
 */
export const INDEX_GENERATION = 'v2'

const withGeneration = <T extends string>(name: T) =>
  (INDEX_GENERATION ? `${name}_${INDEX_GENERATION}` : name) as `${T}_${typeof INDEX_GENERATION}`

export const INDEX = {
  transcript: withGeneration('transcript'),
  scene: withGeneration('scene'),
  ocr: withGeneration('ocr'),
  objects: withGeneration('objects'),
  activity: withGeneration('activity'),
  location: withGeneration('location'),
  brands: withGeneration('brands'),
} as const

export const INDEX_NAMES = Object.values(INDEX) as [string, ...string[]]

export type IndexName = (typeof INDEX)[keyof typeof INDEX]

/**
 * What each index holds, phrased for the model choosing between them.
 *
 * `scene` is prose only: the VLM runs on its default prompt, so it produces a plain
 * `text` description with no structured fields. Anything filterable or countable
 * lives on one of the task-specific indexes instead.
 */
export const INDEX_CATALOGUE = [
  `"${INDEX.transcript}" — what was said (text)`,
  `"${INDEX.scene}" — a prose description of what is shown (text); good for semantic search, nothing to filter on`,
  `"${INDEX.ocr}" — text visible on screen (text)`,
  `"${INDEX.objects}" — detected objects (frames.detections.label, frames.detections.score, summary)`,
  `"${INDEX.activity}" — actions and behaviour (activity, labels, actions)`,
  `"${INDEX.location}" — where it takes place (location, location_type, setting, time_of_day)`,
  `"${INDEX.brands}" — logos and brand mentions (brand_names, summary)`,
].join('; ')
