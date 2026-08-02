import { SidebarProvider } from '@/components/ui/sidebar'
import { AgentSidebar } from '@/app/agent/components/sidebar/agent-sidebar'
import { createSupabaseServer } from '@/lib/supabase/server'

export default async function ProjectLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createSupabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return (
    <SidebarProvider defaultOpen={true}>
      <AgentSidebar user={user} />
      <div className="flex-1 overflow-auto bg-background">{children}</div>
    </SidebarProvider>
  )
}
