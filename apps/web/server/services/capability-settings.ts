import { encrypt, getDb } from '@nitejar/database'

function now(): number {
  return Math.floor(Date.now() / 1000)
}

export interface CapabilitySettingsView {
  id: string
  provider: string
  hasApiKey: boolean
  enabled: boolean
  config: Record<string, unknown> | null
}

function parseConfig(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
}

export async function getCapabilitySettings(id: string): Promise<CapabilitySettingsView | null> {
  const db = getDb()
  const row = await db
    .selectFrom('capability_settings')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst()

  if (!row) return null

  return {
    id: row.id,
    provider: row.provider,
    hasApiKey: Boolean(row.api_key_encrypted),
    enabled: row.enabled === 1,
    config: parseConfig(row.config),
  }
}

export async function listCapabilitySettings(): Promise<CapabilitySettingsView[]> {
  const db = getDb()
  const rows = await db.selectFrom('capability_settings').selectAll().orderBy('id', 'asc').execute()

  return rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    hasApiKey: Boolean(row.api_key_encrypted),
    enabled: row.enabled === 1,
    config: parseConfig(row.config),
  }))
}

export async function updateCapabilitySettings(
  id: string,
  input: {
    provider: string
    apiKey?: string | null
    enabled?: boolean
    config?: Record<string, unknown> | null
  }
): Promise<CapabilitySettingsView> {
  const db = getDb()
  const existing = await db
    .selectFrom('capability_settings')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst()

  let apiKeyEncrypted = existing?.api_key_encrypted ?? null
  if (input.apiKey !== undefined && input.apiKey !== null) {
    const trimmed = input.apiKey.trim()
    apiKeyEncrypted = trimmed ? encrypt(trimmed) : null
  }

  const enabled = input.enabled !== undefined ? (input.enabled ? 1 : 0) : (existing?.enabled ?? 1)
  const configJson =
    input.config !== undefined
      ? input.config
        ? JSON.stringify(input.config)
        : null
      : (existing?.config ?? null)

  const timestamp = now()

  if (existing) {
    await db
      .updateTable('capability_settings')
      .set({
        provider: input.provider,
        api_key_encrypted: apiKeyEncrypted,
        enabled,
        config: configJson,
        updated_at: timestamp,
      })
      .where('id', '=', id)
      .execute()
  } else {
    await db
      .insertInto('capability_settings')
      .values({
        id,
        provider: input.provider,
        api_key_encrypted: apiKeyEncrypted,
        enabled,
        config: configJson,
        created_at: timestamp,
        updated_at: timestamp,
      })
      .execute()
  }

  return {
    id,
    provider: input.provider,
    hasApiKey: Boolean(apiKeyEncrypted),
    enabled: enabled === 1,
    config: parseConfig(configJson),
  }
}

export async function deleteCapabilitySettings(id: string): Promise<boolean> {
  const db = getDb()
  const result = await db.deleteFrom('capability_settings').where('id', '=', id).executeTakeFirst()
  return (result.numDeletedRows ?? 0n) > 0n
}
