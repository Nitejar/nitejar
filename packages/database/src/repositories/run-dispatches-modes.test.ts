import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'kysely'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { closeDb, getDb } from '../db'
import {
  claimNextRunDispatch,
  finalizeRunDispatch,
  getRunDispatchControlDirective,
} from './run-dispatches'

let testDir = ''
let db: ReturnType<typeof getDb>

function now(): number {
  return Math.floor(Date.now() / 1000)
}

async function createTestSchema(database: ReturnType<typeof getDb>): Promise<void> {
  await database.schema
    .createTable('runtime_control')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('processing_enabled', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('pause_mode', 'text', (col) => col.notNull().defaultTo('soft'))
    .addColumn('pause_reason', 'text')
    .addColumn('paused_by', 'text')
    .addColumn('paused_at', 'integer')
    .addColumn('control_epoch', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('max_concurrent_dispatches', 'integer')
    .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(0))
    .execute()

  await database.schema
    .createTable('queue_lanes')
    .ifNotExists()
    .addColumn('queue_key', 'text', (col) => col.primaryKey())
    .addColumn('session_key', 'text', (col) => col.notNull())
    .addColumn('agent_id', 'text', (col) => col.notNull())
    .addColumn('plugin_instance_id', 'text')
    .addColumn('state', 'text', (col) => col.notNull().defaultTo('queued'))
    .addColumn('mode', 'text', (col) => col.notNull().defaultTo('steer'))
    .addColumn('is_paused', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('debounce_until', 'integer')
    .addColumn('debounce_ms', 'integer', (col) => col.notNull().defaultTo(2000))
    .addColumn('max_queued', 'integer', (col) => col.notNull().defaultTo(10))
    .addColumn('active_dispatch_id', 'text')
    .addColumn('paused_reason', 'text')
    .addColumn('paused_by', 'text')
    .addColumn('paused_at', 'integer')
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(0))
    .execute()

  await database.schema
    .createTable('run_dispatches')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('run_key', 'text', (col) => col.notNull())
    .addColumn('queue_key', 'text', (col) => col.notNull())
    .addColumn('work_item_id', 'text', (col) => col.notNull())
    .addColumn('agent_id', 'text', (col) => col.notNull())
    .addColumn('plugin_instance_id', 'text')
    .addColumn('session_key', 'text', (col) => col.notNull())
    .addColumn('job_id', 'text')
    .addColumn('status', 'text', (col) => col.notNull())
    .addColumn('control_state', 'text', (col) => col.notNull().defaultTo('normal'))
    .addColumn('control_reason', 'text')
    .addColumn('control_updated_at', 'integer')
    .addColumn('input_text', 'text', (col) => col.notNull())
    .addColumn('coalesced_text', 'text')
    .addColumn('sender_name', 'text')
    .addColumn('response_context', 'text')
    .addColumn('attempt_count', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('claimed_by', 'text')
    .addColumn('lease_expires_at', 'integer')
    .addColumn('claimed_epoch', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('last_error', 'text')
    .addColumn('replay_of_dispatch_id', 'text')
    .addColumn('merged_into_dispatch_id', 'text')
    .addColumn('scheduled_at', 'integer', (col) => col.notNull())
    .addColumn('started_at', 'integer')
    .addColumn('finished_at', 'integer')
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('updated_at', 'integer', (col) => col.notNull())
    .execute()

  await database.schema
    .createTable('queue_messages')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('queue_key', 'text', (col) => col.notNull())
    .addColumn('work_item_id', 'text', (col) => col.notNull())
    .addColumn('plugin_instance_id', 'text')
    .addColumn('response_context', 'text')
    .addColumn('status', 'text', (col) => col.notNull())
    .addColumn('text', 'text', (col) => col.notNull())
    .addColumn('sender_name', 'text')
    .addColumn('arrived_at', 'integer', (col) => col.notNull())
    .addColumn('dispatch_id', 'text')
    .addColumn('drop_reason', 'text')
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(0))
    .execute()
}

async function clearTables(database: ReturnType<typeof getDb>): Promise<void> {
  await sql`delete from queue_messages`.execute(database)
  await sql`delete from run_dispatches`.execute(database)
  await sql`delete from queue_lanes`.execute(database)
  await sql`delete from runtime_control`.execute(database)
}

async function seedRuntimeControl(): Promise<void> {
  await db
    .insertInto('runtime_control')
    .values({
      id: 'default',
      processing_enabled: 1,
      pause_mode: 'soft',
      pause_reason: null,
      paused_by: null,
      paused_at: null,
      control_epoch: 1,
      max_concurrent_dispatches: 2,
      updated_at: now(),
    })
    .execute()
}

async function seedLane(input: {
  queueKey: string
  mode: 'collect' | 'followup'
  maxQueued: number
}) {
  const ts = now()
  await db
    .insertInto('queue_lanes')
    .values({
      queue_key: input.queueKey,
      session_key: `session:${input.queueKey}`,
      agent_id: 'agent-1',
      plugin_instance_id: 'pi-1',
      state: 'queued',
      mode: input.mode,
      is_paused: 0,
      debounce_until: ts - 5,
      debounce_ms: 1000,
      max_queued: input.maxQueued,
      active_dispatch_id: null,
      paused_reason: null,
      paused_by: null,
      paused_at: null,
      created_at: ts,
      updated_at: ts,
    })
    .execute()
}

async function seedPendingMessages(queueKey: string, count: number): Promise<void> {
  const ts = now()
  const rows = Array.from({ length: count }, (_, index) => {
    const idx = index + 1
    return {
      id: `msg-${idx}`,
      queue_key: queueKey,
      work_item_id: `wi-${idx}`,
      plugin_instance_id: 'pi-1',
      response_context: null,
      status: 'pending',
      text: `message ${idx}`,
      sender_name: `sender-${idx}`,
      arrived_at: ts + index,
      dispatch_id: null,
      drop_reason: null,
      created_at: ts,
    }
  })
  await db.insertInto('queue_messages').values(rows).execute()
}

describe('run-dispatch queue modes', () => {
  beforeAll(async () => {
    await closeDb()
    testDir = mkdtempSync(join(tmpdir(), 'nitejar-run-dispatch-modes-'))
    process.env.DATABASE_URL = join(testDir, 'test.sqlite')
    db = getDb()
    await createTestSchema(db)
  })

  afterAll(async () => {
    await closeDb()
    delete process.env.DATABASE_URL
    if (testDir) rmSync(testDir, { recursive: true, force: true })
  })

  beforeEach(async () => {
    await clearTables(db)
    await seedRuntimeControl()
  })

  it('collect mode claims up to max_queued, coalesces text, and does not steer mid-run', async () => {
    await seedLane({ queueKey: 'q-collect', mode: 'collect', maxQueued: 2 })
    await seedPendingMessages('q-collect', 3)

    const claimed = await claimNextRunDispatch('worker-1', { leaseSeconds: 120 })
    expect(claimed).not.toBeNull()
    expect(claimed!.messages.map((message) => message.id)).toEqual(['msg-1', 'msg-2'])
    expect(claimed!.dispatch.coalesced_text).toContain(
      '[2 messages arrived while you were working]'
    )
    expect(claimed!.dispatch.coalesced_text).toContain('message 1')
    expect(claimed!.dispatch.coalesced_text).toContain('message 2')
    expect(claimed!.dispatch.input_text).toBe('message 2')

    const statuses = await db
      .selectFrom('queue_messages')
      .select(['id', 'status'])
      .orderBy('id', 'asc')
      .execute()
    expect(statuses).toEqual([
      { id: 'msg-1', status: 'included' },
      { id: 'msg-2', status: 'included' },
      { id: 'msg-3', status: 'pending' },
    ])

    const directive = await getRunDispatchControlDirective(claimed!.dispatch.id)
    expect(directive).toEqual({ action: 'continue' })
  })

  it('followup mode claims exactly one message per dispatch and leaves coalesced_text null', async () => {
    await seedLane({ queueKey: 'q-followup', mode: 'followup', maxQueued: 10 })
    await seedPendingMessages('q-followup', 2)

    const claimed = await claimNextRunDispatch('worker-1', { leaseSeconds: 120 })
    expect(claimed).not.toBeNull()
    expect(claimed!.messages.map((message) => message.id)).toEqual(['msg-1'])
    expect(claimed!.dispatch.input_text).toBe('message 1')
    expect(claimed!.dispatch.coalesced_text).toBeNull()

    const statuses = await db
      .selectFrom('queue_messages')
      .select(['id', 'status'])
      .orderBy('id', 'asc')
      .execute()
    expect(statuses).toEqual([
      { id: 'msg-1', status: 'included' },
      { id: 'msg-2', status: 'pending' },
    ])
  })

  it('finalize sets lane queued when pending messages remain and allows a follow-up claim', async () => {
    await seedLane({ queueKey: 'q-reclaim', mode: 'followup', maxQueued: 10 })
    await seedPendingMessages('q-reclaim', 2)

    const firstClaim = await claimNextRunDispatch('worker-1', { leaseSeconds: 120 })
    expect(firstClaim).not.toBeNull()

    const finalized = await finalizeRunDispatch(firstClaim!.dispatch.id, {
      status: 'completed',
      expectedEpoch: 1,
    })
    expect(finalized).toBe(true)

    const laneAfterFirstFinalize = await db
      .selectFrom('queue_lanes')
      .select(['state', 'active_dispatch_id'])
      .where('queue_key', '=', 'q-reclaim')
      .executeTakeFirst()
    expect(laneAfterFirstFinalize).toEqual({ state: 'queued', active_dispatch_id: null })

    // finalizeRunDispatch re-arms debounce for queued lanes; simulate the debounce window elapsing.
    await db
      .updateTable('queue_lanes')
      .set({ debounce_until: now() - 1 })
      .where('queue_key', '=', 'q-reclaim')
      .execute()

    const secondClaim = await claimNextRunDispatch('worker-2', { leaseSeconds: 120 })
    expect(secondClaim).not.toBeNull()
    expect(secondClaim!.messages.map((message) => message.id)).toEqual(['msg-2'])
  })

  it('finalize sets lane idle when no pending messages remain', async () => {
    await seedLane({ queueKey: 'q-idle', mode: 'collect', maxQueued: 10 })
    await seedPendingMessages('q-idle', 1)

    const claim = await claimNextRunDispatch('worker-1', { leaseSeconds: 120 })
    expect(claim).not.toBeNull()

    const finalized = await finalizeRunDispatch(claim!.dispatch.id, {
      status: 'completed',
      expectedEpoch: 1,
    })
    expect(finalized).toBe(true)

    const laneAfterFinalize = await db
      .selectFrom('queue_lanes')
      .select(['state', 'active_dispatch_id', 'debounce_until'])
      .where('queue_key', '=', 'q-idle')
      .executeTakeFirst()
    expect(laneAfterFinalize).toEqual({
      state: 'idle',
      active_dispatch_id: null,
      debounce_until: null,
    })
  })
})
