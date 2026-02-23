import {
  claimNextEffectOutbox,
  markEffectOutboxSent,
  markEffectOutboxFailed,
  markEffectOutboxUnknown,
  getRuntimeControl,
  createWorkItem,
  findWorkItemById,
  getAgentsForPluginInstance,
  createQueueMessage,
  upsertQueueLaneOnMessage,
  getDb,
} from '@nitejar/database'
import { parseAgentConfig } from '@nitejar/agent/config'
import {
  getPluginInstanceWithConfig,
  pluginHandlerRegistry,
  type InboundActorEnvelope,
} from '@nitejar/plugin-handlers'
import { dispatchHook } from './plugins/hook-dispatch'
import {
  extractQueueConfig,
  QUEUE_AGENT_STAGGER_MS,
  resolveOriginAgentId,
} from '../../app/api/webhooks/routing'
import { publishRoutineEnvelopeFromWorkItem } from './routines/publish'

const WORKER_STATE_KEY = '__nitejarEffectOutboxWorker'
const TICK_MS = 1000
const LEASE_SECONDS = 120
const ENABLE_AGENT_PUBLIC_RELAY = true
const MAX_AGENT_PUBLIC_RELAY_DEPTH = 12

type WorkerState = {
  started: boolean
  running: boolean
  draining: boolean
  timer?: NodeJS.Timeout
  /** Swappable reference so HMR picks up new code without restarting the interval */
  processFn?: () => Promise<void>
}

function getState(): WorkerState {
  const globalState = globalThis as typeof globalThis & {
    [WORKER_STATE_KEY]?: WorkerState
  }

  const existing = globalState[WORKER_STATE_KEY]
  if (existing) {
    return existing
  }

  const created: WorkerState = {
    started: false,
    running: false,
    draining: false,
  }
  globalState[WORKER_STATE_KEY] = created
  return created
}

function retryDelaySeconds(attempt: number): number {
  return Math.min(300, Math.max(5, attempt * 10))
}

function parseJsonObject(value: string | null): Record<string, unknown> {
  if (!value) return {}
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function truncate(value: string, max = 100): string {
  const normalized = value.trim()
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, max - 3)}...`
}

async function relayAgentTelegramOutput(input: {
  pluginInstanceId: string
  sourceWorkItemId: string
  effectId: string
  content: string
  responseContext?: unknown
  actor?: InboundActorEnvelope
}): Promise<void> {
  if (!ENABLE_AGENT_PUBLIC_RELAY) return
  if (!input.content.trim()) return
  if (!input.actor || input.actor.kind !== 'agent') return

  const sourceWorkItem = await findWorkItemById(input.sourceWorkItemId)
  if (!sourceWorkItem) return
  if (!sourceWorkItem.plugin_instance_id) return
  if (!sourceWorkItem.session_key) return

  const sourcePayload = parseJsonObject(sourceWorkItem.payload)
  const relayDepthRaw = sourcePayload.relayDepth
  const relayDepthParsed =
    typeof relayDepthRaw === 'number'
      ? relayDepthRaw
      : typeof relayDepthRaw === 'string'
        ? Number(relayDepthRaw)
        : 0
  const relayDepth = Number.isFinite(relayDepthParsed) ? relayDepthParsed : 0

  if (relayDepth >= MAX_AGENT_PUBLIC_RELAY_DEPTH) {
    console.log(
      '[EffectOutboxWorker] Agent relay depth limit reached, skipping follow-up enqueue',
      {
        sourceWorkItemId: sourceWorkItem.id,
        relayDepth,
      }
    )
    return
  }

  const sourceRef = `agent_relay:${input.effectId}`
  const db = getDb()
  const existing = await db
    .selectFrom('work_items')
    .select('id')
    .where('source_ref', '=', sourceRef)
    .executeTakeFirst()
  if (existing) {
    return
  }

  const agents = await getAgentsForPluginInstance(input.pluginInstanceId)
  if (agents.length === 0) return

  const originAgentId = resolveOriginAgentId(input.actor, agents)
  const targetAgents = originAgentId ? agents.filter((agent) => agent.id !== originAgentId) : agents
  if (targetAgents.length === 0) return

  const pluginInstance = await getPluginInstanceWithConfig(input.pluginInstanceId)
  const queueConfig = extractQueueConfig(pluginInstance?.config ?? null)
  const responseContextJson =
    input.responseContext === undefined ? null : JSON.stringify(input.responseContext)
  const senderName = input.actor.displayName ?? input.actor.handle ?? 'Agent'
  const arrivedAt = Math.floor(Date.now() / 1000)
  const nextRelayDepth = relayDepth + 1

  const workItem = await createWorkItem({
    plugin_instance_id: input.pluginInstanceId,
    session_key: sourceWorkItem.session_key,
    source: sourceWorkItem.source,
    source_ref: sourceRef,
    title: truncate(input.content, 100),
    payload: JSON.stringify({
      body: input.content,
      source: sourceWorkItem.source,
      source_type: 'agent_public_relay',
      relayDepth: nextRelayDepth,
      relayFromWorkItemId: sourceWorkItem.id,
      actor: input.actor,
      senderName,
      senderUsername: input.actor.handle,
      senderId: input.actor.agentId ?? input.actor.externalId,
      responseContext: input.responseContext,
    }),
    status: 'NEW',
  })

  await publishRoutineEnvelopeFromWorkItem(workItem.id).catch((error) => {
    console.warn('[EffectOutboxWorker] Failed to publish routine envelope from relay work item', {
      workItemId: workItem.id,
      error: error instanceof Error ? error.message : String(error),
    })
  })

  for (const [index, agent] of targetAgents.entries()) {
    const agentCfg = parseAgentConfig(agent.config)
    const agentQueue = agentCfg.queue ?? {}
    const resolvedMode = agentQueue.mode ?? queueConfig.mode
    const resolvedDebounceMs = agentQueue.debounceMs ?? queueConfig.debounceMs
    const staggeredDebounceMs = resolvedDebounceMs + index * QUEUE_AGENT_STAGGER_MS
    const resolvedMaxQueued = agentQueue.maxQueued ?? queueConfig.maxQueued
    const queueKey = `${sourceWorkItem.session_key}:${agent.id}`

    await createQueueMessage({
      queue_key: queueKey,
      work_item_id: workItem.id,
      plugin_instance_id: input.pluginInstanceId,
      response_context: responseContextJson,
      text: input.content,
      sender_name: senderName,
      arrived_at: arrivedAt,
      status: 'pending',
      dispatch_id: null,
      drop_reason: null,
    })

    await upsertQueueLaneOnMessage({
      queueKey,
      sessionKey: sourceWorkItem.session_key,
      agentId: agent.id,
      pluginInstanceId: input.pluginInstanceId,
      arrivedAt,
      debounceMs: staggeredDebounceMs,
      maxQueued: resolvedMaxQueued,
      mode: resolvedMode,
    })
  }
}

async function processNextEffect(): Promise<void> {
  const control = await getRuntimeControl()
  if (control.processing_enabled !== 1) return

  const workerId = `effect-worker:${process.pid}`
  const effect = await claimNextEffectOutbox(workerId, { leaseSeconds: LEASE_SECONDS })
  if (!effect) return

  try {
    const pluginInstance = await getPluginInstanceWithConfig(effect.plugin_instance_id)
    if (!pluginInstance) {
      await markEffectOutboxFailed(effect.id, 'Plugin instance not found', {
        retryable: false,
        expectedEpoch: effect.claimed_epoch,
      })
      return
    }

    const handler = pluginHandlerRegistry.get(pluginInstance.type)
    if (!handler?.postResponse) {
      await markEffectOutboxFailed(
        effect.id,
        `No postResponse handler for ${pluginInstance.type}`,
        {
          retryable: false,
          expectedEpoch: effect.claimed_epoch,
        }
      )
      return
    }

    const payload = JSON.parse(effect.payload) as {
      content?: string
      responseContext?: unknown
      options?: { hitLimit?: boolean; idempotencyKey?: string }
      actor?: InboundActorEnvelope
    }

    if (!payload.content) {
      await markEffectOutboxFailed(effect.id, 'Missing content payload', {
        retryable: false,
        expectedEpoch: effect.claimed_epoch,
      })
      return
    }

    // Hook 8: response.pre_deliver — can transform or block delivery
    let deliveryContent = payload.content
    const hookCtx = { workItemId: effect.work_item_id, jobId: effect.job_id ?? '', agentId: '' }
    try {
      const preResult = await dispatchHook('response.pre_deliver', hookCtx, {
        content: deliveryContent,
        pluginType: pluginInstance.type,
        pluginInstanceId: effect.plugin_instance_id,
        workItemId: effect.work_item_id,
        responseMode: 'final' as const,
        hitLimit: payload.options?.hitLimit ?? false,
      })
      if (preResult.blocked) {
        await markEffectOutboxFailed(effect.id, 'Delivery blocked by plugin hook', {
          retryable: false,
          expectedEpoch: effect.claimed_epoch,
        })
        return
      }
      if (preResult.data.content && typeof preResult.data.content === 'string') {
        deliveryContent = preResult.data.content
      }
    } catch {
      // Hook failure is non-fatal
    }

    const result = await handler.postResponse(
      pluginInstance,
      effect.work_item_id,
      deliveryContent,
      payload.responseContext,
      payload.options
    )

    // Hook 9: response.post_deliver — observability only
    try {
      await dispatchHook('response.post_deliver', hookCtx, {
        content: deliveryContent,
        result,
        pluginType: pluginInstance.type,
        pluginInstanceId: effect.plugin_instance_id,
        workItemId: effect.work_item_id,
      })
    } catch {
      // Hook failure is non-fatal
    }

    const outcome = result.outcome ?? (result.success ? 'sent' : 'failed')

    if (outcome === 'sent') {
      if (pluginInstance.type === 'telegram') {
        await relayAgentTelegramOutput({
          pluginInstanceId: pluginInstance.id,
          sourceWorkItemId: effect.work_item_id,
          effectId: effect.id,
          content: payload.content,
          responseContext: payload.responseContext,
          actor: payload.actor,
        })
      }
      await markEffectOutboxSent(effect.id, result.providerRef, {
        expectedEpoch: effect.claimed_epoch,
      })
      return
    }

    if (outcome === 'unknown') {
      await markEffectOutboxUnknown(effect.id, result.error ?? 'Unknown provider delivery result', {
        expectedEpoch: effect.claimed_epoch,
      })
      return
    }

    const retryable = result.retryable === true
    const nextAttempt = retryable
      ? Math.floor(Date.now() / 1000) + retryDelaySeconds(effect.attempt_count + 1)
      : null
    await markEffectOutboxFailed(effect.id, result.error ?? 'Send failed', {
      retryable,
      nextAttemptAt: nextAttempt,
      expectedEpoch: effect.claimed_epoch,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // Unknown by default when transport-level failure leaves delivery ambiguous.
    await markEffectOutboxUnknown(effect.id, message, { expectedEpoch: effect.claimed_epoch })
  }
}

export const __effectOutboxTest = {
  processNextEffect,
  retryDelaySeconds,
}

export function ensureEffectOutboxWorker(): void {
  const state = getState()

  // Always update the process function so HMR picks up new code
  state.processFn = processNextEffect

  if (state.started) return

  state.started = true

  const tick = async () => {
    if (state.running || state.draining) return
    state.running = true
    try {
      // Call through the swappable reference so HMR code changes take effect
      await state.processFn!()
    } catch (error) {
      console.warn('[EffectOutboxWorker] Tick failed', error)
    } finally {
      state.running = false
    }
  }

  void tick()
  state.timer = setInterval(() => {
    void tick()
  }, TICK_MS)

  if (typeof state.timer.unref === 'function') {
    state.timer.unref()
  }

  console.log('[EffectOutboxWorker] Started')
}

export function stopEffectOutboxWorker(): void {
  const state = getState()
  state.draining = true
  if (state.timer) {
    clearInterval(state.timer)
    state.timer = undefined
  }
}

export function isEffectOutboxWorkerBusy(): boolean {
  return getState().running
}
