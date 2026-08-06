import { createSupabaseServer } from '@/lib/supabase/server'
import { getUser } from '@/app/agent/hooks/get-user'
import { core } from '@/lib/core/client'
import type {
  Chapter,
  ChunkOut,
  SceneSegment,
  TranscriptSegment,
  VideoEvent,
  VideoTimeline,
} from '@/lib/core/types'

type Params = Promise<{ videoId: string }>

export const maxDuration = 60

/** Core paginates chunks; a long video's timeline still wants all of them. */
const CHUNK_LIMIT = 500

const TAG_MAX_LENGTH = 40

/** A tag is a short label, not prose — drop anything sentence-length. */
function shortLabels(...groups: (string[] | string | undefined)[]): string[] {
  const tags: string[] = []
  for (const group of groups) {
    for (const value of Array.isArray(group) ? group : group ? [group] : []) {
      const text = String(value).trim()
      if (text && text !== 'unknown' && text.length <= TAG_MAX_LENGTH) tags.push(text)
    }
  }
  return [...new Set(tags)]
}

/**
 * One chunk → one scene.
 *
 * Core merges every analyzer's output onto the chunk before returning it, so
 * this is a field mapping and nothing more. The VideoDB version needed ~90
 * lines to align five separately-queried indexes by time range; that whole
 * layer is gone.
 */
function toScene(chunk: ChunkOut): SceneSegment {
  const scene = chunk.default_video ?? {}
  const ocrText = (chunk.ocr?.texts ?? [])
    .map((entry) => entry.text)
    .filter(Boolean)
    .join(' · ')

  const detected = (chunk.object_detection?.detections ?? []).map((d) => d.object)

  return {
    id: `${chunk.start}-${chunk.end}-${chunk.chunk_id}`,
    start: Number(chunk.start) || 0,
    end: Number(chunk.end) || 0,
    description: (scene.description ?? '').trim(),
    on_screen_text: ocrText || chunk.ocr?.summary || null,
    tags: shortLabels(scene.tags, scene.actions, scene.setting),
    visible_objects: [...new Set([...(scene.objects ?? []), ...detected])],
  }
}

/**
 * Speech, from whichever analyzer produced it.
 *
 * `diarization` is a strict superset of `transcript` — same Whisper text, plus
 * who said it — and the two are mutually exclusive at ingest, so at most one of
 * these branches has anything in it.
 */
function toTranscript(chunks: ChunkOut[]): TranscriptSegment[] {
  const segments: TranscriptSegment[] = []

  for (const chunk of chunks) {
    for (const turn of chunk.diarization?.turns ?? []) {
      if (turn.text?.trim()) {
        segments.push({
          start: turn.start,
          end: turn.end,
          text: turn.text.trim(),
          speaker: turn.speaker,
        })
      }
    }

    const plain = chunk.transcript?.text?.trim()
    if (plain) segments.push({ start: chunk.start, end: chunk.end, text: plain })
  }

  return segments.sort((a, b) => a.start - b.start)
}

/** Chapters and events are LLM-written and loosely shaped; coerce defensively. */
function toChapters(result: unknown): Chapter[] {
  const rows = (result as any)?.chapters
  if (!Array.isArray(rows)) return []
  return rows
    .map((row: any) => ({
      title: String(row?.title ?? 'Untitled'),
      start: Number(row?.start) || 0,
      end: Number(row?.end) || 0,
      summary: row?.summary ? String(row.summary) : undefined,
    }))
    .filter((chapter) => chapter.end > chapter.start)
    .sort((a, b) => a.start - b.start)
}

function toEvents(result: unknown): VideoEvent[] {
  const rows = (result as any)?.events
  if (!Array.isArray(rows)) return []
  return rows
    .map((row: any) => ({
      time: Number(row?.time ?? row?.start) || 0,
      description: String(row?.description ?? row?.event ?? '').trim(),
      actor: row?.actor ? String(row.actor) : undefined,
      category: row?.category ? String(row.category) : undefined,
    }))
    .filter((event) => event.description)
    .sort((a, b) => a.time - b.time)
}

/** Scenes, transcript, chapters and events for the studio timeline, in one round trip. */
export async function GET(_request: Request, { params }: { params: Params }) {
  const { videoId } = await params

  const user = await getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const supabase = await createSupabaseServer()
  const { data: video } = await supabase
    .from('video_core')
    .select('*')
    .eq('id', videoId)
    .eq('user_id', user.id)
    .single()

  if (!video) return new Response('Video not found', { status: 404 })
  if (!video.core_video_id) {
    return new Response('This video has not been analysed yet', { status: 409 })
  }

  const errors: string[] = []

  // Chapters and events are optional: they only exist if those aggregators ran,
  // and one of them missing must not blank the strip the scenes carry on their own.
  const [chunksResult, chaptersResult, eventsResult] = await Promise.allSettled([
    core.chunks(video.core_video_id, { limit: CHUNK_LIMIT }),
    core.aggregates(video.core_video_id, 'chapters'),
    core.aggregates(video.core_video_id, 'events'),
  ])

  let scenes: SceneSegment[] = []
  let transcript: TranscriptSegment[] = []

  if (chunksResult.status === 'fulfilled') {
    const chunks = chunksResult.value.chunks ?? []
    scenes = chunks
      .map(toScene)
      .filter((scene) => scene.end > scene.start && (scene.description || scene.tags.length))
      .sort((a, b) => a.start - b.start)
    transcript = toTranscript(chunks)
  } else {
    errors.push(
      `Scenes unavailable: ${chunksResult.reason?.message ?? chunksResult.reason}`
    )
  }

  // A 400 here means "this video has no such aggregate", which is a normal state
  // rather than a failure — the aggregator either has not run or was skipped.
  const chapters =
    chaptersResult.status === 'fulfilled' ? toChapters(chaptersResult.value.result) : []
  const events = eventsResult.status === 'fulfilled' ? toEvents(eventsResult.value.result) : []

  // The stored duration can be null for rows written before ingest finished —
  // fall back to the last thing on the timeline.
  const lastEnd = Math.max(scenes.at(-1)?.end ?? 0, transcript.at(-1)?.end ?? 0)

  const timeline: VideoTimeline = {
    video_id: video.id,
    core_video_id: video.core_video_id,
    title: video.title,
    duration: video.duration ?? (lastEnd > 0 ? lastEnd : null),
    playback_url: video.playback_url,
    poster_url: video.poster_url,
    scenes,
    transcript,
    chapters,
    events,
    errors,
  }

  return Response.json(timeline)
}
