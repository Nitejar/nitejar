import type { Kysely } from 'kysely'

interface Database {}

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema.alterTable('attention_items').addColumn('read_at', 'integer').execute()
  await db.schema.alterTable('attention_items').addColumn('read_by_kind', 'text').execute()
  await db.schema.alterTable('attention_items').addColumn('read_by_ref', 'text').execute()

  await db.schema
    .createIndex('idx_attention_items_target_read_status_created_at')
    .ifNotExists()
    .on('attention_items')
    .columns(['target_kind', 'target_ref', 'read_at', 'status', 'created_at'])
    .execute()
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.schema
    .dropIndex('idx_attention_items_target_read_status_created_at')
    .ifExists()
    .execute()

  await db.schema.alterTable('attention_items').dropColumn('read_by_ref').execute()
  await db.schema.alterTable('attention_items').dropColumn('read_by_kind').execute()
  await db.schema.alterTable('attention_items').dropColumn('read_at').execute()
}
