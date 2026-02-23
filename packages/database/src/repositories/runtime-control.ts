import { getDb } from '../db'
import type { RuntimeControl } from '../types'

const CONTROL_ID = 'default'

function now(): number {
  return Math.floor(Date.now() / 1000)
}

export async function getRuntimeControl(): Promise<RuntimeControl> {
  const db = getDb()
  await db
    .insertInto('runtime_control')
    .values({
      id: CONTROL_ID,
      processing_enabled: 1,
      pause_mode: 'soft',
      pause_reason: null,
      paused_by: null,
      paused_at: null,
      control_epoch: 0,
      max_concurrent_dispatches: 20,
      updated_at: now(),
    })
    .onConflict((oc) => oc.column('id').doNothing())
    .execute()

  const control = await db
    .selectFrom('runtime_control')
    .selectAll()
    .where('id', '=', CONTROL_ID)
    .executeTakeFirst()

  if (!control) {
    throw new Error('Failed to initialize runtime control row.')
  }
  return control
}

export async function setRuntimeProcessingEnabled(input: {
  enabled: boolean
  mode: 'soft' | 'hard'
  reason?: string | null
  actor?: string | null
}): Promise<RuntimeControl> {
  const db = getDb()
  const ts = now()
  await getRuntimeControl()

  return db
    .updateTable('runtime_control')
    .set({
      processing_enabled: input.enabled ? 1 : 0,
      pause_mode: input.mode,
      pause_reason: input.reason ?? null,
      paused_by: input.enabled ? null : (input.actor ?? null),
      paused_at: input.enabled ? null : ts,
      updated_at: ts,
    })
    .where('id', '=', CONTROL_ID)
    .returningAll()
    .executeTakeFirstOrThrow()
}

export async function incrementRuntimeControlEpoch(): Promise<RuntimeControl> {
  const db = getDb()
  const ts = now()
  const control = await getRuntimeControl()

  return db
    .updateTable('runtime_control')
    .set({
      control_epoch: control.control_epoch + 1,
      updated_at: ts,
    })
    .where('id', '=', CONTROL_ID)
    .returningAll()
    .executeTakeFirstOrThrow()
}

export async function setMaxConcurrentDispatches(value: number): Promise<RuntimeControl> {
  const db = getDb()
  const ts = now()
  await getRuntimeControl()

  return db
    .updateTable('runtime_control')
    .set({
      max_concurrent_dispatches: Math.max(1, Math.min(value, 100)),
      updated_at: ts,
    })
    .where('id', '=', CONTROL_ID)
    .returningAll()
    .executeTakeFirstOrThrow()
}

export interface RuntimeControlStats {
  runningDispatches: number
  queuedDispatches: number
  pausedDispatches: number
  unknownEffects: number
  pendingEffects: number
}

export async function getRuntimeControlStats(): Promise<RuntimeControlStats> {
  const db = getDb()
  const [dispatchStats, effectStats] = await Promise.all([
    db
      .selectFrom('run_dispatches')
      .select([
        (eb) =>
          eb.fn
            .sum<number>(eb.case().when('status', '=', 'running').then(1).else(0).end())
            .as('running'),
        (eb) =>
          eb.fn
            .sum<number>(eb.case().when('status', '=', 'queued').then(1).else(0).end())
            .as('queued'),
        (eb) =>
          eb.fn
            .sum<number>(eb.case().when('status', '=', 'paused').then(1).else(0).end())
            .as('paused'),
      ])
      .executeTakeFirst(),
    db
      .selectFrom('effect_outbox')
      .select([
        (eb) =>
          eb.fn
            .sum<number>(eb.case().when('status', '=', 'unknown').then(1).else(0).end())
            .as('unknown_count'),
        (eb) =>
          eb.fn
            .sum<number>(eb.case().when('status', '=', 'pending').then(1).else(0).end())
            .as('pending_count'),
      ])
      .executeTakeFirst(),
  ])

  return {
    runningDispatches: Number(dispatchStats?.running ?? 0),
    queuedDispatches: Number(dispatchStats?.queued ?? 0),
    pausedDispatches: Number(dispatchStats?.paused ?? 0),
    unknownEffects: Number(effectStats?.unknown_count ?? 0),
    pendingEffects: Number(effectStats?.pending_count ?? 0),
  }
}
