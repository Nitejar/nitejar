import { Kysely, sql } from 'kysely'

function currentTimestamp(): number {
  return Math.floor(Date.now() / 1000)
}

async function hasRoutinesTable(db: Kysely<unknown>): Promise<boolean> {
  const typedDb = db as Kysely<any> & { executeQuery?: unknown }

  // Unit tests use a lightweight mocked DB that only stubs the update builder.
  // In that case, assume the table exists so the migration logic stays testable.
  if (typeof typedDb.executeQuery !== 'function') {
    return true
  }

  const routinesTable = await sql<{ count: number }>`
    SELECT COUNT(*) AS count
    FROM sqlite_master
    WHERE type = 'table' AND name = 'routines'
  `.execute(typedDb)

  return Number(routinesTable.rows[0]?.count ?? 0) > 0
}

export async function up(db: Kysely<unknown>): Promise<void> {
  const typedDb = db as Kysely<any>
  if (!(await hasRoutinesTable(db))) {
    return
  }

  await typedDb
    .updateTable('routines')
    .set({
      enabled: 0,
      next_run_at: null,
      archived_at: currentTimestamp(),
    })
    .where('target_session_key', 'like', 'work:team:%:heartbeat')
    .where('archived_at', 'is', null)
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  const typedDb = db as Kysely<any>
  if (!(await hasRoutinesTable(db))) {
    return
  }

  await typedDb
    .updateTable('routines')
    .set({
      archived_at: null,
    })
    .where('target_session_key', 'like', 'work:team:%:heartbeat')
    .execute()
}
