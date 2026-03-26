import { type Kysely, sql } from 'kysely'

/**
 * Remove the policy_bundles abstraction. Move grants and defaults to live
 * directly on roles. This is a data migration + schema change:
 *
 * 1. Create role_grants and role_defaults tables
 * 2. Migrate existing data: for each role → collect grants/defaults from all
 *    linked bundles → insert into the new role-direct tables
 * 3. Seed the full grant set for Platform Admin
 * 4. Drop: policy_bundles, role_policy_bundles, policy_grants, policy_defaults,
 *    agent_policy_bundle_assignments
 */

function now(): number {
  return Math.floor(Date.now() / 1000)
}

const PLATFORM_ADMIN_ROLE_ID = 'role_platform_admin'

const FULL_GRANT_SET = [
  // Policy
  { action: 'policy.read', resource_type: '*' },
  { action: 'policy.write', resource_type: '*' },
  { action: 'policy.create', resource_type: '*' },
  { action: 'policy.delete', resource_type: '*' },
  // Goals
  { action: 'work.goal.read', resource_type: 'goal' },
  { action: 'work.goal.write', resource_type: 'goal' },
  { action: 'work.goal.create', resource_type: 'goal' },
  { action: 'work.goal.delete', resource_type: 'goal' },
  // Tickets
  { action: 'work.ticket.read', resource_type: 'ticket' },
  { action: 'work.ticket.write', resource_type: 'ticket' },
  { action: 'work.ticket.create', resource_type: 'ticket' },
  { action: 'work.ticket.delete', resource_type: 'ticket' },
  // Teams
  { action: 'company.team.read', resource_type: 'team' },
  { action: 'company.team.write', resource_type: 'team' },
  { action: 'company.team.create', resource_type: 'team' },
  { action: 'company.team.delete', resource_type: 'team' },
  // Agents
  { action: 'fleet.agent.read', resource_type: 'agent' },
  { action: 'fleet.agent.write', resource_type: 'agent' },
  { action: 'fleet.agent.create', resource_type: 'agent' },
  { action: 'fleet.agent.delete', resource_type: 'agent' },
  { action: 'fleet.agent.control', resource_type: 'agent' },
  // GitHub
  { action: 'github.repo.read', resource_type: '*' },
  { action: 'github.repo.create_branch', resource_type: '*' },
  { action: 'github.repo.push_branch', resource_type: '*' },
  { action: 'github.repo.open_pr', resource_type: '*' },
  { action: 'github.repo.review_pr', resource_type: '*' },
  { action: 'github.repo.comment', resource_type: '*' },
  { action: 'github.repo.label_issue_pr', resource_type: '*' },
  { action: 'github.repo.request_review', resource_type: '*' },
  { action: 'github.repo.merge_pr', resource_type: '*' },
  // Capabilities
  { action: 'capability.web_search', resource_type: '*' },
  { action: 'capability.tool_execution', resource_type: '*' },
  { action: 'capability.image_generation', resource_type: '*' },
  { action: 'capability.speech_to_text', resource_type: '*' },
  { action: 'capability.text_to_speech', resource_type: '*' },
  // Routines
  { action: 'routine.self.manage', resource_type: '*' },
  { action: 'routine.manage', resource_type: '*' },
  // Sandboxes
  { action: 'sandbox.ephemeral.create', resource_type: '*' },
]

export async function up(db: Kysely<any>): Promise<void> {
  const timestamp = now()

  // 1. Create new tables
  await db.schema
    .createTable('role_grants')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('role_id', 'text', (col) => col.notNull().references('roles.id').onDelete('cascade'))
    .addColumn('action', 'text', (col) => col.notNull())
    .addColumn('resource_type', 'text')
    .addColumn('resource_id', 'text')
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .execute()

  await db.schema
    .createTable('role_defaults')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('role_id', 'text', (col) => col.notNull().references('roles.id').onDelete('cascade'))
    .addColumn('key', 'text', (col) => col.notNull())
    .addColumn('value_json', 'text', (col) => col.notNull())
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .execute()

  await db.schema
    .createIndex('idx_role_grants_role_action')
    .on('role_grants')
    .columns(['role_id', 'action'])
    .execute()

  await db.schema
    .createIndex('idx_role_defaults_role_key')
    .on('role_defaults')
    .columns(['role_id', 'key'])
    .execute()

  // 2. Migrate existing data: role → bundles → grants/defaults → role_grants/role_defaults
  const roleBundles = await db
    .selectFrom('role_policy_bundles')
    .select(['role_id', 'bundle_id'])
    .execute()

  for (const { role_id, bundle_id } of roleBundles) {
    const grants = await db
      .selectFrom('policy_grants')
      .select(['action', 'resource_type', 'resource_id'])
      .where('bundle_id', '=', bundle_id)
      .execute()

    for (const grant of grants) {
      await db
        .insertInto('role_grants')
        .values({
          id: crypto.randomUUID(),
          role_id,
          action: grant.action,
          resource_type: grant.resource_type,
          resource_id: grant.resource_id,
          created_at: timestamp,
        })
        .execute()
    }

    const defaults = await db
      .selectFrom('policy_defaults')
      .select(['key', 'value_json'])
      .where('bundle_id', '=', bundle_id)
      .execute()

    for (const entry of defaults) {
      await db
        .insertInto('role_defaults')
        .values({
          id: crypto.randomUUID(),
          role_id,
          key: entry.key,
          value_json: entry.value_json,
          created_at: timestamp,
        })
        .execute()
    }
  }

  // Also migrate platform-default bundles (not linked to roles via role_policy_bundles)
  // These get applied to every agent — assign them to the Platform Admin role
  const platformBundles = await db
    .selectFrom('policy_bundles')
    .select(['id'])
    .where('is_platform_default', '=', 1)
    .execute()

  for (const { id: bundleId } of platformBundles) {
    // Check if we already migrated this bundle for Platform Admin
    const alreadyMigrated = roleBundles.some(
      (rb) => rb.role_id === PLATFORM_ADMIN_ROLE_ID && rb.bundle_id === bundleId
    )
    if (alreadyMigrated) continue

    const grants = await db
      .selectFrom('policy_grants')
      .select(['action', 'resource_type', 'resource_id'])
      .where('bundle_id', '=', bundleId)
      .execute()

    for (const grant of grants) {
      await db
        .insertInto('role_grants')
        .values({
          id: crypto.randomUUID(),
          role_id: PLATFORM_ADMIN_ROLE_ID,
          action: grant.action,
          resource_type: grant.resource_type,
          resource_id: grant.resource_id,
          created_at: timestamp,
        })
        .execute()
    }

    const defaults = await db
      .selectFrom('policy_defaults')
      .select(['key', 'value_json'])
      .where('bundle_id', '=', bundleId)
      .execute()

    for (const entry of defaults) {
      await db
        .insertInto('role_defaults')
        .values({
          id: crypto.randomUUID(),
          role_id: PLATFORM_ADMIN_ROLE_ID,
          key: entry.key,
          value_json: entry.value_json,
          created_at: timestamp,
        })
        .execute()
    }
  }

  // 3. Ensure Platform Admin has the full grant set (insert missing)
  const existingGrants = await db
    .selectFrom('role_grants')
    .select(['action'])
    .where('role_id', '=', PLATFORM_ADMIN_ROLE_ID)
    .execute()
  const existingActions = new Set(existingGrants.map((g) => g.action))

  for (const grant of FULL_GRANT_SET) {
    if (existingActions.has(grant.action)) continue
    await db
      .insertInto('role_grants')
      .values({
        id: crypto.randomUUID(),
        role_id: PLATFORM_ADMIN_ROLE_ID,
        action: grant.action,
        resource_type: grant.resource_type,
        resource_id: null,
        created_at: timestamp,
      })
      .execute()
  }

  // 4. Drop old bundle tables (order matters for FK constraints)
  await db.schema.dropTable('agent_policy_bundle_assignments').execute()
  await db.schema.dropTable('policy_defaults').execute()
  await db.schema.dropTable('policy_grants').execute()
  await db.schema.dropTable('role_policy_bundles').execute()
  await db.schema.dropTable('policy_bundles').execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  // Drop the new tables — restoring full bundle schema would require the original migration
  await db.schema.dropTable('role_defaults').ifExists().execute()
  await db.schema.dropTable('role_grants').ifExists().execute()
}
