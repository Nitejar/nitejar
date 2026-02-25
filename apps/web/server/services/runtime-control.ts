import {
  getRuntimeControl,
  setRuntimeProcessingEnabled,
  incrementRuntimeControlEpoch,
  getRuntimeControlStats,
  markStaleRunningDispatchesAbandoned,
  markAllActiveDispatchesAbandoned,
  markStaleSendingEffectsUnknown,
  markAllSendingEffectsUnknown,
  requestPauseRunDispatchByJob,
  clearPauseRunDispatchByJob,
  requestCancelRunDispatchByJob,
  pauseQueueLane,
  resumeQueueLane,
  cancelPendingQueueMessagesForQueue,
  cancelPendingEffectsByDispatch,
  findRunDispatchByJobId,
  pauseJob,
  resumeJob,
  cancelJob,
  failStartingActivityByJobIds,
  getDb,
} from '@nitejar/database'
import { closeSpriteSessionForConversation, killBackgroundTaskSession } from '@nitejar/sprites'

function now(): number {
  return Math.floor(Date.now() / 1000)
}

export type TerminationScope = 'stale_only' | 'all_active'

type ActiveDispatchSnapshot = {
  id: string
  job_id: string | null
  session_key: string
  agent_id: string
}

async function listDispatchesForTermination(
  scope: TerminationScope,
  cutoff: number
): Promise<ActiveDispatchSnapshot[]> {
  const db = getDb()
  let query = db
    .selectFrom('run_dispatches')
    .select(['id', 'job_id', 'session_key', 'agent_id'])
    .where('status', 'in', ['running', 'paused'])

  if (scope === 'stale_only') {
    query = query.where((eb) =>
      eb.or([
        eb('lease_expires_at', '<', cutoff),
        eb.and([eb('lease_expires_at', 'is', null), eb('started_at', '<', cutoff)]),
      ])
    )
  }

  return query.execute()
}

async function terminateExecutionForDispatches(
  dispatches: ActiveDispatchSnapshot[],
  reason: string
): Promise<void> {
  if (dispatches.length === 0) return

  const db = getDb()
  const ts = now()
  const reasonText = `Runtime terminated: ${reason}`
  const jobIds = Array.from(
    new Set(dispatches.map((dispatch) => dispatch.job_id).filter((id): id is string => !!id))
  )

  if (jobIds.length > 0) {
    const runningTasks = await db
      .selectFrom('background_tasks')
      .select(['id', 'sprite_name', 'sprite_session_id'])
      .where('job_id', 'in', jobIds)
      .where('status', '=', 'running')
      .execute()

    await Promise.all(
      runningTasks.map(async (task) => {
        try {
          await killBackgroundTaskSession(task.sprite_name, task.sprite_session_id)
        } catch {
          // Best effort — we still mark DB state as killed below.
        }
      })
    )

    await db
      .updateTable('background_tasks')
      .set({
        status: 'killed',
        error_text: reasonText,
        finished_at: ts,
        updated_at: ts,
      })
      .where('job_id', 'in', jobIds)
      .where('status', '=', 'running')
      .execute()

    await db
      .updateTable('jobs')
      .set({
        status: 'CANCELLED',
        error_text: reasonText,
        completed_at: ts,
        updated_at: ts,
      })
      .where('id', 'in', jobIds)
      .where('status', 'in', ['PENDING', 'RUNNING', 'PAUSED'])
      .execute()

    await failStartingActivityByJobIds(jobIds, reasonText)
  }

  const sessionPairs = Array.from(
    new Set(dispatches.map((dispatch) => `${dispatch.session_key}::${dispatch.agent_id}`))
  )

  await Promise.all(
    sessionPairs.map(async (pair) => {
      const [sessionKey, agentId] = pair.split('::')
      if (!sessionKey || !agentId) return
      try {
        await closeSpriteSessionForConversation(sessionKey, agentId)
      } catch {
        // Best effort — closeSpriteSessionForConversation already swallows
        // most token/configuration errors.
      }
    })
  )
}

export async function forceTerminateActiveRuntime(input: {
  scope: TerminationScope
  reason: string
  actor: string
  staleSeconds?: number
  incrementEpoch?: boolean
}): Promise<{ abandonedDispatches: number; unknownEffects: number; epoch: number }> {
  const staleSeconds = input.staleSeconds ?? 180
  const cutoff = now() - staleSeconds
  const activeDispatches = await listDispatchesForTermination(input.scope, cutoff)

  const [abandonedDispatches, unknownEffects] =
    input.scope === 'all_active'
      ? await Promise.all([
          markAllActiveDispatchesAbandoned(input.reason),
          markAllSendingEffectsUnknown(input.reason),
        ])
      : await Promise.all([
          markStaleRunningDispatchesAbandoned(cutoff),
          markStaleSendingEffectsUnknown(cutoff),
        ])

  await terminateExecutionForDispatches(activeDispatches, input.reason)

  const db = getDb()
  const ts = now()
  await db
    .updateTable('queue_lanes')
    .set({
      state: 'queued',
      active_dispatch_id: null,
      debounce_until: ts,
      updated_at: ts,
    })
    .where('state', '=', 'running')
    .execute()

  const control =
    input.incrementEpoch === false
      ? await getRuntimeControl()
      : await incrementRuntimeControlEpoch()

  return {
    abandonedDispatches,
    unknownEffects,
    epoch: control.control_epoch,
  }
}

export async function getRuntimeControlView() {
  const [control, stats] = await Promise.all([getRuntimeControl(), getRuntimeControlStats()])

  return {
    processingEnabled: control.processing_enabled === 1,
    pauseMode: control.pause_mode,
    pauseReason: control.pause_reason,
    pausedBy: control.paused_by,
    pausedAt: control.paused_at,
    controlEpoch: control.control_epoch,
    maxConcurrentDispatches: control.max_concurrent_dispatches,
    appBaseUrl: control.app_base_url,
    updatedAt: control.updated_at,
    stats,
  }
}

export async function pauseRuntime(input: {
  actor: string
  reason?: string
  mode?: 'soft' | 'hard'
}) {
  const mode = input.mode ?? 'soft'
  const control = await setRuntimeProcessingEnabled({
    enabled: false,
    mode,
    reason: input.reason ?? 'Paused by operator',
    actor: input.actor,
  })

  if (mode === 'hard') {
    await forceTerminateActiveRuntime({
      scope: 'all_active',
      reason: input.reason ?? 'Hard pause invoked by operator',
      actor: input.actor,
      incrementEpoch: true,
    })
  }

  return {
    processingEnabled: control.processing_enabled === 1,
    pauseMode: control.pause_mode,
    controlEpoch: control.control_epoch,
  }
}

export async function resumeRuntime() {
  const control = await setRuntimeProcessingEnabled({
    enabled: true,
    mode: 'soft',
    reason: null,
    actor: null,
  })

  return {
    processingEnabled: control.processing_enabled === 1,
    pauseMode: control.pause_mode,
    controlEpoch: control.control_epoch,
  }
}

export async function emergencyStopRuntime(input: { actor: string; reason?: string }) {
  await setRuntimeProcessingEnabled({
    enabled: false,
    mode: 'hard',
    reason: input.reason ?? 'Emergency stop invoked',
    actor: input.actor,
  })

  return forceTerminateActiveRuntime({
    scope: 'all_active',
    reason: input.reason ?? 'Emergency stop invoked',
    actor: input.actor,
    incrementEpoch: true,
  })
}

export async function pauseRunByJob(input: { jobId: string; actor: string; reason?: string }) {
  const dispatch = await requestPauseRunDispatchByJob(
    input.jobId,
    input.reason ?? `Paused by ${input.actor}`
  )
  if (!dispatch) return { ok: false as const, reason: 'Run not active' }

  await pauseQueueLane(dispatch.queue_key, input.reason ?? `Paused by ${input.actor}`, input.actor)
  await pauseJob(input.jobId)

  return { ok: true as const, dispatchId: dispatch.id }
}

export async function resumeRunByJob(input: { jobId: string }) {
  const dispatch = await clearPauseRunDispatchByJob(input.jobId)
  if (!dispatch) return { ok: false as const, reason: 'Run not paused' }

  await resumeQueueLane(dispatch.queue_key)
  await resumeJob(input.jobId)

  return { ok: true as const, dispatchId: dispatch.id }
}

export async function cancelRunByJob(input: { jobId: string; actor: string; reason?: string }) {
  const reason = input.reason ?? `Cancelled by ${input.actor}`
  const dispatch = await requestCancelRunDispatchByJob(input.jobId, reason)
  if (!dispatch) {
    const fallbackDispatch = await findRunDispatchByJobId(input.jobId)
    if (!fallbackDispatch) return { ok: false as const, reason: 'Run not active' }
    await terminateExecutionForDispatches(
      [
        {
          id: fallbackDispatch.id,
          job_id: fallbackDispatch.job_id,
          session_key: fallbackDispatch.session_key,
          agent_id: fallbackDispatch.agent_id,
        },
      ],
      reason
    )
    await cancelJob(input.jobId, reason)
    await resumeQueueLane(fallbackDispatch.queue_key)
    return { ok: true as const, dispatchId: fallbackDispatch.id }
  }

  await pauseQueueLane(dispatch.queue_key, reason, input.actor)
  try {
    await cancelPendingQueueMessagesForQueue(dispatch.queue_key, reason)
    await cancelPendingEffectsByDispatch(dispatch.id, reason)
    await terminateExecutionForDispatches(
      [
        {
          id: dispatch.id,
          job_id: dispatch.job_id,
          session_key: dispatch.session_key,
          agent_id: dispatch.agent_id,
        },
      ],
      reason
    )
    await cancelJob(input.jobId, reason)
  } finally {
    await resumeQueueLane(dispatch.queue_key)
  }

  return { ok: true as const, dispatchId: dispatch.id }
}

export async function getRunControlByJob(jobId: string) {
  const dispatch = await findRunDispatchByJobId(jobId)
  if (!dispatch) return null

  return {
    dispatchId: dispatch.id,
    queueKey: dispatch.queue_key,
    status: dispatch.status,
    controlState: dispatch.control_state,
    controlReason: dispatch.control_reason,
    controlUpdatedAt: dispatch.control_updated_at,
  }
}
