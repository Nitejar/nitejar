import { NextResponse, type NextRequest } from 'next/server'
import { getSessionFromHeaders } from '@/lib/auth-server'

export const ADMIN_ROLES = ['superadmin', 'admin'] as const
export type AdminRole = (typeof ADMIN_ROLES)[number]

export function hasRequiredRole(role: string | null | undefined, allowedRoles: readonly string[]) {
  if (!role) return false
  return allowedRoles.includes(role)
}

export async function requireApiAuth(request: Request | NextRequest): Promise<NextResponse | null> {
  const session = await getSessionFromHeaders(request.headers)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}

export async function requireApiRole(
  request: Request | NextRequest,
  allowedRoles: readonly string[] = ADMIN_ROLES
): Promise<NextResponse | null> {
  const session = await getSessionFromHeaders(request.headers)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const roleValue =
    session.user && typeof session.user === 'object' && 'role' in session.user
      ? (session.user as { role?: unknown }).role
      : null
  const role = typeof roleValue === 'string' ? roleValue : null
  if (!hasRequiredRole(role, allowedRoles)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return null
}
