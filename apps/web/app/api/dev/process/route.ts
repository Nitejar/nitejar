import { type NextRequest, NextResponse } from 'next/server'
import { getWorkItemStore } from '@/lib/store'
import { WorkItemStatus } from '@nitejar/core'
import { devGuard } from '@/lib/dev-guard'

interface ProcessResult {
  id: string
  previousStatus: WorkItemStatus
  newStatus: WorkItemStatus
  failed?: boolean
}

export async function POST(request: NextRequest) {
  const guard = devGuard()
  if (guard) return guard

  const url = new URL(request.url)
  const targetId = url.searchParams.get('id')
  const delay = parseInt(url.searchParams.get('delay') ?? '0', 10)
  const failRate = parseFloat(url.searchParams.get('failRate') ?? '0')

  const store = getWorkItemStore()
  const results: ProcessResult[] = []

  if (targetId) {
    // Process single item
    const item = await store.get(targetId)
    if (!item) {
      return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
    }

    const result = await processItem(store, item.id, item.status, delay, failRate)
    if (result) {
      results.push(result)
    }
  } else {
    // Process all NEW items
    const items = await store.list()
    const newItems = items.filter((item) => item.status === WorkItemStatus.NEW)

    for (const item of newItems) {
      const result = await processItem(store, item.id, item.status, delay, failRate)
      if (result) {
        results.push(result)
      }
    }
  }

  return NextResponse.json({ ok: true, processed: results.length, results })
}

async function processItem(
  store: ReturnType<typeof getWorkItemStore>,
  id: string,
  currentStatus: WorkItemStatus,
  delay: number,
  failRate: number
): Promise<ProcessResult | null> {
  if (delay > 0) {
    await new Promise((resolve) => setTimeout(resolve, delay))
  }

  let newStatus: WorkItemStatus
  const shouldFail = failRate > 0 && Math.random() < failRate

  switch (currentStatus) {
    case WorkItemStatus.NEW:
      newStatus = WorkItemStatus.RUNNING
      break
    case WorkItemStatus.RUNNING:
      newStatus = shouldFail ? WorkItemStatus.FAILED : WorkItemStatus.DONE
      break
    default:
      // Item is in a terminal state, skip
      return null
  }

  await store.update(id, { status: newStatus })

  return {
    id,
    previousStatus: currentStatus,
    newStatus,
    ...(shouldFail && { failed: true }),
  }
}
