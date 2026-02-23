import { toNextJsHandler } from 'better-auth/next-js'
import { getAuth } from '@/lib/auth'

function getHandlers() {
  return toNextJsHandler(getAuth())
}

export function GET(request: Request): Promise<Response> {
  return getHandlers().GET(request)
}

export function POST(request: Request): Promise<Response> {
  return getHandlers().POST(request)
}

export function PUT(request: Request): Promise<Response> {
  return getHandlers().PUT(request)
}

export function PATCH(request: Request): Promise<Response> {
  return getHandlers().PATCH(request)
}

export function DELETE(request: Request): Promise<Response> {
  return getHandlers().DELETE(request)
}
