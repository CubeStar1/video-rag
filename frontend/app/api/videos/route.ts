import { createSupabaseServer } from '@/lib/supabase/server'
import { getUser } from '@/app/agent/hooks/get-user'
import { videodb, VideoDBBackendError } from '@/lib/videodb/backend-client'
import { normalizeSegmentation } from '@/lib/videodb/segmentation'

export const maxDuration = 120

/** List every video in a project. */
export async function GET(request: Request) {
  const user = await getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const projectId = new URL(request.url).searchParams.get('projectId')
  if (!projectId) return new Response('projectId is required', { status: 400 })

  const supabase = await createSupabaseServer()
  const { data, error } = await supabase
    .from('videos')
    .select('*')
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) return new Response(error.message, { status: 500 })

  return Response.json({ videos: await backfillThumbnails(supabase, data ?? []) })
}

/**
 * A video uploaded from a URL often has no thumbnail until VideoDB finishes
 * processing it. Fill in anything still missing, once, on read.
 */
async function backfillThumbnails(
  supabase: Awaited<ReturnType<typeof createSupabaseServer>>,
  videos: any[]
) {
  const missing = videos.filter(
    (video) => video.videodb_video_id && !video.thumbnail_url && video.status !== 'failed'
  )
  if (missing.length === 0) return videos

  const byId = new Map<string, Record<string, unknown>>()

  await Promise.all(
    missing.map(async (video) => {
      try {
        const detail = await videodb.detail(video.videodb_video_id)
        if (!detail.thumbnail_url) return

        const patch = {
          thumbnail_url: detail.thumbnail_url,
          duration: video.duration ?? detail.duration ?? null,
          stream_url: video.stream_url ?? detail.stream_url ?? null,
          player_url: video.player_url ?? detail.player_url ?? null,
        }
        await supabase.from('videos').update(patch).eq('id', video.id)
        byId.set(video.id, patch)
      } catch {
        // Backend down or still processing — try again on the next poll.
      }
    })
  )

  return videos.map((video) => {
    const patch = byId.get(video.id)
    return patch ? { ...video, ...patch } : video
  })
}

/**
 * Register an uploaded file or a pasted URL, then hand it to the backend for
 * ingestion. The row is created first so the UI can show it while VideoDB works.
 */
export async function POST(request: Request) {
  const user = await getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const { projectId, title, sourceUrl, storagePath, sourceType, segmentation } =
    await request.json()

  if (!projectId) return new Response('projectId is required', { status: 400 })
  if (!sourceUrl) return new Response('sourceUrl is required', { status: 400 })

  // Stored alongside the row so a later re-index replays the same understanding pass.
  const segmentationConfig = normalizeSegmentation(segmentation)

  const supabase = await createSupabaseServer()

  const { data: project } = await supabase
    .from('projects')
    .select('id,user_id')
    .eq('id', projectId)
    .single()

  if (!project || project.user_id !== user.id) {
    return new Response('Project not found', { status: 404 })
  }

  const { data: video, error: insertError } = await supabase
    .from('videos')
    .insert({
      project_id: projectId,
      user_id: user.id,
      title: title?.trim() || 'Untitled video',
      source_type: sourceType === 'url' ? 'url' : 'upload',
      storage_path: storagePath ?? null,
      source_url: sourceUrl,
      status: 'pending',
      index_config: { segmentation: segmentationConfig },
    })
    .select()
    .single()

  if (insertError || !video) {
    return new Response(insertError?.message || 'Failed to create video', { status: 500 })
  }

  try {
    const ingested = await videodb.ingest({
      db_video_id: video.id,
      source_url: sourceUrl,
      title: video.title,
      segmentation: segmentationConfig,
    })

    // The backend already wrote these; re-read so the client gets fresh values.
    const { data: refreshed } = await supabase
      .from('videos')
      .select('*')
      .eq('id', video.id)
      .single()

    return Response.json({ video: refreshed ?? video, ingest: ingested })
  } catch (error: any) {
    const message =
      error instanceof VideoDBBackendError ? error.message : error?.message || 'Ingest failed'

    await supabase
      .from('videos')
      .update({ status: 'failed', error: message })
      .eq('id', video.id)

    return Response.json({ video: { ...video, status: 'failed', error: message } }, { status: 502 })
  }
}
