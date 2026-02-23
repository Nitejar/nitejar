import type { Kysely } from 'kysely'
import { getDb } from '../db'
import {
  type Database,
  type NewRoutine,
  type NewRoutineEventQueueItem,
  type NewRoutineRun,
  type Routine,
  type RoutineEventQueueItem,
  type RoutineRun,
  type RoutineUpdate,
  type RoutineRunUpdate,
  type ScheduledItem,
} from '../types'
import { generateUuidV7 } from '@nitejar/core'
import { createScheduledItem } from './scheduled-items'

export type RoutineTriggerKind = 'cron' | 'event' | 'condition' | 'oneshot'
export type RoutineRunOrigin = 'cron' | 'event' | 'condition' | 'manual' | 'oneshot'
export type RoutineRunDecision = 'enqueued' | 'skipped' | 'throttled' | 'error'

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function uuid(): string {
  return generateUuidV7()
}

export async function createRoutine(
  data: Omit<NewRoutine, 'id' | 'created_at' | 'updated_at'>,
  trx?: Kysely<Database>
): Promise<Routine> {
  const db = trx ?? getDb()
  const ts = now()

  return db
    .insertInto('routines')
    .values({
      id: uuid(),
      ...data,
      created_at: ts,
      updated_at: ts,
    })
    .returningAll()
    .executeTakeFirstOrThrow()
}

export async function findRoutineById(id: string): Promise<Routine | null> {
  const db = getDb()
  const row = await db.selectFrom('routines').selectAll().where('id', '=', id).executeTakeFirst()
  return row ?? null
}

export async function listRoutines(opts?: {
  agentId?: string
  enabled?: boolean
  triggerKind?: RoutineTriggerKind
  includeArchived?: boolean
  limit?: number
}): Promise<Routine[]> {
  const db = getDb()
  let query = db.selectFrom('routines').selectAll()

  if (opts?.agentId) {
    query = query.where('agent_id', '=', opts.agentId)
  }
  if (opts?.enabled !== undefined) {
    query = query.where('enabled', '=', opts.enabled ? 1 : 0)
  }
  if (opts?.triggerKind) {
    query = query.where('trigger_kind', '=', opts.triggerKind)
  }
  if (!opts?.includeArchived) {
    query = query.where('archived_at', 'is', null)
  }

  query = query.orderBy('created_at', 'desc')

  if (opts?.limit) {
    query = query.limit(opts.limit)
  }

  return query.execute()
}

export async function listEnabledEventRoutines(): Promise<Routine[]> {
  const db = getDb()
  return db
    .selectFrom('routines')
    .selectAll()
    .where('trigger_kind', '=', 'event')
    .where('enabled', '=', 1)
    .where('archived_at', 'is', null)
    .orderBy('created_at', 'asc')
    .execute()
}

export async function listDueRoutines(
  beforeTimestamp: number,
  opts?: { limit?: number; kinds?: RoutineTriggerKind[] }
): Promise<Routine[]> {
  const db = getDb()
  const kinds = opts?.kinds ?? ['cron', 'condition', 'oneshot']

  return db
    .selectFrom('routines')
    .selectAll()
    .where('enabled', '=', 1)
    .where('archived_at', 'is', null)
    .where('trigger_kind', 'in', kinds)
    .where('next_run_at', 'is not', null)
    .where('next_run_at', '<=', beforeTimestamp)
    .orderBy('next_run_at', 'asc')
    .limit(opts?.limit ?? 100)
    .execute()
}

export async function updateRoutine(
  id: string,
  data: Omit<RoutineUpdate, 'id' | 'created_at'>,
  trx?: Kysely<Database>
): Promise<Routine | null> {
  const db = trx ?? getDb()
  const row = await db
    .updateTable('routines')
    .set({
      ...data,
      updated_at: now(),
    })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirst()

  return row ?? null
}

export async function setRoutineEnabled(
  id: string,
  enabled: boolean,
  trx?: Kysely<Database>
): Promise<Routine | null> {
  return updateRoutine(id, { enabled: enabled ? 1 : 0 }, trx)
}

export async function archiveRoutine(id: string, trx?: Kysely<Database>): Promise<Routine | null> {
  return updateRoutine(id, { archived_at: now(), enabled: 0 }, trx)
}

export async function createRoutineRun(
  data: Omit<NewRoutineRun, 'id' | 'created_at'>,
  trx?: Kysely<Database>
): Promise<RoutineRun> {
  const db = trx ?? getDb()
  return db
    .insertInto('routine_runs')
    .values({
      id: uuid(),
      ...data,
      created_at: now(),
    })
    .returningAll()
    .executeTakeFirstOrThrow()
}

export async function findRoutineRunById(id: string): Promise<RoutineRun | null> {
  const db = getDb()
  const row = await db
    .selectFrom('routine_runs')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst()
  return row ?? null
}

export async function findRoutineRunByTrigger(
  routineId: string,
  triggerOrigin: RoutineRunOrigin,
  triggerRef: string
): Promise<RoutineRun | null> {
  const db = getDb()
  const row = await db
    .selectFrom('routine_runs')
    .selectAll()
    .where('routine_id', '=', routineId)
    .where('trigger_origin', '=', triggerOrigin)
    .where('trigger_ref', '=', triggerRef)
    .orderBy('created_at', 'desc')
    .executeTakeFirst()
  return row ?? null
}

export async function updateRoutineRun(
  id: string,
  data: Omit<RoutineRunUpdate, 'id' | 'created_at'>,
  trx?: Kysely<Database>
): Promise<RoutineRun | null> {
  const db = trx ?? getDb()
  const row = await db
    .updateTable('routine_runs')
    .set(data)
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirst()

  return row ?? null
}

export async function linkRoutineRunToScheduledItem(
  routineRunId: string,
  scheduledItemId: string,
  trx?: Kysely<Database>
): Promise<RoutineRun | null> {
  return updateRoutineRun(routineRunId, { scheduled_item_id: scheduledItemId }, trx)
}

export async function linkRoutineRunToWorkItem(
  routineRunId: string,
  workItemId: string,
  trx?: Kysely<Database>
): Promise<RoutineRun | null> {
  return updateRoutineRun(routineRunId, { work_item_id: workItemId }, trx)
}

export async function linkRoutineRunToWorkItemByScheduledItem(
  scheduledItemId: string,
  workItemId: string,
  trx?: Kysely<Database>
): Promise<RoutineRun | null> {
  const db = trx ?? getDb()
  const row = await db
    .updateTable('routine_runs')
    .set({ work_item_id: workItemId })
    .where('scheduled_item_id', '=', scheduledItemId)
    .returningAll()
    .executeTakeFirst()

  return row ?? null
}

export async function listRoutineRunsByRoutine(
  routineId: string,
  opts?: { limit?: number; offset?: number }
): Promise<RoutineRun[]> {
  const db = getDb()
  let query = db
    .selectFrom('routine_runs')
    .selectAll()
    .where('routine_id', '=', routineId)
    .orderBy('evaluated_at', 'desc')

  if (opts?.offset) {
    query = query.offset(opts.offset)
  }
  if (opts?.limit) {
    query = query.limit(opts.limit)
  }

  return query.execute()
}

async function enqueueRoutineRunInTransaction(
  trx: Kysely<Database>,
  input: {
    routine: Routine
    triggerOrigin: RoutineRunOrigin
    triggerRef?: string | null
    envelopeJson?: string | null
    decisionReason?: string | null
    runAt: number
  }
): Promise<{ run: RoutineRun; scheduledItem: ScheduledItem }> {
  const evaluatedAt = now()

  const run = await createRoutineRun(
    {
      routine_id: input.routine.id,
      trigger_origin: input.triggerOrigin,
      trigger_ref: input.triggerRef ?? null,
      envelope_json: input.envelopeJson ?? null,
      decision: 'enqueued',
      decision_reason: input.decisionReason ?? null,
      scheduled_item_id: null,
      work_item_id: null,
      evaluated_at: evaluatedAt,
    },
    trx
  )

  const scheduledItem = await createScheduledItem(
    {
      agent_id: input.routine.agent_id,
      session_key: input.routine.target_session_key,
      type: input.routine.trigger_kind === 'oneshot' ? 'deferred' : 'routine',
      payload: input.routine.action_prompt,
      run_at: input.runAt,
      recurrence: null,
      status: 'pending',
      source_ref: `routine:${input.routine.id}:run:${run.id}`,
      plugin_instance_id: input.routine.target_plugin_instance_id,
      response_context: input.routine.target_response_context,
      routine_id: input.routine.id,
      routine_run_id: run.id,
      fired_at: null,
      cancelled_at: null,
    },
    trx
  )

  const updatedRun = await linkRoutineRunToScheduledItem(run.id, scheduledItem.id, trx)
  return { run: updatedRun ?? run, scheduledItem }
}

export async function enqueueRoutineRun(input: {
  routine: Routine
  triggerOrigin: RoutineRunOrigin
  triggerRef?: string | null
  envelopeJson?: string | null
  decisionReason?: string | null
  runAt: number
  trx?: Kysely<Database>
}): Promise<{ run: RoutineRun; scheduledItem: ScheduledItem }> {
  if (input.trx) {
    return enqueueRoutineRunInTransaction(input.trx, input)
  }

  const db = getDb()
  return db.transaction().execute(async (trx) => enqueueRoutineRunInTransaction(trx, input))
}

export async function createOneShotRoutineSchedule(input: {
  agentId: string
  name: string
  description?: string | null
  actionPrompt: string
  runAt: number
  sourceRef?: string | null
  targetPluginInstanceId: string
  targetSessionKey: string
  targetResponseContext?: string | null
  createdByKind: 'agent' | 'admin' | 'system'
  createdByRef?: string | null
}): Promise<{ routine: Routine; run: RoutineRun; scheduledItem: ScheduledItem }> {
  const db = getDb()

  return db.transaction().execute(async (trx) => {
    const routine = await createRoutine(
      {
        agent_id: input.agentId,
        name: input.name,
        description: input.description ?? null,
        enabled: 1,
        trigger_kind: 'oneshot',
        cron_expr: null,
        timezone: null,
        rule_json: '{}',
        condition_probe: null,
        condition_config: null,
        target_plugin_instance_id: input.targetPluginInstanceId,
        target_session_key: input.targetSessionKey,
        target_response_context: input.targetResponseContext ?? null,
        action_prompt: input.actionPrompt,
        next_run_at: input.runAt,
        last_evaluated_at: now(),
        last_fired_at: null,
        last_status: 'enqueued',
        created_by_kind: input.createdByKind,
        created_by_ref: input.createdByRef ?? null,
        archived_at: null,
      },
      trx
    )

    const { run, scheduledItem } = await enqueueRoutineRun({
      routine,
      triggerOrigin: 'oneshot',
      triggerRef: input.sourceRef ?? null,
      runAt: input.runAt,
      trx,
    })

    return { routine, run, scheduledItem }
  })
}

export async function enqueueRoutineEvent(input: {
  eventKey: string
  envelopeJson: string
  trx?: Kysely<Database>
}): Promise<RoutineEventQueueItem | null> {
  const db = input.trx ?? getDb()
  const ts = now()

  const inserted = await db
    .insertInto('routine_event_queue')
    .values({
      id: uuid(),
      event_key: input.eventKey,
      envelope_json: input.envelopeJson,
      status: 'pending',
      attempt_count: 0,
      last_error: null,
      lease_expires_at: null,
      claimed_by: null,
      created_at: ts,
      updated_at: ts,
    } satisfies Omit<NewRoutineEventQueueItem, 'id'> & { id: string })
    .onConflict((oc) => oc.column('event_key').doNothing())
    .returningAll()
    .executeTakeFirst()

  if (inserted) {
    return inserted
  }

  const existing = await db
    .selectFrom('routine_event_queue')
    .selectAll()
    .where('event_key', '=', input.eventKey)
    .executeTakeFirst()

  return existing ?? null
}

export async function claimNextRoutineEvent(
  workerId: string,
  opts?: { leaseSeconds?: number }
): Promise<RoutineEventQueueItem | null> {
  const db = getDb()
  const leaseSeconds = opts?.leaseSeconds ?? 120
  const ts = now()

  const claimed = await db.transaction().execute(async (trx) => {
    const candidate = await trx
      .selectFrom('routine_event_queue')
      .selectAll()
      .where((eb) =>
        eb.or([
          eb('status', '=', 'pending'),
          eb.and([
            eb('status', '=', 'processing'),
            eb('lease_expires_at', 'is not', null),
            eb('lease_expires_at', '<=', ts),
          ]),
        ])
      )
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .limit(1)
      .executeTakeFirst()

    if (!candidate) return null

    const updated = await trx
      .updateTable('routine_event_queue')
      .set({
        status: 'processing',
        attempt_count: candidate.attempt_count + 1,
        lease_expires_at: ts + leaseSeconds,
        claimed_by: workerId,
        updated_at: ts,
      })
      .where('id', '=', candidate.id)
      .where('status', '=', candidate.status)
      .executeTakeFirst()

    if (Number(updated.numUpdatedRows ?? 0) === 0) {
      return null
    }

    const row = await trx
      .selectFrom('routine_event_queue')
      .selectAll()
      .where('id', '=', candidate.id)
      .executeTakeFirst()

    return row ?? null
  })

  return claimed ?? null
}

export async function markRoutineEventDone(id: string): Promise<RoutineEventQueueItem | null> {
  const db = getDb()
  const row = await db
    .updateTable('routine_event_queue')
    .set({
      status: 'done',
      lease_expires_at: null,
      claimed_by: null,
      updated_at: now(),
    })
    .where('id', '=', id)
    .where('status', '=', 'processing')
    .returningAll()
    .executeTakeFirst()

  return row ?? null
}

export async function markRoutineEventFailed(
  id: string,
  errorText: string,
  opts?: { retryable?: boolean }
): Promise<RoutineEventQueueItem | null> {
  const db = getDb()
  const retryable = opts?.retryable === true

  const row = await db
    .updateTable('routine_event_queue')
    .set({
      status: retryable ? 'pending' : 'failed',
      last_error: errorText,
      lease_expires_at: null,
      claimed_by: null,
      updated_at: now(),
    })
    .where('id', '=', id)
    .where('status', '=', 'processing')
    .returningAll()
    .executeTakeFirst()

  return row ?? null
}

export async function findRoutineEventByKey(
  eventKey: string
): Promise<RoutineEventQueueItem | null> {
  const db = getDb()
  const row = await db
    .selectFrom('routine_event_queue')
    .selectAll()
    .where('event_key', '=', eventKey)
    .executeTakeFirst()
  return row ?? null
}
