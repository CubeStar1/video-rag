import { createSupabaseServer } from '@/lib/supabase/server'
import { getUser } from '@/app/agent/hooks/get-user'

export async function POST(request: Request) {
  const user = await getUser()
  if (!user) {
    return new Response('Unauthorized', { status: 401 })
  }

  const { name, description } = await request.json()
  if (!name?.trim()) {
    return new Response('name is required', { status: 400 })
  }

  try {
    const supabase = await createSupabaseServer()

    const { data: project, error: projectError } = await supabase
      .from('projects')
      .insert({
        user_id: user.id,
        name: name.trim(),
        description: description?.trim() || null,
      })
      .select()
      .single()

    if (projectError || !project) {
      throw projectError ?? new Error('Failed to create project')
    }

    const { data: conversation, error: conversationError } = await supabase
      .from('conversations')
      .insert({
        user_id: user.id,
        project_id: project.id,
        title: 'New conversation',
      })
      .select()
      .single()

    if (conversationError || !conversation) {
      throw conversationError ?? new Error('Failed to create conversation')
    }

    return Response.json({
      projectId: project.id,
      conversationId: conversation.id,
    })
  } catch (error: any) {
    return new Response(error.message || 'Failed to create project', { status: 500 })
  }
}
