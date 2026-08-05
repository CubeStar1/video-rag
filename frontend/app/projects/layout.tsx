import { createSupabaseServer } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function ProjectsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createSupabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return redirect('/signin')
  }

  return <>{children}</>
}
