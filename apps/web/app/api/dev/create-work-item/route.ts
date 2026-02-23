import { type NextRequest, NextResponse } from 'next/server'
import { createWorkItem, listPluginInstances } from '@nitejar/database'
import { devGuard } from '@/lib/dev-guard'
import { publishRoutineEnvelopeFromWorkItem } from '@/server/services/routines/publish'

/**
 * POST /api/dev/create-work-item
 *
 * Creates a test work item for development/testing purposes.
 *
 * Query params:
 * - title: Optional title for the work item
 * - source: Source platform (default: 'dev')
 */
export async function POST(request: NextRequest) {
  const guard = devGuard()
  if (guard) return guard

  const url = new URL(request.url)
  const title = url.searchParams.get('title') || 'Test work item'
  const source = url.searchParams.get('source') || 'dev'

  // Try to get the first plugin instance to associate with.
  const pluginInstances = await listPluginInstances()
  const pluginInstance = pluginInstances[0]

  const workItem = await createWorkItem({
    plugin_instance_id: pluginInstance?.id || null,
    session_key: `dev-${Date.now()}`,
    source,
    source_ref: `dev-ref-${Date.now()}`,
    status: 'NEW',
    title,
    payload: JSON.stringify({
      type: 'dev_test',
      message: 'This is a test work item created via /api/dev/create-work-item',
      created_at: new Date().toISOString(),
    }),
  })

  await publishRoutineEnvelopeFromWorkItem(workItem.id).catch((error) => {
    console.warn('[dev/create-work-item] Failed to publish routine envelope', {
      workItemId: workItem.id,
      error: error instanceof Error ? error.message : String(error),
    })
  })

  return NextResponse.json({
    ok: true,
    workItem: {
      id: workItem.id,
      title: workItem.title,
      status: workItem.status,
      source: workItem.source,
    },
  })
}
