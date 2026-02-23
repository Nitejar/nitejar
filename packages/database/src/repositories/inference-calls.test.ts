import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'kysely'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { closeDb, getDb } from '../db'
import {
  PASSIVE_MEMORY_EXTRACT_TURN_BASE,
  PASSIVE_MEMORY_REFINE_TURN_BASE,
  PASSIVE_MEMORY_TURN_THRESHOLD,
} from '../passive-memory-turns'
import { getCostByJobs } from './inference-calls'

let testDir = ''
let db: ReturnType<typeof getDb>

describe('getCostByJobs', () => {
  beforeAll(async () => {
    await closeDb()
    testDir = mkdtempSync(join(tmpdir(), 'nitejar-inference-calls-'))
    process.env.DATABASE_URL = join(testDir, 'test.sqlite')
    db = getDb()

    // Create minimal tables needed for getCostByJobs
    await db.schema
      .createTable('inference_calls')
      .ifNotExists()
      .addColumn('id', 'text', (col) => col.primaryKey())
      .addColumn('job_id', 'text', (col) => col.notNull())
      .addColumn('agent_id', 'text', (col) => col.notNull())
      .addColumn('turn', 'integer', (col) => col.notNull())
      .addColumn('model', 'text', (col) => col.notNull())
      .addColumn('prompt_tokens', 'integer', (col) => col.notNull())
      .addColumn('completion_tokens', 'integer', (col) => col.notNull())
      .addColumn('total_tokens', 'integer', (col) => col.notNull())
      .addColumn('cache_read_tokens', 'integer', (col) => col.defaultTo(0))
      .addColumn('cache_write_tokens', 'integer', (col) => col.defaultTo(0))
      .addColumn('cost_usd', 'real')
      .addColumn('created_at', 'integer', (col) => col.notNull())
      .execute()

    await db.schema
      .createTable('external_api_calls')
      .ifNotExists()
      .addColumn('id', 'text', (col) => col.primaryKey())
      .addColumn('job_id', 'text', (col) => col.notNull())
      .addColumn('agent_id', 'text', (col) => col.notNull())
      .addColumn('provider', 'text', (col) => col.notNull())
      .addColumn('operation', 'text', (col) => col.notNull())
      .addColumn('cost_usd', 'real')
      .addColumn('created_at', 'integer', (col) => col.notNull())
      .execute()
  })

  beforeEach(async () => {
    await sql`delete from inference_calls`.execute(db)
    await sql`delete from external_api_calls`.execute(db)
  })

  afterAll(async () => {
    await closeDb()
    delete process.env.DATABASE_URL
    if (testDir) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  // Helper to insert inference calls
  function insertInference(overrides: {
    id?: string
    job_id: string
    turn?: number
    prompt_tokens?: number
    completion_tokens?: number
    cache_read_tokens?: number
    cache_write_tokens?: number
    cost_usd?: number
  }) {
    return db
      .insertInto('inference_calls')
      .values({
        id: overrides.id ?? crypto.randomUUID(),
        job_id: overrides.job_id,
        agent_id: 'agent-1',
        turn: overrides.turn ?? 1,
        model: 'test-model',
        prompt_tokens: overrides.prompt_tokens ?? 0,
        completion_tokens: overrides.completion_tokens ?? 0,
        total_tokens: (overrides.prompt_tokens ?? 0) + (overrides.completion_tokens ?? 0),
        cache_read_tokens: overrides.cache_read_tokens ?? 0,
        cache_write_tokens: overrides.cache_write_tokens ?? 0,
        cost_usd: overrides.cost_usd ?? 0,
        created_at: Math.floor(Date.now() / 1000),
      })
      .execute()
  }

  // Helper to insert external API calls
  function insertExternal(overrides: { id?: string; job_id: string; cost_usd?: number }) {
    return db
      .insertInto('external_api_calls')
      .values({
        id: overrides.id ?? crypto.randomUUID(),
        job_id: overrides.job_id,
        agent_id: 'agent-1',
        provider: 'test-provider',
        operation: 'test-op',
        cost_usd: overrides.cost_usd ?? 0,
        created_at: Math.floor(Date.now() / 1000),
      })
      .execute()
  }

  it('returns empty array for empty input', async () => {
    const result = await getCostByJobs([])
    expect(result).toEqual([])
  })

  it('returns empty array when no matching rows exist', async () => {
    const result = await getCostByJobs(['nonexistent-job'])
    expect(result).toEqual([])
  })

  it('aggregates inference calls for a single job', async () => {
    await insertInference({
      job_id: 'job-1',
      prompt_tokens: 100,
      completion_tokens: 50,
      cache_read_tokens: 10,
      cache_write_tokens: 5,
      cost_usd: 0.01,
    })
    await insertInference({
      job_id: 'job-1',
      prompt_tokens: 200,
      completion_tokens: 100,
      cache_read_tokens: 20,
      cache_write_tokens: 10,
      cost_usd: 0.02,
    })

    const result = await getCostByJobs(['job-1'])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      job_id: 'job-1',
      total_cost: 0.03,
      prompt_tokens: 300,
      completion_tokens: 150,
      cache_read_tokens: 30,
      cache_write_tokens: 15,
      call_count: 2,
      passive_memory_cost: 0,
      external_cost: 0,
    })
  })

  it(`separates passive memory cost (turn >= ${PASSIVE_MEMORY_TURN_THRESHOLD})`, async () => {
    // Regular inference call
    await insertInference({
      job_id: 'job-1',
      turn: 1,
      prompt_tokens: 100,
      completion_tokens: 50,
      cost_usd: 0.01,
    })
    // Passive memory extraction call (turn >= threshold)
    await insertInference({
      job_id: 'job-1',
      turn: PASSIVE_MEMORY_EXTRACT_TURN_BASE,
      prompt_tokens: 200,
      completion_tokens: 80,
      cost_usd: 0.005,
    })
    // Passive memory refinement call (separate phase, still passive-memory budget)
    await insertInference({
      job_id: 'job-1',
      turn: PASSIVE_MEMORY_REFINE_TURN_BASE,
      prompt_tokens: 120,
      completion_tokens: 40,
      cost_usd: 0.002,
    })

    const result = await getCostByJobs(['job-1'])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      job_id: 'job-1',
      total_cost: 0.017, // inference only, no external
      passive_memory_cost: 0.007,
      external_cost: 0,
    })
  })

  it('includes external API costs in total and external_cost', async () => {
    await insertInference({
      job_id: 'job-1',
      prompt_tokens: 100,
      completion_tokens: 50,
      cost_usd: 0.01,
    })
    await insertExternal({ job_id: 'job-1', cost_usd: 0.05 })
    await insertExternal({ job_id: 'job-1', cost_usd: 0.03 })

    const result = await getCostByJobs(['job-1'])
    expect(result).toHaveLength(1)
    expect(result[0]!.total_cost).toBeCloseTo(0.09) // 0.01 + 0.05 + 0.03
    expect(result[0]!.external_cost).toBeCloseTo(0.08) // 0.05 + 0.03
    // External calls count towards call_count
    expect(result[0]!.call_count).toBe(3) // 1 inference + 2 external
  })

  it('handles jobs with only external costs (no inference)', async () => {
    await insertExternal({ job_id: 'job-1', cost_usd: 0.1 })

    const result = await getCostByJobs(['job-1'])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      job_id: 'job-1',
      total_cost: 0.1,
      prompt_tokens: 0,
      completion_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      call_count: 1,
      passive_memory_cost: 0,
      external_cost: 0.1,
    })
  })

  it('aggregates multiple jobs independently', async () => {
    await insertInference({ job_id: 'job-1', prompt_tokens: 100, cost_usd: 0.01 })
    await insertInference({ job_id: 'job-2', prompt_tokens: 200, cost_usd: 0.02 })
    await insertExternal({ job_id: 'job-2', cost_usd: 0.05 })

    const result = await getCostByJobs(['job-1', 'job-2'])
    expect(result).toHaveLength(2)

    const job1 = result.find((r) => r.job_id === 'job-1')!
    const job2 = result.find((r) => r.job_id === 'job-2')!

    expect(job1.total_cost).toBeCloseTo(0.01)
    expect(job1.external_cost).toBe(0)

    expect(job2.total_cost).toBeCloseTo(0.07) // 0.02 + 0.05
    expect(job2.external_cost).toBeCloseTo(0.05)
  })

  it('only returns requested job IDs', async () => {
    await insertInference({ job_id: 'job-1', cost_usd: 0.01 })
    await insertInference({ job_id: 'job-other', cost_usd: 0.99 })

    const result = await getCostByJobs(['job-1'])
    expect(result).toHaveLength(1)
    expect(result[0]!.job_id).toBe('job-1')
  })

  it('combines all three cost types correctly', async () => {
    // Regular inference
    await insertInference({ job_id: 'job-1', turn: 1, cost_usd: 0.01 })
    // Passive memory extraction
    await insertInference({
      job_id: 'job-1',
      turn: PASSIVE_MEMORY_EXTRACT_TURN_BASE + 1,
      cost_usd: 0.003,
    })
    // External API
    await insertExternal({ job_id: 'job-1', cost_usd: 0.05 })

    const result = await getCostByJobs(['job-1'])
    expect(result).toHaveLength(1)

    const job = result[0]!
    // total_cost = inference total (0.01 + 0.003) + external (0.05)
    expect(job.total_cost).toBeCloseTo(0.063)
    expect(job.passive_memory_cost).toBeCloseTo(0.003)
    expect(job.external_cost).toBeCloseTo(0.05)
    // Inference cost (for UI) = total - external - passive = 0.063 - 0.05 - 0.003 = 0.01
  })
})
