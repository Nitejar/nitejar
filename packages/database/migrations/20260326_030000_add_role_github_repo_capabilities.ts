import { type Kysely } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('role_github_repo_capabilities')
    .addColumn('role_id', 'text', (col) => col.notNull().references('roles.id').onDelete('cascade'))
    .addColumn('github_repo_id', 'integer', (col) =>
      col.notNull().references('github_repos.id').onDelete('cascade')
    )
    .addColumn('capabilities', 'text', (col) => col.notNull())
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('updated_at', 'integer', (col) => col.notNull())
    .addPrimaryKeyConstraint('role_github_repo_capabilities_pk', ['role_id', 'github_repo_id'])
    .execute()

  await db.schema
    .createIndex('idx_role_github_repo_capabilities_role')
    .on('role_github_repo_capabilities')
    .column('role_id')
    .execute()

  await db.schema
    .createIndex('idx_role_github_repo_capabilities_repo')
    .on('role_github_repo_capabilities')
    .column('github_repo_id')
    .execute()

  await db.deleteFrom('role_grants').where('action', '=', 'capability.tool_execution').execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('idx_role_github_repo_capabilities_repo').ifExists().execute()
  await db.schema.dropIndex('idx_role_github_repo_capabilities_role').ifExists().execute()
  await db.schema.dropTable('role_github_repo_capabilities').ifExists().execute()
}
