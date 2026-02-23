import { encrypt, getDb } from '@nitejar/database'

const SETTINGS_ID = 'default'
const ALLOWED_PROVIDER = 'openrouter'

export interface GatewaySettings {
  provider: string
  baseUrl: string | null
  hasApiKey: boolean
}

function now(): number {
  return Math.floor(Date.now() / 1000)
}

export async function getGatewaySettings(): Promise<GatewaySettings> {
  const db = getDb()
  const existing = await db
    .selectFrom('gateway_settings')
    .selectAll()
    .where('id', '=', SETTINGS_ID)
    .executeTakeFirst()

  const provider = existing?.provider ?? ALLOWED_PROVIDER
  const baseUrl = existing?.base_url ?? null
  const hasApiKey = Boolean(existing?.api_key_encrypted)

  return { provider, baseUrl, hasApiKey }
}

export async function updateGatewaySettings(input: {
  provider?: string | null
  baseUrl?: string | null
  apiKey?: string | null
}): Promise<GatewaySettings> {
  const db = getDb()
  const existing = await db
    .selectFrom('gateway_settings')
    .selectAll()
    .where('id', '=', SETTINGS_ID)
    .executeTakeFirst()

  const nextProvider = input.provider ?? existing?.provider ?? ALLOWED_PROVIDER
  if (nextProvider !== ALLOWED_PROVIDER) {
    throw new Error(`Unsupported provider: ${nextProvider}`)
  }

  const nextBaseUrl = input.baseUrl ?? existing?.base_url ?? null
  let nextApiKeyEncrypted = existing?.api_key_encrypted ?? null

  if (input.apiKey !== undefined && input.apiKey !== null) {
    const apiKey = input.apiKey.trim()
    nextApiKeyEncrypted = apiKey ? encrypt(apiKey) : null
  }

  const timestamp = now()

  if (existing) {
    await db
      .updateTable('gateway_settings')
      .set({
        provider: nextProvider,
        base_url: nextBaseUrl,
        api_key_encrypted: nextApiKeyEncrypted,
        updated_at: timestamp,
      })
      .where('id', '=', SETTINGS_ID)
      .execute()
  } else {
    await db
      .insertInto('gateway_settings')
      .values({
        id: SETTINGS_ID,
        provider: nextProvider,
        base_url: nextBaseUrl,
        api_key_encrypted: nextApiKeyEncrypted,
        created_at: timestamp,
        updated_at: timestamp,
      })
      .execute()
  }

  return {
    provider: nextProvider,
    baseUrl: nextBaseUrl,
    hasApiKey: Boolean(nextApiKeyEncrypted),
  }
}
