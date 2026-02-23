import { getDb } from '../db'
import type { QueueMessage, RunDispatch } from '../types'
import { generateUuidV7 } from '@nitejar/core'

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function uuid(): string {
  return generateUuidV7()
}

function coalesceQueueMessages(messages: QueueMessage[]): string {
  if (messages.length === 0) return ''
  if (messages.length === 1) return messages[0]!.text

  const header = `[${messages.length} messages arrived while you were working]\n\n`
  const lines = messages.map((m) => {
    const ts = new Date(m.arrived_at * 1000).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
    const sender = m.sender_name ?? 'Unknown'
    return `[${ts} - ${sender}] ${m.text}`
  })
  return header + lines.join('\n')
}

async function getRuntimeEpoch(trx: ReturnType<typeof getDb>): Promise<number> {
  const control = await trx
    .selectFrom('runtime_control')
    .select('control_epoch')
    .where('id', '=', 'default')
    .executeTakeFirst()
  return control?.control_epoch ?? 0
}

export interface ClaimedRunDispatch {
  dispatch: RunDispatch
  messages: QueueMessage[]
}

export interface ActiveRunDispatchSnapshot {
  dispatch_id: string
  status: string
  queue_key: string
  session_key: string
  source: string
  title: string
  created_at: number
}

export interface ExclusiveRunDispatchClaim {
  dispatch_id: string
  agent_id: string
  work_item_id: string
  session_key: string
  control_reason: string | null
  control_updated_at: number | null
  updated_at: number
}

export async function findRunDispatchById(id: string): Promise<RunDispatch | null> {
  const db = getDb()
  const row = await db
    .selectFrom('run_dispatches')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst()
  return row ?? null
}

export async function findRunDispatchByJobId(jobId: string): Promise<RunDispatch | null> {
  const db = getDb()
  const row = await db
    .selectFrom('run_dispatches')
    .selectAll()
    .where('job_id', '=', jobId)
    .orderBy('created_at', 'desc')
    .executeTakeFirst()
  return row ?? null
}

export async function listRunDispatchesByWorkItem(workItemId: string): Promise<RunDispatch[]> {
  const db = getDb()
  return db
    .selectFrom('run_dispatches')
    .selectAll()
    .where('work_item_id', '=', workItemId)
    .orderBy('created_at', 'desc')
    .execute()
}

export async function listActiveRunDispatchSnapshotsForAgent(
  agentId: string,
  opts?: { excludeDispatchId?: string; limit?: number }
): Promise<ActiveRunDispatchSnapshot[]> {
  const db = getDb()
  const limit = Math.min(Math.max(opts?.limit ?? 12, 1), 50)

  return db
    .selectFrom('run_dispatches')
    .innerJoin('work_items', 'work_items.id', 'run_dispatches.work_item_id')
    .select([
      'run_dispatches.id as dispatch_id',
      'run_dispatches.status',
      'run_dispatches.queue_key',
      'run_dispatches.session_key',
      'work_items.source',
      'work_items.title',
      'run_dispatches.created_at',
    ])
    .where('run_dispatches.agent_id', '=', agentId)
    .where('run_dispatches.status', 'in', ['queued', 'running', 'paused'])
    .$if(!!opts?.excludeDispatchId, (qb) =>
      qb.where('run_dispatches.id', '!=', opts!.excludeDispatchId!)
    )
    .orderBy('run_dispatches.created_at', 'desc')
    .limit(limit)
    .execute()
}

export async function findLatestExclusiveClaimForWorkItem(
  workItemId: string,
  opts?: { excludeDispatchId?: string }
): Promise<ExclusiveRunDispatchClaim | null> {
  const db = getDb()
  const row = await db
    .selectFrom('run_dispatches')
    .select([
      'id as dispatch_id',
      'agent_id',
      'work_item_id',
      'session_key',
      'control_reason',
      'control_updated_at',
      'updated_at',
    ])
    .where('work_item_id', '=', workItemId)
    .where('status', 'in', ['running', 'paused', 'completed'])
    .where('control_reason', 'like', 'arbiter:exclusive_claim:%')
    .$if(!!opts?.excludeDispatchId, (qb) => qb.where('id', '!=', opts!.excludeDispatchId!))
    .orderBy('control_updated_at', 'desc')
    .orderBy('updated_at', 'desc')
    .orderBy('created_at', 'desc')
    .limit(1)
    .executeTakeFirst()
  return row ?? null
}

export async function claimNextRunDispatch(
  workerId: string,
  opts?: { leaseSeconds?: number }
): Promise<ClaimedRunDispatch | null> {
  const db = getDb()
  const leaseSeconds = opts?.leaseSeconds ?? 120

  return db.transaction().execute(async (trx) => {
    const nowTs = now()

    // Phase 1: select candidate lane. Keep this isolated so future "skip to latest"
    // coalescing policies can replace selection without changing claim/finalize transitions.
    const candidate = await trx
      .selectFrom('queue_lanes as q')
      .select([
        'q.queue_key',
        'q.session_key',
        'q.agent_id',
        'q.plugin_instance_id',
        'q.max_queued',
        'q.mode',
      ])
      .where('q.state', '=', 'queued')
      .where('q.is_paused', '=', 0)
      .where('q.debounce_until', '<=', nowTs)
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('run_dispatches as r')
              .select('r.id')
              .whereRef('r.queue_key', '=', 'q.queue_key')
              .where('r.status', '=', 'running')
          )
        )
      )
      .orderBy('q.debounce_until', 'asc')
      .orderBy('q.queue_key', 'asc')
      .limit(1)
      .executeTakeFirst()

    if (!candidate) {
      return null
    }

    const claimedLane = await trx
      .updateTable('queue_lanes')
      .set({
        state: 'running',
        updated_at: nowTs,
      })
      .where('queue_key', '=', candidate.queue_key)
      .where('state', '=', 'queued')
      .where('is_paused', '=', 0)
      .where('debounce_until', '<=', nowTs)
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('run_dispatches as r')
              .select('r.id')
              .where('r.queue_key', '=', candidate.queue_key)
              .where('r.status', '=', 'running')
          )
        )
      )
      .executeTakeFirst()

    if (Number(claimedLane.numUpdatedRows ?? 0) === 0) {
      return null
    }

    // Phase 2: claim + include/merge messages for this queue key in the same transaction.
    // In 'followup' mode, claim exactly one message (oldest) per dispatch.
    // In 'collect' or 'steer' mode, coalesce up to maxQueued.
    const isFollowup = (candidate.mode ?? 'steer') === 'followup'
    const messageLimit = isFollowup ? 1 : Math.max(1, candidate.max_queued ?? 10)
    const messages = await trx
      .selectFrom('queue_messages')
      .selectAll()
      .where('queue_key', '=', candidate.queue_key)
      .where('status', '=', 'pending')
      .orderBy('arrived_at', 'asc')
      .orderBy('id', 'asc')
      .limit(messageLimit)
      .execute()

    if (messages.length === 0) {
      // Check for pre-created queued dispatches (e.g. from replayRunDispatch)
      const queuedDispatch = await trx
        .selectFrom('run_dispatches')
        .selectAll()
        .where('queue_key', '=', candidate.queue_key)
        .where('status', '=', 'queued')
        .orderBy('created_at', 'asc')
        .limit(1)
        .executeTakeFirst()

      if (!queuedDispatch) {
        await trx
          .updateTable('queue_lanes')
          .set({
            state: 'idle',
            active_dispatch_id: null,
            debounce_until: null,
            updated_at: nowTs,
          })
          .where('queue_key', '=', candidate.queue_key)
          .execute()
        return null
      }

      // Claim the pre-created dispatch (replay)
      await trx
        .updateTable('run_dispatches')
        .set({
          status: 'running',
          claimed_by: workerId,
          lease_expires_at: nowTs + leaseSeconds,
          claimed_epoch: await getRuntimeEpoch(trx),
          attempt_count: (queuedDispatch.attempt_count ?? 0) + 1,
          started_at: nowTs,
          updated_at: nowTs,
        })
        .where('id', '=', queuedDispatch.id)
        .where('status', '=', 'queued')
        .execute()

      await trx
        .updateTable('queue_lanes')
        .set({
          active_dispatch_id: queuedDispatch.id,
          state: 'running',
          updated_at: nowTs,
        })
        .where('queue_key', '=', candidate.queue_key)
        .execute()

      const dispatch = await trx
        .selectFrom('run_dispatches')
        .selectAll()
        .where('id', '=', queuedDispatch.id)
        .executeTakeFirstOrThrow()

      return { dispatch, messages: [] }
    }

    const latest = messages[messages.length - 1]!
    const dispatchId = uuid()
    const dispatch = await trx
      .insertInto('run_dispatches')
      .values({
        id: dispatchId,
        run_key: `${candidate.queue_key}:${latest.id}`,
        queue_key: candidate.queue_key,
        work_item_id: latest.work_item_id,
        agent_id: candidate.agent_id,
        plugin_instance_id: latest.plugin_instance_id ?? candidate.plugin_instance_id ?? null,
        session_key: candidate.session_key,
        status: 'running',
        control_state: 'normal',
        control_reason: null,
        control_updated_at: null,
        input_text: latest.text,
        coalesced_text: isFollowup ? null : coalesceQueueMessages(messages),
        sender_name: latest.sender_name,
        response_context: latest.response_context,
        job_id: null,
        attempt_count: 1,
        claimed_by: workerId,
        lease_expires_at: nowTs + leaseSeconds,
        claimed_epoch: await getRuntimeEpoch(trx),
        last_error: null,
        replay_of_dispatch_id: null,
        merged_into_dispatch_id: null,
        scheduled_at: latest.arrived_at,
        started_at: nowTs,
        finished_at: null,
        created_at: nowTs,
        updated_at: nowTs,
      })
      .returningAll()
      .executeTakeFirstOrThrow()

    await trx
      .updateTable('queue_messages')
      .set({ status: 'included', dispatch_id: dispatchId })
      .where(
        'id',
        'in',
        messages.map((m) => m.id)
      )
      .where('status', '=', 'pending')
      .execute()

    await trx
      .updateTable('queue_lanes')
      .set({ active_dispatch_id: dispatchId, state: 'running', updated_at: nowTs })
      .where('queue_key', '=', candidate.queue_key)
      .execute()

    return { dispatch, messages }
  })
}

export async function attachJobIdToRunDispatch(dispatchId: string, jobId: string): Promise<void> {
  const db = getDb()
  await db
    .updateTable('run_dispatches')
    .set({ job_id: jobId, updated_at: now() })
    .where('id', '=', dispatchId)
    .execute()
}

export async function heartbeatRunDispatch(
  dispatchId: string,
  leaseSeconds: number
): Promise<void> {
  const db = getDb()
  const ts = now()
  await db
    .updateTable('run_dispatches')
    .set({ lease_expires_at: ts + leaseSeconds, updated_at: ts })
    .where('id', '=', dispatchId)
    .where('status', 'in', ['running', 'paused'])
    .execute()
}

export type RunControlDirective =
  | { action: 'continue' }
  | { action: 'pause' }
  | { action: 'cancel' }
  | { action: 'steer'; messages: { id: string; text: string; senderName: string }[] }

export async function getRunDispatchControlState(
  dispatchId: string
): Promise<'continue' | 'pause' | 'cancel'> {
  const db = getDb()
  const row = await db
    .selectFrom('run_dispatches')
    .select(['status', 'control_state'])
    .where('id', '=', dispatchId)
    .executeTakeFirst()

  if (!row) return 'cancel'
  if (row.status === 'abandoned' || row.status === 'completed' || row.status === 'failed') {
    return 'cancel'
  }
  if (row.control_state === 'cancel_requested' || row.status === 'cancelled') return 'cancel'
  if (row.control_state === 'pause_requested' || row.status === 'paused') return 'pause'
  return 'continue'
}

/**
 * Extended control check for steer-mode lanes. Checks pause/cancel first,
 * then looks for pending steering messages if the lane mode is 'steer'.
 * Returns a directive with the action and optional messages to inject.
 */
export async function getRunDispatchControlDirective(
  dispatchId: string
): Promise<RunControlDirective> {
  const db = getDb()
  const row = await db
    .selectFrom('run_dispatches')
    .select(['run_dispatches.status', 'run_dispatches.control_state', 'run_dispatches.queue_key'])
    .where('run_dispatches.id', '=', dispatchId)
    .executeTakeFirst()

  if (!row) return { action: 'cancel' }
  if (row.status === 'abandoned' || row.status === 'completed' || row.status === 'failed') {
    return { action: 'cancel' }
  }
  if (row.control_state === 'cancel_requested' || row.status === 'cancelled') {
    return { action: 'cancel' }
  }
  if (row.control_state === 'pause_requested' || row.status === 'paused') {
    return { action: 'pause' }
  }

  // Check lane mode — only steer mode checks for pending messages
  const lane = await db
    .selectFrom('queue_lanes')
    .select('mode')
    .where('queue_key', '=', row.queue_key)
    .executeTakeFirst()

  if ((lane?.mode ?? 'steer') !== 'steer') {
    return { action: 'continue' }
  }

  // Check for pending steering messages
  const pending = await db
    .selectFrom('queue_messages')
    .select(['id', 'text', 'sender_name'])
    .where('queue_key', '=', row.queue_key)
    .where('status', '=', 'pending')
    .orderBy('arrived_at', 'asc')
    .orderBy('id', 'asc')
    .execute()

  if (pending.length === 0) {
    return { action: 'continue' }
  }

  return {
    action: 'steer',
    messages: pending.map((m) => ({
      id: m.id,
      text: m.text,
      senderName: m.sender_name ?? 'Unknown',
    })),
  }
}

export async function setRunDispatchPaused(dispatchId: string): Promise<void> {
  const db = getDb()
  const ts = now()
  await db
    .updateTable('run_dispatches')
    .set({ status: 'paused', control_state: 'paused', control_updated_at: ts, updated_at: ts })
    .where('id', '=', dispatchId)
    .where('status', '=', 'running')
    .execute()
}

export async function setRunDispatchRunningFromPause(dispatchId: string): Promise<void> {
  const db = getDb()
  const ts = now()
  await db
    .updateTable('run_dispatches')
    .set({
      status: 'running',
      control_state: 'normal',
      control_reason: null,
      control_updated_at: ts,
      updated_at: ts,
    })
    .where('id', '=', dispatchId)
    .where('status', '=', 'paused')
    .execute()
}

export async function annotateRunDispatchDecision(
  dispatchId: string,
  reason: string
): Promise<void> {
  const db = getDb()
  const ts = now()
  await db
    .updateTable('run_dispatches')
    .set({
      control_reason: reason,
      control_updated_at: ts,
      updated_at: ts,
    })
    .where('id', '=', dispatchId)
    .where('status', 'in', ['running', 'paused'])
    .execute()
}

export async function requestPauseRunDispatchByJob(
  jobId: string,
  reason: string
): Promise<RunDispatch | null> {
  const db = getDb()
  const ts = now()
  const dispatch = await db
    .updateTable('run_dispatches')
    .set({
      control_state: 'pause_requested',
      control_reason: reason,
      control_updated_at: ts,
      updated_at: ts,
    })
    .where('job_id', '=', jobId)
    .where('status', 'in', ['running', 'paused'])
    .returningAll()
    .executeTakeFirst()

  return dispatch ?? null
}

export async function clearPauseRunDispatchByJob(jobId: string): Promise<RunDispatch | null> {
  const db = getDb()
  const ts = now()
  const dispatch = await db
    .updateTable('run_dispatches')
    .set({
      status: 'running',
      control_state: 'normal',
      control_reason: null,
      control_updated_at: ts,
      updated_at: ts,
    })
    .where('job_id', '=', jobId)
    .where('status', 'in', ['running', 'paused'])
    .returningAll()
    .executeTakeFirst()

  return dispatch ?? null
}

export async function requestCancelRunDispatchByJob(
  jobId: string,
  reason: string
): Promise<RunDispatch | null> {
  const db = getDb()
  const ts = now()
  const dispatch = await db
    .updateTable('run_dispatches')
    .set({
      control_state: 'cancel_requested',
      control_reason: reason,
      control_updated_at: ts,
      updated_at: ts,
    })
    .where('job_id', '=', jobId)
    .where('status', 'in', ['running', 'paused', 'queued'])
    .returningAll()
    .executeTakeFirst()

  return dispatch ?? null
}

export async function finalizeRunDispatch(
  dispatchId: string,
  result: {
    status: 'completed' | 'failed' | 'abandoned' | 'cancelled'
    error?: string | null
    expectedEpoch?: number
  }
): Promise<boolean> {
  const db = getDb()

  return db.transaction().execute(async (trx) => {
    const ts = now()
    const dispatch = await trx
      .selectFrom('run_dispatches')
      .selectAll()
      .where('id', '=', dispatchId)
      .executeTakeFirst()

    if (!dispatch) return false

    const currentEpoch = await getRuntimeEpoch(trx)
    const expectedEpoch = result.expectedEpoch ?? dispatch.claimed_epoch
    if (currentEpoch !== expectedEpoch) {
      return false
    }

    const updateResult = await trx
      .updateTable('run_dispatches')
      .set({
        status: result.status,
        control_state: result.status === 'cancelled' ? 'cancelled' : dispatch.control_state,
        last_error: result.error ?? null,
        lease_expires_at: null,
        finished_at: ts,
        updated_at: ts,
      })
      .where('id', '=', dispatchId)
      .where('status', 'in', ['running', 'paused'])
      .where('claimed_epoch', '=', expectedEpoch)
      .executeTakeFirst()

    if (Number(updateResult.numUpdatedRows ?? 0) === 0) {
      return false
    }

    const lane = await trx
      .selectFrom('queue_lanes')
      .selectAll()
      .where('queue_key', '=', dispatch.queue_key)
      .executeTakeFirst()

    if (!lane) return true

    const pending = await trx
      .selectFrom('queue_messages')
      .select((eb) => eb.fn.count<string>('id').as('count'))
      .where('queue_key', '=', dispatch.queue_key)
      .where('status', '=', 'pending')
      .executeTakeFirst()

    const pendingCount = Number(pending?.count ?? 0)
    const nextState = pendingCount > 0 ? 'queued' : 'idle'
    const nextDebounce =
      pendingCount > 0 ? ts + Math.max(1, Math.ceil((lane.debounce_ms ?? 2000) / 1000)) : null

    await trx
      .updateTable('queue_lanes')
      .set({
        state: nextState,
        active_dispatch_id: null,
        debounce_until: nextDebounce,
        updated_at: ts,
      })
      .where('queue_key', '=', dispatch.queue_key)
      .execute()

    return true
  })
}

/**
 * Reap dispatches whose leases have expired. Called on each worker tick
 * so that dead workers don't permanently block queue lanes.
 */
export async function reapExpiredLeases(): Promise<number> {
  const db = getDb()
  const ts = now()

  // Find running/paused dispatches with expired leases
  const stale = await db
    .selectFrom('run_dispatches')
    .select(['id', 'queue_key'])
    .where('status', 'in', ['running', 'paused'])
    .where('lease_expires_at', '<', ts)
    .execute()

  if (stale.length === 0) return 0

  // Mark them abandoned
  const result = await db
    .updateTable('run_dispatches')
    .set({
      status: 'abandoned',
      control_state: 'cancelled',
      last_error: 'Lease expired — worker presumed dead',
      finished_at: ts,
      lease_expires_at: null,
      updated_at: ts,
    })
    .where(
      'id',
      'in',
      stale.map((s) => s.id)
    )
    .where('status', 'in', ['running', 'paused'])
    .executeTakeFirst()

  const count = Number(result.numUpdatedRows ?? 0)
  if (count === 0) return 0

  // Reset affected queue lanes so they can be re-claimed.
  // Set to 'queued' if there are pending messages or queued dispatches, else 'idle'.
  const affectedKeys = Array.from(new Set(stale.map((s) => s.queue_key)))
  for (const queueKey of affectedKeys) {
    const hasWork = await db
      .selectFrom('queue_messages')
      .select('id')
      .where('queue_key', '=', queueKey)
      .where('status', '=', 'pending')
      .limit(1)
      .executeTakeFirst()

    const hasQueuedDispatch = await db
      .selectFrom('run_dispatches')
      .select('id')
      .where('queue_key', '=', queueKey)
      .where('status', '=', 'queued')
      .limit(1)
      .executeTakeFirst()

    const newState = hasWork || hasQueuedDispatch ? 'queued' : 'idle'
    await db
      .updateTable('queue_lanes')
      .set({
        state: newState,
        active_dispatch_id: null,
        updated_at: ts,
      })
      .where('queue_key', '=', queueKey)
      .where('state', 'in', ['running', 'queued'])
      .execute()
  }

  return count
}

export async function markStaleRunningDispatchesAbandoned(staleBefore: number): Promise<number> {
  const db = getDb()
  const ts = now()
  const result = await db
    .updateTable('run_dispatches')
    .set({
      status: 'abandoned',
      control_state: 'cancelled',
      last_error: 'Marked abandoned during startup/runtime recovery',
      finished_at: ts,
      lease_expires_at: null,
      updated_at: ts,
    })
    .where('status', 'in', ['running', 'paused'])
    .where((eb) =>
      eb.or([
        eb('lease_expires_at', '<', staleBefore),
        eb.and([eb('lease_expires_at', 'is', null), eb('started_at', '<', staleBefore)]),
      ])
    )
    .executeTakeFirst()

  return Number(result.numUpdatedRows ?? 0)
}

export async function markAllActiveDispatchesAbandoned(reason: string): Promise<number> {
  const db = getDb()
  const ts = now()
  const result = await db
    .updateTable('run_dispatches')
    .set({
      status: 'abandoned',
      control_state: 'cancelled',
      last_error: reason,
      finished_at: ts,
      lease_expires_at: null,
      updated_at: ts,
    })
    .where('status', 'in', ['running', 'paused'])
    .executeTakeFirst()
  return Number(result.numUpdatedRows ?? 0)
}

export interface ReplayResult {
  dispatch: RunDispatch
  alreadyQueued: boolean
}

export type ReplayMode = 'restart' | 'resume' | 'retry'

function replayControlReason(mode: ReplayMode): string {
  return mode === 'resume' ? 'resume_seed' : 'retry_replay'
}

export async function replayRunDispatch(
  dispatchId: string,
  actor: string,
  reason: string,
  mode: ReplayMode = 'restart'
): Promise<ReplayResult | null> {
  const db = getDb()
  const original = await findRunDispatchById(dispatchId)
  if (!original) return null
  const controlReason = replayControlReason(mode)
  const replayAction = mode === 'resume' ? 'Resume' : 'Restart'

  return db.transaction().execute(async (trx) => {
    // Idempotency: if an active replay of this dispatch already exists, return it
    const existing = await trx
      .selectFrom('run_dispatches')
      .selectAll()
      .where('replay_of_dispatch_id', '=', dispatchId)
      .where('control_reason', '=', controlReason)
      .where('status', 'in', ['queued', 'running', 'paused'])
      .executeTakeFirst()

    if (existing) {
      return { dispatch: existing, alreadyQueued: true }
    }

    const ts = now()
    const replayId = uuid()

    const inserted = await trx
      .insertInto('run_dispatches')
      .values({
        id: replayId,
        run_key: `${original.queue_key}:replay:${replayId}`,
        queue_key: original.queue_key,
        work_item_id: original.work_item_id,
        agent_id: original.agent_id,
        plugin_instance_id: original.plugin_instance_id,
        session_key: original.session_key,
        status: 'queued',
        control_state: 'normal',
        control_reason: controlReason,
        control_updated_at: null,
        input_text: original.input_text,
        coalesced_text: original.coalesced_text,
        sender_name: original.sender_name,
        response_context: original.response_context,
        job_id: null,
        attempt_count: 0,
        claimed_by: null,
        lease_expires_at: null,
        claimed_epoch: original.claimed_epoch,
        last_error: `${replayAction} requested by ${actor}: ${reason}`,
        replay_of_dispatch_id: original.id,
        merged_into_dispatch_id: null,
        scheduled_at: ts,
        started_at: null,
        finished_at: null,
        created_at: ts,
        updated_at: ts,
      })
      .returningAll()
      .executeTakeFirstOrThrow()

    await trx
      .updateTable('queue_lanes')
      .set({
        state: 'queued',
        debounce_until: ts,
        updated_at: ts,
      })
      .where('queue_key', '=', original.queue_key)
      .execute()

    return { dispatch: inserted, alreadyQueued: false }
  })
}
