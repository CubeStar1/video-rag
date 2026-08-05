import { createSupabaseServer } from '@/lib/supabase/server'
import { getUser } from '@/app/agent/hooks/get-user'
import { videodb } from '@/lib/videodb/backend-client'
import { INDEX } from '@/lib/videodb/indexes'
import type { SceneSegment, Shot, TranscriptSegment, VideoTimeline } from '@/lib/videodb/types'

type Params = Promise<{ videoId: string }>

export const maxDuration = 60

const SCENE_LIMIT = 300

/**
 * A queried shot carries its index rows under `metadata.indexes.<name>`, but the
 * shape varies by index version — fall back to the metadata bag itself.
 */
function indexRow(
  metadata: Record<string, unknown> | null | undefined,
  name: string
): Record<string, any> {
  if (!metadata || typeof metadata !== 'object') return {}

  const indexes = (metadata as any).indexes
  if (indexes && typeof indexes === 'object') {
    const rows = indexes[name] ?? Object.values(indexes)[0]
    const row = Array.isArray(rows) ? rows[0] : rows
    if (row && typeof row === 'object') return row
  }

  return metadata as Record<string, any>
}

/** Every analyzer in a run shares one segmentation, so timestamps line rows up. */
const timeKey = (shot: Shot) => `${Number(shot.start) || 0}-${Number(shot.end) || 0}`

function label(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  return text && text !== 'unknown' ? text : null
}

/** A tag is a short label, not prose — the analyzers sometimes return a sentence. */
const TAG_MAX_LENGTH = 40

/**
 * Pull short labels out of a row, from whichever of `keys` it actually carries.
 * The task-specific analyzers vary in whether a signal arrives as a string
 * (`activity`), a string array (`labels`), or an array of objects (`actions`), so
 * every shape is flattened and anything sentence-length is dropped.
 */
function tagsFrom(row: Record<string, any>, keys: string[]): string[] {
  const tags: string[] = []

  const add = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(add)
    const text = label(
      value && typeof value === 'object' ? (value as any).label ?? (value as any).name : value
    )
    if (text && text.length <= TAG_MAX_LENGTH) tags.push(text)
  }

  for (const key of keys) add(row[key])
  return tags
}

/**
 * Object detection nests its labels under `frames[].detections[].label`, but the
 * artifact may also carry a flat `objects` list — collect from whichever exists.
 */
function objectLabels(row: Record<string, any>): string[] {
  const labels = new Set<string>()

  const add = (value: unknown) => {
    const text = label(value)
    if (text) labels.add(text)
  }

  for (const entry of Array.isArray(row.objects) ? row.objects : []) {
    add(typeof entry === 'object' && entry ? entry.label ?? entry.name : entry)
  }

  const detectionGroups = [
    ...(Array.isArray(row.detections) ? [row.detections] : []),
    ...(Array.isArray(row.frames) ? row.frames.map((frame: any) => frame?.detections) : []),
  ]
  for (const group of detectionGroups) {
    for (const detection of Array.isArray(group) ? group : []) {
      add(typeof detection === 'object' && detection ? detection.label : detection)
    }
  }

  return [...labels]
}

/** Index name → its rows for this video, keyed by time range. */
type SideIndexes = Record<string, Map<string, Shot>>

function toScene(shot: Shot, index: number, side: SideIndexes): SceneSegment {
  const row = indexRow(shot.metadata, INDEX.scene)
  const key = timeKey(shot)

  const rowOf = (name: string) => {
    const match = side[name]?.get(key)
    return match ? indexRow(match.metadata, name) : {}
  }

  const ocrRow = rowOf(INDEX.ocr)

  return {
    id: `${shot.start}-${shot.end}-${index}`,
    start: Number(shot.start) || 0,
    end: Number(shot.end) || 0,
    // A default VLM writes free prose into `text`; `scene_description` only exists on
    // indexes built by the old schema'd analyzer, and is kept so they still render.
    description: String(row.text || row.scene_description || shot.text || '').trim(),
    on_screen_text: label(ocrRow.combined_text ?? ocrRow.text),
    // Deduped because a place often shows up as both `location` and `setting`.
    tags: [
      ...new Set([
        ...tagsFrom(rowOf(INDEX.activity), ['activity', 'labels', 'actions']),
        ...tagsFrom(rowOf(INDEX.location), [
          'location',
          'location_type',
          'setting',
          'time_of_day',
        ]),
      ]),
    ],
    visible_objects: objectLabels(rowOf(INDEX.objects)),
  }
}

/** Scenes + transcript for the studio timeline, in one round trip. */
export async function GET(_request: Request, { params }: { params: Params }) {
  const { videoId } = await params

  const user = await getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const supabase = await createSupabaseServer()
  const { data: video } = await supabase
    .from('videos')
    .select('*')
    .eq('id', videoId)
    .eq('user_id', user.id)
    .single()

  if (!video) return new Response('Video not found', { status: 404 })
  if (!video.videodb_video_id) {
    return new Response('This video has not been ingested yet', { status: 409 })
  }

  const errors: string[] = []

  const rows = (indexName: string) =>
    videodb.query({
      video_id: video.videodb_video_id,
      index_name: indexName,
      limit: SCENE_LIMIT,
      return_fields: [indexName],
    })

  // The scene index carries the timeline on its own; these only enrich it, so one of
  // them failing (still building, or never built) must not blank the strip.
  const SIDE_INDEXES = [INDEX.ocr, INDEX.objects, INDEX.activity, INDEX.location] as const

  const [sceneResult, transcriptResult, ...sideResults] = await Promise.allSettled([
    rows(INDEX.scene),
    videodb.transcript(video.videodb_video_id, { segmenter: 'sentence' }),
    ...SIDE_INDEXES.map(rows),
  ])

  const side: SideIndexes = Object.fromEntries(
    SIDE_INDEXES.map((name, position) => {
      const result = sideResults[position]
      return [
        name,
        new Map(
          result?.status === 'fulfilled' ? result.value.map((shot) => [timeKey(shot), shot]) : []
        ),
      ]
    })
  )

  let scenes: SceneSegment[] = []
  if (sceneResult.status === 'fulfilled') {
    scenes = sceneResult.value
      .map((shot, index) => toScene(shot, index, side))
      .filter((scene) => scene.end > scene.start)
      .sort((a, b) => a.start - b.start)
  } else {
    errors.push(`Scenes unavailable: ${sceneResult.reason?.message ?? sceneResult.reason}`)
  }

  let transcript: TranscriptSegment[] = []
  if (transcriptResult.status === 'fulfilled') {
    transcript = transcriptResult.value.segments.sort((a, b) => a.start - b.start)
  } else {
    errors.push(
      `Transcript unavailable: ${transcriptResult.reason?.message ?? transcriptResult.reason}`
    )
  }

  // The stored duration can be null for URL sources — fall back to the last segment.
  const lastEnd = Math.max(
    scenes.at(-1)?.end ?? 0,
    transcript.at(-1)?.end ?? 0
  )

  const timeline: VideoTimeline = {
    video_id: video.id,
    videodb_video_id: video.videodb_video_id,
    title: video.title,
    duration: video.duration ?? (lastEnd > 0 ? lastEnd : null),
    stream_url: video.stream_url,
    thumbnail_url: video.thumbnail_url,
    scenes,
    transcript,
    errors,
  }

  return Response.json(timeline)
}
