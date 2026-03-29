import { pluginHandlerRegistry } from '@nitejar/plugin-handlers/registry'
import {
  getPluginInstanceWithConfig,
  type WebhookHooks,
  type WebhookRouterResult,
} from '@nitejar/plugin-handlers/router'
import { runAgent } from '@nitejar/agent/runner'
import { parseAgentConfig } from '@nitejar/agent/config'
import type { TeamContext } from '@nitejar/agent/prompt-builder'
import type { Agent } from '@nitejar/database'
import {
  getAgentsForPluginInstance,
  updateWorkItem,
  findWorkItemById,
  createJob,
  startJob,
  completeJob,
  appendMessage,
  createQueueMessage,
  upsertQueueLaneOnMessage,
  getRuntimeControl,
} from '@nitejar/database'
import { closeSpriteSessionForConversation } from '@nitejar/sprites'
import { dispatchHook, createRunnerHookDispatch } from './hook-dispatch'
import { publishRoutineEnvelopeFromWorkItem } from '../routines/publish'
import {
  extractQueueConfig,
  filterOriginAgent,
  QUEUE_AGENT_STAGGER_MS,
  resolveOriginAgentId,
} from '../../../app/api/webhooks/routing'

/** Commands that trigger a session reset */
const RESET_COMMANDS = ['clear']
/** Small gap between sequential agent responses (ms) */
const INTER_AGENT_GAP_MS = 1500
/** Maximum time to wait for an agent before dispatching the next one anyway (ms) */
const AGENT_TIMEOUT_MS = 45_000

export function createWebhookHooks(): WebhookHooks {
  return {
    preCreate: async (data) => {
      const hookResult = await dispatchHook(
        'work_item.pre_create',
        { workItemId: '', jobId: '', agentId: '' },
        data
      )
      return { blocked: hookResult.blocked, data: hookResult.data }
    },
    postCreate: async (data) => {
      await dispatchHook(
        'work_item.post_create',
        { workItemId: data.workItemId, jobId: '', agentId: '' },
        data
      )
    },
  }
}

/**
 * Fisher-Yates shuffle (in-place, returns same array).
 */
function shuffleArray<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const temp = arr[i]!
    arr[i] = arr[j]!
    arr[j] = temp
  }
  return arr
}

/**
 * Handle bot commands (e.g., /reset, /new)
 * Returns true if the command was handled, false if it should be passed to the agent
 */
async function handleCommand(
  command: string,
  workItemId: string,
  pluginInstanceId: string,
  responseContext: unknown
): Promise<boolean> {
  if (!RESET_COMMANDS.includes(command)) {
    return false
  }

  console.log(`[webhook] Handling command: /${command}`)

  try {
    const workItem = await findWorkItemById(workItemId)
    if (!workItem) {
      console.error('[webhook] Work item not found for command')
      return true
    }

    const agents = await getAgentsForPluginInstance(pluginInstanceId)
    const resetConfirmation = 'Session reset. Starting fresh!'

    for (const agent of agents) {
      try {
        await closeSpriteSessionForConversation(workItem.session_key, agent.id)
        console.log(`[webhook] Closed sprite session for ${workItem.session_key} agent=${agent.id}`)
      } catch (err) {
        console.warn(`[webhook] Failed to close sprite session for agent ${agent.id}:`, err)
      }
    }

    const firstAgent = agents[0]
    if (firstAgent) {
      const commandJob = await createJob({
        work_item_id: workItemId,
        agent_id: firstAgent.id,
        status: 'PENDING',
      })
      await startJob(commandJob.id)
      await appendMessage(commandJob.id, 'user', { text: `/${command}` })
      await appendMessage(commandJob.id, 'assistant', { text: resetConfirmation })
      await completeJob(commandJob.id)
    }

    await updateWorkItem(workItemId, { status: 'DONE' })

    const pluginInstance = await getPluginInstanceWithConfig(pluginInstanceId)
    if (pluginInstance) {
      const handler = pluginHandlerRegistry.get(pluginInstance.type)
      if (handler?.postResponse) {
        await handler.postResponse(
          pluginInstance,
          workItemId,
          `🔄 ${resetConfirmation}`,
          responseContext
        )
      }
    }

    return true
  } catch (error) {
    console.error('[webhook] Error handling command:', error)
    return true
  }
}

/**
 * Process a work item with a specific agent and send the response.
 * When `coalescedText` is provided, it overrides the user message text.
 */
async function processWorkItemForAgent(
  agent: Agent,
  workItemId: string,
  pluginInstanceId: string,
  responseContext: unknown,
  options?: {
    coalescedText?: string
    agentCount?: number
    teamContext?: TeamContext
  }
) {
  const normalizeAssistantResponse = (value: string | null | undefined): string | null => {
    if (typeof value !== 'string') return null
    const normalized = value.trim()
    return normalized.length > 0 ? normalized : null
  }

  const formatFailureMessage = (errorText: string): string => {
    if (errorText.includes('No endpoints found matching your data policy')) {
      return [
        'I couldn\u2019t run this model because OpenRouter rejected it under your current privacy/data policy.',
        '',
        `Error: ${errorText}`,
        '',
        'Fix: update OpenRouter privacy settings for free model publication, then retry.',
      ].join('\n')
    }

    return [
      'I hit an error while processing your request and stopped.',
      '',
      `Error: ${errorText}`,
      '',
      'Please retry. If this keeps happening, try a different model or check plugin instance settings.',
    ].join('\n')
  }

  const notifyFailure = async (errorText: string): Promise<void> => {
    const pluginInstance = await getPluginInstanceWithConfig(pluginInstanceId)
    if (!pluginInstance) {
      return
    }

    const handler = pluginHandlerRegistry.get(pluginInstance.type)
    if (!handler?.postResponse) {
      return
    }

    const message = formatFailureMessage(errorText)
    const responseResult = await handler.postResponse(
      pluginInstance,
      workItemId,
      message,
      responseContext
    )
    console.log('[webhook] Failure response sent:', responseResult)
  }

  const shouldPrefix = (options?.agentCount ?? 1) > 1
  const prefixContent = (content: string): string => {
    if (!shouldPrefix) return content
    let emoji = ''
    try {
      const parsed = agent.config ? (JSON.parse(agent.config) as { emoji?: string }) : null
      emoji = parsed?.emoji ?? ''
    } catch {
      /* ignore */
    }
    const label = `${emoji} ${agent.name}`.trim()
    return `[${label}] ${content}`
  }

  try {
    console.log(`[webhook] Processing work item ${workItemId} with agent ${agent.id}`)

    const pluginInstance = await getPluginInstanceWithConfig(pluginInstanceId)
    const handler = pluginInstance ? pluginHandlerRegistry.get(pluginInstance.type) : null
    let lastDeliveredAssistantMessage: string | null = null
    let progressDeliveryQueue = Promise.resolve()

    const sendAssistantUpdate = async (
      rawContent: string | null | undefined,
      opts?: { hitLimit?: boolean; phase?: 'progress' | 'final' }
    ): Promise<void> => {
      const content = normalizeAssistantResponse(rawContent)
      if (!content) return
      let prefixed = prefixContent(content)
      if (opts?.phase === 'final' && prefixed === lastDeliveredAssistantMessage) return
      if (!pluginInstance || !handler?.postResponse) return

      const hookCtx = { workItemId, jobId: '', agentId: agent.id }
      try {
        const preResult = await dispatchHook('response.pre_deliver', hookCtx, {
          content: prefixed,
          pluginType: pluginInstance.type,
          pluginInstanceId,
          workItemId,
          responseMode: 'streaming' as const,
          hitLimit: opts?.hitLimit ?? false,
        })
        if (preResult.blocked) {
          console.log('[webhook] Response delivery blocked by plugin hook')
          return
        }
        if (preResult.data.content && typeof preResult.data.content === 'string') {
          prefixed = preResult.data.content
        }
      } catch {
        // Hook failure is non-fatal
      }

      const responseResult = await handler.postResponse(
        pluginInstance,
        workItemId,
        prefixed,
        responseContext,
        opts
      )
      if (!responseResult.success) {
        console.warn('[webhook] Assistant update send failed:', responseResult.error)
        return
      }
      lastDeliveredAssistantMessage = prefixed
      console.log('[webhook] Assistant update sent:', responseResult)

      try {
        await dispatchHook('response.post_deliver', hookCtx, {
          content: prefixed,
          result: responseResult,
          pluginType: pluginInstance.type,
          pluginInstanceId,
          workItemId,
        })
      } catch {
        // Hook failure is non-fatal
      }
    }

    const responseMode = handler?.responseMode ?? 'streaming'
    const runOptions: Parameters<typeof runAgent>[2] = {
      coalescedText: options?.coalescedText,
      teamContext: options?.teamContext,
      responseMode,
      hookDispatch: createRunnerHookDispatch(),
      onEvent:
        responseMode === 'streaming'
          ? (event) => {
              if (event.type === 'message' && event.role === 'assistant') {
                progressDeliveryQueue = progressDeliveryQueue
                  .then(() => sendAssistantUpdate(event.content, { phase: 'progress' }))
                  .catch((sendError) => {
                    console.warn('[webhook] Failed to send assistant progress update:', sendError)
                  })
              }
            }
          : undefined,
    }

    const result = await runAgent(agent.id, workItemId, runOptions)

    await progressDeliveryQueue
    await updateWorkItem(workItemId, { status: 'DONE' })
    await sendAssistantUpdate(result.finalResponse, {
      hitLimit: result.hitLimit,
      phase: 'final',
    })

    return result
  } catch (error) {
    console.error(`[webhook] Error processing work item with agent ${agent.id}:`, error)
    await updateWorkItem(workItemId, { status: 'FAILED' })
    const errorText = error instanceof Error ? error.message : String(error)
    try {
      await notifyFailure(errorText)
    } catch (notifyError) {
      console.warn('[webhook] Failed to send failure response:', notifyError)
    }
  }
}

function buildTeamContext(currentAgent: Agent, allAgents: Agent[]): TeamContext | undefined {
  const teammates = allAgents
    .filter((a) => a.id !== currentAgent.id)
    .map((a) => {
      let role: string | null = null
      if (a.config) {
        try {
          const cfg = JSON.parse(a.config) as Record<string, unknown>
          if (typeof cfg.title === 'string') role = cfg.title
        } catch {
          // ignore
        }
      }
      return { handle: a.handle, name: a.name, role, status: a.status }
    })

  if (teammates.length === 0) return undefined
  return { teammates }
}

async function dispatchToAgents(
  agents: Agent[],
  workItemId: string,
  pluginInstanceId: string,
  responseContext: unknown,
  options?: { coalescedText?: string; originAgentId?: string | null }
): Promise<void> {
  const runtime = await getRuntimeControl()
  if (runtime.processing_enabled !== 1) {
    console.log('[webhook] Runtime processing is paused; skipping immediate dispatch')
    return
  }

  if (agents.length === 0) {
    console.error('[webhook] No agents available to process work item')
    await updateWorkItem(workItemId, { status: 'FAILED' })
    return
  }

  const targetAgents = filterOriginAgent(agents, options?.originAgentId ?? null)
  if (targetAgents.length === 0) {
    console.log('[webhook] No dispatch targets after origin-agent exclusion; marking DONE')
    await updateWorkItem(workItemId, { status: 'DONE' })
    return
  }

  const shuffled = shuffleArray([...targetAgents])
  const agentCount = shuffled.length
  let previousDone: Promise<void> = Promise.resolve()

  for (const [i, agent] of shuffled.entries()) {
    const teamContext = buildTeamContext(agent, targetAgents)
    const dispatchOpts = {
      coalescedText: options?.coalescedText,
      agentCount,
      teamContext,
    }

    if (i === 0) {
      const done = processWorkItemForAgent(
        agent,
        workItemId,
        pluginInstanceId,
        responseContext,
        dispatchOpts
      ).catch((err) => console.error(`[webhook] Agent ${agent.id} dispatch error:`, err))
      previousDone = done.then(() => undefined)
    } else {
      const prev = previousDone
      const done = (async () => {
        await Promise.race([
          prev,
          new Promise<void>((resolve) => setTimeout(resolve, AGENT_TIMEOUT_MS)),
        ])
        await new Promise<void>((resolve) => setTimeout(resolve, INTER_AGENT_GAP_MS))
        console.log(`[webhook] Agent ${agent.id} dispatching (previous finished or timed out)`)
        await processWorkItemForAgent(
          agent,
          workItemId,
          pluginInstanceId,
          responseContext,
          dispatchOpts
        )
      })().catch((err) => console.error(`[webhook] Agent ${agent.id} dispatch error:`, err))
      previousDone = done.then(() => undefined)
    }
  }
}

export async function handleCreatedWebhookWorkItem(result: WebhookRouterResult): Promise<void> {
  if (!result.workItemId || !result.pluginInstanceId) {
    return
  }

  await publishRoutineEnvelopeFromWorkItem(result.workItemId).catch((error) => {
    console.warn('[webhook] Failed to publish routine envelope from webhook work item', {
      workItemId: result.workItemId,
      error: error instanceof Error ? error.message : String(error),
    })
  })

  if (result.command) {
    handleCommand(
      result.command,
      result.workItemId,
      result.pluginInstanceId,
      result.responseContext
    )
      .then(async (handled) => {
        if (!handled) {
          const agents = await getAgentsForPluginInstance(result.pluginInstanceId!)
          const originAgentId = resolveOriginAgentId(result.actor, agents)
          return dispatchToAgents(
            agents,
            result.workItemId!,
            result.pluginInstanceId!,
            result.responseContext,
            { originAgentId }
          )
        }
      })
      .catch((err) => console.error('[webhook] Command handling error:', err))
    return
  }

  if (result.sessionKey) {
    const pluginInstanceData = await getPluginInstanceWithConfig(result.pluginInstanceId)
    const queueConfig = extractQueueConfig(pluginInstanceData?.config ?? null)
    const agents = await getAgentsForPluginInstance(result.pluginInstanceId)
    const originAgentId = resolveOriginAgentId(result.actor, agents)
    const targetAgents = filterOriginAgent(agents, originAgentId)

    if (agents.length === 0) {
      console.error('[webhook] No agents assigned to plugin instance', result.pluginInstanceId)
      await updateWorkItem(result.workItemId, { status: 'FAILED' })
      return
    }

    if (targetAgents.length === 0) {
      console.log('[webhook] Queue enqueue skipped: origin-agent exclusion removed all targets')
      await updateWorkItem(result.workItemId, { status: 'DONE' })
      return
    }

    if (pluginInstanceData) {
      const handler = pluginHandlerRegistry.get(pluginInstanceData.type)
      if (handler?.acknowledgeReceipt) {
        handler
          .acknowledgeReceipt(pluginInstanceData, result.responseContext)
          .catch((err) => console.warn('[webhook] Failed to acknowledge receipt:', err))
      }
    }

    const shuffled = shuffleArray([...targetAgents])
    const arrivedAt = Math.floor(Date.now() / 1000)
    for (const [index, agent] of shuffled.entries()) {
      const agentCfg = parseAgentConfig(agent.config)
      const agentQueue = agentCfg.queue ?? {}
      const resolvedMode = agentQueue.mode ?? queueConfig.mode
      const resolvedDebounceMs = agentQueue.debounceMs ?? queueConfig.debounceMs
      const staggeredDebounceMs = resolvedDebounceMs + index * QUEUE_AGENT_STAGGER_MS
      const resolvedMaxQueued = agentQueue.maxQueued ?? queueConfig.maxQueued

      const queueKey = `${result.sessionKey}:${agent.id}`
      await createQueueMessage({
        queue_key: queueKey,
        work_item_id: result.workItemId,
        plugin_instance_id: result.pluginInstanceId,
        response_context: result.responseContext ? JSON.stringify(result.responseContext) : null,
        text: result.messageText ?? '',
        sender_name: result.senderName ?? 'Unknown',
        arrived_at: arrivedAt,
        status: 'pending',
        dispatch_id: null,
        drop_reason: null,
      })

      await upsertQueueLaneOnMessage({
        queueKey,
        sessionKey: result.sessionKey,
        agentId: agent.id,
        pluginInstanceId: result.pluginInstanceId,
        arrivedAt,
        debounceMs: staggeredDebounceMs,
        maxQueued: resolvedMaxQueued,
        mode: resolvedMode,
      })
    }
    return
  }

  const pluginInstanceData = await getPluginInstanceWithConfig(result.pluginInstanceId)
  if (pluginInstanceData) {
    const handler = pluginHandlerRegistry.get(pluginInstanceData.type)
    if (handler?.acknowledgeReceipt) {
      handler
        .acknowledgeReceipt(pluginInstanceData, result.responseContext)
        .catch((err) => console.warn('[webhook] Failed to acknowledge receipt:', err))
    }
  }

  const agents = await getAgentsForPluginInstance(result.pluginInstanceId)
  const originAgentId = resolveOriginAgentId(result.actor, agents)
  dispatchToAgents(agents, result.workItemId, result.pluginInstanceId, result.responseContext, {
    originAgentId,
  }).catch((err) => console.error('[webhook] Background processing error:', err))
}
