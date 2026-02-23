import { Kysely, sql } from 'kysely'

const isPostgres =
  (process.env.DATABASE_URL || '').startsWith('postgres://') ||
  (process.env.DATABASE_URL || '').startsWith('postgresql://')

const defaultTimestamp = isPostgres ? sql`extract(epoch from now())::integer` : sql`(unixepoch())`

export async function up(db: Kysely<unknown>): Promise<void> {
  // Skills table
  await db.schema
    .createTable('skills')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('slug', 'text', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('category', 'text', (col) => col.notNull().defaultTo('general'))
    .addColumn('source_kind', 'text', (col) => col.notNull())
    .addColumn('plugin_id', 'text', (col) => col.references('plugins.id').onDelete('set null'))
    .addColumn('source_ref', 'text')
    .addColumn('content', 'text', (col) => col.notNull())
    .addColumn('is_directory', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('version', 'text')
    .addColumn('checksum', 'text')
    .addColumn('enabled', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('tags_json', 'text')
    .addColumn('requires_tools_json', 'text')
    .addColumn('metadata_json', 'text')
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .execute()

  await db.schema
    .createIndex('idx_skills_slug')
    .ifNotExists()
    .on('skills')
    .column('slug')
    .unique()
    .execute()

  await db.schema
    .createIndex('idx_skills_source_kind')
    .ifNotExists()
    .on('skills')
    .column('source_kind')
    .execute()

  await db.schema
    .createIndex('idx_skills_plugin_id')
    .ifNotExists()
    .on('skills')
    .column('plugin_id')
    .execute()

  await db.schema
    .createIndex('idx_skills_category')
    .ifNotExists()
    .on('skills')
    .column('category')
    .execute()

  await db.schema
    .createIndex('idx_skills_enabled')
    .ifNotExists()
    .on('skills')
    .column('enabled')
    .execute()

  // Skill files table
  await db.schema
    .createTable('skill_files')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('skill_id', 'text', (col) =>
      col.notNull().references('skills.id').onDelete('cascade')
    )
    .addColumn('relative_path', 'text', (col) => col.notNull())
    .addColumn('content', 'text', (col) => col.notNull())
    .addColumn('content_type', 'text')
    .addColumn('size_bytes', 'integer')
    .addColumn('checksum', 'text')
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .execute()

  await db.schema
    .createIndex('idx_skill_files_path')
    .ifNotExists()
    .on('skill_files')
    .columns(['skill_id', 'relative_path'])
    .unique()
    .execute()

  await db.schema
    .createIndex('idx_skill_files_skill')
    .ifNotExists()
    .on('skill_files')
    .column('skill_id')
    .execute()

  // Skill assignments table
  await db.schema
    .createTable('skill_assignments')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('skill_id', 'text', (col) =>
      col.notNull().references('skills.id').onDelete('cascade')
    )
    .addColumn('skill_slug', 'text', (col) => col.notNull())
    .addColumn('scope', 'text', (col) => col.notNull())
    .addColumn('scope_id', 'text')
    .addColumn('priority', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('auto_inject', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('enabled', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .execute()

  await db.schema
    .createIndex('idx_skill_assignments_unique')
    .ifNotExists()
    .on('skill_assignments')
    .columns(['skill_id', 'scope', 'scope_id'])
    .unique()
    .execute()

  await db.schema
    .createIndex('idx_skill_assignments_scope')
    .ifNotExists()
    .on('skill_assignments')
    .columns(['scope', 'scope_id'])
    .execute()

  await db.schema
    .createIndex('idx_skill_assignments_skill')
    .ifNotExists()
    .on('skill_assignments')
    .column('skill_id')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('idx_skill_assignments_skill').ifExists().execute()
  await db.schema.dropIndex('idx_skill_assignments_scope').ifExists().execute()
  await db.schema.dropIndex('idx_skill_assignments_unique').ifExists().execute()
  await db.schema.dropTable('skill_assignments').ifExists().execute()

  await db.schema.dropIndex('idx_skill_files_skill').ifExists().execute()
  await db.schema.dropIndex('idx_skill_files_path').ifExists().execute()
  await db.schema.dropTable('skill_files').ifExists().execute()

  await db.schema.dropIndex('idx_skills_enabled').ifExists().execute()
  await db.schema.dropIndex('idx_skills_category').ifExists().execute()
  await db.schema.dropIndex('idx_skills_plugin_id').ifExists().execute()
  await db.schema.dropIndex('idx_skills_source_kind').ifExists().execute()
  await db.schema.dropIndex('idx_skills_slug').ifExists().execute()
  await db.schema.dropTable('skills').ifExists().execute()
}
