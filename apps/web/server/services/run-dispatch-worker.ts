import {
  claimNextRunDispatch,
  attachJobIdToRunDispatch,
  heartbeatRunDispatch,
  finalizeRunDispatch,
  createEffectOutbox,
  listQueueMessagesByDispatch,
  consumeSteeringMessages,
  consumeSteeringMessagesByIds,
  dropPendingQueueMessagesByIds,
  updateWorkItem,
  getRuntimeControl,
  getRunDispatchControlDirective,
  annotateRunDispatchDecision,
  listActiveRunDispatchSnapshotsForAgent,
  listLatestSessionActivityByAgents,
  setRunDispatchPaused,
  setRunDispatchRunningFromPause,
  cancelJob,
  pauseJob,
  resumeJob,
  findRunDispatchById,
  findAgentById,
  findWorkItemById,
  getAgentsForPluginInstance,
  listAppSessionParticipantAgents,
  findLatestExclusiveClaimForWorkItem,
  reapExpiredLeases,
  type RuntimeControl,
  type ClaimedRunDispatch,
} from '@nitejar/database'
import { runAgent, type AgentEventCallback } from '@nitejar/agent/runner'
import { createEventCallback } from '@nitejar/agent/streaming'
import { decideSteeringAction } from '@nitejar/agent/steer-arbiter'
import { parseAgentConfig } from '@nitejar/agent/config'
import type { TeamContext } from '@nitejar/agent/prompt-builder'
import { getPluginInstanceWithConfig, pluginHandlerRegistry } from '@nitejar/plugin-handlers'
import { createRunnerHookDispatch } from './plugins/hook-dispatch'

const WORKER_STATE_KEY = '__nitejarRunDispatchWorker'
const TICK_MS = 1000
const LEASE_SECONDS = 120
const HEARTBEAT_MS = 20_000
const CANCELLED_MARKER = '__RUN_CANCELLED__'
const DEFAULT_MAX_CONCURRENT_DISPATCHES = 20

function steeringSignature(messages: { id: string; text: string; senderName: string }[]): string {
  return messages.map((m) => `${m.id}:${m.senderName}:${m.text}`).join('\n')
}

function mapDispatchStatusToTeamStatus(status: string): string {
  switch (status) {
    case 'running':
      return 'active'
    case 'paused':
      return 'paused'
    case 'queued':
      return 'queued'
    default:
      return status
  }
}

function mapActivityStatusToTeamStatus(status: string | null | undefined): string | null {
  if (!status) return null
  switch (status) {
    case 'starting':
      return 'active'
    case 'completed':
      return 'completed'
    case 'passed':
      return 'passed'
    case 'failed':
      return 'failed'
    default:
      return status
  }
}

function inferRouteFromActivityStatus(
  status: string | null | undefined
): 'respond' | 'pass' | 'unknown' {
  if (!status) return 'unknown'
  switch (status) {
    case 'passed':
      return 'pass'
    case 'starting':
    case 'completed':
    case 'failed':
      return 'respond'
    default:
      return 'unknown'
  }
}

function summarizeForPrompt(text: string, maxChars = 160): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxChars) return normalized
  if (maxChars <= 3) return normalized.slice(0, maxChars)
  return `${normalized.slice(0, maxChars - 3).trimEnd()}...`
}

async function resolveTeammateRuntimeStatuses(
  teammateIds: string[],
  sessionKey: string
): Promise<Map<string, string>> {
  const entries = await Promise.all(
    teammateIds.map(async (teammateId) => {
      const snapshots = await listActiveRunDispatchSnapshotsForAgent(teammateId, { limit: 8 })
      if (snapshots.length === 0) return [teammateId, null] as const

      const sameSession = snapshots.find((s) => s.session_key === sessionKey)
      const best = sameSession ?? snapshots[0] ?? null
      if (!best) return [teammateId, null] as const

      return [teammateId, mapDispatchStatusToTeamStatus(best.status)] as const
    })
  )

  const result = new Map<string, string>()
  for (const [teammateId, status] of entries) {
    if (status) result.set(teammateId, status)
  }
  return result
}

type WorkerState = {
  started: boolean
  /** Guards the claim loop to prevent overlapping ticks from racing */
  claiming: boolean
  draining: boolean
  /** Currently executing dispatch IDs */
  active: Set<string>
  timer?: NodeJS.Timeout
  /** Swappable reference so HMR picks up new code without restarting the interval.
   *  This is the FULL tick (guard + claim loop), not just the inner work function.
   *  That way structural changes to the tick logic propagate through HMR. */
  tickFn?: () => Promise<void>
}

function safeParseJson(value: string | null): unknown {
  if (!value) return null
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

function getState(): WorkerState {
  const globalState = globalThis as typeof globalThis & {
    [WORKER_STATE_KEY]?: WorkerState
  }

  const existing = globalState[WORKER_STATE_KEY]
  if (existing) {
    // Migrate from old single-threaded state shape if needed (HMR compat)
    if (!existing.active) {
      existing.active = new Set()
    }
    if (existing.claiming === undefined) {
      existing.claiming = false
    }
    // Clear legacy 'running' flag so old stuck ticks don't block new code
    const legacy = existing as Record<string, unknown>
    if ('running' in legacy) {
      delete legacy.running
    }
    return existing
  }

  const created: WorkerState = {
    started: false,
    claiming: false,
    draining: false,
    active: new Set(),
  }
  globalState[WORKER_STATE_KEY] = created
  return created
}

// ---------------------------------------------------------------------------
// Execute a single claimed dispatch (self-contained, no shared mutable state)
// ---------------------------------------------------------------------------

async function executeDispatch(
  claimed: ClaimedRunDispatch,
  control: RuntimeControl
): Promise<void> {
  const dispatch = claimed.dispatch
  const dispatchAgent = await findAgentById(dispatch.agent_id)
  let jobId: string | null = null
  let heartbeatTimer: NodeJS.Timeout | null = null
  let lastSteerSignature: string | null = null
  let lastSteerDecision: 'interrupt_now' | 'do_not_interrupt' | 'ignore' | null = null
  let pendingSteerMessageIds: string[] = []

  try {
    heartbeatTimer = setInterval(() => {
      void heartbeatRunDispatch(dispatch.id, LEASE_SECONDS).catch((error) => {
        console.warn('[RunDispatchWorker] Heartbeat failed', {
          dispatchId: dispatch.id,
          error: error instanceof Error ? error.message : String(error),
        })
      })
    }, HEARTBEAT_MS)

    const workItem = await findWorkItemById(dispatch.work_item_id)
    const skipTriage = workItem?.source === 'app_chat'

    const pluginInstance = dispatch.plugin_instance_id
      ? await getPluginInstanceWithConfig(dispatch.plugin_instance_id)
      : null
    const pluginInstanceAgents = dispatch.plugin_instance_id
      ? await getAgentsForPluginInstance(dispatch.plugin_instance_id)
      : []
    const teamAgents =
      !dispatch.plugin_instance_id && skipTriage
        ? await listAppSessionParticipantAgents(dispatch.session_key)
        : pluginInstanceAgents
    const teammateIds = teamAgents
      .filter((agent) => agent.id !== dispatch.agent_id)
      .map((agent) => agent.id)
    const teammateRuntimeStatuses = await resolveTeammateRuntimeStatuses(
      teammateIds,
      dispatch.session_key
    )
    const teammateActivity = await listLatestSessionActivityByAgents(
      dispatch.session_key,
      teammateIds
    )
    const teammateActivityById = new Map(teammateActivity.map((entry) => [entry.agent_id, entry]))
    const responseMode = pluginInstance
      ? (pluginHandlerRegistry.get(pluginInstance.type)?.responseMode ?? 'streaming')
      : 'streaming'
    const exclusiveClaim = await findLatestExclusiveClaimForWorkItem(dispatch.work_item_id, {
      excludeDispatchId: dispatch.id,
    })
    const exclusiveAgent = exclusiveClaim
      ? teamAgents.find((agent) => agent.id === exclusiveClaim.agent_id)
      : null
    const dispatchInfoParts: string[] = []
    if (exclusiveClaim) {
      dispatchInfoParts.push(
        `Exclusive responder volunteer for this work item: ${exclusiveAgent ? `@${exclusiveAgent.handle} (${exclusiveAgent.name})` : exclusiveClaim.agent_id}.`
      )
    }
    if (teammateActivity.length > 0) {
      dispatchInfoParts.push('Recent triage log:')
      for (const entry of teammateActivity) {
        const teammate = teamAgents.find((agent) => agent.id === entry.agent_id)
        const displayHandle = teammate?.handle ?? entry.agent_handle
        const displayName = teammate?.name ?? entry.agent_handle
        const status = mapActivityStatusToTeamStatus(entry.status) ?? entry.status
        const route = inferRouteFromActivityStatus(entry.status)
        const isExclusive = exclusiveClaim?.agent_id === entry.agent_id
        dispatchInfoParts.push(
          `- @${displayHandle} (${displayName}) — ${status}: route=${route}; exclusive=${isExclusive}; reason=${summarizeForPrompt(entry.summary, 140)}`
        )
      }
    }
    const dispatchInfo = dispatchInfoParts.length > 0 ? dispatchInfoParts.join('\n') : undefined
    const teamContext: TeamContext | undefined =
      teamAgents.length > 1
        ? {
            teammates: teamAgents
              .filter((agent) => agent.id !== dispatch.agent_id)
              .map((agent) => {
                const cfg = parseAgentConfig(agent.config)
                return {
                  handle: agent.handle,
                  name: agent.name,
                  role: cfg.title ?? null,
                  status:
                    teammateRuntimeStatuses.get(agent.id) ??
                    mapActivityStatusToTeamStatus(teammateActivityById.get(agent.id)?.status) ??
                    agent.status,
                }
              }),
            dispatchInfo,
          }
        : undefined

    let eventCallback: AgentEventCallback | null = null
    let resumeFromJobId: string | undefined

    if (
      (dispatch.control_reason === 'resume_seed' || dispatch.control_reason === 'restart_seed') &&
      dispatch.replay_of_dispatch_id
    ) {
      const sourceDispatch = await findRunDispatchById(dispatch.replay_of_dispatch_id)
      if (sourceDispatch?.job_id) {
        resumeFromJobId = sourceDispatch.job_id
      }
    }

    const result = await runAgent(dispatch.agent_id, dispatch.work_item_id, {
      coalescedText: dispatch.coalesced_text ?? dispatch.input_text,
      resumeFromJobId,
      skipTriage,
      responseMode,
      teamContext,
      hookDispatch: createRunnerHookDispatch(),
      onEvent: (event) => {
        if (event.type === 'job_started') {
          jobId = event.jobId
          eventCallback = createEventCallback(event.jobId)
          void attachJobIdToRunDispatch(dispatch.id, event.jobId).catch((error) => {
            console.warn('[RunDispatchWorker] Failed to attach job ID to dispatch', {
              dispatchId: dispatch.id,
              jobId: event.jobId,
              error: error instanceof Error ? error.message : String(error),
            })
          })
        }
        if (event.type === 'triage' && event.shouldRespond && event.exclusiveClaim) {
          void annotateRunDispatchDecision(
            dispatch.id,
            `arbiter:exclusive_claim:triage_volunteer:${dispatch.agent_id}`
          ).catch((error) => {
            console.warn('[RunDispatchWorker] Failed to annotate exclusive triage claim', {
              dispatchId: dispatch.id,
              error: error instanceof Error ? error.message : String(error),
            })
          })
        }

        if (eventCallback) {
          eventCallback(event)
        }
      },
      getRunControlDirective: async () => {
        const directive = await getRunDispatchControlDirective(dispatch.id)
        if (directive.action !== 'steer') {
          pendingSteerMessageIds = []
          return directive
        }

        if (!dispatchAgent) {
          return directive
        }

        const signature = steeringSignature(directive.messages)
        if (
          lastSteerSignature === signature &&
          lastSteerDecision &&
          lastSteerDecision !== 'interrupt_now'
        ) {
          return { action: 'continue' }
        }

        const activeWork = await listActiveRunDispatchSnapshotsForAgent(dispatch.agent_id, {
          excludeDispatchId: dispatch.id,
          limit: 8,
        })
        const arbiter = await decideSteeringAction({
          agent: dispatchAgent,
          queueKey: dispatch.queue_key,
          sessionKey: dispatch.session_key,
          objectiveText: dispatch.coalesced_text ?? dispatch.input_text,
          pendingMessages: directive.messages,
          activeWork: activeWork.map((item) => ({
            dispatchId: item.dispatch_id,
            status: item.status,
            source: item.source,
            sessionKey: item.session_key,
            title: item.title,
            createdAt: item.created_at,
          })),
        })

        const reason = `arbiter:${arbiter.decision}:${arbiter.reason}`
        await annotateRunDispatchDecision(dispatch.id, reason)

        if (arbiter.decision === 'ignore') {
          await dropPendingQueueMessagesByIds(
            directive.messages.map((m) => m.id),
            reason
          )
          pendingSteerMessageIds = []
          lastSteerSignature = signature
          lastSteerDecision = 'ignore'
          return { action: 'continue' }
        }

        if (arbiter.decision === 'do_not_interrupt') {
          pendingSteerMessageIds = []
          lastSteerSignature = signature
          lastSteerDecision = 'do_not_interrupt'
          return { action: 'continue' }
        }

        pendingSteerMessageIds = directive.messages.map((m) => m.id)
        lastSteerSignature = signature
        lastSteerDecision = 'interrupt_now'
        return directive
      },
      onSteered: async () => {
        const steerIds = pendingSteerMessageIds
        pendingSteerMessageIds = []
        const consumed =
          steerIds.length > 0
            ? await consumeSteeringMessagesByIds(steerIds, dispatch.id)
            : await consumeSteeringMessages(dispatch.queue_key, dispatch.id)
        return consumed.map((m) => ({
          text: m.text,
          senderName: m.sender_name ?? 'Unknown',
        }))
      },
      onPaused: async () => {
        await setRunDispatchPaused(dispatch.id)
        if (jobId) {
          await pauseJob(jobId)
        }
      },
      onResumed: async () => {
        await setRunDispatchRunningFromPause(dispatch.id)
        if (jobId) {
          await resumeJob(jobId)
        }
      },
      onCancelled: async () => {
        if (jobId) {
          await cancelJob(jobId, 'Cancelled by operator')
        }
      },
    })

    const finalized = await finalizeRunDispatch(dispatch.id, {
      status: 'completed',
      expectedEpoch: dispatch.claimed_epoch,
    })
    if (!finalized) {
      return
    }

    const includedMessages = await listQueueMessagesByDispatch(dispatch.id)
    const workItemIds = Array.from(
      new Set(
        includedMessages.length > 0
          ? includedMessages.map((m) => m.work_item_id)
          : [dispatch.work_item_id]
      )
    )
    for (const workItemId of workItemIds) {
      await updateWorkItem(workItemId, { status: 'DONE' })
    }

    if (pluginInstance && result.finalResponse) {
      // Prefix with [AgentName] when multiple agents share the pluginInstance
      let content = result.finalResponse
      if (dispatch.plugin_instance_id) {
        const [agent, assignedAgents] = await Promise.all([
          Promise.resolve(dispatchAgent),
          Promise.resolve(pluginInstanceAgents),
        ])
        if (agent && assignedAgents.length > 1) {
          let emoji = ''
          try {
            const parsed = agent.config ? (JSON.parse(agent.config) as { emoji?: string }) : null
            emoji = parsed?.emoji ?? ''
          } catch {
            /* ignore */
          }
          const label = `${emoji} ${agent.name}`.trim()
          content = `[${label}] ${content}`
        }
      }

      const effectKey = `dispatch:${dispatch.id}:assistant_final_response`
      await createEffectOutbox({
        effect_key: effectKey,
        dispatch_id: dispatch.id,
        plugin_instance_id: pluginInstance.id,
        work_item_id: dispatch.work_item_id,
        job_id: jobId,
        channel: pluginInstance.type,
        kind: 'assistant_final_response',
        payload: JSON.stringify({
          content,
          responseContext: safeParseJson(dispatch.response_context),
          options: { hitLimit: result.hitLimit, idempotencyKey: effectKey },
          actor: dispatchAgent
            ? {
                kind: 'agent',
                agentId: dispatchAgent.id,
                handle: dispatchAgent.handle,
                displayName: dispatchAgent.name,
                source: pluginInstance.type,
              }
            : undefined,
        }),
        status: 'pending',
        retryable: 0,
        attempt_count: 0,
        next_attempt_at: null,
        claimed_by: null,
        lease_expires_at: null,
        claimed_epoch: control.control_epoch,
        provider_ref: null,
        last_error: null,
        unknown_reason: null,
        released_by: null,
        released_at: null,
        sent_at: null,
      })
    }

    // Post-run eval hook: enqueue eval pipeline if agent has active evaluators
    if (jobId) {
      try {
        const { maybeEnqueuePassiveMemory } = await import('./passive-memory-enqueue')
        await maybeEnqueuePassiveMemory(
          jobId,
          dispatch.agent_id,
          dispatch.work_item_id,
          dispatch.id
        )
      } catch (passiveMemoryError) {
        // Passive memory enqueue failures must never block the agent response
        console.warn(
          '[RunDispatchWorker] Passive memory enqueue failed (non-blocking):',
          passiveMemoryError
        )
      }

      try {
        const { maybeEnqueueEvalPipeline } = await import('./eval-enqueue')
        await maybeEnqueueEvalPipeline(jobId, dispatch.agent_id, dispatch.work_item_id)
      } catch (evalError) {
        // Eval enqueue failures must never block the agent response
        console.warn('[RunDispatchWorker] Eval enqueue failed (non-blocking):', evalError)
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes(CANCELLED_MARKER)) {
      await finalizeRunDispatch(dispatch.id, {
        status: 'cancelled',
        error: 'Cancelled by operator',
        expectedEpoch: dispatch.claimed_epoch,
      })
    } else {
      const finalized = await finalizeRunDispatch(dispatch.id, {
        status: 'failed',
        error: message,
        expectedEpoch: dispatch.claimed_epoch,
      })
      if (finalized) {
        await updateWorkItem(dispatch.work_item_id, { status: 'FAILED' })
      }
    }
  } finally {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
    }
  }
}

// ---------------------------------------------------------------------------
// Claim loop: claim all available lanes and fire dispatches concurrently
// ---------------------------------------------------------------------------

async function claimAndDispatch(): Promise<void> {
  const state = getState()
  const control = await getRuntimeControl()
  if (control.processing_enabled !== 1) {
    return
  }

  // Reap dispatches whose leases expired (dead workers) so lanes unblock
  const reaped = await reapExpiredLeases()
  if (reaped > 0) {
    console.log(`[RunDispatchWorker] Reaped ${reaped} expired-lease dispatch(es)`)
  }

  const workerId = `run-worker:${process.pid}`
  const maxConcurrent = control.max_concurrent_dispatches || DEFAULT_MAX_CONCURRENT_DISPATCHES

  // Claim all available lanes up to concurrency limit
  while (state.active.size < maxConcurrent && !state.draining) {
    const claimed = await claimNextRunDispatch(workerId, { leaseSeconds: LEASE_SECONDS })
    if (!claimed) break

    const dispatchId = claimed.dispatch.id
    state.active.add(dispatchId)

    // Fire and forget — executeDispatch handles its own lifecycle
    void executeDispatch(claimed, control)
      .catch((error) => {
        console.warn('[RunDispatchWorker] Dispatch failed', {
          dispatchId,
          error: error instanceof Error ? error.message : String(error),
        })
      })
      .finally(() => {
        state.active.delete(dispatchId)
      })
  }
}

// ---------------------------------------------------------------------------
// Worker lifecycle
// ---------------------------------------------------------------------------

export const __dispatchWorkerTest = {
  executeDispatch,
  claimAndDispatch,
  resetState: () => {
    const state = getState()
    state.started = false
    state.claiming = false
    state.draining = false
    state.active.clear()
    state.tickFn = undefined
    if (state.timer) {
      clearInterval(state.timer)
      state.timer = undefined
    }
  },
}

export function ensureRunDispatchWorker(): void {
  const state = getState()

  // Always replace the FULL tick so HMR picks up guard-logic changes, not just
  // the inner work function. The interval only calls through this reference.
  state.tickFn = async () => {
    if (state.claiming || state.draining) return
    state.claiming = true
    try {
      await claimAndDispatch()
    } catch (error) {
      console.warn('[RunDispatchWorker] Tick failed', error)
    } finally {
      state.claiming = false
    }
  }

  if (state.started) return

  state.started = true

  void state.tickFn()
  state.timer = setInterval(() => {
    void state.tickFn!()
  }, TICK_MS)

  if (typeof state.timer.unref === 'function') {
    state.timer.unref()
  }

  console.log('[RunDispatchWorker] Started (concurrent, max configurable via runtime settings)')
}

export function stopRunDispatchWorker(): void {
  const state = getState()
  state.draining = true
  if (state.timer) {
    clearInterval(state.timer)
    state.timer = undefined
  }
}

export function isRunDispatchWorkerBusy(): boolean {
  return getState().active.size > 0
}
