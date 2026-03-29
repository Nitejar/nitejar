import { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  const typedDb = db as Kysely<any>

  await addColumnIfNotExists('parent_job_id', () =>
    typedDb.schema
      .alterTable('jobs')
      .addColumn('parent_job_id', 'text', (col) => col.references('jobs.id').onDelete('set null'))
      .execute()
  )
  await addColumnIfNotExists('root_job_id', () =>
    typedDb.schema
      .alterTable('jobs')
      .addColumn('root_job_id', 'text', (col) => col.references('jobs.id').onDelete('set null'))
      .execute()
  )
  await addColumnIfNotExists('run_kind', () =>
    typedDb.schema
      .alterTable('jobs')
      .addColumn('run_kind', 'text', (col) => col.notNull().defaultTo('primary'))
      .execute()
  )
  await addColumnIfNotExists('origin_tool_name', () =>
    typedDb.schema.alterTable('jobs').addColumn('origin_tool_name', 'text').execute()
  )

  await typedDb.schema
    .createIndex('idx_jobs_parent')
    .ifNotExists()
    .on('jobs')
    .column('parent_job_id')
    .execute()
  await typedDb.schema
    .createIndex('idx_jobs_root')
    .ifNotExists()
    .on('jobs')
    .column('root_job_id')
    .execute()
  await typedDb.schema
    .createIndex('idx_jobs_run_kind')
    .ifNotExists()
    .on('jobs')
    .column('run_kind')
    .execute()

  await typedDb
    .updateTable('jobs')
    .set((eb) => ({
      root_job_id: eb.ref('id'),
    }))
    .where('root_job_id', 'is', null)
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  const typedDb = db as Kysely<any>

  await typedDb.schema.dropIndex('idx_jobs_parent').ifExists().execute()
  await typedDb.schema.dropIndex('idx_jobs_root').ifExists().execute()
  await typedDb.schema.dropIndex('idx_jobs_run_kind').ifExists().execute()
  await typedDb.schema.alterTable('jobs').dropColumn('origin_tool_name').execute()
  await typedDb.schema.alterTable('jobs').dropColumn('run_kind').execute()
  await typedDb.schema.alterTable('jobs').dropColumn('root_job_id').execute()
  await typedDb.schema.alterTable('jobs').dropColumn('parent_job_id').execute()
}

async function addColumnIfNotExists(
  columnName: string,
  addColumn: () => Promise<unknown>
): Promise<void> {
  try {
    await addColumn()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (
      message.includes(`duplicate column name: ${columnName}`) ||
      message.includes('already exists')
    ) {
      return
    }
    throw error
  }
}
