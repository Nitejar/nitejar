import type { ReactNode } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { AdminSidebar } from './AdminSidebar'
import { AdminShell } from './AdminShell'
import { SidebarProvider } from './sidebar-context'
import { AdminProviders } from './Providers'
import { Toaster } from '@/components/ui/sonner'
import { getServerSession } from '@/lib/auth-server'
import { ADMIN_ROLES, hasRequiredRole } from '@/lib/api-auth'

function hasSessionCookie(name: string): boolean {
  return name.includes('session_token')
}

export default async function AdminLayout({
  children,
  modal,
}: {
  children: ReactNode
  modal: ReactNode
}) {
  const session = await getServerSession()
  if (!session) {
    const cookieStore = await cookies()
    const hasStaleSessionCookie = cookieStore
      .getAll()
      .some((cookie) => hasSessionCookie(cookie.name))
    if (hasStaleSessionCookie) {
      redirect('/api/auth/invalid-session')
    }
    redirect('/login')
  }

  const userName =
    session.user && typeof session.user === 'object' && 'name' in session.user
      ? session.user.name
      : null
  const userEmail =
    session.user && typeof session.user === 'object' && 'email' in session.user
      ? session.user.email
      : null
  const userRole =
    session.user && typeof session.user === 'object' && 'role' in session.user
      ? session.user.role
      : null
  const canAccessEvals = hasRequiredRole(
    typeof userRole === 'string' ? userRole : null,
    ADMIN_ROLES
  )

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <AdminProviders>
        <SidebarProvider>
          <div className="relative min-h-0 flex-1">
            <AdminSidebar
              user={{
                name:
                  typeof userName === 'string' && userName.trim().length > 0 ? userName : 'Account',
                email: typeof userEmail === 'string' ? userEmail : '',
              }}
              canAccessEvals={canAccessEvals}
            />
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
