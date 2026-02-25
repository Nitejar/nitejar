import { NextResponse, type NextRequest } from 'next/server'

function hasSessionCookie(request: NextRequest): boolean {
  return request.cookies.getAll().some((cookie) => cookie.name.includes('session_token'))
}

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl

  // Public API routes — no session needed
  if (pathname.startsWith('/api/webhooks/')) {
    return NextResponse.next()
  }

  // MCP transport is bearer-token/OAuth based, not cookie-session based.
  if (pathname.startsWith('/api/mcp')) {
    return NextResponse.next()
  }

  if (pathname.startsWith('/api/auth/')) {
    return NextResponse.next()
  }

  if (!hasSessionCookie(request)) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const loginUrl = new URL('/login', request.url)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|login|signup|invite|setup|api/webhooks|api/mcp|api/auth|.*\\..*).*)',
    '/api/:path*',
  ],
}
