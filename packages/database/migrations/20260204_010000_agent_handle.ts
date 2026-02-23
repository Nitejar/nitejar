import { Kysely } from 'kysely'

/**
 * Add handle column to agents table for @mention functionality
 *
 * After this migration:
 * - agent.handle = @mention ID (slug format, e.g., "mary")
 * - agent.name = display name (human readable, e.g., "Mary")
 * - config.title = role/job description (e.g., "Sr Eng")
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // Add handle column
  await db.schema.alterTable('agents').addColumn('handle', 'text').execute()

  const normalizeHandle = (value: string | null | undefined, fallback: string): string => {
    const slug = (value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '')

    return slug || fallback
  }

  const agents = await db
    .selectFrom('agents')
    .select(['id', 'name', 'handle'])
    .orderBy('created_at', 'asc')
    .execute()

  const usedHandles = new Set<string>()

  for (const agent of agents) {
    const base = normalizeHandle(agent.handle ?? agent.name ?? '', `agent-${agent.id.slice(0, 8)}`)

    let handle = base
    let suffix = 2
    while (usedHandles.has(handle)) {
      handle = `${base}-${suffix}`
      suffix += 1
    }

    usedHandles.add(handle)

    if (agent.handle !== handle) {
      await db.updateTable('agents').set({ handle }).where('id', '=', agent.id).execute()
    }
  }

  // Create unique index on handle
  await db.schema
    .createIndex('idx_agents_handle')
    .ifNotExists()
    .on('agents')
    .column('handle')
    .unique()
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('idx_agents_handle').ifExists().execute()

  await db.schema.alterTable('agents').dropColumn('handle').execute()
}
