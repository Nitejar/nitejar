import { getDb } from '@nitejar/database'

const SETTINGS_ID = 'default'

const MODES = ['invite_only', 'approved_domain'] as const
const ROLES = ['superadmin', 'admin', 'member'] as const

export type SignupMode = (typeof MODES)[number]
export type SignupDefaultRole = (typeof ROLES)[number]

export interface AuthSignupPolicy {
  mode: SignupMode
  approvedDomains: string[]
  defaultRole: SignupDefaultRole
}

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function normalizeDomain(value: string): string | null {
  const normalized = value.trim().toLowerCase().replace(/^@+/, '')
  if (!normalized) return null
  if (!/^[a-z0-9.-]+$/.test(normalized)) return null
  if (normalized.startsWith('.') || normalized.endsWith('.') || normalized.includes('..'))
    return null
  return normalized
}

function normalizeDomains(values: string[]): string[] {
  const deduped = new Set<string>()
  values.forEach((value) => {
    const normalized = normalizeDomain(value)
    if (normalized) deduped.add(normalized)
  })
  return Array.from(deduped).sort()
}

function parseApprovedDomains(raw: string | null | undefined): string[] {
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return normalizeDomains(parsed.filter((value): value is string => typeof value === 'string'))
  } catch {
    return []
  }
}

function normalizeRole(raw: string | null | undefined): SignupDefaultRole {
  if (raw && (ROLES as readonly string[]).includes(raw)) {
    return raw as SignupDefaultRole
  }
  return 'member'
}

function normalizeMode(raw: string | null | undefined): SignupMode {
  if (raw && (MODES as readonly string[]).includes(raw)) {
    return raw as SignupMode
  }
  return 'invite_only'
}

function applyDefaults(
  row?: {
    mode: string
    approved_domains: string
    default_role: string
  } | null
): AuthSignupPolicy {
  return {
    mode: normalizeMode(row?.mode),
    approvedDomains: parseApprovedDomains(row?.approved_domains),
    defaultRole: normalizeRole(row?.default_role),
  }
}

export async function getAuthSignupPolicy(): Promise<AuthSignupPolicy> {
  const db = getDb()
  const existing = await db
    .selectFrom('auth_signup_settings')
    .select(['mode', 'approved_domains', 'default_role'])
    .where('id', '=', SETTINGS_ID)
    .executeTakeFirst()

  return applyDefaults(existing)
}

export async function updateAuthSignupPolicy(input: AuthSignupPolicy): Promise<AuthSignupPolicy> {
  const db = getDb()
  const timestamp = now()
  const approvedDomains = normalizeDomains(input.approvedDomains)
  const mode = normalizeMode(input.mode)
  const defaultRole = normalizeRole(input.defaultRole)
  const approvedDomainsJson = JSON.stringify(approvedDomains)

  const existing = await db
    .selectFrom('auth_signup_settings')
    .select(['id'])
    .where('id', '=', SETTINGS_ID)
    .executeTakeFirst()

  if (existing) {
    await db
      .updateTable('auth_signup_settings')
      .set({
        mode,
        approved_domains: approvedDomainsJson,
        default_role: defaultRole,
        updated_at: timestamp,
      })
      .where('id', '=', SETTINGS_ID)
      .execute()
  } else {
    await db
      .insertInto('auth_signup_settings')
      .values({
        id: SETTINGS_ID,
        mode,
        approved_domains: approvedDomainsJson,
        default_role: defaultRole,
        created_at: timestamp,
        updated_at: timestamp,
      })
      .execute()
  }

  return {
    mode,
    approvedDomains,
    defaultRole,
  }
}

export function extractEmailDomain(email: string): string | null {
  const atIndex = email.lastIndexOf('@')
  if (atIndex < 1 || atIndex === email.length - 1) return null
  return normalizeDomain(email.slice(atIndex + 1))
}
