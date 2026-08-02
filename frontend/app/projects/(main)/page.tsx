import { createSupabaseServer } from '@/lib/supabase/server'
import { getUser } from '@/app/agent/hooks/get-user'
import { ProjectsPageClient } from './projects-page-client'

export const dynamic = 'force-dynamic'

export default async function ProjectsPage() {
  const user = await getUser()
  const supabase = await createSupabaseServer()

  const { data: projects } = await supabase
    .from('projects')
    .select('*')
    .eq('user_id', user!.id)
    .order('updated_at', { ascending: false })

  const { data: conversations } = await supabase
    .from('conversations')
    .select('id, project_id')
    .eq('user_id', user!.id)
    .not('project_id', 'is', null)
    .order('updated_at', { ascending: false })

  return (
    <ProjectsPageClient
      projects={(projects ?? []) as any}
      conversations={(conversations ?? []) as any}
    />
  )
}
