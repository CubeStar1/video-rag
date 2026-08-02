import { tool } from 'ai'
import { z } from 'zod'
import { createSupabaseServer } from '@/lib/supabase/server'
import { formatDuration } from '@/lib/videodb/format'
import type { VideoToolContext } from './index'

export function createListProjectVideosTool(context: VideoToolContext) {
  return tool({
    description:
      'List every video in the current project with its VideoDB id, duration and index status. Use this to resolve a video the user named in words into the id the other tools need.',
    inputSchema: z.object({}),
    execute: async () => {
      if (!context.projectId) {
        return { videos: [], note: 'This conversation is not attached to a project.' }
      }

      const supabase = await createSupabaseServer()
      const { data, error } = await supabase
        .from('videos')
        .select('id,title,duration,status,videodb_video_id,error')
        .eq('project_id', context.projectId)
        .eq('user_id', context.userId)
        .order('created_at', { ascending: false })

      if (error) return { videos: [], error: error.message }

      return {
        videos: (data ?? []).map((video) => ({
          videodb_video_id: video.videodb_video_id,
          title: video.title,
          duration: formatDuration(video.duration),
          status: video.status,
          searchable: video.status === 'ready',
          ...(video.error ? { error: video.error } : {}),
        })),
      }
    },
  })
}
