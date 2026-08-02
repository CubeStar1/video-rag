import { createSupabaseServer } from '@/lib/supabase/server'
import { getUser } from '@/app/agent/hooks/get-user'
import type { ProjectHistoryItem } from '@/app/agent/types'

export async function GET() {
  const user = await getUser()
  if (!user) {
    return new Response('Unauthorized', { status: 401 })
  }

  const supabase = await createSupabaseServer()

  const [{ data: projects, error: projectError }, { data: conversations, error: conversationError }] =
    await Promise.all([
      supabase.from('projects').select('*').eq('user_id', user.id).order('updated_at', { ascending: false }),
      supabase.from('conversations').select('*').eq('user_id', user.id).not('project_id', 'is', null).order('updated_at', { ascending: false }),
    ])

  if (projectError || conversationError) {
    return new Response(projectError?.message || conversationError?.message || 'Failed to load history', {
      status: 500,
    })
  }

  const items: ProjectHistoryItem[] = (projects ?? []).map((project) => ({
    project,
    conversations: (conversations ?? []).filter((conversation) => conversation.project_id === project.id),
  }))

  return Response.json(items)
}
