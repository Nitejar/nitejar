import { NextResponse } from 'next/server'
import { routeWebhook, type WebhookHooks } from '@nitejar/plugin-handlers/router'
import { ensurePluginHandlerLoaded } from '../../../../../../server/services/plugins/ensure-builtin-handlers'

interface RouteParams {
  params: Promise<{
    type: string
    instanceId: string
  }>
}

function isDiscordDeferredAckBody(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false
  return (body as { type?: unknown }).type === 5
}

export async function POST(request: Request, context: RouteParams) {
  const { type, instanceId } = await context.params

  await ensurePluginHandlerLoaded(type)

  const { createWebhookHooks, handleCreatedWebhookWorkItem } =
    await import('../../../../../../server/services/plugins/process-webhook-work-item')
  const webhookHooks: WebhookHooks = createWebhookHooks()

  const result = await routeWebhook(type, instanceId, request, webhookHooks)

  if (result.workItemId) {
    const processCreatedWorkItem = () => handleCreatedWebhookWorkItem(result)

    const shouldDetachForFastAck = type === 'discord' && isDiscordDeferredAckBody(result.body)
    if (shouldDetachForFastAck) {
      // Discord interactions must be ACKed quickly (<3s), so continue in the background.
      void processCreatedWorkItem().catch((error) => {
        console.error('[webhook] Post-route background processing error:', error)
      })
    } else {
      await processCreatedWorkItem()
    }
  }

  return NextResponse.json(result.body, { status: result.status })
}

// Some plugin types (like Telegram) may send GET for webhook verification
export async function GET(request: Request, context: RouteParams) {
  const { type, instanceId } = await context.params

  // For now, just acknowledge GET requests
  return NextResponse.json({
    type,
    instanceId,
    status: 'ok',
  })
}
