import {
  findPluginInstanceById,
  createWorkItem,
  findIdempotencyKeyByAnyKey,
  createIdempotencyKeysIgnoreConflicts,
  createPluginEvent,
  decryptConfig,
  type PluginInstanceRecord,
} from '@nitejar/database'
import { pluginHandlerRegistry } from './registry'
import type { InboundActorEnvelope, WebhookParseResult } from './types'

export interface WebhookRouterResult {
  status: number
  body: unknown
  /** If a work item was created, its ID */
  workItemId?: string
  /** If a work item was created, the plugin instance ID */
  pluginInstanceId?: string
  /** Response context for replying */
  responseContext?: unknown
  /** If this is a bot command (e.g., /reset), the command name without slash */
  command?: string
  /** Session key for queue routing (e.g. "telegram:12345") */
  sessionKey?: string
  /** Sender display name extracted from the webhook */
  senderName?: string
  /** User message text */
  messageText?: string
  /** Canonical actor envelope extracted from payload */
  actor?: InboundActorEnvelope
}

function extractActorEnvelope(payload: Record<string, unknown>): InboundActorEnvelope | undefined {
  const candidate =
    payload.actor && typeof payload.actor === 'object'
      ? (payload.actor as Record<string, unknown>)
      : null

  if (candidate) {
    const kindRaw = candidate.kind
    const kind =
      kindRaw === 'human' || kindRaw === 'agent' || kindRaw === 'bot' || kindRaw === 'system'
        ? kindRaw
        : 'human'

    return {
      kind,
      externalId: typeof candidate.externalId === 'string' ? candidate.externalId : undefined,
      agentId: typeof candidate.agentId === 'string' ? candidate.agentId : undefined,
      handle: typeof candidate.handle === 'string' ? candidate.handle : undefined,
      displayName: typeof candidate.displayName === 'string' ? candidate.displayName : undefined,
      source: typeof candidate.source === 'string' ? candidate.source : undefined,
    }
  }

  const senderName = typeof payload.senderName === 'string' ? payload.senderName : undefined
  const senderUsername =
    typeof payload.senderUsername === 'string' ? payload.senderUsername : undefined
  const senderId =
    typeof payload.senderId === 'string' || typeof payload.senderId === 'number'
      ? String(payload.senderId)
      : undefined
  const source = typeof payload.source === 'string' ? payload.source.toLowerCase() : undefined

  if (!senderName && !senderUsername && !senderId) {
    return undefined
  }

  return {
    kind: 'human',
    externalId: senderId,
    handle: senderUsername,
    displayName: senderName ?? senderUsername,
    source,
  }
}

/**
 * Optional hook callbacks injected by the app layer.
 * This avoids a circular dependency between plugin-handlers and plugin-runtime.
 */
export interface WebhookHooks {
  /** Called before createWorkItem. Return { blocked: true } to suppress creation. */
  preCreate?: (data: {
    workItem: Record<string, unknown>
    pluginType: string
    pluginInstanceId: string
  }) => Promise<{ blocked: boolean; data: Record<string, unknown> }>
  /** Called after createWorkItem (fire-and-forget). */
  postCreate?: (data: {
    workItemId: string
    pluginType: string
    pluginInstanceId: string
  }) => Promise<void>
}

function normalizeIdempotencyKeys(parseResult: WebhookParseResult): string[] {
  const keys = [
    ...(Array.isArray(parseResult.idempotencyKeys) ? parseResult.idempotencyKeys : []),
    parseResult.idempotencyKey,
  ]
  return [...new Set(keys.map((key) => key?.trim() ?? '').filter((key) => key.length > 0))]
}

async function recordWebhookIngressEvent(params: {
  pluginId: string
  pluginVersion?: string | null
  status: 'accepted' | 'duplicate' | 'skipped' | 'rejected'
  workItemId?: string | null
  detail: Record<string, unknown>
}): Promise<void> {
  try {
    await createPluginEvent({
      plugin_id: params.pluginId,
      plugin_version: params.pluginVersion ?? null,
      kind: 'webhook_ingress',
      status: params.status,
      work_item_id: params.workItemId ?? null,
      detail_json: JSON.stringify(params.detail),
    })
  } catch {
    // Non-fatal observability path.
  }
}

export async function routeWebhook(
  pluginType: string,
  pluginInstanceId: string,
  request: Request,
  hooks?: WebhookHooks
): Promise<WebhookRouterResult> {
  // Get the plugin instance
  const pluginInstance = await findPluginInstanceById(pluginInstanceId)

  if (!pluginInstance) {
    return { status: 404, body: { error: 'Plugin instance not found' } }
  }

  if (pluginInstance.type !== pluginType) {
    await recordWebhookIngressEvent({
      pluginId: pluginInstance.plugin_id,
      status: 'rejected',
      detail: {
        pluginType,
        pluginInstanceId,
        reasonCode: 'plugin_type_mismatch',
        reasonText: `Plugin type mismatch: expected ${pluginInstance.type}, got ${pluginType}`,
      },
    })
    return { status: 400, body: { error: 'Plugin type mismatch' } }
  }

  // Get the handler
  const handler = pluginHandlerRegistry.get(pluginType)
  if (!handler) {
    await recordWebhookIngressEvent({
      pluginId: pluginInstance.plugin_id,
      status: 'rejected',
      detail: {
        pluginType,
        pluginInstanceId,
        reasonCode: 'unknown_plugin_type',
        reasonText: `Unknown plugin type: ${pluginType}`,
      },
    })
    return { status: 400, body: { error: `Unknown plugin type: ${pluginType}` } }
  }

  // Parse and decrypt sensitive config fields
  const parsedConfig = pluginInstance.config
    ? (JSON.parse(pluginInstance.config) as Record<string, unknown>)
    : null
  const decryptedConfig = parsedConfig ? decryptConfig(parsedConfig, handler.sensitiveFields) : null
  const decryptedPluginInstance: PluginInstanceRecord = {
    ...pluginInstance,
    config: decryptedConfig ? JSON.stringify(decryptedConfig) : null,
  }

  // Parse the webhook
  let parseResult: WebhookParseResult
  try {
    parseResult = await handler.parseWebhook(request, decryptedPluginInstance)
  } catch (error) {
    console.error(`[${pluginType}] Webhook parse error:`, error)
    await recordWebhookIngressEvent({
      pluginId: pluginInstance.plugin_id,
      status: 'rejected',
      detail: {
        pluginType,
        pluginInstanceId,
        reasonCode: 'parse_error',
        reasonText: error instanceof Error ? error.message : String(error),
      },
    })
    return { status: 500, body: { error: 'Failed to parse webhook' } }
  }

  const immediateResponse = parseResult.webhookResponse
  const idempotencyKeys = normalizeIdempotencyKeys(parseResult)
  const ingressDetailBase: Record<string, unknown> = {
    pluginType,
    pluginInstanceId,
    ...(parseResult.ingressEventId ? { providerEventId: parseResult.ingressEventId } : {}),
    ...(parseResult.workItem?.session_key ? { sessionKey: parseResult.workItem.session_key } : {}),
    ...(parseResult.workItem?.source_ref ? { sourceRef: parseResult.workItem.source_ref } : {}),
    ...(idempotencyKeys[0] ? { canonicalDedupeKey: idempotencyKeys[0] } : {}),
    ...(idempotencyKeys.length > 0 ? { idempotencyKeys } : {}),
    ...(parseResult.ingressMeta ? { meta: parseResult.ingressMeta } : {}),
  }

  if (!parseResult.shouldProcess) {
    await recordWebhookIngressEvent({
      pluginId: pluginInstance.plugin_id,
      status: 'skipped',
      detail: {
        ...ingressDetailBase,
        reasonCode: parseResult.ingressReasonCode ?? 'should_process_false',
        reasonText: parseResult.ingressReasonText ?? 'Parser marked payload as non-actionable.',
      },
    })
    if (immediateResponse) {
      return {
        status: immediateResponse.status ?? 200,
        body: immediateResponse.body,
      }
    }
    return { status: 200, body: { ignored: true } }
  }

  if (!pluginInstance.enabled) {
    await recordWebhookIngressEvent({
      pluginId: pluginInstance.plugin_id,
      status: 'rejected',
      detail: {
        ...ingressDetailBase,
        reasonCode: 'plugin_instance_disabled',
        reasonText: 'Plugin instance disabled',
      },
    })
    return { status: 200, body: { ignored: true, reason: 'Plugin instance disabled' } }
  }

  if (!parseResult.workItem) {
    await recordWebhookIngressEvent({
      pluginId: pluginInstance.plugin_id,
      status: 'skipped',
      detail: {
        ...ingressDetailBase,
        reasonCode: parseResult.ingressReasonCode ?? 'no_work_item',
        reasonText: parseResult.ingressReasonText ?? 'No work item to create',
      },
    })
    if (immediateResponse) {
      return {
        status: immediateResponse.status ?? 200,
        body: immediateResponse.body,
      }
    }
    return { status: 200, body: { ignored: true, reason: 'No work item to create' } }
  }

  // Check idempotency
  if (idempotencyKeys.length > 0) {
    const existing = await findIdempotencyKeyByAnyKey(idempotencyKeys)

    if (existing) {
      await recordWebhookIngressEvent({
        pluginId: pluginInstance.plugin_id,
        status: 'duplicate',
        workItemId: existing.work_item_id,
        detail: {
          ...ingressDetailBase,
          matchedKey: existing.key,
          existingWorkItemId: existing.work_item_id,
        },
      })
      return {
        status: immediateResponse?.status ?? 200,
        body: immediateResponse?.body ?? { duplicate: true, workItemId: existing.work_item_id },
      }
    }
  }

  // Create work item, including responseContext in payload
  let workItemPayload = parseResult.workItem.payload
    ? (JSON.parse(parseResult.workItem.payload) as Record<string, unknown>)
    : {}
  const normalizedSource =
    typeof parseResult.workItem.source === 'string'
      ? parseResult.workItem.source.toLowerCase()
      : parseResult.workItem.source

  // Add responseContext to payload so we can reply later
  if (parseResult.responseContext) {
    workItemPayload.responseContext = parseResult.responseContext
  }

  // Hook 1: work_item.pre_create — can block or transform payload
  let workItemData: Record<string, unknown> = {
    ...parseResult.workItem,
    source: normalizedSource,
    payload: workItemPayload,
    plugin_instance_id: pluginInstance.id,
  }
  if (hooks?.preCreate) {
    try {
      const hookResult = await hooks.preCreate({
        workItem: workItemData,
        pluginType,
        pluginInstanceId,
      })
      if (hookResult.blocked) {
        await recordWebhookIngressEvent({
          pluginId: pluginInstance.plugin_id,
          status: 'skipped',
          detail: {
            ...ingressDetailBase,
            reasonCode: 'blocked_by_plugin_hook',
            reasonText: 'Blocked by plugin hook',
          },
        })
        return { status: 200, body: { ignored: true, reason: 'Blocked by plugin hook' } }
      }
      // Apply any mutations from the hook
      workItemData = { ...workItemData, ...hookResult.data }
      // If the hook mutated the payload, update our local reference
      if (hookResult.data.payload && typeof hookResult.data.payload === 'object') {
        workItemPayload = hookResult.data.payload as Record<string, unknown>
      }
    } catch {
      // Hook failure is non-fatal
    }
  }

  const workItem = await createWorkItem({
    ...parseResult.workItem,
    source: normalizedSource,
    payload: JSON.stringify(workItemPayload),
    plugin_instance_id: pluginInstance.id,
  })

  // Record idempotency keys
  if (idempotencyKeys.length > 0) {
    await createIdempotencyKeysIgnoreConflicts(idempotencyKeys, workItem.id)
  }

  await recordWebhookIngressEvent({
    pluginId: pluginInstance.plugin_id,
    status: 'accepted',
    workItemId: workItem.id,
    detail: ingressDetailBase,
  })

  // Hook 2: work_item.post_create — observability only (fire-and-forget)
  if (hooks?.postCreate) {
    hooks
      .postCreate({
        workItemId: workItem.id,
        pluginType,
        pluginInstanceId,
      })
      .catch(() => {
        // Non-fatal
      })
  }

  // Extract sender name and message text from work item payload for queue
  const senderNameRaw =
    typeof workItemPayload.senderName === 'string' ? workItemPayload.senderName : null
  const senderUsername =
    typeof workItemPayload.senderUsername === 'string' ? workItemPayload.senderUsername : null
  const senderName =
    senderNameRaw && senderUsername
      ? `${senderNameRaw} (@${senderUsername})`
      : (senderNameRaw ?? (senderUsername ? `@${senderUsername}` : 'Unknown'))
  const messageText = (workItemPayload.body as string) ?? ''
  const actor = extractActorEnvelope(workItemPayload)

  return {
    status: immediateResponse?.status ?? 201,
    body: immediateResponse?.body ?? { created: true, workItemId: workItem.id },
    workItemId: workItem.id,
    pluginInstanceId: pluginInstance.id,
    responseContext: parseResult.responseContext,
    command: parseResult.command,
    sessionKey: parseResult.workItem.session_key,
    senderName,
    messageText,
    actor,
  }
}

/**
 * Get plugin instance by ID with decrypted config
 */
export async function getPluginInstanceWithConfig(
  pluginInstanceId: string
): Promise<PluginInstanceRecord | null> {
  const pluginInstance = await findPluginInstanceById(pluginInstanceId)

  if (!pluginInstance) {
    return null
  }

  const handler = pluginHandlerRegistry.get(pluginInstance.type)
  if (!handler || !pluginInstance.config) {
    return pluginInstance
  }

  const parsedConfig = JSON.parse(pluginInstance.config) as Record<string, unknown>
  const decryptedConfig = decryptConfig(parsedConfig, handler.sensitiveFields)

  return {
    ...pluginInstance,
    config: JSON.stringify(decryptedConfig),
  }
}

/** @deprecated Use `getPluginInstanceWithConfig`. */
export const getIntegrationWithConfig = getPluginInstanceWithConfig
