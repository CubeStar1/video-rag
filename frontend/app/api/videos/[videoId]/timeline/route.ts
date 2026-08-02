import { createSupabaseServer } from '@/lib/supabase/server'
import { getUser } from '@/app/agent/hooks/get-user'
import { videodb } from '@/lib/videodb/backend-client'
import type { SceneSegment, Shot, TranscriptSegment, VideoTimeline } from '@/lib/videodb/types'

type Params = Promise<{ videoId: string }>

export const maxDuration = 60

const SCENE_LIMIT = 300

/**
 * A queried shot carries its index rows under `metadata.indexes.<name>`, but the
 * shape varies by index version — fall back to the metadata bag itself.
 */
function sceneRow(metadata: Record<string, unknown> | null | undefined): Record<string, any> {
  if (!metadata || typeof metadata !== 'object') return {}

  const indexes = (metadata as any).indexes
  if (indexes && typeof indexes === 'object') {
    const rows = indexes.scene ?? Object.values(indexes)[0]
    const row = Array.isArray(rows) ? rows[0] : rows
    if (row && typeof row === 'object') return row
  }

  return metadata as Record<string, any>
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item)).filter(Boolean)
}

function toScene(shot: Shot, index: number): SceneSegment {
  const row = sceneRow(shot.metadata)
  const setting = row.setting && typeof row.setting === 'object' ? row.setting : null

  return {
    id: `${shot.start}-${shot.end}-${index}`,
    start: Number(shot.start) || 0,
    end: Number(shot.end) || 0,
    description: String(row.scene_description || shot.text || '').trim(),
    on_screen_text: row.on_screen_text ? String(row.on_screen_text).trim() : null,
    activity: row.activity ? String(row.activity) : null,
    setting: setting
      ? {
          location_type: setting.location_type ? String(setting.location_type) : null,
          environment: setting.environment ? String(setting.environment) : null,
        }
      : null,
    visible_objects: toStringArray(row.visible_objects),
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

  // One index failing (still building, or never built) must not blank the other.
  const [sceneResult, transcriptResult] = await Promise.allSettled([
    videodb.query({
      video_id: video.videodb_video_id,
      index_name: 'scene',
      limit: SCENE_LIMIT,
      return_fields: ['scene'],
    }),
    videodb.transcript(video.videodb_video_id, { segmenter: 'sentence' }),
  ])

  let scenes: SceneSegment[] = []
  if (sceneResult.status === 'fulfilled') {
    scenes = sceneResult.value
      .map(toScene)
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
