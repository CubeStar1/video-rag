import type { SupabaseClient } from '@supabase/supabase-js'
import { core, statusFromJob } from './client'
import { IN_FLIGHT, type ProjectVideo } from './types'

/**
 * Bring a row up to date with the core job it is waiting on.
 *
 * Core returns 202 and analyses on a background thread, so ingest progress
 * arrives by polling rather than by callback. This is the one place that knows
 * how to turn a job into a row, used by both the list and the single-video
 * routes so they cannot drift.
 */
export async function reconcileVideo(
  supabase: SupabaseClient,
  video: ProjectVideo
): Promise<ProjectVideo> {
  if (!IN_FLIGHT.includes(video.status)) return video
  if (!video.job_id) return video

  let job
  try {
    job = await core.job(video.job_id)
  } catch (error: any) {
    // Core's jobs live in memory, so a restart mid-ingest 404s the poll. If the
    // video landed anyway its record survives on disk and proves it; if not,
    // the row is stuck waiting on a job that no longer exists and has to be
    // failed so the re-index button becomes the way out.
    if (error?.status !== 404) return video
    return recoverLostJob(supabase, video)
  }

  const { status, stage } = statusFromJob(job)
  const patch: Record<string, unknown> = { status, stage, progress: job.detail ?? null }

  if (job.status === 'failed') {
    patch.error = job.error ?? 'Analysis failed'
  }

  if (job.status === 'done' && job.result) {
    const result = job.result as Record<string, any>

    if (result.video_url) {
      // An ingest job: everything identifying about the video arrives here,
      // because the id is the hash of bytes core had not yet seen when the row
      // was created.
      Object.assign(patch, {
        core_video_id: result.video_id,
        playback_url: result.video_url,
        poster_url: result.poster_url ?? null,
        duration: result.duration ?? video.duration,
        size_bytes: result.size_bytes ?? video.size_bytes,
        chunk_config: result.chunk_config,
        chunk_count: result.chunks ?? 0,
        analyzers: result.analyzers ?? [],
        aggregates: result.aggregated?.aggregates ?? [],
        error: null,
      })
    } else if (Array.isArray(result.aggregates)) {
      // An aggregate re-run, which shares the job table with ingest but touches
      // only the video-level results. Writing the ingest fields here would blank
      // the playback URL with `undefined`.
      Object.assign(patch, { aggregates: result.aggregates, job_id: null, error: null })
    }
  }

  const { data } = await supabase
    .from('video_core')
    .update(patch)
    .eq('id', video.id)
    .select()
    .single()

  return (data as ProjectVideo) ?? { ...video, ...(patch as Partial<ProjectVideo>) }
}

/**
 * A job core no longer remembers. If the video is nonetheless present in core,
 * the ingest finished before the restart and the row can be completed from the
 * video itself; otherwise it is genuinely lost.
 */
async function recoverLostJob(
  supabase: SupabaseClient,
  video: ProjectVideo
): Promise<ProjectVideo> {
  if (video.core_video_id) {
    try {
      const found = await core.video(video.core_video_id)
      const patch = {
        status: 'ready',
        stage: 'complete',
        job_id: null,
        playback_url: found.video_url,
        poster_url: found.poster_url ?? null,
        duration: found.duration ?? video.duration,
        chunk_config: found.chunk_config,
        chunk_count: found.chunks,
        analyzers: found.analyzers ?? [],
        aggregates: found.aggregates ?? [],
        error: null,
      }
      const { data } = await supabase
        .from('video_core')
        .update(patch)
        .eq('id', video.id)
        .select()
        .single()
      return (data as ProjectVideo) ?? { ...video, ...(patch as Partial<ProjectVideo>) }
    } catch {
      // Fall through — not in core either.
    }
  }

  const patch = {
    status: 'failed',
    error: 'The analysis backend restarted before this video finished. Re-index to try again.',
    job_id: null,
  }
  const { data } = await supabase
    .from('video_core')
    .update(patch)
    .eq('id', video.id)
    .select()
    .single()
  return (data as ProjectVideo) ?? { ...video, ...(patch as Partial<ProjectVideo>) }
}

/** Reconcile a whole listing, leaving settled rows untouched. */
export async function reconcileAll(
  supabase: SupabaseClient,
  videos: ProjectVideo[]
): Promise<ProjectVideo[]> {
  const pending = videos.filter((video) => IN_FLIGHT.includes(video.status) && video.job_id)
  if (pending.length === 0) return videos

  const settled = new Map<string, ProjectVideo>()
  await Promise.all(
    pending.map(async (video) => {
      try {
        settled.set(video.id, await reconcileVideo(supabase, video))
      } catch {
        // Backend down — keep the stored row and try again on the next poll.
      }
    })
  )

  return videos.map((video) => settled.get(video.id) ?? video)
}
