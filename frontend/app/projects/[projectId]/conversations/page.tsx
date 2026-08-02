import { Suspense } from 'react'
import { createSupabaseServer } from '@/lib/supabase/server'
import { getUser } from '@/app/agent/hooks/get-user'
import { notFound } from 'next/navigation'
import { AgentView } from '@/app/agent/components/agent-view'
import { generateUUID } from '@/app/agent/lib/utils/generate-uuid'

type Params = Promise<{ projectId: string }>

async function NewProjectConversationPage({ params }: { params: Params }) {
  const { projectId } = await params
  const supabase = await createSupabaseServer()
  const user = await getUser()

  const { data: project } = await supabase
    .from('projects')
    .select('id,user_id')
    .eq('id', projectId)
    .single()

  if (!project || project.user_id !== user?.id) {
    notFound()
  }

  const conversationId = generateUUID()

  return <AgentView id={conversationId} projectId={projectId} initialMessages={[]} />
}

export default function Page(props: { params: Params }) {
  return (
    <Suspense fallback={<div className="flex h-dvh" />}>
      <NewProjectConversationPage params={props.params} />
    </Suspense>
  )
}
