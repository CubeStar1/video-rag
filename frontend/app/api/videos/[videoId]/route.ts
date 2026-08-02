import { createSupabaseServer } from '@/lib/supabase/server'
import { getUser } from '@/app/agent/hooks/get-user'
import { videodb } from '@/lib/videodb/backend-client'

type Params = Promise<{ videoId: string }>

async function loadOwnedVideo(videoId: string) {
  const user = await getUser()
  if (!user) return { error: new Response('Unauthorized', { status: 401 }) }

  const supabase = await createSupabaseServer()
  const { data: video } = await supabase
    .from('videos')
    .select('*')
    .eq('id', videoId)
    .eq('user_id', user.id)
    .single()

  if (!video) return { error: new Response('Video not found', { status: 404 }) }

  return { video, supabase }
}

/** Refresh a video's indexing status from VideoDB and persist what changed. */
export async function GET(_request: Request, { params }: { params: Params }) {
  const { videoId } = await params
  const { video, supabase, error } = await loadOwnedVideo(videoId)
  if (error) return error

  if (!video.videodb_video_id || video.status === 'ready' || video.status === 'failed') {
    return Response.json({ video })
  }

  try {
    const status = await videodb.status(video.videodb_video_id)
    if (status.status !== video.status) {
      const { data: updated } = await supabase!
        .from('videos')
        .update({
          status: status.status,
          index_status: { ...(video.index_status ?? {}), ...status },
        })
        .eq('id', videoId)
        .select()
        .single()

      return Response.json({ video: updated ?? video })
    }
  } catch {
    // Backend down or video not yet visible — keep the stored row.
  }

  return Response.json({ video })
}

export async function DELETE(_request: Request, { params }: { params: Params }) {
  const { videoId } = await params
  const { video, supabase, error } = await loadOwnedVideo(videoId)
  if (error) return error

  if (video.videodb_video_id) {
    try {
      await videodb.remove(video.videodb_video_id)
    } catch {
      // Already gone from VideoDB — still drop our row.
    }
  }

  if (video.storage_path) {
    await supabase!.storage.from('project-assets').remove([video.storage_path])
  }

  const { error: deleteError } = await supabase!.from('videos').delete().eq('id', videoId)
  if (deleteError) return new Response(deleteError.message, { status: 500 })

  return Response.json({ deleted: true })
}
