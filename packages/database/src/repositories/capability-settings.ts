import { getDb } from '../db'
import { encrypt, decrypt } from '../encryption'
import type { CapabilitySetting } from '../types'

function now(): number {
  return Math.floor(Date.now() / 1000)
}

export interface CapabilitySettingResult {
  id: string
  provider: string
  apiKey: string | null
  enabled: boolean
  config: Record<string, unknown> | null
}

export interface CapabilitySettingListItem {
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

export async function getCapabilitySetting(id: string): Promise<CapabilitySettingResult | null> {
  const db = getDb()
  const row = await db
    .selectFrom('capability_settings')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst()

  if (!row) return null

  let apiKey: string | null = null
  if (row.api_key_encrypted) {
    try {
      apiKey = decrypt(row.api_key_encrypted)
    } catch {
      apiKey = null
    }
  }

  return {
    id: row.id,
    provider: row.provider,
    apiKey,
    enabled: row.enabled === 1,
    config: parseConfig(row.config),
  }
}

export async function upsertCapabilitySetting(
  id: string,
  data: {
    provider: string
    apiKey?: string | null
    enabled?: boolean
    config?: Record<string, unknown> | null
  }
): Promise<CapabilitySettingListItem> {
  const db = getDb()
  const existing = await db
    .selectFrom('capability_settings')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst()

  let apiKeyEncrypted = existing?.api_key_encrypted ?? null
  if (data.apiKey !== undefined) {
    apiKeyEncrypted = data.apiKey ? encrypt(data.apiKey) : null
  }

  const enabled = data.enabled !== undefined ? (data.enabled ? 1 : 0) : (existing?.enabled ?? 1)
  const configJson =
    data.config !== undefined
      ? data.config
        ? JSON.stringify(data.config)
        : null
      : (existing?.config ?? null)

  const timestamp = now()

  if (existing) {
    await db
      .updateTable('capability_settings')
      .set({
        provider: data.provider,
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
        provider: data.provider,
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
    provider: data.provider,
    hasApiKey: Boolean(apiKeyEncrypted),
    enabled: enabled === 1,
    config: parseConfig(configJson),
  }
}

export async function deleteCapabilitySetting(id: string): Promise<boolean> {
  const db = getDb()
  const result = await db.deleteFrom('capability_settings').where('id', '=', id).executeTakeFirst()
  return (result.numDeletedRows ?? 0n) > 0n
}

export async function listCapabilitySettings(): Promise<CapabilitySettingListItem[]> {
  const db = getDb()
  const rows = await db.selectFrom('capability_settings').selectAll().orderBy('id', 'asc').execute()

  return rows.map((row: CapabilitySetting) => ({
    id: row.id,
    provider: row.provider,
    hasApiKey: Boolean(row.api_key_encrypted),
    enabled: row.enabled === 1,
    config: parseConfig(row.config),
  }))
}
