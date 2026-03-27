import { Kysely, sql } from 'kysely'

const isPostgres =
  (process.env.DATABASE_URL || '').startsWith('postgres://') ||
  (process.env.DATABASE_URL || '').startsWith('postgresql://')

async function hasTable(db: Kysely<unknown>, tableName: string): Promise<boolean> {
  if (isPostgres) {
    const result = await sql<{ count: number }>`
      SELECT COUNT(*) AS count
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${tableName}
    `.execute(db)

    return Number(result.rows[0]?.count ?? 0) > 0
  }

  const result = await sql<{ count: number }>`
    SELECT COUNT(*) AS count
    FROM sqlite_master
    WHERE type = 'table' AND name = ${tableName}
  `.execute(db)

  return Number(result.rows[0]?.count ?? 0) > 0
}

export async function up(db: Kysely<unknown>): Promise<void> {
  if (!(await hasTable(db, 'agents'))) return

  if (isPostgres) {
    await sql`
      UPDATE agents
      SET config = (
        (config::jsonb - 'allowEphemeralSandboxCreation' - 'allowRoutineManagement' - 'dangerouslyUnrestricted')::text
      )
      WHERE config IS NOT NULL
        AND jsonb_typeof(config::jsonb) = 'object'
    `.execute(db)
    return
  }

  await sql`
    UPDATE agents
    SET config = CASE
      WHEN json_valid(config) = 1 AND json_type(config) = 'object'
        THEN json_remove(
          config,
          '$.allowEphemeralSandboxCreation',
          '$.allowRoutineManagement',
          '$.dangerouslyUnrestricted'
        )
      ELSE config
    END
    WHERE config IS NOT NULL
  `.execute(db)
}

export async function down(): Promise<void> {
  // Strict cutover: removed legacy config flags stay removed.
}
