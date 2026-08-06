import { notFound } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import { getUser } from '@/app/agent/hooks/get-user'
import type { ProjectVideo } from '@/lib/core/types'
import { VideoDetailClient } from './components/video-detail-client'

type Params = Promise<{ projectId: string; videoId: string }>

export const metadata = { title: 'Video analysis' }

/**
 * One video's full analysis.
 *
 * The row is fetched here so the page has a title and a player before the
 * heavier `/details` call lands — that one pulls every chunk and every
 * aggregate, and waiting on it server-side would leave the tab blank.
 */
export default async function VideoDetailPage({ params }: { params: Params }) {
  const { projectId, videoId } = await params

  const user = await getUser()
  if (!user) notFound()

  const supabase = await createSupabaseServer()

  const [{ data: project }, { data: video }] = await Promise.all([
    supabase.from('projects').select('id,name,user_id').eq('id', projectId).single(),
    supabase
      .from('video_core')
      .select('*')
      .eq('id', videoId)
      .eq('user_id', user.id)
      .single(),
  ])

  if (!project || project.user_id !== user.id) notFound()
  if (!video || video.project_id !== projectId) notFound()

  return (
    <VideoDetailClient
      projectId={projectId}
      projectName={project.name}
      initialVideo={video as ProjectVideo}
    />
  )
}
