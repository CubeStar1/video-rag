import { createSupabaseServer } from '@/lib/supabase/server'
import { getUser } from '@/app/agent/hooks/get-user'
import { core, CoreApiError } from '@/lib/core/client'

type Params = Promise<{ videoId: string }>

async function loadOwnedVideo(videoId: string) {
  const user = await getUser()
  if (!user) return { error: new Response('Unauthorized', { status: 401 }) }

  const supabase = await createSupabaseServer()
  const { data: video } = await supabase
    .from('video_core')
    .select('id,core_video_id,aggregates')
    .eq('id', videoId)
    .eq('user_id', user.id)
    .single()

  if (!video) return { error: new Response('Video not found', { status: 404 }) }
  if (!video.core_video_id) {
    return { error: new Response('This video has not finished ingesting yet', { status: 409 }) }
  }

  return { video, supabase }
}

/** Video-level results: summary, chapters, events, stats, entities, and the rest. */
export async function GET(request: Request, { params }: { params: Params }) {
  const { videoId } = await params
  const { video, error } = await loadOwnedVideo(videoId)
  if (error) return error

  const aggregator = new URL(request.url).searchParams.get('aggregator') ?? undefined

  try {
    return Response.json(await core.aggregates(video!.core_video_id!, aggregator))
  } catch (err: any) {
    const status = err instanceof CoreApiError ? err.status : 502
    return new Response(err?.message || 'Could not load aggregates', { status })
  }
}

/**
 * Re-run aggregators over already-analysed output.
 *
 * The cheap half of re-processing: aggregators read stored analyzer output
 * rather than the video, so re-summarising or re-linking entities after tuning
 * costs no re-analysis. Five of them do bill LLM calls, which is why this is a
 * deliberate action rather than something the page does on load.
 */
export async function POST(request: Request, { params }: { params: Params }) {
  const { videoId } = await params
  const { video, supabase, error } = await loadOwnedVideo(videoId)
  if (error) return error

  let body: { aggregators?: string[]; force?: boolean } = {}
  try {
    body = await request.json()
  } catch {
    // No body — re-run everything.
  }

  try {
    const job = await core.runAggregates(
      video!.core_video_id!,
      body.aggregators,
      body.force ?? true
    )

    await supabase!
      .from('video_core')
      .update({ status: 'analyzing', stage: 'aggregating', job_id: job.job_id })
      .eq('id', videoId)

    return Response.json(job)
  } catch (err: any) {
    const status = err instanceof CoreApiError ? err.status : 502
    return new Response(err?.message || 'Could not run aggregators', { status })
  }
}
