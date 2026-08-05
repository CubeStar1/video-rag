import { createSupabaseServer } from '@/lib/supabase/server'
import type { ProjectVideo } from '@/lib/core/types'

export interface VideoToolContext {
  projectId?: string
  userId: string
}

/**
 * Core has no users, no projects and no row-level security: whoever can reach
 * it can read every video in it. Scoping is therefore entirely this layer's
 * job, and this is the choke point that does it — every tool resolves the ids
 * it is allowed to touch through here, and passes them to core explicitly.
 *
 * A model that hallucinates a video id, or repeats one it saw in another
 * conversation, gets it filtered out here rather than answered from someone
 * else's footage.
 */
export async function resolveScope(
  context: VideoToolContext,
  requested?: string[]
): Promise<{ ids: string[]; videos: ProjectVideo[]; note?: string }> {
  if (!context.projectId) {
    return { ids: [], videos: [], note: 'This conversation is not attached to a project.' }
  }

  const supabase = await createSupabaseServer()
  const { data, error } = await supabase
    .from('video_core')
    .select('*')
    .eq('project_id', context.projectId)
    .eq('user_id', context.userId)
    .order('created_at', { ascending: false })

  if (error) return { ids: [], videos: [], note: error.message }

  const videos = (data ?? []) as ProjectVideo[]
  const ready = videos.filter((video) => video.status === 'ready' && video.core_video_id)

  if (!requested?.length) {
    return {
      ids: ready.map((video) => video.core_video_id!),
      videos,
      ...(ready.length === 0
        ? { note: 'No videos in this project have finished analysing yet.' }
        : {}),
    }
  }

  const allowed = new Set(ready.map((video) => video.core_video_id!))
  const ids = requested.filter((id) => allowed.has(id))
  const rejected = requested.filter((id) => !allowed.has(id))

  return {
    ids,
    videos,
    ...(rejected.length
      ? {
          note: `Ignored ${rejected.length} id(s) that are not searchable in this project: ${rejected.join(', ')}. Call list_project_videos for the real ids.`,
        }
      : {}),
  }
}

/** Title lookup for citations, keyed by core's id. */
export function titleMap(videos: ProjectVideo[]): Map<string, string> {
  return new Map(
    videos.filter((v) => v.core_video_id).map((v) => [v.core_video_id!, v.title])
  )
}

/** The playable mp4 per core id — what a clip's range is a range *of*. */
export function urlMap(videos: ProjectVideo[]): Map<string, string> {
  return new Map(
    videos
      .filter((v) => v.core_video_id && v.playback_url)
      .map((v) => [v.core_video_id!, v.playback_url!])
  )
}
