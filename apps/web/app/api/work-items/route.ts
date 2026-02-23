import { type NextRequest, NextResponse } from 'next/server'
import { getWorkItemStore } from '@/lib/store'
import { requireApiAuth, requireApiRole } from '@/lib/api-auth'

interface CreateWorkItemBody {
  title: string
  payload?: unknown
}

export async function GET(request: NextRequest) {
  const unauthorized = await requireApiAuth(request)
  if (unauthorized) return unauthorized

  const store = getWorkItemStore()
  const defaultLimit = 100
  const maxLimit = 1000
  const limitParam = request.nextUrl.searchParams.get('limit')
  const cursor = request.nextUrl.searchParams.get('cursor') ?? undefined
  const parsedLimit = limitParam ? Number(limitParam) : defaultLimit
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(parsedLimit, 1), maxLimit)
    : defaultLimit

  const items = await store.list({ limit, cursor })
  const lastItem = items[items.length - 1]
  const nextCursor = lastItem && items.length === limit ? lastItem.id : null
  return NextResponse.json({ ok: true, items, limit, nextCursor })
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireApiRole(request)
  if (unauthorized) return unauthorized

  let body: CreateWorkItemBody
  try {
    body = (await request.json()) as CreateWorkItemBody
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }

  if (!body.title || typeof body.title !== 'string') {
    return NextResponse.json({ ok: false, error: 'title_required' }, { status: 400 })
  }

  const store = getWorkItemStore()
  const id = crypto.randomUUID()

  const workItem = await store.create({
    sessionKey: `manual:${id}`,
    source: 'manual',
    sourceRef: `manual:${id}`,
    title: body.title,
    payload: body.payload ?? null,
  })

  return NextResponse.json({ ok: true, workItem }, { status: 201 })
}
