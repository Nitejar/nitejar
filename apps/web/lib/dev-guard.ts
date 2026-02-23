import { NextResponse } from 'next/server'

/**
 * Guards dev-only routes from being accessed in production.
 * Returns a 404 response if in production, null otherwise.
 */
export function devGuard(): NextResponse | null {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return null
}
