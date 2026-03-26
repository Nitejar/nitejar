import { getDb } from '../db'
import type {
  AgentRoleAssignment,
  NewRole,
  RoleGrant,
  RoleDefault,
  Role,
  RoleUpdate,
  TeamRoleDefault,
} from '../types'

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function uuid(): string {
  return crypto.randomUUID()
}

type PolicyConfigLegacy = {
  allowEphemeralSandboxCreation?: boolean
  allowRoutineManagement?: boolean
  dangerouslyUnrestricted?: boolean
}

export type ResolvedPolicySource =
  | {
      sourceType: 'legacy_config'
    }
  | {
      sourceType: 'agent_role' | 'team_role_default'
      roleId: string
      roleSlug: string
      roleName: string
      teamId?: string | null
      teamName?: string | null
    }

export type ResolvedPolicyGrant = {
  action: string
  resourceType: string | null
  resourceId: string | null
  sources: ResolvedPolicySource[]
}

export type ResolvedPolicyDefault = {
  key: string
  value: unknown
  sources: ResolvedPolicySource[]
}

export type ResolvedRoleSummary = {
  id: string
  slug: string
  name: string
  charter: string | null
  jobDescription: string | null
  escalationPosture: string | null
  sourceType: 'agent_role' | 'team_role_default'
  teamId?: string | null
  teamName?: string | null
}

export type ResolvedPolicy = {
  roles: ResolvedRoleSummary[]
  grants: ResolvedPolicyGrant[]
  defaults: ResolvedPolicyDefault[]
  legacy: {
    allowEphemeralSandboxCreation: boolean
    allowRoutineManagement: boolean
    dangerouslyUnrestricted: boolean
  }
}

function parseLegacyPolicyConfig(configJson: string | null): PolicyConfigLegacy {
  if (!configJson) return {}
  try {
    const parsed = JSON.parse(configJson) as PolicyConfigLegacy
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function parseDefaultValue(valueJson: string): unknown {
  try {
    return JSON.parse(valueJson)
  } catch {
    return valueJson
  }
}

export async function createRole(
  data: Omit<NewRole, 'id' | 'created_at' | 'updated_at'>
): Promise<Role> {
  const db = getDb()
  const timestamp = now()
  return db
    .insertInto('roles')
    .values({
      id: uuid(),
      ...data,
      created_at: timestamp,
      updated_at: timestamp,
    })
    .returningAll()
    .executeTakeFirstOrThrow()
}

export async function updateRole(id: string, data: Omit<RoleUpdate, 'id' | 'created_at'>) {
  const db = getDb()
  return db
    .updateTable('roles')
    .set({ ...data, updated_at: now() })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirst()
}

export async function deleteRole(id: string): Promise<boolean> {
  const db = getDb()
  const result = await db.deleteFrom('roles').where('id', '=', id).executeTakeFirst()
  return (result?.numDeletedRows ?? 0n) > 0n
}

export async function findRoleById(id: string): Promise<Role | null> {
  const db = getDb()
  return (await db.selectFrom('roles').selectAll().where('id', '=', id).executeTakeFirst()) ?? null
}

export async function findRoleBySlug(slug: string): Promise<Role | null> {
  const db = getDb()
  return (
    (await db.selectFrom('roles').selectAll().where('slug', '=', slug).executeTakeFirst()) ?? null
  )
}

export async function listRoles(opts?: { activeOnly?: boolean }): Promise<Role[]> {
  const db = getDb()
  let query = db.selectFrom('roles').selectAll()
  if (opts?.activeOnly) {
    query = query.where('active', '=', 1)
  }
  return query.orderBy('name', 'asc').execute()
}

// ---------------------------------------------------------------------------
// Role Grants
// ---------------------------------------------------------------------------

export async function listRoleGrants(roleId: string): Promise<RoleGrant[]> {
  const db = getDb()
  return db
    .selectFrom('role_grants')
    .selectAll()
    .where('role_id', '=', roleId)
    .orderBy('action', 'asc')
    .execute()
}

export async function replaceRoleGrants(
  roleId: string,
  grants: Array<{ action: string; resource_type?: string | null; resource_id?: string | null }>
): Promise<void> {
  const db = getDb()
  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom('role_grants').where('role_id', '=', roleId).execute()
    if (grants.length === 0) return
    await trx
      .insertInto('role_grants')
      .values(
        grants.map((grant) => ({
          id: uuid(),
          role_id: roleId,
          action: grant.action,
          resource_type: grant.resource_type ?? null,
          resource_id: grant.resource_id ?? null,
          created_at: now(),
        }))
      )
      .execute()
  })
}

// ---------------------------------------------------------------------------
// Role Defaults
// ---------------------------------------------------------------------------

export async function listRoleDefaults(roleId: string): Promise<RoleDefault[]> {
  const db = getDb()
  return db
    .selectFrom('role_defaults')
    .selectAll()
    .where('role_id', '=', roleId)
    .orderBy('key', 'asc')
    .execute()
}

export async function replaceRoleDefaults(
  roleId: string,
  defaults: Array<{ key: string; value_json: string }>
): Promise<void> {
  const db = getDb()
  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom('role_defaults').where('role_id', '=', roleId).execute()
    if (defaults.length === 0) return
    await trx
      .insertInto('role_defaults')
      .values(
        defaults.map((entry) => ({
          id: uuid(),
          role_id: roleId,
          key: entry.key,
          value_json: entry.value_json,
          created_at: now(),
        }))
      )
      .execute()
  })
}

// ---------------------------------------------------------------------------
// Agent Role Assignments
// ---------------------------------------------------------------------------

export async function listAgentRoleAssignments(
  agentId: string
): Promise<Array<AgentRoleAssignment & { role: Role }>> {
  const db = getDb()
  const rows = await db
    .selectFrom('agent_role_assignments')
    .innerJoin('roles', 'roles.id', 'agent_role_assignments.role_id')
    .selectAll('agent_role_assignments')
    .select([
      'roles.id as role_id_full',
      'roles.slug as role_slug',
      'roles.name as role_name',
      'roles.charter as role_charter',
      'roles.job_description as role_job_description',
      'roles.escalation_posture as role_escalation_posture',
      'roles.active as role_active',
      'roles.created_at as role_created_at',
      'roles.updated_at as role_updated_at',
    ])
    .where('agent_role_assignments.agent_id', '=', agentId)
    .orderBy('roles.name', 'asc')
    .execute()

  return rows.map((row) => ({
    agent_id: row.agent_id,
    role_id: row.role_id,
    created_at: row.created_at,
    role: {
      id: row.role_id_full,
      slug: row.role_slug,
      name: row.role_name,
      charter: row.role_charter,
      job_description: row.role_job_description,
      escalation_posture: row.role_escalation_posture,
      active: row.role_active,
      created_at: row.role_created_at,
      updated_at: row.role_updated_at,
    },
  }))
}

export async function assignRoleToAgent(agentId: string, roleId: string): Promise<void> {
  const db = getDb()
  // Enforce single-role: remove any existing assignment before inserting
  await db.deleteFrom('agent_role_assignments').where('agent_id', '=', agentId).execute()
  await db
    .insertInto('agent_role_assignments')
    .values({ agent_id: agentId, role_id: roleId, created_at: now() })
    .execute()
}

export async function removeRoleFromAgent(agentId: string, roleId: string): Promise<boolean> {
  const db = getDb()
  const result = await db
    .deleteFrom('agent_role_assignments')
    .where('agent_id', '=', agentId)
    .where('role_id', '=', roleId)
    .executeTakeFirst()
  return Number(result.numDeletedRows ?? 0) > 0
}

// ---------------------------------------------------------------------------
// Team Role Defaults
// ---------------------------------------------------------------------------

export async function listTeamRoleDefaults(
  teamId: string
): Promise<Array<TeamRoleDefault & { role: Role }>> {
  const db = getDb()
  const rows = await db
    .selectFrom('team_role_defaults')
    .innerJoin('roles', 'roles.id', 'team_role_defaults.role_id')
    .selectAll('team_role_defaults')
    .select([
      'roles.id as role_id_full',
      'roles.slug as role_slug',
      'roles.name as role_name',
      'roles.charter as role_charter',
      'roles.job_description as role_job_description',
      'roles.escalation_posture as role_escalation_posture',
      'roles.active as role_active',
      'roles.created_at as role_created_at',
      'roles.updated_at as role_updated_at',
    ])
    .where('team_role_defaults.team_id', '=', teamId)
    .orderBy('roles.name', 'asc')
    .execute()

  return rows.map((row) => ({
    team_id: row.team_id,
    role_id: row.role_id,
    created_at: row.created_at,
    role: {
      id: row.role_id_full,
      slug: row.role_slug,
      name: row.role_name,
      charter: row.role_charter,
      job_description: row.role_job_description,
      escalation_posture: row.role_escalation_posture,
      active: row.role_active,
      created_at: row.role_created_at,
      updated_at: row.role_updated_at,
    },
  }))
}

export async function assignDefaultRoleToTeam(teamId: string, roleId: string): Promise<void> {
  const db = getDb()
  await db
    .insertInto('team_role_defaults')
    .values({ team_id: teamId, role_id: roleId, created_at: now() })
    .onConflict((oc) => oc.columns(['team_id', 'role_id']).doNothing())
    .execute()
}

export async function removeDefaultRoleFromTeam(teamId: string, roleId: string): Promise<boolean> {
  const db = getDb()
  const result = await db
    .deleteFrom('team_role_defaults')
    .where('team_id', '=', teamId)
    .where('role_id', '=', roleId)
    .executeTakeFirst()
  return Number(result.numDeletedRows ?? 0) > 0
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function upsertGrant(
  grantMap: Map<string, ResolvedPolicyGrant>,
  next: Omit<ResolvedPolicyGrant, 'sources'> & { source: ResolvedPolicySource }
) {
  const key = `${next.action}::${next.resourceType ?? '*'}::${next.resourceId ?? '*'}`
  const existing = grantMap.get(key)
  if (existing) {
    existing.sources.push(next.source)
    return
  }
  grantMap.set(key, {
    action: next.action,
    resourceType: next.resourceType,
    resourceId: next.resourceId,
    sources: [next.source],
  })
}

function upsertDefault(
  defaultMap: Map<string, ResolvedPolicyDefault>,
  next: { key: string; value: unknown; source: ResolvedPolicySource }
) {
  const existing = defaultMap.get(next.key)
  if (existing) {
    existing.value = next.value
    existing.sources.push(next.source)
    return
  }
  defaultMap.set(next.key, {
    key: next.key,
    value: next.value,
    sources: [next.source],
  })
}

// ---------------------------------------------------------------------------
// Audit Log
// ---------------------------------------------------------------------------

export async function writePolicyAuditLog(input: {
  eventType: string
  agentId?: string | null
  result?: string | null
  capability?: string | null
  metadata?: Record<string, unknown> | null
}): Promise<void> {
  const db = getDb()
  await db
    .insertInto('audit_logs')
    .values({
      id: uuid(),
      event_type: input.eventType,
      agent_id: input.agentId ?? null,
      github_repo_id: null,
      capability: input.capability ?? null,
      result: input.result ?? null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      created_at: now(),
    })
    .execute()
}

// ---------------------------------------------------------------------------
// Resolve Effective Policy
// ---------------------------------------------------------------------------

async function addRoleContent(
  roleId: string,
  source: ResolvedPolicySource,
  grantMap: Map<string, ResolvedPolicyGrant>,
  defaultMap: Map<string, ResolvedPolicyDefault>
): Promise<void> {
  const [roleGrants, roleDefaults] = await Promise.all([
    listRoleGrants(roleId),
    listRoleDefaults(roleId),
  ])

  for (const grant of roleGrants) {
    upsertGrant(grantMap, {
      action: grant.action,
      resourceType: grant.resource_type,
      resourceId: grant.resource_id,
      source,
    })
  }

  for (const entry of roleDefaults) {
    upsertDefault(defaultMap, {
      key: entry.key,
      value: parseDefaultValue(entry.value_json),
      source,
    })
  }
}

export async function resolveEffectivePolicy(agentId: string): Promise<ResolvedPolicy> {
  const db = getDb()
  const agent = await db
    .selectFrom('agents')
    .select(['id', 'config'])
    .where('id', '=', agentId)
    .executeTakeFirst()
  if (!agent) {
    throw new Error('Agent not found.')
  }

  const grantMap = new Map<string, ResolvedPolicyGrant>()
  const defaultMap = new Map<string, ResolvedPolicyDefault>()
  const roles: ResolvedRoleSummary[] = []
  const seenRoleIds = new Set<string>()

  const legacy = parseLegacyPolicyConfig(agent.config)

  // ---- Team role defaults: agent_teams → teams → team_role_defaults → roles ----
  const teamRoleRows = await db
    .selectFrom('agent_teams')
    .innerJoin('teams', 'teams.id', 'agent_teams.team_id')
    .innerJoin('team_role_defaults', 'team_role_defaults.team_id', 'teams.id')
    .innerJoin('roles', 'roles.id', 'team_role_defaults.role_id')
    .select([
      'teams.id as team_id',
      'teams.name as team_name',
      'roles.id as role_id',
      'roles.slug as role_slug',
      'roles.name as role_name',
      'roles.charter as role_charter',
      'roles.job_description as role_job_description',
      'roles.escalation_posture as role_escalation_posture',
    ])
    .where('agent_teams.agent_id', '=', agentId)
    .where('roles.active', '=', 1)
    .execute()

  for (const row of teamRoleRows) {
    const compositeKey = `team:${row.team_id}:${row.role_id}`
    if (!seenRoleIds.has(compositeKey)) {
      roles.push({
        id: row.role_id,
        slug: row.role_slug,
        name: row.role_name,
        charter: row.role_charter,
        jobDescription: row.role_job_description,
        escalationPosture: row.role_escalation_posture,
        sourceType: 'team_role_default',
        teamId: row.team_id,
        teamName: row.team_name,
      })
      seenRoleIds.add(compositeKey)
    }
    const source: ResolvedPolicySource = {
      sourceType: 'team_role_default',
      roleId: row.role_id,
      roleSlug: row.role_slug,
      roleName: row.role_name,
      teamId: row.team_id,
      teamName: row.team_name,
    }
    await addRoleContent(row.role_id, source, grantMap, defaultMap)
  }

  // ---- Agent role assignments: agent_role_assignments → roles ----
  const agentRoles = await listAgentRoleAssignments(agentId)
  for (const assignment of agentRoles) {
    const compositeKey = `agent:${assignment.role.id}`
    if (!seenRoleIds.has(compositeKey)) {
      roles.push({
        id: assignment.role.id,
        slug: assignment.role.slug,
        name: assignment.role.name,
        charter: assignment.role.charter,
        jobDescription: assignment.role.job_description,
        escalationPosture: assignment.role.escalation_posture,
        sourceType: 'agent_role',
      })
      seenRoleIds.add(compositeKey)
    }
    const source: ResolvedPolicySource = {
      sourceType: 'agent_role',
      roleId: assignment.role.id,
      roleSlug: assignment.role.slug,
      roleName: assignment.role.name,
    }
    await addRoleContent(assignment.role.id, source, grantMap, defaultMap)
  }

  // ---- Legacy config bridge ----
  if (legacy.dangerouslyUnrestricted === true) {
    upsertGrant(grantMap, {
      action: '*',
      resourceType: '*',
      resourceId: null,
      source: { sourceType: 'legacy_config' },
    })
  }

  return {
    roles,
    grants: [...grantMap.values()].sort((a, b) => a.action.localeCompare(b.action)),
    defaults: [...defaultMap.values()].sort((a, b) => a.key.localeCompare(b.key)),
    legacy: {
      allowEphemeralSandboxCreation: legacy.allowEphemeralSandboxCreation === true,
      allowRoutineManagement: legacy.allowRoutineManagement === true,
      dangerouslyUnrestricted: legacy.dangerouslyUnrestricted === true,
    },
  }
}

export async function resolveInheritedDefaults(agentId: string): Promise<ResolvedPolicyDefault[]> {
  const resolved = await resolveEffectivePolicy(agentId)
  return resolved.defaults
}

export async function assertAgentGrant(input: {
  agentId: string
  action: string
  resourceType?: string | null
  resourceId?: string | null
  metadata?: Record<string, unknown>
}): Promise<void> {
  const resolved = await resolveEffectivePolicy(input.agentId)
  const resourceType = input.resourceType ?? '*'
  const resourceId = input.resourceId ?? null

  const allowed = resolved.grants.some((grant) => {
    const actionMatch = grant.action === '*' || grant.action === input.action
    const typeMatch =
      grant.resourceType == null ||
      grant.resourceType === '*' ||
      grant.resourceType === resourceType
    const idMatch = grant.resourceId == null || grant.resourceId === resourceId
    return actionMatch && typeMatch && idMatch
  })

  await writePolicyAuditLog({
    eventType: allowed ? 'POLICY_GRANT_CHECK_PASS' : 'POLICY_GRANT_CHECK_FAIL',
    agentId: input.agentId,
    capability: input.action,
    result: allowed ? 'allowed' : 'denied',
    metadata: {
      action: input.action,
      resourceType,
      resourceId,
      ...(input.metadata ?? {}),
    },
  })

  if (!allowed) {
    throw new Error(`Access denied: missing grant "${input.action}".`)
  }
}
