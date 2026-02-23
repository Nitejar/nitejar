import { NextResponse } from 'next/server'
import {
  routeWebhook,
  pluginHandlerRegistry,
  getPluginInstanceWithConfig,
  type WebhookHooks,
} from '@nitejar/plugin-handlers'
import { runAgent } from '@nitejar/agent/runner'
import { extractMentions } from '@nitejar/agent/mention-parser'
import { parseAgentConfig } from '@nitejar/agent/config'
import type { TeamContext } from '@nitejar/agent/prompt-builder'
import type { Agent } from '@nitejar/database'
import {
  dispatchHook,
  createRunnerHookDispatch,
} from '../../../../../../server/services/plugins/hook-dispatch'
import {
  getAgentsForPluginInstance,
  findAgentByHandle,
  updateWorkItem,
  findWorkItemById,
  createWorkItem,
  createJob,
  startJob,
  completeJob,
  appendMessage,
  createQueueMessage,
  upsertQueueLaneOnMessage,
  getRuntimeControl,
} from '@nitejar/database'
import { closeSpriteSessionForConversation } from '@nitejar/sprites'
import { ensureRuntimeWorkers } from '../../../../../../server/services/runtime-workers'
import { publishRoutineEnvelopeFromWorkItem } from '../../../../../../server/services/routines/publish'
import {
  extractQueueConfig,
  filterOriginAgent,
  QUEUE_AGENT_STAGGER_MS,
  resolveOriginAgentId,
} from '../../../routing'

interface RouteParams {
  params: Promise<{
    type: string
    instanceId: string
  }>
}

/** Commands that trigger a session reset */
const RESET_COMMANDS = ['clear']
/** Intentionally disabled while we harden actor envelope + origin-exclusion routing. */
const ENABLE_AGENT_MENTION_HANDOFFS = false

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
    return false // Unknown command, let agent handle it
  }

  console.log(`[webhook] Handling command: /${command}`)

  try {
    // Get work item to find session key
    const workItem = await findWorkItemById(workItemId)
    if (!workItem) {
      console.error('[webhook] Work item not found for command')
      return true
    }

    // Close sprite sessions for all agents on this plugin instance
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

    // Persist a completed reset turn for the first agent (or skip if none)
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

    // Mark work item as done
    await updateWorkItem(workItemId, { status: 'DONE' })

    // Send confirmation
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
    return true // Still consider it handled to avoid double-processing
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
    /** When >1, prefix responses with [AgentName] */
    agentCount?: number
    /** Structured team context for multi-agent awareness */
    teamContext?: TeamContext
    /** Chain depth for @mention dispatch (0 = human message, increments per @mention) */
    chainDepth?: number
    /** All agents on this plugin instance (needed for @mention parsing) */
    allAgents?: Agent[]
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

  // Prefix with [emoji AgentName] when multiple agents share the plugin instance
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

    // Resolve plugin instance once so we can emit progress updates during the run.
    const pluginInstance = await getPluginInstanceWithConfig(pluginInstanceId)
    const handler = pluginInstance ? pluginHandlerRegistry.get(pluginInstance.type) : null
    let lastDeliveredAssistantMessage: string | null = null
    let progressDeliveryQueue = Promise.resolve()

    const sendAssistantUpdate = async (
      rawContent: string | null | undefined,
      opts?: { hitLimit?: boolean }
    ): Promise<void> => {
      const content = normalizeAssistantResponse(rawContent)
      if (!content) return
      let prefixed = prefixContent(content)
      if (prefixed === lastDeliveredAssistantMessage) return
      if (!pluginInstance || !handler?.postResponse) return

      // Hook 8: response.pre_deliver — can transform or block delivery
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

      // Hook 9: response.post_deliver — observability only
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

    // Build run options
    // Plugin handlers declare their responseMode: 'streaming' sends intermediate updates
    // as the agent works (chat-like), 'final' waits for the complete response (issues, email, etc.)
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
                  .then(() => sendAssistantUpdate(event.content))
                  .catch((sendError) => {
                    console.warn('[webhook] Failed to send assistant progress update:', sendError)
                  })
              }
            }
          : undefined,
    }

    // Run the agent and forward assistant updates as they arrive.
    const result = await runAgent(agent.id, workItemId, runOptions)

    // Ensure in-flight progress sends are flushed before final response handling.
    await progressDeliveryQueue

    // Update work item status (first agent to complete wins; subsequent are no-ops on a DONE item)
    await updateWorkItem(workItemId, { status: 'DONE' })

    // Send final response if it wasn't already delivered as a progress update.
    await sendAssistantUpdate(result.finalResponse, { hitLimit: result.hitLimit })

    // @Mention dispatch: if the agent mentioned other agents, trigger them.
    // Skip agents already dispatched for this work item — they'll see the @mention
    // in session context when they run via normal sequential dispatch.
    const chainDepth = options?.chainDepth ?? 0
    const MAX_CHAIN_DEPTH = 3
    if (
      ENABLE_AGENT_MENTION_HANDOFFS &&
      result.finalResponse &&
      chainDepth < MAX_CHAIN_DEPTH &&
      options?.allAgents
    ) {
      const alreadyDispatchedIds = new Set(options.allAgents.map((a) => a.id))
      const knownHandles = options.allAgents.filter((a) => a.id !== agent.id).map((a) => a.handle)
      const mentionedHandles = extractMentions(result.finalResponse, knownHandles)

      for (const handle of mentionedHandles) {
        try {
          const mentionedAgent = await findAgentByHandle(handle)
          if (!mentionedAgent) continue

          const transferIntent = detectOwnershipTransferIntent(result.finalResponse, handle)
          if (!transferIntent.explicit) {
            console.log(
              `[webhook] @mention skip (no explicit transfer intent): ${agent.handle}→@${handle}`
            )
            continue
          }

          // Skip if this agent is already dispatched for this work item
          if (alreadyDispatchedIds.has(mentionedAgent.id)) {
            console.log(`[webhook] @mention skip (already dispatched): ${agent.handle}→@${handle}`)
            continue
          }

          // Create a synthetic work item for the mentioned agent
          const originalWorkItem = await findWorkItemById(workItemId)
          if (!originalWorkItem) continue

          const syntheticWorkItem = await createWorkItem({
            plugin_instance_id: originalWorkItem.plugin_instance_id,
            session_key: originalWorkItem.session_key,
            source: originalWorkItem.source,
            source_ref: `inter_agent:${agent.handle}→@${handle}`,
            title: `@${agent.handle} mentioned you`,
            payload: JSON.stringify({
              source_type: 'inter_agent',
              triggered_by: agent.handle,
              actor: {
                kind: 'agent',
                agentId: agent.id,
                handle: agent.handle,
                displayName: agent.name,
                source: originalWorkItem.source,
              },
              chain_depth: chainDepth + 1,
              transfer_intent: {
                explicit: transferIntent.explicit,
                reason: transferIntent.reason,
              },
              body: result.finalResponse,
              responseContext,
            }),
          })

          await publishRoutineEnvelopeFromWorkItem(syntheticWorkItem.id).catch((error) => {
            console.warn(
              '[webhook] Failed to publish routine envelope for synthetic mention item',
              {
                workItemId: syntheticWorkItem.id,
                error: error instanceof Error ? error.message : String(error),
              }
            )
          })

          console.log(
            `[webhook] @mention dispatch: ${agent.handle}→@${handle} (depth=${chainDepth + 1})`
          )

          // Dispatch to the mentioned agent directly (no stagger, they were explicitly called)
          const mentionTeamContext = buildTeamContext(mentionedAgent, options.allAgents)
          processWorkItemForAgent(
            mentionedAgent,
            syntheticWorkItem.id,
            pluginInstanceId,
            responseContext,
            {
              agentCount: options?.agentCount,
              teamContext: mentionTeamContext,
              chainDepth: chainDepth + 1,
              allAgents: options.allAgents,
            }
          ).catch((err) => console.error(`[webhook] @mention dispatch error for @${handle}:`, err))
        } catch (err) {
          console.warn(`[webhook] Failed to dispatch @mention to @${handle}:`, err)
        }
      }
    }

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

/**
 * Build a TeamContext for a given agent, using the other agents as teammates.
 */
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

function detectOwnershipTransferIntent(
  text: string,
  handle: string
): { explicit: boolean; reason: string } {
  const escapedHandle = handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const mentionRegex = new RegExp(`@${escapedHandle}\\b`, 'i')
  if (!mentionRegex.test(text)) {
    return { explicit: false, reason: 'No explicit mention present.' }
  }

  const lowered = text.toLowerCase()
  const handleLower = handle.toLowerCase()
  const strongSignals = [
    `@${handleLower} can you`,
    `@${handleLower} please`,
    `@${handleLower} could you`,
    `@${handleLower} your turn`,
    `@${handleLower} take over`,
    `handoff to @${handleLower}`,
    `assigning @${handleLower}`,
  ]

  if (strongSignals.some((signal) => lowered.includes(signal))) {
    return { explicit: true, reason: 'Explicit transfer/request phrasing detected.' }
  }

  const questionNearMention = new RegExp(`@${escapedHandle}[^\\n\\r]{0,120}\\?`, 'i')
  if (questionNearMention.test(text)) {
    return { explicit: true, reason: 'Question directed at mentioned agent.' }
  }

  return { explicit: false, reason: 'Mention appears conversational/referential.' }
}

/** Small gap between sequential agent responses (ms) */
const INTER_AGENT_GAP_MS = 1500
/** Maximum time to wait for an agent before dispatching the next one anyway (ms) */
const AGENT_TIMEOUT_MS = 45_000

/**
 * Dispatch a work item to all agents assigned to the plugin instance.
 * Agents run sequentially: the next agent fires as soon as the previous one
 * finishes (plus a small gap), or after a timeout — whichever comes first.
 */
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

  // Shuffle agents randomly for fair dispatch ordering
  const shuffled = shuffleArray([...targetAgents])
  const agentCount = shuffled.length

  // Chain agents: each waits for the previous to finish (or timeout)
  let previousDone: Promise<void> = Promise.resolve()

  for (const [i, agent] of shuffled.entries()) {
    const teamContext = buildTeamContext(agent, targetAgents)
    const dispatchOpts = {
      coalescedText: options?.coalescedText,
      agentCount,
      teamContext,
      allAgents: targetAgents,
    }

    if (i === 0) {
      // First agent: fire immediately (fire-and-forget), capture its completion
      const done = processWorkItemForAgent(
        agent,
        workItemId,
        pluginInstanceId,
        responseContext,
        dispatchOpts
      ).catch((err) => console.error(`[webhook] Agent ${agent.id} dispatch error:`, err))
      previousDone = done.then(() => undefined)
    } else {
      // Subsequent agents: wait for previous to finish (or timeout), then add a small gap
      const prev = previousDone
      const done = (async () => {
        await Promise.race([
          prev,
          new Promise<void>((resolve) => setTimeout(resolve, AGENT_TIMEOUT_MS)),
        ])
        // Small gap so responses don't collide in the chat
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

export async function POST(request: Request, context: RouteParams) {
  const { type, instanceId } = await context.params

  // Ensure runtime workers are active (startup should already do this via instrumentation).
  await ensureRuntimeWorkers()

  // Wire hooks 1-2 (work_item.pre_create / post_create) via callbacks
  // to avoid circular deps between plugin-handlers and plugin-runtime
  const webhookHooks: WebhookHooks = {
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

  const result = await routeWebhook(type, instanceId, request, webhookHooks)

  // If a work item was created, process it asynchronously
  if (result.workItemId) {
    await publishRoutineEnvelopeFromWorkItem(result.workItemId).catch((error) => {
      console.warn('[webhook] Failed to publish routine envelope from webhook work item', {
        workItemId: result.workItemId,
        error: error instanceof Error ? error.message : String(error),
      })
    })

    // Check if this is a command that should be handled specially
    if (result.command) {
      // Handle command (fire and forget)
      handleCommand(
        result.command,
        result.workItemId,
        result.pluginInstanceId!,
        result.responseContext
      )
        .then(async (handled) => {
          if (!handled) {
            // Unknown command, process as normal message — dispatch to all agents
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
    } else if (result.sessionKey) {
      // Regular message with a session key — route through per-agent queues
      const pluginInstanceData = await getPluginInstanceWithConfig(result.pluginInstanceId!)
      const queueConfig = extractQueueConfig(pluginInstanceData?.config ?? null)
      const agents = await getAgentsForPluginInstance(result.pluginInstanceId!)
      const originAgentId = resolveOriginAgentId(result.actor, agents)
      const targetAgents = filterOriginAgent(agents, originAgentId)

      if (agents.length === 0) {
        console.error('[webhook] No agents assigned to plugin instance', result.pluginInstanceId)
        await updateWorkItem(result.workItemId, { status: 'FAILED' })
      } else if (targetAgents.length === 0) {
        console.log('[webhook] Queue enqueue skipped: origin-agent exclusion removed all targets')
        await updateWorkItem(result.workItemId, { status: 'DONE' })
      } else {
        // Acknowledge receipt once (before dispatching to any agents)
        if (pluginInstanceData) {
          const handler = pluginHandlerRegistry.get(pluginInstanceData.type)
          if (handler?.acknowledgeReceipt) {
            handler
              .acknowledgeReceipt(pluginInstanceData, result.responseContext)
              .catch((err) => console.warn('[webhook] Failed to acknowledge receipt:', err))
          }
        }

        // Shuffle for fair lane assignment order; durable workers handle serialization per lane.
        const shuffled = shuffleArray([...targetAgents])
        const arrivedAt = Math.floor(Date.now() / 1000)
        for (const [index, agent] of shuffled.entries()) {
          // Resolve per-agent queue config: agent config > plugin instance config > defaults
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
            plugin_instance_id: result.pluginInstanceId!,
            response_context: result.responseContext
              ? JSON.stringify(result.responseContext)
              : null,
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
            pluginInstanceId: result.pluginInstanceId!,
            arrivedAt,
            debounceMs: staggeredDebounceMs,
            maxQueued: resolvedMaxQueued,
            mode: resolvedMode,
          })
        }
      }
    } else {
      // No session key (shouldn't happen for Telegram, but handle gracefully)
      const pluginInstanceData = await getPluginInstanceWithConfig(result.pluginInstanceId!)
      if (pluginInstanceData) {
        const handler = pluginHandlerRegistry.get(pluginInstanceData.type)
        if (handler?.acknowledgeReceipt) {
          handler
            .acknowledgeReceipt(pluginInstanceData, result.responseContext)
            .catch((err) => console.warn('[webhook] Failed to acknowledge receipt:', err))
        }
      }

      // Dispatch to all agents on this plugin instance
      const agents = await getAgentsForPluginInstance(result.pluginInstanceId!)
      const originAgentId = resolveOriginAgentId(result.actor, agents)
      dispatchToAgents(
        agents,
        result.workItemId,
        result.pluginInstanceId!,
        result.responseContext,
        {
          originAgentId,
        }
      ).catch((err) => console.error('[webhook] Background processing error:', err))
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
