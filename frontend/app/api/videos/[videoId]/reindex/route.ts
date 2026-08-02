import { createSupabaseServer } from '@/lib/supabase/server'
import { getUser } from '@/app/agent/hooks/get-user'
import { videodb } from '@/lib/videodb/backend-client'

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

  // Never ingested — start over from the source URL instead of re-indexing nothing.
  if (!video.videodb_video_id) {
    try {
      await videodb.ingest({
        db_video_id: video.id,
        source_url: video.source_url,
        title: video.title,
      })
    } catch (error: any) {
      return new Response(error?.message || 'Ingest failed', { status: 502 })
    }
  } else {
    try {
      await videodb.reindex(video.videodb_video_id, video.id)
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
