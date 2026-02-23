import type { ReactNode } from 'react'
import { AdminSidebar } from './AdminSidebar'
import { AdminShell } from './AdminShell'
import { SidebarProvider } from './sidebar-context'
import { AdminProviders } from './Providers'
import { Toaster } from '@/components/ui/sonner'

export default function AdminLayout({
  children,
  modal,
}: {
  children: ReactNode
  modal: ReactNode
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <AdminProviders>
        <SidebarProvider>
          <div className="relative min-h-screen">
            <AdminSidebar />
            <AdminShell>
              {children}
              {modal}
            </AdminShell>
          </div>
        </SidebarProvider>
        <Toaster position="bottom-right" />
      </AdminProviders>
    </div>
  )
}
