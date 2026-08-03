import { createSupabaseServer } from '@/lib/supabase/server'
import { getUser } from '@/app/agent/hooks/get-user'
import { videodb } from '@/lib/videodb/backend-client'
import { normalizeSegmentation } from '@/lib/videodb/segmentation'

type Params = Promise<{ videoId: string }>

export async function POST(_request: Request, { params }: { params: Params }) {
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

  // Rows created before segmentation was configurable have no stored config —
  // normalize() falls back to the defaults for them.
  const segmentation = normalizeSegmentation(video.index_config?.segmentation)

  // Never ingested — start over from the source URL instead of re-indexing nothing.
  if (!video.videodb_video_id) {
    try {
      await videodb.ingest({
        db_video_id: video.id,
        source_url: video.source_url,
        title: video.title,
        segmentation,
      })
    } catch (error: any) {
      return new Response(error?.message || 'Ingest failed', { status: 502 })
    }
  } else {
    try {
      await videodb.reindex(video.videodb_video_id, video.id, segmentation)
    } catch (error: any) {
      return new Response(error?.message || 'Reindex failed', { status: 502 })
    }
  }

  const { data: refreshed } = await supabase
    .from('videos')
    .select('*')
    .eq('id', videoId)
    .single()

  return Response.json({ video: refreshed ?? video })
}
