import { Metadata } from 'next'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/global/app-sidebar'
import { Breadcrumbs } from '@/components/navigation/breadcrumbs'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <Breadcrumbs />
        <main className="flex-1 container mx-auto py-10 px-4 md:px-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  )
}
