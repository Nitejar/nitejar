import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { sql } from 'kysely'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { closeDb, getDb } from '../db'
import {
  findIntegrationById,
  createPluginInstance,
  deletePluginInstance,
  findIntegrationsByType,
  findPluginInstanceById,
  findPluginInstancesByType,
  getAgentsForPluginInstance,
  getPluginInstancesForAgent,
  listAgentAssignmentsForPluginInstances,
  listAgentIdsForPluginInstance,
  listPluginInstances,
  listPluginInstancesWithAgents,
  searchPluginInstances,
  setAgentPluginInstanceAssignment,
  updatePluginInstance,
} from './plugin-instances'
import {
  cancelJob,
  completeJob,
  createJob,
  failJob,
  findJobById,
  listJobs,
  listJobsByAgent,
  listJobsByWorkItem,
  listRunHistoryForAgent,
  pauseJob,
  resumeJob,
  searchRuns,
  startJob,
} from './jobs'
import {
  createWorkItem,
  findWorkItemById,
  listWorkItems,
  listWorkItemsByIntegration,
  listWorkItemsByPluginInstance,
  searchWorkItems,
  updateWorkItem,
} from './work-items'

const TEST_AGENT_ID = 'agent-test-1'
let testDir = ''
let db: ReturnType<typeof getDb>

async function createTestSchema(database: ReturnType<typeof getDb>): Promise<void> {
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
    .createTable('work_items')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('plugin_instance_id', 'text')
    .addColumn('session_key', 'text', (col) => col.notNull())
    .addColumn('source', 'text', (col) => col.notNull())
    .addColumn('source_ref', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('NEW'))
    .addColumn('title', 'text', (col) => col.notNull())
    .addColumn('payload', 'text')
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('updated_at', 'integer', (col) => col.notNull())
    .execute()

  await database.schema
    .createTable('jobs')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('work_item_id', 'text', (col) => col.notNull())
    .addColumn('agent_id', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('PENDING'))
    .addColumn('error_text', 'text')
    .addColumn('todo_state', 'text')
    .addColumn('final_response', 'text')
    .addColumn('started_at', 'integer')
    .addColumn('completed_at', 'integer')
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('updated_at', 'integer', (col) => col.notNull())
    .execute()

  await database.schema
    .createTable('inference_calls')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('job_id', 'text', (col) => col.notNull())
    .addColumn('agent_id', 'text', (col) => col.notNull())
    .addColumn('turn', 'integer', (col) => col.notNull())
    .addColumn('model', 'text', (col) => col.notNull())
    .addColumn('prompt_tokens', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('completion_tokens', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('total_tokens', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('cache_read_tokens', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('cache_write_tokens', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('cost_usd', 'real')
    .addColumn('tool_call_names', 'text')
    .addColumn('finish_reason', 'text')
    .addColumn('is_fallback', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('duration_ms', 'integer')
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .execute()

  await database.schema
    .createTable('activity_log')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('agent_id', 'text', (col) => col.notNull())
    .addColumn('agent_handle', 'text', (col) => col.notNull())
    .addColumn('job_id', 'text')
    .addColumn('session_key', 'text')
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('starting'))
    .addColumn('summary', 'text')
    .addColumn('resources', 'text')
    .addColumn('embedding', 'blob')
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .execute()

  await database.schema
    .createTable('agent_plugin_instances')
    .ifNotExists()
    .addColumn('agent_id', 'text', (col) => col.notNull())
    .addColumn('plugin_instance_id', 'text', (col) => col.notNull())
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addPrimaryKeyConstraint('agent_integrations_pk', ['agent_id', 'plugin_instance_id'])
    .execute()
}

async function clearTables(database: ReturnType<typeof getDb>): Promise<void> {
  await sql`delete from activity_log`.execute(database)
  await sql`delete from inference_calls`.execute(database)
  await sql`delete from jobs`.execute(database)
  await sql`delete from work_items`.execute(database)
  await sql`delete from agent_plugin_instances`.execute(database)
  await sql`delete from plugin_instances`.execute(database)
  await sql`delete from agents`.execute(database)
}

async function seedAgent(database: ReturnType<typeof getDb>, id = TEST_AGENT_ID): Promise<void> {
  await database
    .insertInto('agents')
    .values({
      id,
      handle: 'test-agent',
      name: 'Test Agent',
      sprite_id: null,
      config: null,
      status: 'idle',
      created_at: 1,
      updated_at: 1,
    })
    .execute()
}

describe('repository search + control operations', () => {
  beforeAll(async () => {
    await closeDb()
    testDir = mkdtempSync(join(tmpdir(), 'nitejar-db-'))
    process.env.DATABASE_URL = join(testDir, 'test.sqlite')
    db = getDb()
    await createTestSchema(db)
  })

  afterAll(async () => {
    await closeDb()
    delete process.env.DATABASE_URL
    if (testDir) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  beforeEach(async () => {
    await clearTables(db)
    await seedAgent(db)
  })

  it('supports work item find/list/search/update flows with cursor pagination', async () => {
    const alpha = await createWorkItem({
      plugin_instance_id: 'integration-a',
      session_key: 'session-alpha',
      source: 'telegram',
      source_ref: 'ref-alpha',
      status: 'NEW',
      title: 'Alpha incident',
      payload: null,
    })

    const beta = await createWorkItem({
      plugin_instance_id: 'integration-b',
      session_key: 'session-beta',
      source: 'github',
      source_ref: 'ref-beta',
      status: 'IN_PROGRESS',
      title: 'Beta issue',
      payload: null,
    })

    await db
      .updateTable('work_items')
      .set({ created_at: 200, updated_at: 200 })
      .where('id', '=', alpha.id)
      .execute()

    await db
      .updateTable('work_items')
      .set({ created_at: 100, updated_at: 100 })
      .where('id', '=', beta.id)
      .execute()

    await createJob({
      work_item_id: alpha.id,
      agent_id: TEST_AGENT_ID,
      status: 'PENDING',
      error_text: null,
      todo_state: null,
      final_response: null,
      started_at: null,
      completed_at: null,
    })

    const found = await findWorkItemById(alpha.id)
    expect(found?.title).toBe('Alpha incident')

    const listed = await listWorkItems(10)
    expect(listed).toHaveLength(2)

    const listedByPluginInstance = await listWorkItemsByPluginInstance('integration-a', 10)
    expect(listedByPluginInstance).toHaveLength(1)
    expect(listedByPluginInstance[0]?.id).toBe(alpha.id)

    const listedByIntegration = await listWorkItemsByIntegration('integration-a', 10)
    expect(listedByIntegration).toHaveLength(1)
    expect(listedByIntegration[0]?.id).toBe(alpha.id)

    const searchPageOne = await searchWorkItems({
      q: 'incident',
      statuses: ['NEW', 'IN_PROGRESS'],
      agentId: TEST_AGENT_ID,
      sessionKeyPrefix: 'session-',
      limit: 1,
    })

    expect(searchPageOne.items).toHaveLength(1)
    expect(searchPageOne.items[0]?.id).toBe(alpha.id)
    expect(searchPageOne.nextCursor).toBeNull()

    const pagedOne = await searchWorkItems({ limit: 1 })
    expect(pagedOne.items).toHaveLength(1)
    expect(pagedOne.nextCursor).not.toBeNull()

    const searchPageTwo = await searchWorkItems({
      limit: 1,
      cursor: pagedOne.nextCursor,
    })

    expect(searchPageTwo.items).toHaveLength(1)
    expect(searchPageTwo.items[0]?.id).toBe(beta.id)

    const updated = await updateWorkItem(alpha.id, {
      status: 'COMPLETED',
      title: 'Alpha incident resolved',
    })

    expect(updated?.status).toBe('COMPLETED')
  })

  it('supports run listing/searching and status transitions', async () => {
    const workItemA = await createWorkItem({
      plugin_instance_id: 'integration-a',
      session_key: 'run-session-a',
      source: 'telegram',
      source_ref: 'r-a',
      status: 'NEW',
      title: 'Run Alpha',
      payload: null,
    })

    const workItemB = await createWorkItem({
      plugin_instance_id: 'integration-b',
      session_key: 'run-session-b',
      source: 'github',
      source_ref: 'r-b',
      status: 'NEW',
      title: 'Run Beta',
      payload: null,
    })

    const runA = await createJob({
      work_item_id: workItemA.id,
      agent_id: TEST_AGENT_ID,
      status: 'PENDING',
      error_text: null,
      todo_state: null,
      final_response: null,
      started_at: null,
      completed_at: null,
    })

    const runB = await createJob({
      work_item_id: workItemB.id,
      agent_id: TEST_AGENT_ID,
      status: 'RUNNING',
      error_text: null,
      todo_state: null,
      final_response: null,
      started_at: null,
      completed_at: null,
    })

    await db
      .updateTable('jobs')
      .set({ created_at: 300, updated_at: 300 })
      .where('id', '=', runA.id)
      .execute()

    await db
      .updateTable('jobs')
      .set({ created_at: 200, updated_at: 200 })
      .where('id', '=', runB.id)
      .execute()

    await db
      .insertInto('inference_calls')
      .values([
        {
          id: 'call-1',
          job_id: runA.id,
          agent_id: TEST_AGENT_ID,
          turn: 1,
          model: 'test-model',
          prompt_tokens: 10,
          completion_tokens: 12,
          total_tokens: 22,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
          cost_usd: 0.42,
          tool_call_names: null,
          finish_reason: null,
          is_fallback: 0,
          duration_ms: null,
          created_at: 1,
        },
        {
          id: 'call-2',
          job_id: runA.id,
          agent_id: TEST_AGENT_ID,
          turn: 2,
          model: 'test-model',
          prompt_tokens: 2,
          completion_tokens: 4,
          total_tokens: 6,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
          cost_usd: 0.08,
          tool_call_names: null,
          finish_reason: null,
          is_fallback: 0,
          duration_ms: null,
          created_at: 1,
        },
      ])
      .execute()

    await db
      .insertInto('activity_log')
      .values({
        id: 'log-1',
        agent_id: TEST_AGENT_ID,
        agent_handle: 'test-agent',
        job_id: runA.id,
        session_key: workItemA.session_key,
        status: 'completed',
        summary: 'triage summary',
        resources: '[]',
        embedding: null,
        created_at: 1,
      })
      .execute()

    expect((await findJobById(runA.id))?.id).toBe(runA.id)
    expect((await listJobs(10)).length).toBe(2)
    expect((await listJobsByAgent(TEST_AGENT_ID, 10)).length).toBe(2)
    expect((await listJobsByWorkItem(workItemA.id)).length).toBe(1)

    expect((await startJob(runA.id))?.status).toBe('RUNNING')
    expect((await pauseJob(runA.id))?.status).toBe('PAUSED')
    expect((await resumeJob(runA.id))?.status).toBe('RUNNING')
    expect((await completeJob(runA.id))?.status).toBe('COMPLETED')
    expect((await failJob(runB.id, 'boom'))?.status).toBe('FAILED')
    expect((await cancelJob(runB.id, 'cancelled'))?.status).toBe('CANCELLED')

    const history = await listRunHistoryForAgent(TEST_AGENT_ID, {
      source: 'telegram',
      status: 'completed',
      sinceUnix: 100,
      limit: 10,
    })

    expect(history).toHaveLength(1)
    expect(history[0]?.job_id).toBe(runA.id)
    expect(history[0]?.total_cost).toBeCloseTo(0.5)

    const runsPageOne = await searchRuns({
      q: 'run',
      statuses: ['COMPLETED', 'CANCELLED'],
      agentId: TEST_AGENT_ID,
      limit: 1,
    })

    expect(runsPageOne.runs).toHaveLength(1)
    expect(runsPageOne.nextCursor).not.toBeNull()

    const runsPageTwo = await searchRuns({
      limit: 1,
      cursor: runsPageOne.nextCursor,
    })

    expect(runsPageTwo.runs).toHaveLength(1)
  })

  it('supports plugin-instance search/list/update/assignment flows', async () => {
    const integrationA = await createPluginInstance({
      type: 'telegram',
      name: 'Inbox Telegram',
      config: '{"bot":"x"}',
      scope: 'global',
      enabled: 1,
    })

    const integrationB = await createPluginInstance({
      type: 'github',
      name: 'GitHub Webhooks',
      config: '{"app":"y"}',
      scope: 'global',
      enabled: 0,
    })

    await db
      .updateTable('plugin_instances')
      .set({ created_at: 500, updated_at: 500 })
      .where('id', '=', integrationA.id)
      .execute()

    await db
      .updateTable('plugin_instances')
      .set({ created_at: 400, updated_at: 400 })
      .where('id', '=', integrationB.id)
      .execute()

    expect((await findPluginInstanceById(integrationA.id))?.name).toBe('Inbox Telegram')
    expect((await findIntegrationsByType('telegram')).length).toBe(1)
    expect((await findPluginInstancesByType('telegram')).length).toBe(1)
    expect((await listPluginInstances()).length).toBe(2)

    const updated = await updatePluginInstance(integrationA.id, {
      enabled: 0,
      name: 'Inbox Telegram v2',
    })
    expect(updated?.enabled).toBe(0)

    await setAgentPluginInstanceAssignment({
      pluginInstanceId: integrationA.id,
      agentId: TEST_AGENT_ID,
      enabled: true,
    })

    expect(await listAgentIdsForPluginInstance(integrationA.id)).toEqual([TEST_AGENT_ID])
    expect((await getAgentsForPluginInstance(integrationA.id))[0]?.id).toBe(TEST_AGENT_ID)
    expect((await getPluginInstancesForAgent(TEST_AGENT_ID))[0]?.id).toBe(integrationA.id)

    const withAgents = await listPluginInstancesWithAgents()
    const mergedA = withAgents.find((entry) => entry.id === integrationA.id)
    expect(mergedA?.agents[0]?.id).toBe(TEST_AGENT_ID)

    const assignments = await listAgentAssignmentsForPluginInstances([
      integrationA.id,
      integrationB.id,
    ])
    expect(assignments).toHaveLength(1)

    const searchPageOne = await searchPluginInstances({
      q: 'telegram',
      types: ['telegram', 'github'],
      enabled: false,
      agentId: TEST_AGENT_ID,
      limit: 1,
    })

    expect(searchPageOne.plugin_instances).toHaveLength(1)
    expect(searchPageOne.nextCursor).toBeNull()

    await setAgentPluginInstanceAssignment({
      pluginInstanceId: integrationA.id,
      agentId: TEST_AGENT_ID,
      enabled: false,
    })

    expect(await listAgentIdsForPluginInstance(integrationA.id)).toEqual([])
    expect(await deletePluginInstance(integrationB.id)).toBe(true)

    // Legacy alias is still exported for callers that have not cut over yet.
    expect((await findIntegrationById(integrationA.id))?.id).toBe(integrationA.id)
  })
})
