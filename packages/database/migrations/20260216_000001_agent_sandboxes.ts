import { Kysely, sql } from 'kysely'

const isPostgres =
  (process.env.DATABASE_URL || '').startsWith('postgres://') ||
  (process.env.DATABASE_URL || '').startsWith('postgresql://')

const defaultTimestamp = isPostgres ? sql`extract(epoch from now())::integer` : sql`(unixepoch())`

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('agent_sandboxes')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('agent_id', 'text', (col) =>
      col.notNull().references('agents.id').onDelete('cascade')
    )
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('description', 'text', (col) => col.notNull())
    .addColumn('sprite_name', 'text', (col) => col.notNull())
    .addColumn('kind', 'text', (col) => col.notNull())
    .addColumn('created_by', 'text', (col) => col.notNull().defaultTo('system'))
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addColumn('last_used_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addUniqueConstraint('agent_sandboxes_agent_name_unique', ['agent_id', 'name'])
    .addUniqueConstraint('agent_sandboxes_sprite_name_unique', ['sprite_name'])
    .execute()

  await db.schema
    .createIndex('idx_agent_sandboxes_agent_kind')
    .ifNotExists()
    .on('agent_sandboxes')
    .columns(['agent_id', 'kind'])
    .execute()

  await db.schema
    .createIndex('idx_agent_sandboxes_last_used_at')
    .ifNotExists()
    .on('agent_sandboxes')
    .column('last_used_at')
    .execute()

  await sql`
    INSERT INTO agent_sandboxes (
      id,
      agent_id,
      name,
      description,
      sprite_name,
      kind,
      created_by,
      created_at,
      updated_at,
      last_used_at
    )
    SELECT
      'home-' || a.id,
      a.id,
      'home',
      'Persistent home sandbox',
      COALESCE(a.sprite_id, 'nitejar-' || a.id),
      'home',
      'system',
      ${defaultTimestamp},
      ${defaultTimestamp},
      ${defaultTimestamp}
    FROM agents a
    WHERE NOT EXISTS (
      SELECT 1
      FROM agent_sandboxes s
      WHERE s.agent_id = a.id
        AND s.name = 'home'
    )
  `.execute(db)
}
