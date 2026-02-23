import { type NextRequest, NextResponse } from 'next/server'
import { getWorkItemStore } from '@/lib/store'
import { WorkItemStatus } from '@nitejar/core'
import { requireApiAuth, requireApiRole } from '@/lib/api-auth'

interface RouteParams {
  params: Promise<{ id: string }>
}

interface UpdateWorkItemBody {
  status?: WorkItemStatus
  payload?: unknown
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const unauthorized = await requireApiAuth(request)
  if (unauthorized) return unauthorized

  const { id } = await params
  const store = getWorkItemStore()
  const item = await store.get(id)

  if (!item) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
  }

  return NextResponse.json({ ok: true, item })
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const unauthorized = await requireApiRole(request)
  if (unauthorized) return unauthorized

  const { id } = await params

  let body: UpdateWorkItemBody
  try {
    body = (await request.json()) as UpdateWorkItemBody
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }

  const store = getWorkItemStore()
  const existing = await store.get(id)

  if (!existing) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
  }

  const updates: Partial<{ status: WorkItemStatus; payload: unknown }> = {}

  if (body.status !== undefined) {
    if (!Object.values(WorkItemStatus).includes(body.status)) {
      return NextResponse.json({ ok: false, error: 'invalid_status' }, { status: 400 })
    }
    updates.status = body.status
  }

  if (body.payload !== undefined) {
    updates.payload = body.payload
  }

  const updated = await store.update(id, updates)
  return NextResponse.json({ ok: true, item: updated })
}
