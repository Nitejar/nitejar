import { getDb } from '../db'
import type { EffectOutbox, NewEffectOutbox } from '../types'
import { generateUuidV7 } from '@nitejar/core'

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function uuid(): string {
  return generateUuidV7()
}

async function getRuntimeEpoch(trx: ReturnType<typeof getDb>): Promise<number> {
  const control = await trx
    .selectFrom('runtime_control')
    .select('control_epoch')
    .where('id', '=', 'default')
    .executeTakeFirst()
  return control?.control_epoch ?? 0
}

export async function createEffectOutbox(
  data: Omit<NewEffectOutbox, 'id' | 'created_at' | 'updated_at'>
): Promise<EffectOutbox> {
  const db = getDb()
  const ts = now()
  return db
    .insertInto('effect_outbox')
    .values({
      id: uuid(),
      ...data,
      created_at: ts,
      updated_at: ts,
    })
    .returningAll()
    .executeTakeFirstOrThrow()
}

export async function listEffectOutboxByWorkItem(workItemId: string): Promise<EffectOutbox[]> {
  const db = getDb()
  return db
    .selectFrom('effect_outbox')
    .selectAll()
    .where('work_item_id', '=', workItemId)
    .orderBy('created_at', 'desc')
    .execute()
}

export async function claimNextEffectOutbox(
  workerId: string,
  opts?: { leaseSeconds?: number }
): Promise<EffectOutbox | null> {
  const db = getDb()
  const leaseSeconds = opts?.leaseSeconds ?? 120
  const ts = now()

  const claimed = await db.transaction().execute(async (trx) => {
    const epoch = await getRuntimeEpoch(trx)
    const candidate = await trx
      .selectFrom('effect_outbox')
      .selectAll()
      .where((eb) =>
        eb.or([
          eb('status', '=', 'pending'),
          eb.and([
            eb('status', '=', 'failed'),
            eb('retryable', '=', 1),
            eb('next_attempt_at', 'is not', null),
            eb('next_attempt_at', '<=', ts),
          ]),
        ])
      )
      .orderBy('created_at', 'asc')
      .limit(1)
      .executeTakeFirst()

    if (!candidate) return null

    const result = await trx
      .updateTable('effect_outbox')
      .set({
        status: 'sending',
        claimed_by: workerId,
        lease_expires_at: ts + leaseSeconds,
        attempt_count: candidate.attempt_count + 1,
        claimed_epoch: epoch,
        updated_at: ts,
      })
      .where('id', '=', candidate.id)
      .where('status', '=', candidate.status)
      .executeTakeFirst()

    if (Number(result.numUpdatedRows ?? 0) === 0) {
      return null
    }

    const row = await trx
      .selectFrom('effect_outbox')
      .selectAll()
      .where('id', '=', candidate.id)
      .executeTakeFirst()
    return row ?? null
  })
  return claimed ?? null
}

export async function markEffectOutboxSent(
  id: string,
  providerRef?: string | null,
  opts?: { expectedEpoch?: number }
): Promise<EffectOutbox | null> {
  const db = getDb()
  const ts = now()
  return db.transaction().execute(async (trx) => {
    if (opts?.expectedEpoch != null) {
      const epoch = await getRuntimeEpoch(trx)
      if (epoch !== opts.expectedEpoch) return null
    }

    let query = trx
      .updateTable('effect_outbox')
      .set({
        status: 'sent',
        provider_ref: providerRef ?? null,
        lease_expires_at: null,
        sent_at: ts,
        updated_at: ts,
      })
      .where('id', '=', id)
      .where('status', '=', 'sending')

    if (opts?.expectedEpoch != null) {
      query = query.where('claimed_epoch', '=', opts.expectedEpoch)
    }

    const row = await query.returningAll().executeTakeFirst()
    return row ?? null
  })
}

export async function markEffectOutboxFailed(
  id: string,
  errorText: string,
  opts?: { retryable?: boolean; nextAttemptAt?: number | null; expectedEpoch?: number }
): Promise<EffectOutbox | null> {
  const db = getDb()
  const ts = now()

  return db.transaction().execute(async (trx) => {
    if (opts?.expectedEpoch != null) {
      const epoch = await getRuntimeEpoch(trx)
      if (epoch !== opts.expectedEpoch) return null
    }

    let query = trx
      .updateTable('effect_outbox')
      .set({
        status: 'failed',
        retryable: opts?.retryable ? 1 : 0,
        next_attempt_at: opts?.nextAttemptAt ?? null,
        lease_expires_at: null,
        last_error: errorText,
        updated_at: ts,
      })
      .where('id', '=', id)
      .where('status', '=', 'sending')

    if (opts?.expectedEpoch != null) {
      query = query.where('claimed_epoch', '=', opts.expectedEpoch)
    }

    const row = await query.returningAll().executeTakeFirst()
    return row ?? null
  })
}

export async function markEffectOutboxUnknown(
  id: string,
  reason: string,
  opts?: { expectedEpoch?: number }
): Promise<EffectOutbox | null> {
  const db = getDb()
  const ts = now()

  return db.transaction().execute(async (trx) => {
    if (opts?.expectedEpoch != null) {
      const epoch = await getRuntimeEpoch(trx)
      if (epoch !== opts.expectedEpoch) return null
    }

    let query = trx
      .updateTable('effect_outbox')
      .set({
        status: 'unknown',
        unknown_reason: reason,
        lease_expires_at: null,
        updated_at: ts,
      })
      .where('id', '=', id)
      .where('status', '=', 'sending')

    if (opts?.expectedEpoch != null) {
      query = query.where('claimed_epoch', '=', opts.expectedEpoch)
    }

    const row = await query.returningAll().executeTakeFirst()
    return row ?? null
  })
}

export async function releaseUnknownEffectOutbox(
  id: string,
  actor: string
): Promise<EffectOutbox | null> {
  const db = getDb()
  const ts = now()

  return db
    .updateTable('effect_outbox')
    .set({
      status: 'pending',
      released_by: actor,
      released_at: ts,
      unknown_reason: null,
      next_attempt_at: null,
      updated_at: ts,
    })
    .where('id', '=', id)
    .where('status', '=', 'unknown')
    .returningAll()
    .executeTakeFirst()
    .then((row) => row ?? null)
}

export async function retryFailedEffectOutbox(
  id: string,
  actor: string
): Promise<EffectOutbox | null> {
  const db = getDb()
  const ts = now()
  return db
    .updateTable('effect_outbox')
    .set({
      status: 'pending',
      next_attempt_at: null,
      released_by: actor,
      released_at: ts,
      updated_at: ts,
    })
    .where('id', '=', id)
    .where('status', '=', 'failed')
    .returningAll()
    .executeTakeFirst()
    .then((row) => row ?? null)
}

export async function cancelPendingEffectsByDispatch(
  dispatchId: string,
  reason: string
): Promise<number> {
  const db = getDb()
  const ts = now()
  const result = await db
    .updateTable('effect_outbox')
    .set({
      status: 'cancelled',
      last_error: reason,
      lease_expires_at: null,
      updated_at: ts,
    })
    .where('dispatch_id', '=', dispatchId)
    .where('status', 'in', ['pending', 'failed'])
    .executeTakeFirst()

  return Number(result.numUpdatedRows ?? 0)
}

export async function cancelEffectOutbox(id: string, reason: string): Promise<EffectOutbox | null> {
  const db = getDb()
  const ts = now()
  return db
    .updateTable('effect_outbox')
    .set({
      status: 'cancelled',
      last_error: reason,
      lease_expires_at: null,
      updated_at: ts,
    })
    .where('id', '=', id)
    .where('status', 'in', ['pending', 'failed', 'unknown'])
    .returningAll()
    .executeTakeFirst()
    .then((row) => row ?? null)
}

export async function markStaleSendingEffectsUnknown(staleBefore: number): Promise<number> {
  const db = getDb()
  const ts = now()
  const result = await db
    .updateTable('effect_outbox')
    .set({
      status: 'unknown',
      unknown_reason: 'Marked unknown during startup/runtime recovery',
      lease_expires_at: null,
      updated_at: ts,
    })
    .where('status', '=', 'sending')
    .where((eb) =>
      eb.or([
        eb('lease_expires_at', '<', staleBefore),
        eb.and([eb('lease_expires_at', 'is', null), eb('updated_at', '<', staleBefore)]),
      ])
    )
    .executeTakeFirst()

  return Number(result.numUpdatedRows ?? 0)
}

export async function markAllSendingEffectsUnknown(reason: string): Promise<number> {
  const db = getDb()
  const ts = now()
  const result = await db
    .updateTable('effect_outbox')
    .set({
      status: 'unknown',
      unknown_reason: reason,
      lease_expires_at: null,
      updated_at: ts,
    })
    .where('status', '=', 'sending')
    .executeTakeFirst()
  return Number(result.numUpdatedRows ?? 0)
}

export async function findEffectOutboxById(id: string): Promise<EffectOutbox | null> {
  const db = getDb()
  const row = await db
    .selectFrom('effect_outbox')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst()
  return row ?? null
}
