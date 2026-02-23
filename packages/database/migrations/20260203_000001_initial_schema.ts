import { Kysely, sql } from 'kysely'

const isPostgres =
  (process.env.DATABASE_URL || '').startsWith('postgres://') ||
  (process.env.DATABASE_URL || '').startsWith('postgresql://')

const defaultTimestamp = isPostgres ? sql`extract(epoch from now())::integer` : sql`(unixepoch())`

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('plugin_instances')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('plugin_id', 'text', (col) => col.notNull())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('config_json', 'text')
    .addColumn('scope', 'text', (col) => col.notNull().defaultTo('global'))
    .addColumn('enabled', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .execute()

  await db.schema
    .createTable('agents')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('name', 'text', (col) => col.notNull().unique())
    .addColumn('sprite_id', 'text')
    .addColumn('config', 'text')
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('idle'))
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .execute()

  await db.schema
    .createTable('agent_plugin_instances')
    .ifNotExists()
    .addColumn('agent_id', 'text', (col) =>
      col.notNull().references('agents.id').onDelete('cascade')
    )
    .addColumn('plugin_instance_id', 'text', (col) =>
      col.notNull().references('plugin_instances.id').onDelete('cascade')
    )
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addPrimaryKeyConstraint('agent_plugin_instances_pk', ['agent_id', 'plugin_instance_id'])
    .execute()

  await db.schema
    .createTable('agent_memories')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('agent_id', 'text', (col) =>
      col.notNull().references('agents.id').onDelete('cascade')
    )
    .addColumn('content', 'text', (col) => col.notNull())
    .addColumn('embedding', 'blob')
    .addColumn('strength', 'real', (col) => col.notNull().defaultTo(1.0))
    .addColumn('access_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('permanent', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('last_accessed_at', 'integer')
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .execute()

  await db.schema
    .createTable('work_items')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('plugin_instance_id', 'text', (col) => col.references('plugin_instances.id'))
    .addColumn('session_key', 'text', (col) => col.notNull())
    .addColumn('source', 'text', (col) => col.notNull())
    .addColumn('source_ref', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('NEW'))
    .addColumn('title', 'text', (col) => col.notNull())
    .addColumn('payload', 'text')
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .execute()

  await db.schema
    .createTable('jobs')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('work_item_id', 'text', (col) =>
      col.notNull().references('work_items.id').onDelete('cascade')
    )
    .addColumn('agent_id', 'text', (col) =>
      col.notNull().references('agents.id').onDelete('cascade')
    )
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('PENDING'))
    .addColumn('error_text', 'text')
    .addColumn('started_at', 'integer')
    .addColumn('completed_at', 'integer')
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .execute()

  await db.schema
    .createTable('messages')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('job_id', 'text', (col) => col.notNull().references('jobs.id').onDelete('cascade'))
    .addColumn('role', 'text', (col) => col.notNull())
    .addColumn('content', 'text')
    .addColumn('embedding', 'blob')
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .execute()

  await db.schema
    .createTable('session_summaries')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('session_key', 'text', (col) => col.notNull())
    .addColumn('agent_id', 'text', (col) =>
      col.notNull().references('agents.id').onDelete('cascade')
    )
    .addColumn('summary', 'text', (col) => col.notNull())
    .addColumn('turn_count', 'integer', (col) => col.notNull())
    .addColumn('start_time', 'integer', (col) => col.notNull())
    .addColumn('end_time', 'integer', (col) => col.notNull())
    .addColumn('embedding', 'blob')
    .addColumn('compacted_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .execute()

  await db.schema
    .createTable('idempotency_keys')
    .ifNotExists()
    .addColumn('key', 'text', (col) => col.primaryKey())
    .addColumn('work_item_id', 'text', (col) => col.references('work_items.id').onDelete('cascade'))
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .execute()

  await db.schema
    .createTable('sprite_sessions')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('sprite_name', 'text', (col) => col.notNull())
    .addColumn('session_id', 'text', (col) => col.notNull())
    .addColumn('session_key', 'text', (col) => col.notNull())
    .addColumn('agent_id', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('active'))
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addColumn('last_active_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .execute()

  await addColumnIfNotExists(db, 'messages', 'embedding', 'blob')
  await addColumnIfNotExists(db, 'sprite_sessions', 'session_key', 'text')
  await addColumnIfNotExists(db, 'sprite_sessions', 'agent_id', 'text')

  await db.schema
    .createIndex('idx_work_items_plugin_instance')
    .ifNotExists()
    .on('work_items')
    .column('plugin_instance_id')
    .execute()

  await db.schema
    .createIndex('idx_work_items_status')
    .ifNotExists()
    .on('work_items')
    .column('status')
    .execute()

  await db.schema
    .createIndex('idx_work_items_session_key')
    .ifNotExists()
    .on('work_items')
    .column('session_key')
    .execute()

  await db.schema
    .createIndex('idx_jobs_work_item')
    .ifNotExists()
    .on('jobs')
    .column('work_item_id')
    .execute()

  await db.schema
    .createIndex('idx_jobs_agent')
    .ifNotExists()
    .on('jobs')
    .column('agent_id')
    .execute()

  await db.schema
    .createIndex('idx_messages_job')
    .ifNotExists()
    .on('messages')
    .column('job_id')
    .execute()

  await db.schema
    .createIndex('idx_agent_memories_agent')
    .ifNotExists()
    .on('agent_memories')
    .column('agent_id')
    .execute()

  await db.schema
    .createIndex('idx_agent_memories_strength')
    .ifNotExists()
    .on('agent_memories')
    .columns(['agent_id', 'strength'])
    .execute()

  await db.schema
    .createIndex('idx_session_summaries_session_key')
    .ifNotExists()
    .on('session_summaries')
    .column('session_key')
    .execute()

  await db.schema
    .createIndex('idx_session_summaries_agent')
    .ifNotExists()
    .on('session_summaries')
    .column('agent_id')
    .execute()

  await db.schema
    .createIndex('idx_sprite_sessions_session_key_agent')
    .ifNotExists()
    .on('sprite_sessions')
    .columns(['session_key', 'agent_id'])
    .execute()

  await db.schema
    .createIndex('idx_sprite_sessions_status')
    .ifNotExists()
    .on('sprite_sessions')
    .column('status')
    .execute()

  await db.schema
    .createIndex('idx_sprite_sessions_sprite_name')
    .ifNotExists()
    .on('sprite_sessions')
    .column('sprite_name')
    .execute()
}

async function addColumnIfNotExists(
  db: Kysely<unknown>,
  table: string,
  column: string,
  type: string
): Promise<void> {
  try {
    await db.schema
      .alterTable(table)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .addColumn(column, type as any)
      .execute()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('duplicate column') || message.includes('already exists')) {
      return
    }
    throw error
  }
}
