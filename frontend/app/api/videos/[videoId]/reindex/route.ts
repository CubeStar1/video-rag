import { createSupabaseServer } from '@/lib/supabase/server'
import { getUser } from '@/app/agent/hooks/get-user'
import { core, CoreApiError } from '@/lib/core/client'
import { normalizeChunkConfig } from '@/lib/core/chunking'

type Params = Promise<{ videoId: string }>

/**
 * Re-run the analysis, optionally with a different config.
 *
 * There is no separate re-index call in core: ingest is idempotent on the
 * content hash, so handing it the same source URL again re-analyses the same
 * video in place. Re-running with the same chunking keeps analyzers that
 * already ran and adds any new ones; changing the chunking replaces the chunks
 * and drops the vectors that described the old ones.
 */
export async function POST(request: Request, { params }: { params: Params }) {
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

  // A body is optional: the button re-runs what was stored, the upload dialog
  // can pass a changed config to re-analyse differently.
  let override: unknown = null
  try {
    override = await request.json()
  } catch {
    // No body — replay the stored config.
  }

  const config = normalizeChunkConfig(
    override && Object.keys(override as object).length > 0 ? override : video.ingest_config
  )

  try {
    const { job_id } = await core.ingestUrl(video.source_url, config)

    const { data: refreshed } = await supabase
      .from('video_core')
      .update({
        status: 'queued',
        stage: 'fetching',
        job_id,
        error: null,
        progress: null,
        ingest_config: config,
      })
      .eq('id', videoId)
      .select()
      .single()

    return Response.json({ video: refreshed ?? video, job_id })
  } catch (error: any) {
    const message =
      error instanceof CoreApiError ? error.message : error?.message || 'Re-index failed'
    return new Response(message, { status: 502 })
  }
}
