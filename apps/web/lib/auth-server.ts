import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getAuth, type AuthSession } from './auth'

export async function getSessionFromHeaders(input: HeadersInit): Promise<AuthSession> {
  return getAuth().api.getSession({ headers: new Headers(input) })
}

export async function getServerSession(): Promise<AuthSession> {
  const requestHeaders = await headers()
  return getSessionFromHeaders(requestHeaders)
}

export async function requireServerSession(): Promise<NonNullable<AuthSession>> {
  const session = await getServerSession()
  if (!session) {
    redirect('/login')
  }
  return session
}
