import { createHash } from 'node:crypto'
import { getDb } from '../db'
import type { Skill, SkillFile, SkillAssignment } from '../types'

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function uuid(): string {
  return crypto.randomUUID()
}

function computeChecksum(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is string => typeof v === 'string')
  } catch {
    return []
  }
}

// ============================================================================
// Skills CRUD
// ============================================================================

export async function createSkill(data: {
  name: string
  slug: string
  description?: string | null
  category?: string
  sourceKind: string
  pluginId?: string | null
  sourceRef?: string | null
  content: string
  isDirectory?: boolean
  version?: string | null
  tags?: string[]
  requiresTools?: string[]
  metadata?: Record<string, unknown>
}): Promise<Skill> {
  const db = getDb()
  const timestamp = now()
  const id = uuid()
  const checksum = computeChecksum(data.content)

  const row = await db
    .insertInto('skills')
    .values({
      id,
      name: data.name,
      slug: data.slug,
      description: data.description ?? null,
      category: data.category ?? 'general',
      source_kind: data.sourceKind,
      plugin_id: data.pluginId ?? null,
      source_ref: data.sourceRef ?? null,
      content: data.content,
      is_directory: data.isDirectory ? 1 : 0,
      version: data.version ?? null,
      checksum,
      enabled: 1,
      tags_json: data.tags ? JSON.stringify(data.tags) : null,
      requires_tools_json: data.requiresTools ? JSON.stringify(data.requiresTools) : null,
      metadata_json: data.metadata ? JSON.stringify(data.metadata) : null,
      created_at: timestamp,
      updated_at: timestamp,
    })
    .returningAll()
    .executeTakeFirstOrThrow()

  return row
}

export async function findSkillById(id: string): Promise<Skill | null> {
  const db = getDb()
  const row = await db.selectFrom('skills').selectAll().where('id', '=', id).executeTakeFirst()
  return row ?? null
}

export async function findSkillBySlug(slug: string): Promise<Skill | null> {
  const db = getDb()
  const row = await db.selectFrom('skills').selectAll().where('slug', '=', slug).executeTakeFirst()
  return row ?? null
}

export async function listSkills(filters?: {
  source?: string
  category?: string
  search?: string
  enabled?: boolean
}): Promise<Skill[]> {
  const db = getDb()
  let query = db.selectFrom('skills').selectAll().orderBy('name', 'asc')

  if (filters?.source) {
    query = query.where('source_kind', '=', filters.source)
  }
  if (filters?.category) {
    query = query.where('category', '=', filters.category)
  }
  if (filters?.enabled !== undefined) {
    query = query.where('enabled', '=', filters.enabled ? 1 : 0)
  }
  if (filters?.search) {
    const term = `%${filters.search}%`
    query = query.where((eb) => eb.or([eb('name', 'like', term), eb('description', 'like', term)]))
  }

  return query.execute()
}

export async function updateSkill(
  id: string,
  data: {
    name?: string
    description?: string | null
    category?: string
    content?: string
    version?: string | null
    enabled?: boolean
    tags?: string[]
    requiresTools?: string[]
    metadata?: Record<string, unknown>
  }
): Promise<Skill | null> {
  const db = getDb()
  const existing = await findSkillById(id)
  if (!existing) return null

  const updates: Record<string, unknown> = { updated_at: now() }

  if (data.name !== undefined) updates.name = data.name
  if (data.description !== undefined) updates.description = data.description
  if (data.category !== undefined) updates.category = data.category
  if (data.content !== undefined) {
    updates.content = data.content
    updates.checksum = computeChecksum(data.content)
  }
  if (data.version !== undefined) updates.version = data.version
  if (data.enabled !== undefined) updates.enabled = data.enabled ? 1 : 0
  if (data.tags !== undefined) updates.tags_json = JSON.stringify(data.tags)
  if (data.requiresTools !== undefined)
    updates.requires_tools_json = JSON.stringify(data.requiresTools)
  if (data.metadata !== undefined) updates.metadata_json = JSON.stringify(data.metadata)

  const row = await db
    .updateTable('skills')
    .set(updates)
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirst()

  return row ?? null
}

export async function deleteSkill(id: string): Promise<boolean> {
  const db = getDb()
  const result = await db.deleteFrom('skills').where('id', '=', id).executeTakeFirst()
  return (result.numDeletedRows ?? 0n) > 0n
}

export async function isSkillSlugAvailable(slug: string, excludeId?: string): Promise<boolean> {
  const db = getDb()
  let query = db.selectFrom('skills').select(['id']).where('slug', '=', slug)
  if (excludeId) {
    query = query.where('id', '!=', excludeId)
  }
  const existing = await query.executeTakeFirst()
  return !existing
}

// ============================================================================
// Skill Files CRUD
// ============================================================================

export async function createSkillFile(data: {
  skillId: string
  relativePath: string
  content: string
  contentType?: string | null
}): Promise<SkillFile> {
  const db = getDb()
  const timestamp = now()
  const id = uuid()

  const row = await db
    .insertInto('skill_files')
    .values({
      id,
      skill_id: data.skillId,
      relative_path: data.relativePath,
      content: data.content,
      content_type: data.contentType ?? null,
      size_bytes: Buffer.byteLength(data.content, 'utf8'),
      checksum: computeChecksum(data.content),
      created_at: timestamp,
      updated_at: timestamp,
    })
    .returningAll()
    .executeTakeFirstOrThrow()

  return row
}

export async function listSkillFiles(skillId: string): Promise<SkillFile[]> {
  const db = getDb()
  return db
    .selectFrom('skill_files')
    .selectAll()
    .where('skill_id', '=', skillId)
    .orderBy('relative_path', 'asc')
    .execute()
}

export async function findSkillFile(
  skillId: string,
  relativePath: string
): Promise<SkillFile | null> {
  const db = getDb()
  const row = await db
    .selectFrom('skill_files')
    .selectAll()
    .where('skill_id', '=', skillId)
    .where('relative_path', '=', relativePath)
    .executeTakeFirst()
  return row ?? null
}

export async function updateSkillFile(
  id: string,
  data: { content: string; contentType?: string | null }
): Promise<SkillFile | null> {
  const db = getDb()
  const row = await db
    .updateTable('skill_files')
    .set({
      content: data.content,
      content_type: data.contentType !== undefined ? data.contentType : undefined,
      size_bytes: Buffer.byteLength(data.content, 'utf8'),
      checksum: computeChecksum(data.content),
      updated_at: now(),
    })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirst()
  return row ?? null
}

export async function deleteSkillFile(id: string): Promise<boolean> {
  const db = getDb()
  const result = await db.deleteFrom('skill_files').where('id', '=', id).executeTakeFirst()
  return (result.numDeletedRows ?? 0n) > 0n
}

export async function deleteSkillFilesBySkillId(skillId: string): Promise<number> {
  const db = getDb()
  const result = await db
    .deleteFrom('skill_files')
    .where('skill_id', '=', skillId)
    .executeTakeFirst()
  return Number(result.numDeletedRows ?? 0)
}

// ============================================================================
// Skill Assignments
// ============================================================================

export async function createSkillAssignment(data: {
  skillId: string
  skillSlug: string
  scope: string
  scopeId?: string | null
  priority?: number
  autoInject?: boolean
}): Promise<SkillAssignment> {
  const db = getDb()
  const timestamp = now()
  const id = uuid()

  const row = await db
    .insertInto('skill_assignments')
    .values({
      id,
      skill_id: data.skillId,
      skill_slug: data.skillSlug,
      scope: data.scope,
      scope_id: data.scopeId ?? null,
      priority: data.priority ?? 0,
      auto_inject: data.autoInject ? 1 : 0,
      enabled: 1,
      created_at: timestamp,
      updated_at: timestamp,
    })
    .returningAll()
    .executeTakeFirstOrThrow()

  return row
}

export async function listSkillAssignments(filters?: {
  skillId?: string
  scope?: string
  scopeId?: string
}): Promise<SkillAssignment[]> {
  const db = getDb()
  let query = db.selectFrom('skill_assignments').selectAll().orderBy('priority', 'desc')

  if (filters?.skillId) {
    query = query.where('skill_id', '=', filters.skillId)
  }
  if (filters?.scope) {
    query = query.where('scope', '=', filters.scope)
  }
  if (filters?.scopeId) {
    query = query.where('scope_id', '=', filters.scopeId)
  }

  return query.execute()
}

export async function getSkillAssignmentsForAgent(
  agentId: string,
  teamId?: string | null
): Promise<Array<SkillAssignment & { skill: Skill }>> {
  const db = getDb()

  // Build scope conditions: global OR (team with matching teamId) OR (agent with matching agentId)
  const scopeConditions: Array<{ scope: string; scopeId: string | null }> = [
    { scope: 'global', scopeId: null },
    { scope: 'agent', scopeId: agentId },
  ]
  if (teamId) {
    scopeConditions.push({ scope: 'team', scopeId: teamId })
  }

  const rows = await db
    .selectFrom('skill_assignments')
    .innerJoin('skills', 'skills.id', 'skill_assignments.skill_id')
    .selectAll('skill_assignments')
    .select([
      'skills.id as skill_db_id',
      'skills.name as skill_name',
      'skills.slug as skill_slug_db',
      'skills.description as skill_description',
      'skills.category as skill_category',
      'skills.source_kind as skill_source_kind',
      'skills.plugin_id as skill_plugin_id',
      'skills.source_ref as skill_source_ref',
      'skills.content as skill_content',
      'skills.is_directory as skill_is_directory',
      'skills.version as skill_version',
      'skills.checksum as skill_checksum',
      'skills.enabled as skill_enabled',
      'skills.tags_json as skill_tags_json',
      'skills.requires_tools_json as skill_requires_tools_json',
      'skills.metadata_json as skill_metadata_json',
      'skills.created_at as skill_created_at',
      'skills.updated_at as skill_updated_at',
    ])
    .where('skill_assignments.enabled', '=', 1)
    .where('skills.enabled', '=', 1)
    .where((eb) =>
      eb.or(
        scopeConditions.map((c) =>
          c.scopeId === null
            ? eb.and([
                eb('skill_assignments.scope', '=', c.scope),
                eb('skill_assignments.scope_id', 'is', null),
              ])
            : eb.and([
                eb('skill_assignments.scope', '=', c.scope),
                eb('skill_assignments.scope_id', '=', c.scopeId),
              ])
        )
      )
    )
    .orderBy('skill_assignments.priority', 'desc')
    .execute()

  return rows.map((row) => ({
    id: row.id,
    skill_id: row.skill_id,
    skill_slug: row.skill_slug,
    scope: row.scope,
    scope_id: row.scope_id,
    priority: row.priority,
    auto_inject: row.auto_inject,
    enabled: row.enabled,
    created_at: row.created_at,
    updated_at: row.updated_at,
    skill: {
      id: row.skill_db_id,
      name: row.skill_name,
      slug: row.skill_slug_db,
      description: row.skill_description,
      category: row.skill_category,
      source_kind: row.skill_source_kind,
      plugin_id: row.skill_plugin_id,
      source_ref: row.skill_source_ref,
      content: row.skill_content,
      is_directory: row.skill_is_directory,
      version: row.skill_version,
      checksum: row.skill_checksum,
      enabled: row.skill_enabled,
      tags_json: row.skill_tags_json,
      requires_tools_json: row.skill_requires_tools_json,
      metadata_json: row.skill_metadata_json,
      created_at: row.skill_created_at,
      updated_at: row.skill_updated_at,
    },
  }))
}

export async function updateSkillAssignment(
  id: string,
  data: {
    enabled?: boolean
    priority?: number
    autoInject?: boolean
  }
): Promise<SkillAssignment | null> {
  const db = getDb()
  const updates: Record<string, unknown> = { updated_at: now() }

  if (data.enabled !== undefined) updates.enabled = data.enabled ? 1 : 0
  if (data.priority !== undefined) updates.priority = data.priority
  if (data.autoInject !== undefined) updates.auto_inject = data.autoInject ? 1 : 0

  const row = await db
    .updateTable('skill_assignments')
    .set(updates)
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirst()

  return row ?? null
}

export async function deleteSkillAssignment(id: string): Promise<boolean> {
  const db = getDb()
  const result = await db.deleteFrom('skill_assignments').where('id', '=', id).executeTakeFirst()
  return (result.numDeletedRows ?? 0n) > 0n
}

export async function findSkillAssignmentById(id: string): Promise<SkillAssignment | null> {
  const db = getDb()
  const row = await db
    .selectFrom('skill_assignments')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst()
  return row ?? null
}

// ============================================================================
// Bulk / Aggregate operations
// ============================================================================

export async function getSkillsWithAssignmentCounts(): Promise<
  Array<Skill & { assignmentCount: number }>
> {
  const db = getDb()
  const rows = await db
    .selectFrom('skills')
    .leftJoin('skill_assignments', 'skill_assignments.skill_id', 'skills.id')
    .selectAll('skills')
    .select((eb) => eb.fn.count('skill_assignments.id').as('assignmentCount'))
    .groupBy('skills.id')
    .orderBy('skills.name', 'asc')
    .execute()

  return rows.map((row) => ({
    ...row,
    assignmentCount: Number(row.assignmentCount),
  }))
}

export async function listCategories(): Promise<string[]> {
  const db = getDb()
  const rows = await db
    .selectFrom('skills')
    .select('category')
    .distinct()
    .orderBy('category', 'asc')
    .execute()
  return rows.map((r) => r.category)
}

export async function getAgentIdsForSkill(skillId: string): Promise<string[]> {
  const db = getDb()

  // Get direct agent assignments
  const directRows = await db
    .selectFrom('skill_assignments')
    .select('scope_id')
    .where('skill_id', '=', skillId)
    .where('scope', '=', 'agent')
    .where('enabled', '=', 1)
    .where('scope_id', 'is not', null)
    .execute()

  const agentIds = new Set(directRows.map((r) => r.scope_id!))

  // Check for global assignments — if any exist, fetch all agent IDs
  const globalRow = await db
    .selectFrom('skill_assignments')
    .select('id')
    .where('skill_id', '=', skillId)
    .where('scope', '=', 'global')
    .where('enabled', '=', 1)
    .executeTakeFirst()

  if (globalRow) {
    const allAgents = await db.selectFrom('agents').select('id').execute()
    for (const a of allAgents) agentIds.add(a.id)
  }

  // Check for team assignments — if any exist, fetch agent IDs from those teams
  const teamRows = await db
    .selectFrom('skill_assignments')
    .select('scope_id')
    .where('skill_id', '=', skillId)
    .where('scope', '=', 'team')
    .where('enabled', '=', 1)
    .where('scope_id', 'is not', null)
    .execute()

  if (teamRows.length > 0) {
    const teamIds = teamRows.map((r) => r.scope_id!)
    const teamAgents = await db
      .selectFrom('agent_teams')
      .select('agent_id')
      .where('team_id', 'in', teamIds)
      .execute()
    for (const a of teamAgents) agentIds.add(a.agent_id)
  }

  return Array.from(agentIds)
}

/** Helper to parse JSON array fields from skills rows */
export { parseJsonArray as parseSkillJsonArray }
