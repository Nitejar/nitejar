import { decrypt, getDb } from '@nitejar/database'

export const SPRITES_CAPABILITY_ID = 'tool_execution'

type TokenSource = 'capability_settings' | 'none'

export interface SpritesTokenSettings {
  enabled: boolean
  token: string | null
  source: TokenSource
}

async function getCapabilityRow(): Promise<{
  enabled: number
  api_key_encrypted: string | null
} | null> {
  try {
    const db = getDb()
    const row = await db
      .selectFrom('capability_settings')
      .select(['enabled', 'api_key_encrypted'])
      .where('id', '=', SPRITES_CAPABILITY_ID)
      .executeTakeFirst()
    return row ?? null
  } catch {
    return null
  }
}

export async function getSpritesTokenSettings(): Promise<SpritesTokenSettings> {
  const row = await getCapabilityRow()

  // No row yet => capability defaults enabled, but without a configured key.
  if (!row) {
    return {
      enabled: true,
      token: null,
      source: 'none',
    }
  }

  let token: string | null = null
  if (row.api_key_encrypted) {
    try {
      const decrypted = decrypt(row.api_key_encrypted)?.trim()
      token = decrypted && decrypted.length > 0 ? decrypted : null
    } catch {
      token = null
    }
  }

  return {
    enabled: row.enabled === 1,
    token,
    source: token ? 'capability_settings' : 'none',
  }
}

export async function getOptionalSpritesToken(): Promise<string | null> {
  const settings = await getSpritesTokenSettings()
  return settings.enabled && settings.token ? settings.token : null
}

export async function requireSpritesToken(): Promise<string> {
  const settings = await getSpritesTokenSettings()
  if (!settings.enabled) {
    throw new Error('Tool execution is disabled in Settings > Capabilities > Tool Execution.')
  }
  if (!settings.token) {
    throw new Error(
      'Sprites API key not configured. Add it in Settings > Capabilities > Tool Execution.'
    )
  }
  return settings.token
}

export function isSpritesExecutionAvailable(settings: SpritesTokenSettings): boolean {
  return settings.enabled && Boolean(settings.token)
}
