import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  const defaultTimestamp = sql`(strftime('%s', 'now'))`

  await db.schema
    .createTable('agent_messages')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('from_agent_id', 'text', (col) =>
      col.notNull().references('agents.id').onDelete('cascade')
    )
    .addColumn('to_agent_id', 'text', (col) =>
      col.notNull().references('agents.id').onDelete('cascade')
    )
    .addColumn('session_key', 'text')
    .addColumn('content', 'text', (col) => col.notNull())
    .addColumn('delivered', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .execute()

  await db.schema
    .createIndex('idx_agent_messages_to_delivered')
    .ifNotExists()
    .on('agent_messages')
    .columns(['to_agent_id', 'delivered'])
    .execute()
}
