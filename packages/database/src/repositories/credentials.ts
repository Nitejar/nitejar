import { getDb } from '../db'
import { decrypt, encrypt } from '../encryption'
import type { Agent, Credential } from '../types'

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function uuid(): string {
  return crypto.randomUUID()
}

function parseAllowedHosts(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is string => typeof v === 'string')
  } catch {
    return []
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseCredentialIdFromMetadata(raw: string | null): string | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!isObject(parsed)) return null
    const credentialId = parsed.credentialId
    return typeof credentialId === 'string' && credentialId.length > 0 ? credentialId : null
  } catch {
    return null
  }
}

const AUDIT_EVENT_TO_STATUS = {
  CREDENTIAL_REQUEST_SUCCESS: 'success',
  CREDENTIAL_REQUEST_FAIL: 'fail',
  CREDENTIAL_REQUEST_DENIED: 'denied',
} as const

type UsageStatus = (typeof AUDIT_EVENT_TO_STATUS)[keyof typeof AUDIT_EVENT_TO_STATUS]

const USAGE_AUDIT_EVENTS = Object.keys(AUDIT_EVENT_TO_STATUS) as Array<
  keyof typeof AUDIT_EVENT_TO_STATUS
>

function toCredentialView(row: Credential) {
  return {
    id: row.id,
    alias: row.alias,
    provider: row.provider,
    allowedHosts: parseAllowedHosts(row.allowed_hosts),
    enabled: row.enabled === 1,
    allowedInHeader: row.allowed_in_header === 1,
    allowedInQuery: row.allowed_in_query === 1,
    allowedInBody: row.allowed_in_body === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export interface CredentialView {
  id: string
  alias: string
  provider: string
  allowedHosts: string[]
  enabled: boolean
  allowedInHeader: boolean
  allowedInQuery: boolean
  allowedInBody: boolean
  createdAt: number
  updatedAt: number
}

export interface CredentialForUse extends CredentialView {
  secret: string
}

export interface CredentialWithAgents extends CredentialView {
  agents: Array<{ id: string; name: string }>
  lastUsedAt?: number | null
  lastStatus?: CredentialUsageStatus | null
  totalCalls?: number
}

export type CredentialUsageStatus = UsageStatus

export interface CredentialUsageSummary {
  lastUsedAt: number | null
  lastStatus: CredentialUsageStatus | null
  successCount: number
  failCount: number
  deniedCount: number
  totalCalls: number
}

export async function createCredential(input: {
  alias: string
  provider: string
  secret: string
  authType?: 'api_key'
  authKey?: string
  authScheme?: string | null
  allowedHosts: string[]
  enabled?: boolean
  allowedInHeader?: boolean
  allowedInQuery?: boolean
  allowedInBody?: boolean
}): Promise<CredentialView> {
  const db = getDb()
  const timestamp = now()
  const row = await db
    .insertInto('credentials')
    .values({
      id: uuid(),
      alias: input.alias,
      provider: input.provider,
      auth_type: input.authType ?? 'api_key',
      secret_encrypted: encrypt(input.secret),
      auth_key: input.authKey ?? '_',
      auth_scheme: input.authScheme ?? null,
      allowed_hosts: JSON.stringify(input.allowedHosts),
      enabled: input.enabled === false ? 0 : 1,
      allowed_in_header: input.allowedInHeader === false ? 0 : 1,
      allowed_in_query: input.allowedInQuery ? 1 : 0,
      allowed_in_body: input.allowedInBody ? 1 : 0,
      created_at: timestamp,
      updated_at: timestamp,
    })
    .returningAll()
    .executeTakeFirstOrThrow()

  return toCredentialView(row)
}

export async function updateCredential(
  credentialId: string,
  input: {
    provider?: string
    secret?: string
    authKey?: string
    authScheme?: string | null
    allowedHosts?: string[]
    enabled?: boolean
    allowedInHeader?: boolean
    allowedInQuery?: boolean
    allowedInBody?: boolean
  }
): Promise<CredentialView | null> {
  const db = getDb()
  const existing = await db
    .selectFrom('credentials')
    .selectAll()
    .where('id', '=', credentialId)
    .executeTakeFirst()
  if (!existing) return null

  const row = await db
    .updateTable('credentials')
    .set({
      provider: input.provider ?? existing.provider,
      secret_encrypted:
        input.secret !== undefined ? encrypt(input.secret) : existing.secret_encrypted,
      auth_key: input.authKey ?? existing.auth_key,
      auth_scheme: input.authScheme !== undefined ? input.authScheme : existing.auth_scheme,
      allowed_hosts:
        input.allowedHosts !== undefined
          ? JSON.stringify(input.allowedHosts)
          : existing.allowed_hosts,
      enabled: input.enabled !== undefined ? (input.enabled ? 1 : 0) : existing.enabled,
      allowed_in_header:
        input.allowedInHeader !== undefined
          ? input.allowedInHeader
            ? 1
            : 0
          : existing.allowed_in_header,
      allowed_in_query:
        input.allowedInQuery !== undefined
          ? input.allowedInQuery
            ? 1
            : 0
          : existing.allowed_in_query,
      allowed_in_body:
        input.allowedInBody !== undefined
          ? input.allowedInBody
            ? 1
            : 0
          : existing.allowed_in_body,
      updated_at: now(),
    })
    .where('id', '=', credentialId)
    .returningAll()
    .executeTakeFirst()

  return row ? toCredentialView(row) : null
}

export async function deleteCredential(credentialId: string): Promise<boolean> {
  const db = getDb()
  const result = await db
    .deleteFrom('credentials')
    .where('id', '=', credentialId)
    .executeTakeFirst()
  return (result.numDeletedRows ?? 0n) > 0n
}

export async function listCredentials(options?: {
  provider?: string
  enabled?: boolean
}): Promise<CredentialView[]> {
  const db = getDb()
  let query = db.selectFrom('credentials').selectAll().orderBy('alias', 'asc')
  if (options?.provider) {
    query = query.where('provider', '=', options.provider)
  }
  if (options?.enabled !== undefined) {
    query = query.where('enabled', '=', options.enabled ? 1 : 0)
  }

  const rows = await query.execute()
  return rows.map(toCredentialView)
}

export async function getCredentialById(credentialId: string): Promise<CredentialView | null> {
  const db = getDb()
  const row = await db
    .selectFrom('credentials')
    .selectAll()
    .where('id', '=', credentialId)
    .executeTakeFirst()
  return row ? toCredentialView(row) : null
}

export async function getCredentialByAlias(alias: string): Promise<CredentialView | null> {
  const db = getDb()
  const row = await db
    .selectFrom('credentials')
    .selectAll()
    .where('alias', '=', alias)
    .executeTakeFirst()
  return row ? toCredentialView(row) : null
}

export async function isCredentialAliasAvailable(
  alias: string,
  excludeCredentialId?: string
): Promise<boolean> {
  const db = getDb()
  let query = db.selectFrom('credentials').select(['id']).where('alias', '=', alias)
  if (excludeCredentialId) {
    query = query.where('id', '!=', excludeCredentialId)
  }
  const existing = await query.executeTakeFirst()
  return !existing
}

export async function getCredentialForAgentByAlias(
  agentId: string,
  alias: string
): Promise<CredentialForUse | null> {
  const db = getDb()
  const row = await db
    .selectFrom('credentials')
    .innerJoin('agent_credentials', 'agent_credentials.credential_id', 'credentials.id')
    .selectAll('credentials')
    .where('agent_credentials.agent_id', '=', agentId)
    .where('credentials.alias', '=', alias)
    .where('credentials.enabled', '=', 1)
    .executeTakeFirst()

  if (!row) return null

  return {
    ...toCredentialView(row),
    secret: decrypt(row.secret_encrypted),
  }
}

export async function setAgentCredentialAssignment(params: {
  credentialId: string
  agentId: string
  enabled: boolean
}): Promise<void> {
  const db = getDb()
  if (!params.enabled) {
    await db
      .deleteFrom('agent_credentials')
      .where('credential_id', '=', params.credentialId)
      .where('agent_id', '=', params.agentId)
      .execute()
    return
  }

  await db
    .insertInto('agent_credentials')
    .values({
      credential_id: params.credentialId,
      agent_id: params.agentId,
      created_at: now(),
    })
    .onConflict((oc) => oc.columns(['agent_id', 'credential_id']).doNothing())
    .execute()
}

export async function listCredentialAssignments(credentialId: string): Promise<Agent[]> {
  const db = getDb()
  return db
    .selectFrom('agent_credentials')
    .innerJoin('agents', 'agents.id', 'agent_credentials.agent_id')
    .selectAll('agents')
    .where('agent_credentials.credential_id', '=', credentialId)
    .orderBy('agents.name', 'asc')
    .execute()
}

export async function listCredentialsForAgent(
  agentId: string,
  options?: { provider?: string }
): Promise<CredentialView[]> {
  const db = getDb()
  let query = db
    .selectFrom('credentials')
    .innerJoin('agent_credentials', 'agent_credentials.credential_id', 'credentials.id')
    .selectAll('credentials')
    .where('agent_credentials.agent_id', '=', agentId)
    .where('credentials.enabled', '=', 1)
    .orderBy('credentials.alias', 'asc')

  if (options?.provider) {
    query = query.where('credentials.provider', '=', options.provider)
  }

  const rows = await query.execute()
  return rows.map(toCredentialView)
}

export async function listCredentialsWithAgents(options?: {
  provider?: string
  enabled?: boolean
}): Promise<CredentialWithAgents[]> {
  const credentials = await listCredentials(options)
  if (credentials.length === 0) return []

  const db = getDb()
  const rows = await db
    .selectFrom('agent_credentials')
    .innerJoin('agents', 'agents.id', 'agent_credentials.agent_id')
    .select([
      'agent_credentials.credential_id as credentialId',
      'agents.id as agentId',
      'agents.name as agentName',
    ])
    .where(
      'agent_credentials.credential_id',
      'in',
      credentials.map((credential) => credential.id)
    )
    .orderBy('agent_credentials.credential_id', 'asc')
    .orderBy('agents.name', 'asc')
    .execute()

  const byCredential = new Map<string, Array<{ id: string; name: string }>>()
  for (const row of rows) {
    const list = byCredential.get(row.credentialId) ?? []
    list.push({ id: row.agentId, name: row.agentName })
    byCredential.set(row.credentialId, list)
  }

  const usageByCredentialId = await getCredentialUsageSummaries(
    credentials.map((credential) => credential.id)
  )

  return credentials.map((credential) => ({
    ...credential,
    agents: byCredential.get(credential.id) ?? [],
    ...(usageByCredentialId.get(credential.id) ?? {}),
  }))
}

export async function getCredentialUsageSummary(
  credentialId: string,
  windowSeconds?: number
): Promise<CredentialUsageSummary> {
  const usageMap = await getCredentialUsageSummaries([credentialId], windowSeconds)
  return (
    usageMap.get(credentialId) ?? {
      lastUsedAt: null,
      lastStatus: null,
      successCount: 0,
      failCount: 0,
      deniedCount: 0,
      totalCalls: 0,
    }
  )
}

async function getCredentialUsageSummaries(
  credentialIds: string[],
  windowSeconds?: number
): Promise<Map<string, CredentialUsageSummary>> {
  const map = new Map<string, CredentialUsageSummary>()
  if (credentialIds.length === 0) return map

  const db = getDb()
  const credentialIdSet = new Set(credentialIds)
  const since = windowSeconds && windowSeconds > 0 ? now() - windowSeconds : null

  const acc = new Map<
    string,
    {
      successCount: number
      failCount: number
      deniedCount: number
      lastAuditAt: number | null
      lastAuditStatus: CredentialUsageStatus | null
      externalCount: number
      lastExternalAt: number | null
    }
  >()

  const getAccumulator = (credentialId: string) => {
    let existing = acc.get(credentialId)
    if (existing) return existing
    existing = {
      successCount: 0,
      failCount: 0,
      deniedCount: 0,
      lastAuditAt: null,
      lastAuditStatus: null,
      externalCount: 0,
      lastExternalAt: null,
    }
    acc.set(credentialId, existing)
    return existing
  }

  let auditQuery = db
    .selectFrom('audit_logs')
    .select(['event_type', 'metadata', 'created_at'])
    .where('event_type', 'in', USAGE_AUDIT_EVENTS)

  if (since !== null) {
    auditQuery = auditQuery.where('created_at', '>=', since)
  }

  const auditRows = await auditQuery.execute()
  for (const row of auditRows) {
    const credentialId = parseCredentialIdFromMetadata(row.metadata)
    if (!credentialId || !credentialIdSet.has(credentialId)) continue

    const status = AUDIT_EVENT_TO_STATUS[row.event_type as keyof typeof AUDIT_EVENT_TO_STATUS]
    if (!status) continue

    const entry = getAccumulator(credentialId)
    if (status === 'success') entry.successCount += 1
    else if (status === 'fail') entry.failCount += 1
    else entry.deniedCount += 1

    if (entry.lastAuditAt === null || row.created_at >= entry.lastAuditAt) {
      entry.lastAuditAt = row.created_at
      entry.lastAuditStatus = status
    }
  }

  let externalQuery = db
    .selectFrom('external_api_calls')
    .select(['operation', 'metadata', 'created_at'])
    .where('operation', '=', 'secure_http_request')

  if (since !== null) {
    externalQuery = externalQuery.where('created_at', '>=', since)
  }

  const externalRows = await externalQuery.execute()
  for (const row of externalRows) {
    const credentialId = parseCredentialIdFromMetadata(row.metadata)
    if (!credentialId || !credentialIdSet.has(credentialId)) continue

    const entry = getAccumulator(credentialId)
    entry.externalCount += 1
    if (entry.lastExternalAt === null || row.created_at >= entry.lastExternalAt) {
      entry.lastExternalAt = row.created_at
    }
  }

  for (const credentialId of credentialIds) {
    const entry = acc.get(credentialId)
    if (!entry) {
      map.set(credentialId, {
        lastUsedAt: null,
        lastStatus: null,
        successCount: 0,
        failCount: 0,
        deniedCount: 0,
        totalCalls: 0,
      })
      continue
    }

    const auditTotal = entry.successCount + entry.failCount + entry.deniedCount
    const totalCalls = auditTotal + Math.max(0, entry.externalCount - entry.successCount)
    const lastUsedAt = Math.max(entry.lastAuditAt ?? 0, entry.lastExternalAt ?? 0) || null

    map.set(credentialId, {
      lastUsedAt,
      lastStatus: entry.lastAuditStatus ?? (entry.lastExternalAt ? 'success' : null),
      successCount: entry.successCount,
      failCount: entry.failCount,
      deniedCount: entry.deniedCount,
      totalCalls,
    })
  }

  return map
}
