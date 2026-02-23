import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { setupTestDb, resetTestDb, teardownTestDb } from './helpers/db'
import { seedAgent, seedPluginInstance, seedWorkItem } from './helpers/seed'
import {
  getDb,
  reapExpiredLeases,
  findRunDispatchById,
  findQueueLaneByKey,
} from '@nitejar/database'

beforeAll(async () => {
  await setupTestDb()
})

beforeEach(async () => {
  await resetTestDb()
  // Seed runtime_control (required for epoch lookups)
  const db = getDb()
  await db
    .insertInto('runtime_control')
    .values({
      id: 'default',
      processing_enabled: 1,
      pause_mode: 'soft',
      control_epoch: 1,
      max_concurrent_dispatches: 20,
    })
    .execute()
})

afterAll(async () => {
  await teardownTestDb()
})

/** Insert a dispatch + lane pair for testing. */
async function seedDispatch(opts: {
  queueKey: string
  agentId: string
  workItemId: string
  pluginInstanceId: string | null
  status: string
  leaseExpiresAt: number | null
  startedAt: number | null
}) {
  const db = getDb()
  const ts = Math.floor(Date.now() / 1000)
  const id = crypto.randomUUID()

  await db
    .insertInto('queue_lanes')
    .values({
      queue_key: opts.queueKey,
      session_key: `session-${id}`,
      agent_id: opts.agentId,
      plugin_instance_id: opts.pluginInstanceId,
      state: opts.status === 'running' ? 'running' : 'queued',
      is_paused: 0,
      debounce_until: ts,
      debounce_ms: 2000,
      max_queued: 10,
      active_dispatch_id: opts.status === 'running' ? id : null,
      mode: 'steer',
    })
    .onConflict((oc) => oc.doNothing())
    .execute()

  await db
    .insertInto('run_dispatches')
    .values({
      id,
      run_key: `run-${id}`,
      queue_key: opts.queueKey,
      work_item_id: opts.workItemId,
      agent_id: opts.agentId,
      plugin_instance_id: opts.pluginInstanceId,
      session_key: `session-${id}`,
      status: opts.status,
      control_state: 'normal',
      input_text: 'test input',
      attempt_count: 1,
      claimed_by: 'run-worker:test',
      lease_expires_at: opts.leaseExpiresAt,
      claimed_epoch: 1,
      scheduled_at: ts,
      started_at: opts.startedAt,
      created_at: ts,
      updated_at: ts,
    })
    .execute()

  return id
}

describe('reapExpiredLeases', () => {
  it('abandons a running dispatch with an expired lease', async () => {
    const agent = await seedAgent()
    const pluginInstance = await seedPluginInstance()
    const workItem = await seedWorkItem({ plugin_instance_id: pluginInstance.id })
    const pastTs = Math.floor(Date.now() / 1000) - 300 // 5 min ago

    const dispatchId = await seedDispatch({
      queueKey: 'test-lane-1',
      agentId: agent.id,
      workItemId: workItem.id,
      pluginInstanceId: pluginInstance.id,
      status: 'running',
      leaseExpiresAt: pastTs,
      startedAt: pastTs - 60,
    })

    const reaped = await reapExpiredLeases()
    expect(reaped).toBe(1)

    const dispatch = await findRunDispatchById(dispatchId)
    expect(dispatch?.status).toBe('abandoned')
    expect(dispatch?.control_state).toBe('cancelled')
    expect(dispatch?.lease_expires_at).toBeNull()
  })

  it('resets the queue lane to idle when no pending work exists', async () => {
    const agent = await seedAgent()
    const workItem = await seedWorkItem()
    const pastTs = Math.floor(Date.now() / 1000) - 300

    await seedDispatch({
      queueKey: 'test-lane-idle',
      agentId: agent.id,
      workItemId: workItem.id,
      pluginInstanceId: null,
      status: 'running',
      leaseExpiresAt: pastTs,
      startedAt: pastTs - 60,
    })

    await reapExpiredLeases()

    const lane = await findQueueLaneByKey('test-lane-idle')
    expect(lane?.state).toBe('idle')
    expect(lane?.active_dispatch_id).toBeNull()
  })

  it('resets the queue lane to queued when a queued dispatch exists', async () => {
    const db = getDb()
    const agent = await seedAgent()
    const workItem = await seedWorkItem()
    const ts = Math.floor(Date.now() / 1000)
    const pastTs = ts - 300

    // Stale running dispatch
    await seedDispatch({
      queueKey: 'test-lane-replay',
      agentId: agent.id,
      workItemId: workItem.id,
      pluginInstanceId: null,
      status: 'running',
      leaseExpiresAt: pastTs,
      startedAt: pastTs - 60,
    })

    // A queued replay waiting behind it
    await db
      .insertInto('run_dispatches')
      .values({
        id: crypto.randomUUID(),
        run_key: `run-replay-${crypto.randomUUID()}`,
        queue_key: 'test-lane-replay',
        work_item_id: workItem.id,
        agent_id: agent.id,
        plugin_instance_id: null,
        session_key: `session-replay`,
        status: 'queued',
        control_state: 'normal',
        input_text: 'retry input',
        attempt_count: 0,
        claimed_by: null,
        lease_expires_at: null,
        claimed_epoch: 1,
        scheduled_at: ts,
        started_at: null,
        created_at: ts,
        updated_at: ts,
      })
      .execute()

    await reapExpiredLeases()

    const lane = await findQueueLaneByKey('test-lane-replay')
    expect(lane?.state).toBe('queued')
    expect(lane?.active_dispatch_id).toBeNull()
  })

  it('does not touch dispatches with a valid (future) lease', async () => {
    const agent = await seedAgent()
    const workItem = await seedWorkItem()
    const futureTs = Math.floor(Date.now() / 1000) + 600 // 10 min from now

    const dispatchId = await seedDispatch({
      queueKey: 'test-lane-active',
      agentId: agent.id,
      workItemId: workItem.id,
      pluginInstanceId: null,
      status: 'running',
      leaseExpiresAt: futureTs,
      startedAt: futureTs - 60,
    })

    const reaped = await reapExpiredLeases()
    expect(reaped).toBe(0)

    const dispatch = await findRunDispatchById(dispatchId)
    expect(dispatch?.status).toBe('running')
  })

  it('returns 0 when there are no stale dispatches', async () => {
    const reaped = await reapExpiredLeases()
    expect(reaped).toBe(0)
  })

  it('reaps paused dispatches with expired leases', async () => {
    const agent = await seedAgent()
    const workItem = await seedWorkItem()
    const pastTs = Math.floor(Date.now() / 1000) - 300

    const dispatchId = await seedDispatch({
      queueKey: 'test-lane-paused',
      agentId: agent.id,
      workItemId: workItem.id,
      pluginInstanceId: null,
      status: 'paused',
      leaseExpiresAt: pastTs,
      startedAt: pastTs - 120,
    })

    // Manually set lane state to match paused dispatch
    const db = getDb()
    await db
      .updateTable('queue_lanes')
      .set({ state: 'running' })
      .where('queue_key', '=', 'test-lane-paused')
      .execute()

    const reaped = await reapExpiredLeases()
    expect(reaped).toBe(1)

    const dispatch = await findRunDispatchById(dispatchId)
    expect(dispatch?.status).toBe('abandoned')
  })
})
