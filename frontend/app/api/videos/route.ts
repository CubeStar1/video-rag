import { createSupabaseServer } from '@/lib/supabase/server'
import { getUser } from '@/app/agent/hooks/get-user'
import { ingestVideoFromUrl, IngestRejected } from '@/lib/core/ingest'
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

  const supabase = await createSupabaseServer()

  try {
    const { video, jobId, error } = await ingestVideoFromUrl({
      supabase,
      userId: user.id,
      projectId,
      title,
      sourceUrl,
      sourceType,
      storagePath,
      config,
    })

    if (error) return Response.json({ video }, { status: 502 })
    return Response.json({ video, job_id: jobId })
  } catch (error: any) {
    if (error instanceof IngestRejected) {
      const status = error.message === 'Project not found' ? 404 : 500
      return new Response(error.message, { status })
    }
    throw error
  }
}
