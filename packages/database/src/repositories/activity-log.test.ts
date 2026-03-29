import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../db'
import { normalizeActivitySummary, resolveActivityGoalSnapshot } from './activity-log'

let testDir = ''
let db: ReturnType<typeof getDb>

describe('activity-log repository helpers', () => {
  beforeAll(async () => {
    await closeDb()
    testDir = mkdtempSync(join(tmpdir(), 'nitejar-activity-log-'))
    process.env.DATABASE_URL = join(testDir, 'test.sqlite')
    db = getDb()

    await db.schema
      .createTable('goals')
      .addColumn('id', 'text', (col) => col.primaryKey())
      .addColumn('title', 'text', (col) => col.notNull())
      .addColumn('outcome', 'text', (col) => col.notNull())
      .addColumn('status', 'text', (col) => col.notNull())
      .execute()

    await db.schema
      .createTable('routines')
      .addColumn('id', 'text', (col) => col.primaryKey())
      .addColumn('agent_id', 'text')
      .addColumn('target_session_key', 'text', (col) => col.notNull())
      .addColumn('name', 'text', (col) => col.notNull())
      .addColumn('description', 'text')
      .addColumn('enabled', 'integer')
      .addColumn('trigger_kind', 'text')
      .addColumn('cron_expr', 'text')
      .addColumn('timezone', 'text')
      .addColumn('rule_json', 'text')
      .addColumn('condition_probe', 'text')
      .addColumn('condition_config', 'text')
      .addColumn('target_plugin_instance_id', 'text')
      .addColumn('target_response_context', 'text')
      .addColumn('target_spec_json', 'text')
      .addColumn('action_prompt', 'text')
      .addColumn('next_run_at', 'integer')
      .addColumn('last_evaluated_at', 'integer')
      .addColumn('last_fired_at', 'integer')
      .addColumn('last_status', 'text')
      .addColumn('created_by_kind', 'text')
      .addColumn('created_by_ref', 'text')
      .addColumn('created_at', 'integer', (col) => col.notNull())
      .addColumn('updated_at', 'integer')
      .addColumn('archived_at', 'integer')
      .execute()
  })

  afterAll(async () => {
    await closeDb()
    delete process.env.DATABASE_URL
    if (testDir) rmSync(testDir, { recursive: true, force: true })
  })

  it('returns trimmed summary when provided', () => {
    expect(normalizeActivitySummary('  valid reason  ')).toBe('valid reason')
  })

  it('returns fallback when summary is blank', () => {
    expect(normalizeActivitySummary('   ', 'fallback reason')).toBe('fallback reason')
  })

  it('returns deterministic default when both summary and fallback are blank', () => {
    expect(normalizeActivitySummary('   ', '   ')).toBe('Auto-derived reason: no reason provided')
  })

  it('captures goal heartbeat snapshots from the session key and routine context', async () => {
    await db.deleteFrom('routines').execute()
    await db.deleteFrom('goals').execute()

    await db
      .insertInto('goals')
      .values({
        id: 'goal-1',
        title: 'Keep onboarding healthy',
        outcome: 'Steady conversion and fewer stuck trials.',
        status: 'active',
      })
      .execute()

    await db
      .insertInto('routines')
      .values({
        id: 'routine-1',
        agent_id: 'agent-1',
        target_session_key: 'work:goal:goal-1:heartbeat',
        name: 'Goal Stewardship · Keep onboarding healthy',
        description: null,
        enabled: 1,
        trigger_kind: 'cron',
        cron_expr: '0 9 * * 1-5',
        timezone: 'America/Chicago',
        rule_json: '{}',
        condition_probe: null,
        condition_config: null,
        target_plugin_instance_id: null,
        target_response_context: null,
        action_prompt: 'Check the goal heartbeat.',
        next_run_at: null,
        last_evaluated_at: null,
        last_fired_at: null,
        last_status: null,
        created_by_kind: 'test',
        created_by_ref: null,
        created_at: 1,
        updated_at: 1,
        archived_at: null,
      })
      .execute()

    const snapshot = await resolveActivityGoalSnapshot({
      session_key: 'work:goal:goal-1:heartbeat',
      source_ref: 'routine:routine-1:scheduled:item-1',
    } as never)

    expect(snapshot?.goalId).toBe('goal-1')
    expect(snapshot?.goalSnapshotJson).toContain('"goalTitle":"Keep onboarding healthy"')
    expect(snapshot?.goalSnapshotJson).toContain('"cronExpr":"0 9 * * 1-5"')
    expect(snapshot?.goalSnapshotJson).toContain('"timezone":"America/Chicago"')
  })
})
