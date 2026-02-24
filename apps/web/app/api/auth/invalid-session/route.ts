import { NextResponse, type NextRequest } from 'next/server'

const INVALID_SESSION_ERROR = 'Your session is invalid. Please sign in again.'

function isAuthCookie(name: string): boolean {
  return name.includes('session_token') || name.includes('session_data') || name.includes('better-auth')
}

export function GET(request: NextRequest): NextResponse {
  const loginUrl = new URL('/login', request.url)
  loginUrl.searchParams.set('error', INVALID_SESSION_ERROR)

  const response = NextResponse.redirect(loginUrl)
  const authCookieNames = request.cookies
    .getAll()
    .map((cookie) => cookie.name)
    .filter((name) => isAuthCookie(name))

  for (const name of authCookieNames) {
    response.cookies.set({
      name,
      value: '',
      expires: new Date(0),
      path: '/',
    })
  }

  return response
}
