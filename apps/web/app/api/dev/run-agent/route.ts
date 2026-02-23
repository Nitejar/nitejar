import { type NextRequest, NextResponse } from 'next/server'
import { runAgent } from '@nitejar/agent/runner'
import { listAgents, listWorkItems, findWorkItemById, updateWorkItem } from '@nitejar/database'
import { pluginHandlerRegistry, getPluginInstanceWithConfig } from '@nitejar/plugin-handlers'
import { devGuard } from '@/lib/dev-guard'

/**
 * POST /api/dev/run-agent
 *
 * Runs the agent on a work item.
 *
 * Query params:
 * - workItemId: The work item to process (optional, uses first NEW item if not specified)
 * - agentId: The agent to use (optional, uses first agent if not specified)
 */
export async function POST(request: NextRequest) {
  const guard = devGuard()
  if (guard) return guard

  const url = new URL(request.url)
  let workItemId = url.searchParams.get('workItemId')
  let agentId = url.searchParams.get('agentId')

  // Get default agent if not specified
  if (!agentId) {
    const agents = await listAgents()
    const preferredAgent = agents.find((agent) => agent.status === 'idle') ?? agents[0]
    if (!preferredAgent) {
      return NextResponse.json({ ok: false, error: 'No agents available' }, { status: 400 })
    }
    agentId = preferredAgent.id
  }

  // Get first NEW work item if not specified
  if (!workItemId) {
    const workItems = await listWorkItems()
    const newItem = workItems.find((item) => item.status === 'NEW')
    if (!newItem) {
      return NextResponse.json({ ok: false, error: 'No NEW work items available' }, { status: 400 })
    }
    workItemId = newItem.id
  }

  console.log(`[run-agent] Running agent ${agentId} on work item ${workItemId}`)

  // Get the work item to access its plugin instance and response context.
  const workItem = await findWorkItemById(workItemId)
  if (!workItem) {
    return NextResponse.json({ ok: false, error: 'Work item not found' }, { status: 404 })
  }

  try {
    const events: unknown[] = []
    const result = await runAgent(agentId, workItemId, {
      onEvent: (event) => {
        events.push(event)
        console.log('[Agent Event]', event)
      },
    })

    // Update work item status
    await updateWorkItem(workItemId, { status: 'DONE' })

    // Send response back via plugin instance if we have one.
    let responseResult = null
    if (workItem.plugin_instance_id && result.finalResponse) {
      const pluginInstance = await getPluginInstanceWithConfig(workItem.plugin_instance_id)
      if (pluginInstance) {
        const handler = pluginHandlerRegistry.get(pluginInstance.type)
        if (handler?.postResponse) {
          // Get response context from work item payload
          let payload: Record<string, unknown> | null = null
          if (typeof workItem.payload === 'string') {
            try {
              payload = JSON.parse(workItem.payload) as Record<string, unknown>
            } catch {
              // ignore parse errors
            }
          } else {
            payload = workItem.payload as Record<string, unknown> | null
          }
          const responseContext = payload?.responseContext

          console.log(`[run-agent] Sending response via ${pluginInstance.type}`, {
            responseContext,
          })

          responseResult = await handler.postResponse(
            pluginInstance,
            workItemId,
            result.finalResponse,
            responseContext
          )

          console.log(`[run-agent] Response result:`, responseResult)
        }
      }
    }

    return NextResponse.json({
      ok: true,
      jobId: result.job.id,
      finalResponse: result.finalResponse,
      eventCount: events.length,
      responseResult,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // Update work item status to failed
    await updateWorkItem(workItemId, { status: 'FAILED' })
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
