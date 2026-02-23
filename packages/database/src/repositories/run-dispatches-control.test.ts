import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { closeDb, getDb } from '../db'
import {
  clearPauseRunDispatchByJob,
  findLatestExclusiveClaimForWorkItem,
  getRunDispatchControlDirective,
} from './run-dispatches'

let testDir = ''
let db: ReturnType<typeof getDb>

function now(): number {
  return Math.floor(Date.now() / 1000)
}

async function createTestSchema(database: ReturnType<typeof getDb>): Promise<void> {
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
  await database.deleteFrom('queue_messages').execute()
  await database.deleteFrom('run_dispatches').execute()
  await database.deleteFrom('queue_lanes').execute()
}

async function seedDispatch(input: {
  id: string
  jobId: string
  queueKey: string
  status: 'running' | 'paused'
  controlState: 'normal' | 'pause_requested' | 'paused'
}) {
  const ts = now()
  await db
    .insertInto('queue_lanes')
    .values({
      queue_key: input.queueKey,
      session_key: `session-${input.queueKey}`,
      agent_id: `agent-${input.queueKey}`,
      plugin_instance_id: null,
      state: 'running',
      mode: 'steer',
      is_paused: 0,
      debounce_until: ts,
      debounce_ms: 2000,
      max_queued: 10,
      active_dispatch_id: input.id,
      paused_reason: null,
      paused_by: null,
      paused_at: null,
      created_at: ts,
      updated_at: ts,
    })
    .execute()

  await db
    .insertInto('run_dispatches')
    .values({
      id: input.id,
      run_key: `run-${input.id}`,
      queue_key: input.queueKey,
      work_item_id: `work-item-${input.jobId}`,
      agent_id: `agent-${input.queueKey}`,
      plugin_instance_id: null,
      session_key: `session-${input.queueKey}`,
      job_id: input.jobId,
      status: input.status,
      control_state: input.controlState,
      control_reason: input.controlState === 'normal' ? null : 'test',
      control_updated_at: ts,
      input_text: 'test input',
      coalesced_text: null,
      sender_name: 'tester',
      response_context: null,
      attempt_count: 1,
      claimed_by: 'test-worker',
      lease_expires_at: ts + 60,
      claimed_epoch: 1,
      last_error: null,
      replay_of_dispatch_id: null,
      merged_into_dispatch_id: null,
      scheduled_at: ts,
      started_at: ts,
      finished_at: null,
      created_at: ts,
      updated_at: ts,
    })
    .execute()
}

describe('run dispatch pause/resume control', () => {
  beforeAll(async () => {
    await closeDb()
    testDir = mkdtempSync(join(tmpdir(), 'nitejar-dispatch-control-'))
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
  })

  it('resumes a paused dispatch to running and unblocks control directives', async () => {
    const dispatchId = 'dispatch-paused-1'
    await seedDispatch({
      id: dispatchId,
      jobId: 'job-paused-1',
      queueKey: 'queue-paused-1',
      status: 'paused',
      controlState: 'paused',
    })

    const resumed = await clearPauseRunDispatchByJob('job-paused-1')
    expect(resumed).not.toBeNull()
    expect(resumed?.status).toBe('running')
    expect(resumed?.control_state).toBe('normal')
    expect(resumed?.control_reason).toBeNull()

    const directive = await getRunDispatchControlDirective(dispatchId)
    expect(directive).toEqual({ action: 'continue' })
  })

  it('clears pause requests on running dispatches without regressing status', async () => {
    const dispatchId = 'dispatch-running-1'
    await seedDispatch({
      id: dispatchId,
      jobId: 'job-running-1',
      queueKey: 'queue-running-1',
      status: 'running',
      controlState: 'pause_requested',
    })

    const resumed = await clearPauseRunDispatchByJob('job-running-1')
    expect(resumed).not.toBeNull()
    expect(resumed?.status).toBe('running')
    expect(resumed?.control_state).toBe('normal')

    const directive = await getRunDispatchControlDirective(dispatchId)
    expect(directive).toEqual({ action: 'continue' })
  })

  it('returns steer directive with concrete queue message IDs', async () => {
    const dispatchId = 'dispatch-steer-1'
    const queueKey = 'queue-steer-1'
    await seedDispatch({
      id: dispatchId,
      jobId: 'job-steer-1',
      queueKey,
      status: 'running',
      controlState: 'normal',
    })

    await db
      .insertInto('queue_messages')
      .values({
        id: 'qm-1',
        queue_key: queueKey,
        work_item_id: 'work-item-steer-1',
        plugin_instance_id: null,
        response_context: null,
        status: 'pending',
        text: 'new instruction',
        sender_name: 'Alice',
        arrived_at: now(),
        dispatch_id: null,
        drop_reason: null,
        created_at: now(),
      })
      .execute()

    const directive = await getRunDispatchControlDirective(dispatchId)
    expect(directive).toEqual({
      action: 'steer',
      messages: [{ id: 'qm-1', text: 'new instruction', senderName: 'Alice' }],
    })
  })

  it('returns latest exclusive triage claim for a work item', async () => {
    const ts = now()

    await db
      .insertInto('run_dispatches')
      .values([
        {
          id: 'dispatch-claim-1',
          run_key: 'run-dispatch-claim-1',
          queue_key: 'queue-claim-1',
          work_item_id: 'work-item-claim-1',
          agent_id: 'agent-slopper',
          plugin_instance_id: null,
          session_key: 'session-claim-1',
          job_id: null,
          status: 'completed',
          control_state: 'normal',
          control_reason: 'arbiter:exclusive_claim:triage_volunteer:agent-slopper',
          control_updated_at: ts,
          input_text: 'hello',
          coalesced_text: null,
          sender_name: 'tester',
          response_context: null,
          attempt_count: 1,
          claimed_by: null,
          lease_expires_at: null,
          claimed_epoch: 1,
          last_error: null,
          replay_of_dispatch_id: null,
          merged_into_dispatch_id: null,
          scheduled_at: ts,
          started_at: ts,
          finished_at: ts,
          created_at: ts,
          updated_at: ts,
        },
        {
          id: 'dispatch-claim-2',
          run_key: 'run-dispatch-claim-2',
          queue_key: 'queue-claim-2',
          work_item_id: 'work-item-claim-1',
          agent_id: 'agent-pixel',
          plugin_instance_id: null,
          session_key: 'session-claim-1',
          job_id: null,
          status: 'running',
          control_state: 'normal',
          control_reason: 'arbiter:exclusive_claim:triage_volunteer:agent-pixel',
          control_updated_at: ts + 5,
          input_text: 'hello',
          coalesced_text: null,
          sender_name: 'tester',
          response_context: null,
          attempt_count: 1,
          claimed_by: 'worker',
          lease_expires_at: ts + 60,
          claimed_epoch: 1,
          last_error: null,
          replay_of_dispatch_id: null,
          merged_into_dispatch_id: null,
          scheduled_at: ts + 1,
          started_at: ts + 1,
          finished_at: null,
          created_at: ts + 1,
          updated_at: ts + 5,
        },
      ])
      .execute()

    const claim = await findLatestExclusiveClaimForWorkItem('work-item-claim-1')
    expect(claim?.dispatch_id).toBe('dispatch-claim-2')
    expect(claim?.agent_id).toBe('agent-pixel')

    const excludingLatest = await findLatestExclusiveClaimForWorkItem('work-item-claim-1', {
      excludeDispatchId: 'dispatch-claim-2',
    })
    expect(excludingLatest?.dispatch_id).toBe('dispatch-claim-1')
    expect(excludingLatest?.agent_id).toBe('agent-slopper')
  })
})
