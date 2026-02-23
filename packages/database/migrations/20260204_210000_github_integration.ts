import { Kysely, sql } from 'kysely'

const isPostgres =
  (process.env.DATABASE_URL || '').startsWith('postgres://') ||
  (process.env.DATABASE_URL || '').startsWith('postgresql://')

const defaultTimestamp = isPostgres ? sql`extract(epoch from now())::integer` : sql`(unixepoch())`

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('github_installations')
    .ifNotExists()
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('installation_id', 'integer', (col) => col.notNull())
    .addColumn('account_login', 'text')
    .addColumn('account_id', 'integer')
    .addColumn('plugin_instance_id', 'text', (col) =>
      col.notNull().references('plugin_instances.id').onDelete('cascade')
    )
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .execute()

  await db.schema
    .createTable('github_repos')
    .ifNotExists()
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('repo_id', 'integer', (col) => col.notNull())
    .addColumn('full_name', 'text', (col) => col.notNull())
    .addColumn('html_url', 'text')
    .addColumn('installation_id', 'integer', (col) =>
      col.notNull().references('github_installations.id').onDelete('cascade')
    )
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .execute()

  await db.schema
    .createTable('agent_repo_capabilities')
    .ifNotExists()
    .addColumn('agent_id', 'text', (col) =>
      col.notNull().references('agents.id').onDelete('cascade')
    )
    .addColumn('github_repo_id', 'integer', (col) =>
      col.notNull().references('github_repos.id').onDelete('cascade')
    )
    .addColumn('capabilities', 'text', (col) => col.notNull().defaultTo('[]'))
    .addPrimaryKeyConstraint('agent_repo_capabilities_pk', ['agent_id', 'github_repo_id'])
    .execute()

  await db.schema
    .createIndex('idx_github_installations_installation_id')
    .ifNotExists()
    .on('github_installations')
    .column('installation_id')
    .unique()
    .execute()

  await db.schema
    .createIndex('idx_github_repos_repo_id')
    .ifNotExists()
    .on('github_repos')
    .column('repo_id')
    .unique()
    .execute()

  await db.schema
    .createIndex('idx_github_repos_installation_id')
    .ifNotExists()
    .on('github_repos')
    .column('installation_id')
    .execute()

  await db.schema
    .createIndex('idx_agent_repo_capabilities_agent')
    .ifNotExists()
    .on('agent_repo_capabilities')
    .column('agent_id')
    .execute()

  await db.schema
    .createIndex('idx_agent_repo_capabilities_repo')
    .ifNotExists()
    .on('agent_repo_capabilities')
    .column('github_repo_id')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('idx_agent_repo_capabilities_repo').ifExists().execute()

  await db.schema.dropIndex('idx_agent_repo_capabilities_agent').ifExists().execute()

  await db.schema.dropIndex('idx_github_repos_installation_id').ifExists().execute()

  await db.schema.dropIndex('idx_github_repos_repo_id').ifExists().execute()

  await db.schema.dropIndex('idx_github_installations_installation_id').ifExists().execute()

  await db.schema.dropTable('agent_repo_capabilities').ifExists().execute()

  await db.schema.dropTable('github_repos').ifExists().execute()

  await db.schema.dropTable('github_installations').ifExists().execute()
}
