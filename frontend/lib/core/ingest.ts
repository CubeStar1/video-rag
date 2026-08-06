import type { SupabaseClient } from '@supabase/supabase-js'
import { core, CoreApiError } from './client'
import { normalizeChunkConfig } from './chunking'
import type { ProjectVideo } from './types'

export interface IngestRequest {
  supabase: SupabaseClient
  userId: string
  projectId: string
  sourceUrl: string
  title?: string
  sourceType?: 'upload' | 'url'
  storagePath?: string | null
  config?: unknown
}

export interface IngestOutcome {
  video: ProjectVideo
  jobId?: string
  /** Set when core refused the URL. The row exists and is marked failed. */
  error?: string
}

export class IngestRejected extends Error {}

/**
 * Register a video against a project and hand its URL to core.
 *
 * Shared by `POST /api/videos` and the agent's `add_video` tool so the two
 * cannot drift into creating differently-shaped rows — the row is what every
 * later reconcile, re-index and scope check reads, and a tool that wrote a
 * subtly different one would fail much later and somewhere else.
 *
 * The row is created before core has seen a byte, deliberately: a video's core
 * id is the hash of its contents, so it does not exist until the download
 * finishes. Everything identifying arrives later, through the job.
 */
export async function ingestVideoFromUrl({
  supabase,
  userId,
  projectId,
  sourceUrl,
  title,
  sourceType = 'url',
  storagePath = null,
  config,
}: IngestRequest): Promise<IngestOutcome> {
  const ingestConfig = normalizeChunkConfig(config)

  const { data: project } = await supabase
    .from('projects')
    .select('id,user_id')
    .eq('id', projectId)
    .single()

  if (!project || project.user_id !== userId) {
    throw new IngestRejected('Project not found')
  }

  const { data: video, error: insertError } = await supabase
    .from('video_core')
    .insert({
      project_id: projectId,
      user_id: userId,
      title: title?.trim() || 'Untitled video',
      source_type: sourceType === 'upload' ? 'upload' : 'url',
      storage_path: storagePath,
      source_url: sourceUrl,
      status: 'pending',
      ingest_config: ingestConfig,
    })
    .select()
    .single()

  if (insertError || !video) {
    throw new IngestRejected(insertError?.message || 'Failed to create video')
  }

  try {
    const { job_id } = await core.ingestUrl(sourceUrl, ingestConfig)

    const { data: queued } = await supabase
      .from('video_core')
      .update({ status: 'queued', job_id, stage: 'fetching' })
      .eq('id', video.id)
      .select()
      .single()

    return { video: (queued ?? video) as ProjectVideo, jobId: job_id }
  } catch (error: any) {
    const message =
      error instanceof CoreApiError ? error.message : error?.message || 'Ingest failed'

    // The row stays, marked failed. A row the user can see and retry from is
    // more useful than a rejection that leaves no trace of the attempt.
    await supabase
      .from('video_core')
      .update({ status: 'failed', error: message })
      .eq('id', video.id)

    return { video: { ...video, status: 'failed', error: message } as ProjectVideo, error: message }
  }
}
