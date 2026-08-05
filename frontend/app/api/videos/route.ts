import { createSupabaseServer } from '@/lib/supabase/server'
import { getUser } from '@/app/agent/hooks/get-user'
import { core, CoreApiError } from '@/lib/core/client'
import { normalizeChunkConfig } from '@/lib/core/chunking'
import { reconcileAll } from '@/lib/core/reconcile'
import type { ProjectVideo } from '@/lib/core/types'

export const maxDuration = 60

/**
 * List every video in a project, bringing any still-ingesting row up to date
 * with the core job it is waiting on.
 *
 * Reconciling on read is what replaced VideoDB's thumbnail backfill: core
 * analyses on a background thread and pushes nothing, so the client's existing
 * poll is where progress is discovered.
 */
export async function GET(request: Request) {
  const user = await getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const projectId = new URL(request.url).searchParams.get('projectId')
  if (!projectId) return new Response('projectId is required', { status: 400 })

  const supabase = await createSupabaseServer()
  const { data, error } = await supabase
    .from('video_core')
    .select('*')
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) return new Response(error.message, { status: 500 })

  return Response.json({ videos: await reconcileAll(supabase, (data ?? []) as ProjectVideo[]) })
}

/**
 * Register an uploaded file or a pasted URL, then hand the URL to core.
 *
 * The row is created first and deliberately before core has seen a byte: the
 * video's core id is the hash of its contents, so it does not exist until the
 * download finishes. Everything identifying arrives later, through the job.
 */
export async function POST(request: Request) {
  const user = await getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const { projectId, title, sourceUrl, storagePath, sourceType, config } = await request.json()

  if (!projectId) return new Response('projectId is required', { status: 400 })
  if (!sourceUrl) return new Response('sourceUrl is required', { status: 400 })

  // Stored on the row so a later re-index replays the same analysis.
  const ingestConfig = normalizeChunkConfig(config)

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
    .from('video_core')
    .insert({
      project_id: projectId,
      user_id: user.id,
      title: title?.trim() || 'Untitled video',
      source_type: sourceType === 'url' ? 'url' : 'upload',
      storage_path: storagePath ?? null,
      source_url: sourceUrl,
      status: 'pending',
      ingest_config: ingestConfig,
    })
    .select()
    .single()

  if (insertError || !video) {
    return new Response(insertError?.message || 'Failed to create video', { status: 500 })
  }

  try {
    const { job_id } = await core.ingestUrl(sourceUrl, ingestConfig)

    const { data: queued } = await supabase
      .from('video_core')
      .update({ status: 'queued', job_id, stage: 'fetching' })
      .eq('id', video.id)
      .select()
      .single()

    return Response.json({ video: queued ?? video, job_id })
  } catch (error: any) {
    const message =
      error instanceof CoreApiError ? error.message : error?.message || 'Ingest failed'

    await supabase
      .from('video_core')
      .update({ status: 'failed', error: message })
      .eq('id', video.id)

    return Response.json({ video: { ...video, status: 'failed', error: message } }, { status: 502 })
  }
}
