import { mkdirSync, rmSync } from 'fs'
import { dirname, join } from 'path'
import { getDb, closeDb, getDatabaseType } from '@nitejar/database'
import { runMigrations } from '@nitejar/database/migrate'

const DEFAULT_SQLITE_PATH = join(
  process.cwd(),
  '.tmp',
  'integration-tests',
  `nitejar-${process.pid}.db`
)

const DEFAULT_ENCRYPTION_KEY = '0000000000000000000000000000000000000000000000000000000000000000'

const TABLE_DELETE_ORDER = [
  // Ops/event stream
  'audit_logs',
  'activity_log',
  'external_api_calls',
  'inference_calls',
  'model_call_payloads',
  'background_tasks',
  'spans',
  'cost_limits',
  'model_catalog',
  'gateway_settings',
  'capability_settings',
  'effect_outbox',
  'run_dispatches',
  'queue_messages',
  'queue_lanes',
  'runtime_control',
  'routine_event_queue',
  'routine_runs',
  'routines',
  'scheduled_items',
  'messages',
  'jobs',
  'idempotency_keys',
  'work_items',
  // Collections / skills / evals
  'collection_schema_reviews',
  'collection_permissions',
  'collection_rows',
  'collections',
  'skill_assignments',
  'skill_files',
  'skills',
  'improvement_suggestions',
  'eval_results',
  'eval_runs',
  'agent_evaluators',
  'evaluators',
  'rubrics',
  'eval_settings',
  // Integrations/plugins
  'agent_repo_capabilities',
  'github_repos',
  'github_installations',
  'agent_plugin_instances',
  'plugin_instances',
  'plugin_disclosure_acks',
  'plugin_events',
  'plugin_versions',
  'plugin_artifacts',
  'plugins',
  // Legacy table names retained for compatibility with older schemas
  'agent_integrations',
  'integrations',
  // Agent state
  'agent_credentials',
  'credentials',
  'agent_messages',
  'agent_memories',
  'session_summaries',
  'sprite_sessions',
  'agent_sandboxes',
  'agents',
]

function isMissingTableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return (
    message.includes('no such table') ||
    message.includes('does not exist') ||
    message.includes('undefined table')
  )
}

function isPostgresUrl(url: string): boolean {
  return url.startsWith('postgres://') || url.startsWith('postgresql://')
}

function ensureTestEnv(): void {
  process.env.NODE_ENV = 'test'
  if (!process.env.ENCRYPTION_KEY) {
    process.env.ENCRYPTION_KEY = DEFAULT_ENCRYPTION_KEY
  }

  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = DEFAULT_SQLITE_PATH
  }

  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) {
    throw new Error('DATABASE_URL is required for integration tests')
  }

  if (isPostgresUrl(dbUrl)) {
    const dbName = new URL(dbUrl).pathname.replace('/', '')
    if (dbName && !dbName.includes('test') && process.env.SLOPBOT_TEST_ALLOW_NON_TEST_DB !== '1') {
      throw new Error(
        `Refusing to run integration tests against non-test database "${dbName}". ` +
          'Set SLOPBOT_TEST_ALLOW_NON_TEST_DB=1 to override.'
      )
    }
  } else {
    if (
      dbUrl.includes('apps/web/data/nitejar.db') &&
      process.env.SLOPBOT_TEST_ALLOW_DEV_DB !== '1'
    ) {
      throw new Error(
        'Refusing to run integration tests against apps/web/data/nitejar.db. ' +
          'Set SLOPBOT_TEST_ALLOW_DEV_DB=1 to override.'
      )
    }
    const dir = dirname(dbUrl)
    if (dir && dir !== '.') {
      mkdirSync(dir, { recursive: true })
    }
  }
}

export async function setupTestDb(): Promise<void> {
  ensureTestEnv()
  await runMigrations()
}

export async function resetTestDb(): Promise<void> {
  const db = getDb()

  for (const table of TABLE_DELETE_ORDER) {
    try {
      await db.deleteFrom(table).execute()
    } catch (error) {
      if (isMissingTableError(error)) continue
      throw error
    }
  }
}

export async function teardownTestDb(): Promise<void> {
  await closeDb()

  if (process.env.DATABASE_URL === DEFAULT_SQLITE_PATH) {
    rmSync(DEFAULT_SQLITE_PATH, { force: true })
  }
}

export function getTestDatabaseType(): ReturnType<typeof getDatabaseType> {
  return getDatabaseType()
}
