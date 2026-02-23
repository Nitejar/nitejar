import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { closeDb, getDb } from '../db'
import {
  claimNextRoutineEvent,
  createRoutine,
  enqueueRoutineEvent,
  enqueueRoutineRun,
  listDueRoutines,
  listRoutineRunsByRoutine,
  markRoutineEventDone,
} from './routines'

let testDir = ''
let db: ReturnType<typeof getDb>

function now(): number {
  return Math.floor(Date.now() / 1000)
}

async function createSchema(database: ReturnType<typeof getDb>): Promise<void> {
  await database.schema
    .createTable('agents')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('handle', 'text', (col) => col.notNull())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('sprite_id', 'text')
    .addColumn('config', 'text')
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('idle'))
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('updated_at', 'integer', (col) => col.notNull())
    .execute()

  await database.schema
    .createTable('plugin_instances')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('plugin_id', 'text', (col) => col.notNull())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('config_json', 'text')
    .addColumn('scope', 'text', (col) => col.notNull().defaultTo('global'))
    .addColumn('enabled', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('updated_at', 'integer', (col) => col.notNull())
    .execute()

  await database.schema
    .createTable('routines')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('agent_id', 'text', (col) => col.notNull())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('enabled', 'integer', (col) => col.notNull())
    .addColumn('trigger_kind', 'text', (col) => col.notNull())
    .addColumn('cron_expr', 'text')
    .addColumn('timezone', 'text')
    .addColumn('rule_json', 'text', (col) => col.notNull())
    .addColumn('condition_probe', 'text')
    .addColumn('condition_config', 'text')
    .addColumn('target_plugin_instance_id', 'text', (col) => col.notNull())
    .addColumn('target_session_key', 'text', (col) => col.notNull())
    .addColumn('target_response_context', 'text')
    .addColumn('action_prompt', 'text', (col) => col.notNull())
    .addColumn('next_run_at', 'integer')
    .addColumn('last_evaluated_at', 'integer')
    .addColumn('last_fired_at', 'integer')
    .addColumn('last_status', 'text')
    .addColumn('created_by_kind', 'text', (col) => col.notNull())
    .addColumn('created_by_ref', 'text')
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('updated_at', 'integer', (col) => col.notNull())
    .addColumn('archived_at', 'integer')
    .execute()

  await database.schema
    .createTable('scheduled_items')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('agent_id', 'text', (col) => col.notNull())
    .addColumn('session_key', 'text', (col) => col.notNull())
    .addColumn('type', 'text', (col) => col.notNull())
    .addColumn('payload', 'text', (col) => col.notNull())
    .addColumn('run_at', 'integer', (col) => col.notNull())
    .addColumn('recurrence', 'text')
    .addColumn('status', 'text', (col) => col.notNull())
    .addColumn('source_ref', 'text')
    .addColumn('plugin_instance_id', 'text')
    .addColumn('response_context', 'text')
    .addColumn('routine_id', 'text')
    .addColumn('routine_run_id', 'text')
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('fired_at', 'integer')
    .addColumn('cancelled_at', 'integer')
    .execute()

  await database.schema
    .createTable('routine_runs')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('routine_id', 'text', (col) => col.notNull())
    .addColumn('trigger_origin', 'text', (col) => col.notNull())
    .addColumn('trigger_ref', 'text')
    .addColumn('envelope_json', 'text')
    .addColumn('decision', 'text', (col) => col.notNull())
    .addColumn('decision_reason', 'text')
    .addColumn('scheduled_item_id', 'text')
    .addColumn('work_item_id', 'text')
    .addColumn('evaluated_at', 'integer', (col) => col.notNull())
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .execute()

  await database.schema
    .createTable('routine_event_queue')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('event_key', 'text', (col) => col.notNull().unique())
    .addColumn('envelope_json', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull())
    .addColumn('attempt_count', 'integer', (col) => col.notNull())
    .addColumn('last_error', 'text')
    .addColumn('lease_expires_at', 'integer')
    .addColumn('claimed_by', 'text')
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('updated_at', 'integer', (col) => col.notNull())
    .execute()
}

async function clearTables(database: ReturnType<typeof getDb>): Promise<void> {
  await database.deleteFrom('routine_event_queue').execute()
  await database.deleteFrom('routine_runs').execute()
  await database.deleteFrom('scheduled_items').execute()
  await database.deleteFrom('routines').execute()
  await database.deleteFrom('plugin_instances').execute()
  await database.deleteFrom('agents').execute()
}

async function seedAgentAndIntegration(): Promise<void> {
  const ts = now()
  await db
    .insertInto('agents')
    .values({
      id: 'agent-1',
      handle: 'agent',
      name: 'Agent One',
      sprite_id: null,
      config: null,
      status: 'idle',
      created_at: ts,
      updated_at: ts,
    })
    .execute()

  await db
    .insertInto('plugin_instances')
    .values({
      id: 'integration-1',
      plugin_id: 'builtin.telegram',
      name: 'Telegram',
      config_json: null,
      scope: 'global',
      enabled: 1,
      created_at: ts,
      updated_at: ts,
    })
    .execute()
}

describe('routines repository', () => {
  beforeAll(async () => {
    await closeDb()
    testDir = mkdtempSync(join(tmpdir(), 'nitejar-routines-repo-'))
    process.env.DATABASE_URL = join(testDir, 'test.sqlite')
    db = getDb()
    await createSchema(db)
  })

  afterAll(async () => {
    await closeDb()
    delete process.env.DATABASE_URL
    if (testDir) rmSync(testDir, { recursive: true, force: true })
  })

  beforeEach(async () => {
    await clearTables(db)
    await seedAgentAndIntegration()
  })

  it('selects due routines by next_run_at and enabled state', async () => {
    const ts = now()

    await createRoutine({
      agent_id: 'agent-1',
      name: 'due',
      description: null,
      enabled: 1,
      trigger_kind: 'cron',
      cron_expr: '*/15 * * * *',
      timezone: 'UTC',
      rule_json: '{}',
      condition_probe: null,
      condition_config: null,
      target_plugin_instance_id: 'integration-1',
      target_session_key: 'telegram:123',
      target_response_context: null,
      action_prompt: 'run due',
      next_run_at: ts - 60,
      last_evaluated_at: null,
      last_fired_at: null,
      last_status: null,
      created_by_kind: 'admin',
      created_by_ref: 'user-1',
      archived_at: null,
    })

    await createRoutine({
      agent_id: 'agent-1',
      name: 'future',
      description: null,
      enabled: 1,
      trigger_kind: 'cron',
      cron_expr: '*/15 * * * *',
      timezone: 'UTC',
      rule_json: '{}',
      condition_probe: null,
      condition_config: null,
      target_plugin_instance_id: 'integration-1',
      target_session_key: 'telegram:123',
      target_response_context: null,
      action_prompt: 'run future',
      next_run_at: ts + 600,
      last_evaluated_at: null,
      last_fired_at: null,
      last_status: null,
      created_by_kind: 'admin',
      created_by_ref: 'user-1',
      archived_at: null,
    })

    const due = await listDueRoutines(ts)
    expect(due).toHaveLength(1)
    expect(due[0]?.name).toBe('due')
  })

  it('materializes routine runs into scheduled items', async () => {
    const routine = await createRoutine({
      agent_id: 'agent-1',
      name: 'materialize',
      description: null,
      enabled: 1,
      trigger_kind: 'event',
      cron_expr: null,
      timezone: null,
      rule_json: '{}',
      condition_probe: null,
      condition_config: null,
      target_plugin_instance_id: 'integration-1',
      target_session_key: 'telegram:123',
      target_response_context: null,
      action_prompt: 'send summary',
      next_run_at: null,
      last_evaluated_at: null,
      last_fired_at: null,
      last_status: null,
      created_by_kind: 'admin',
      created_by_ref: 'user-1',
      archived_at: null,
    })

    const materialized = await enqueueRoutineRun({
      routine,
      triggerOrigin: 'manual',
      triggerRef: 'manual:test',
      runAt: now(),
    })

    const runs = await listRoutineRunsByRoutine(routine.id)
    expect(runs).toHaveLength(1)
    expect(runs[0]?.scheduled_item_id).toBe(materialized.scheduledItem.id)
    expect(materialized.scheduledItem.routine_id).toBe(routine.id)
  })

  it('claims and completes routine event queue items', async () => {
    await enqueueRoutineEvent({
      eventKey: 'work_item:1',
      envelopeJson: JSON.stringify({ eventId: 'work-item-1' }),
    })

    const claimed = await claimNextRoutineEvent('worker-1', { leaseSeconds: 60 })
    expect(claimed).not.toBeNull()
    expect(claimed?.status).toBe('processing')

    const done = await markRoutineEventDone(claimed!.id)
    expect(done?.status).toBe('done')
  })
})
