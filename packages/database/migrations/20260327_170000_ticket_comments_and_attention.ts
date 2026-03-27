import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import type { Database } from '../src/types'

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema
    .createTable('ticket_comments')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('ticket_id', 'text', (col) => col.notNull().references('tickets.id').onDelete('cascade'))
    .addColumn('author_kind', 'text', (col) => col.notNull())
    .addColumn('author_ref', 'text')
    .addColumn('kind', 'text', (col) => col.notNull().defaultTo('comment'))
    .addColumn('body', 'text', (col) => col.notNull())
    .addColumn('metadata_json', 'text')
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('updated_at', 'integer', (col) => col.notNull())
    .execute()

  await db.schema
    .createTable('ticket_participants')
    .ifNotExists()
    .addColumn('ticket_id', 'text', (col) => col.notNull().references('tickets.id').onDelete('cascade'))
    .addColumn('participant_kind', 'text', (col) => col.notNull())
    .addColumn('participant_ref', 'text', (col) => col.notNull())
    .addColumn('added_by_kind', 'text', (col) => col.notNull())
    .addColumn('added_by_ref', 'text')
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .execute()

  await db.schema
    .createTable('attention_items')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('target_kind', 'text', (col) => col.notNull())
    .addColumn('target_ref', 'text', (col) => col.notNull())
    .addColumn('source_kind', 'text', (col) => col.notNull())
    .addColumn('source_ref', 'text', (col) => col.notNull())
    .addColumn('ticket_id', 'text', (col) => col.references('tickets.id').onDelete('cascade'))
    .addColumn('goal_id', 'text', (col) => col.references('goals.id').onDelete('cascade'))
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('open'))
    .addColumn('title', 'text', (col) => col.notNull())
    .addColumn('body', 'text')
    .addColumn('metadata_json', 'text')
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('updated_at', 'integer', (col) => col.notNull())
    .addColumn('resolved_at', 'integer')
    .addColumn('resolved_by_kind', 'text')
    .addColumn('resolved_by_ref', 'text')
    .execute()

  await db.schema
    .createIndex('idx_ticket_comments_ticket_created_at')
    .ifNotExists()
    .on('ticket_comments')
    .columns(['ticket_id', 'created_at'])
    .execute()

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_participants_unique
    ON ticket_participants(ticket_id, participant_kind, participant_ref)
  `.execute(db)

  await db.schema
    .createIndex('idx_attention_items_target_status_created_at')
    .ifNotExists()
    .on('attention_items')
    .columns(['target_kind', 'target_ref', 'status', 'created_at'])
    .execute()

  await db.schema
    .createIndex('idx_attention_items_ticket_status_created_at')
    .ifNotExists()
    .on('attention_items')
    .columns(['ticket_id', 'status', 'created_at'])
    .execute()
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema.dropIndex('idx_attention_items_ticket_status_created_at').ifExists().execute()
  await db.schema.dropIndex('idx_attention_items_target_status_created_at').ifExists().execute()
  await sql`DROP INDEX IF EXISTS idx_ticket_participants_unique`.execute(db)
  await db.schema.dropIndex('idx_ticket_comments_ticket_created_at').ifExists().execute()
  await db.schema.dropTable('attention_items').ifExists().execute()
  await db.schema.dropTable('ticket_participants').ifExists().execute()
  await db.schema.dropTable('ticket_comments').ifExists().execute()
}
