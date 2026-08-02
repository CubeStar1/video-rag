import { createSupabaseServer } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import { getUser } from '@/app/agent/hooks/get-user'

type Params = Promise<{ projectId: string }>

async function ProjectRedirectPage({ params }: { params: Params }) {
  const { projectId } = await params
  const user = await getUser()
  const supabase = await createSupabaseServer()

  const { data: project } = await supabase
    .from('projects')
    .select('id,user_id')
    .eq('id', projectId)
    .single()

  if (!project || project.user_id !== user?.id) {
    notFound()
  }

  const { data: conversation } = await supabase
    .from('conversations')
    .select('id')
    .eq('project_id', projectId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .single()

  if (!conversation) {
    return redirect('/projects?create=1')
  }

  return redirect(`/projects/${projectId}/conversations/${conversation.id}`)
}

export default function Page(props: { params: Params }) {
  return <ProjectRedirectPage params={props.params} />
}
