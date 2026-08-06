import { createSupabaseServer } from '@/lib/supabase/server'
import { getUser } from '@/app/agent/hooks/get-user'
import { core } from '@/lib/core/client'
import { reconcileVideo } from '@/lib/core/reconcile'
import type { ProjectVideo } from '@/lib/core/types'

type Params = Promise<{ videoId: string }>

async function loadOwnedVideo(videoId: string) {
  const user = await getUser()
  if (!user) return { error: new Response('Unauthorized', { status: 401 }) }

  const supabase = await createSupabaseServer()
  const { data: video } = await supabase
    .from('video_core')
    .select('*')
    .eq('id', videoId)
    .eq('user_id', user.id)
    .single()

  if (!video) return { error: new Response('Video not found', { status: 404 }) }

  return { video: video as ProjectVideo, supabase }
}

/** Refresh one video's ingest progress from core and persist what changed. */
export async function GET(_request: Request, { params }: { params: Params }) {
  const { videoId } = await params
  const { video, supabase, error } = await loadOwnedVideo(videoId)
  if (error) return error

  try {
    return Response.json({ video: await reconcileVideo(supabase!, video!) })
  } catch {
    // Backend down — the stored row is still the best answer we have.
    return Response.json({ video })
  }
}

export async function DELETE(_request: Request, { params }: { params: Params }) {
  const { videoId } = await params
  const { video, supabase, error } = await loadOwnedVideo(videoId)
  if (error) return error

  // Core identifies a video by the hash of its bytes, so the same file uploaded
  // to two projects is one video in core. Deleting it because *this* row went
  // away would silently destroy the other project's analysis, so core is only
  // told once nothing else points at it.
  if (video!.core_video_id) {
    const { count } = await supabase!
      .from('video_core')
      .select('id', { count: 'exact', head: true })
      .eq('core_video_id', video!.core_video_id)
      .neq('id', videoId)

    if (!count) {
      try {
        await core.remove(video!.core_video_id)
      } catch {
        // Already gone from core, or core is down — still drop our row.
      }
    }
  }

  if (video!.storage_path) {
    await supabase!.storage.from('project-assets').remove([video!.storage_path])
  }

  const { error: deleteError } = await supabase!.from('video_core').delete().eq('id', videoId)
  if (deleteError) return new Response(deleteError.message, { status: 500 })

  return Response.json({ deleted: true })
}
