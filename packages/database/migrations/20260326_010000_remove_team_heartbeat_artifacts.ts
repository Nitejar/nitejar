import { Kysely, sql } from 'kysely'

const TEAM_HEARTBEAT_SESSION_KEY_PATTERN = 'work:team:%:heartbeat'
const isPostgres =
  (process.env.DATABASE_URL || '').startsWith('postgres://') ||
  (process.env.DATABASE_URL || '').startsWith('postgresql://')

async function hasTable(db: Kysely<unknown>, tableName: string): Promise<boolean> {
  const typedDb = db as Kysely<any> & { executeQuery?: unknown }

  // Unit tests use a lightweight mocked DB that only stubs delete builders.
  if (typeof typedDb.executeQuery !== 'function') {
    return true
  }

  if (isPostgres) {
    const result = await sql<{ count: number }>`
      SELECT COUNT(*) AS count
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${tableName}
    `.execute(typedDb)

    return Number(result.rows[0]?.count ?? 0) > 0
  }

  const result = await sql<{ count: number }>`
    SELECT COUNT(*) AS count
    FROM sqlite_master
    WHERE type = 'table' AND name = ${tableName}
  `.execute(typedDb)

  return Number(result.rows[0]?.count ?? 0) > 0
}

export async function up(db: Kysely<unknown>): Promise<void> {
  const typedDb = db as Kysely<any>

  if (await hasTable(db, 'scheduled_items')) {
    await typedDb
      .deleteFrom('scheduled_items')
      .where('session_key', 'like', TEAM_HEARTBEAT_SESSION_KEY_PATTERN)
      .execute()
  }

  if (await hasTable(db, 'agent_messages')) {
    await typedDb
      .deleteFrom('agent_messages')
      .where('session_key', 'like', TEAM_HEARTBEAT_SESSION_KEY_PATTERN)
      .execute()
  }

  if (await hasTable(db, 'session_summaries')) {
    await typedDb
      .deleteFrom('session_summaries')
      .where('session_key', 'like', TEAM_HEARTBEAT_SESSION_KEY_PATTERN)
      .execute()
  }

  if (await hasTable(db, 'sprite_sessions')) {
    await typedDb
      .deleteFrom('sprite_sessions')
      .where('session_key', 'like', TEAM_HEARTBEAT_SESSION_KEY_PATTERN)
      .execute()
  }

  if (await hasTable(db, 'queue_lanes')) {
    await typedDb
      .deleteFrom('queue_lanes')
      .where('session_key', 'like', TEAM_HEARTBEAT_SESSION_KEY_PATTERN)
      .execute()
  }

  if (await hasTable(db, 'work_items')) {
    await typedDb
      .deleteFrom('work_items')
      .where('session_key', 'like', TEAM_HEARTBEAT_SESSION_KEY_PATTERN)
      .execute()
  }

  if (await hasTable(db, 'app_sessions')) {
    await typedDb
      .deleteFrom('app_sessions')
      .where('session_key', 'like', TEAM_HEARTBEAT_SESSION_KEY_PATTERN)
      .execute()
  }

  if (await hasTable(db, 'work_updates')) {
    await typedDb
      .deleteFrom('work_updates')
      .where('kind', '=', 'heartbeat')
      .where('team_id', 'is not', null)
      .execute()
  }

  if (await hasTable(db, 'routines')) {
    await typedDb
      .deleteFrom('routines')
      .where('target_session_key', 'like', TEAM_HEARTBEAT_SESSION_KEY_PATTERN)
      .execute()
  }
}

export async function down(): Promise<void> {
  // Destructive cutover: team heartbeat artifacts are intentionally not restored.
}
