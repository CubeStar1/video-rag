import { Suspense } from 'react'
import { createSupabaseServer } from '@/lib/supabase/server'
import { getUser } from '@/app/agent/hooks/get-user'
import { notFound } from 'next/navigation'
import { AgentView } from '@/app/agent/components/agent-view'

type Params = Promise<{ projectId: string; conversationId: string }>

async function ProjectConversationPage({ params }: { params: Params }) {
  const { projectId, conversationId } = await params
  const supabase = await createSupabaseServer()
  const user = await getUser()

  const { data: conversation } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', conversationId)
    .eq('project_id', projectId)
    .single()

  if (!conversation || conversation.user_id !== user?.id) {
    notFound()
  }

  const { data: dbMessages } = await supabase
    .from('messages')
    .select('id, role, parts, created_at, metadata')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })

  const initialMessages =
    dbMessages?.map((message) => ({
      id: message.id,
      role: message.role as 'user' | 'assistant',
      parts: message.parts || [],
      createdAt: new Date(message.created_at),
      metadata: message.metadata || {},
    })) || []

  return (
    <AgentView
      key={conversationId}
      id={conversationId}
      projectId={projectId}
      initialMessages={initialMessages}
    />
  )
}

export default function Page(props: { params: Params }) {
  return (
    <Suspense fallback={<div className="flex h-dvh" />}>
      <ProjectConversationPage params={props.params} />
    </Suspense>
  )
}
