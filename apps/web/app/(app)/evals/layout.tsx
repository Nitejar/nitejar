import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { requireServerSession } from '@/lib/auth-server'
import { ADMIN_ROLES, hasRequiredRole } from '@/lib/api-auth'

export default async function EvalsLayout({ children }: { children: ReactNode }) {
  const session = await requireServerSession()
  const roleValue =
    session.user && typeof session.user === 'object' && 'role' in session.user
      ? session.user.role
      : null
  const role = typeof roleValue === 'string' ? roleValue : null

  if (!hasRequiredRole(role, ADMIN_ROLES)) {
    redirect('/')
  }

  return children
}
