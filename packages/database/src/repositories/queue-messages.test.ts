import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { closeDb, getDb } from '../db'
import { consumeSteeringMessagesByIds, dropPendingQueueMessagesByIds } from './queue-messages'

let testDir = ''
let db: ReturnType<typeof getDb>

function now(): number {
  return Math.floor(Date.now() / 1000)
}

async function createTestSchema(database: ReturnType<typeof getDb>): Promise<void> {
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

async function seedMessages(): Promise<void> {
  const ts = now()
  await db
    .insertInto('queue_messages')
    .values([
      {
        id: 'qm-1',
        queue_key: 'q-1',
        work_item_id: 'w-1',
        plugin_instance_id: null,
        response_context: null,
        status: 'pending',
        text: 'first',
        sender_name: 'Alice',
        arrived_at: ts,
        dispatch_id: null,
        drop_reason: null,
        created_at: ts,
      },
      {
        id: 'qm-2',
        queue_key: 'q-1',
        work_item_id: 'w-2',
        plugin_instance_id: null,
        response_context: null,
        status: 'pending',
        text: 'second',
        sender_name: 'Bob',
        arrived_at: ts + 1,
        dispatch_id: null,
        drop_reason: null,
        created_at: ts,
      },
      {
        id: 'qm-3',
        queue_key: 'q-1',
        work_item_id: 'w-3',
        plugin_instance_id: null,
        response_context: null,
        status: 'included',
        text: 'already included',
        sender_name: 'Carol',
        arrived_at: ts + 2,
        dispatch_id: 'd-old',
        drop_reason: null,
        created_at: ts,
      },
    ])
    .execute()
}

async function clearTable(): Promise<void> {
  await db.deleteFrom('queue_messages').execute()
}

describe('queue-messages targeted steering operations', () => {
  beforeAll(async () => {
    await closeDb()
    testDir = mkdtempSync(join(tmpdir(), 'nitejar-queue-msgs-'))
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
    await clearTable()
    await seedMessages()
  })

  it('drops only targeted pending messages by ID', async () => {
    const dropped = await dropPendingQueueMessagesByIds(['qm-2', 'qm-3'], 'arbiter:ignore:test')
    expect(dropped).toBe(1)

    const rows = await db
      .selectFrom('queue_messages')
      .select(['id', 'status', 'drop_reason'])
      .orderBy('id', 'asc')
      .execute()

    expect(rows).toEqual([
      { id: 'qm-1', status: 'pending', drop_reason: null },
      { id: 'qm-2', status: 'dropped', drop_reason: 'arbiter:ignore:test' },
      { id: 'qm-3', status: 'included', drop_reason: null },
    ])
  })

  it('consumes only targeted pending messages by ID', async () => {
    const consumed = await consumeSteeringMessagesByIds(['qm-2', 'qm-3'], 'dispatch-1')
    expect(consumed.map((m) => m.id)).toEqual(['qm-2'])

    const rows = await db
      .selectFrom('queue_messages')
      .select(['id', 'status', 'dispatch_id'])
      .orderBy('id', 'asc')
      .execute()

    expect(rows).toEqual([
      { id: 'qm-1', status: 'pending', dispatch_id: null },
      { id: 'qm-2', status: 'included', dispatch_id: 'dispatch-1' },
      { id: 'qm-3', status: 'included', dispatch_id: 'd-old' },
    ])
  })
})
