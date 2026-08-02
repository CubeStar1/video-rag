import { createSupabaseServer } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { getUser } from '@/app/agent/hooks/get-user'
import { WorkspaceClient } from './components/workspace-client'

type Params = Promise<{ projectId: string }>

async function ProjectWorkspacePage({ params }: { params: Params }) {
  const { projectId } = await params
  const user = await getUser()
  const supabase = await createSupabaseServer()

  const { data: project } = await supabase
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single()

  if (!project || project.user_id !== user?.id) {
    notFound()
  }

  const { data: videos } = await supabase
    .from('videos')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })

  return <WorkspaceClient project={project} initialVideos={videos ?? []} />
}

export default function Page(props: { params: Params }) {
  return <ProjectWorkspacePage params={props.params} />
}
