import OpenAI from 'openai'
import { decrypt, getDb } from '@nitejar/database'

const DEFAULT_GATEWAY_ID = 'default'
const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

export async function loadGatewayConfig(): Promise<{
  apiKey: string | null
  baseUrl: string | null
  hasSettings: boolean
}> {
  try {
    const db = getDb()
    const settings = await db
      .selectFrom('gateway_settings')
      .selectAll()
      .where('id', '=', DEFAULT_GATEWAY_ID)
      .executeTakeFirst()

    if (!settings) {
      return { apiKey: null, baseUrl: null, hasSettings: false }
    }

    let apiKeyValue: string | null = null
    if (settings.api_key_encrypted) {
      try {
        apiKeyValue = decrypt(settings.api_key_encrypted)
      } catch (error) {
        console.warn('[Gateway] Failed to decrypt gateway API key', error)
      }
    }

    return {
      apiKey: apiKeyValue,
      baseUrl: settings.base_url ?? null,
      hasSettings: true,
    }
  } catch (error) {
    console.warn('[Gateway] Failed to load gateway settings, using env', error)
    return { apiKey: null, baseUrl: null, hasSettings: false }
  }
}

// Initialize OpenRouter client (OpenAI-compatible)
export async function getGatewayClient(): Promise<OpenAI> {
  const gateway = await loadGatewayConfig()
  const envOpenRouterKey = process.env.OPENROUTER_API_KEY
  const envOpenAIKey = process.env.OPENAI_API_KEY

  const apiKey = gateway.apiKey || envOpenRouterKey || envOpenAIKey
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY or OPENAI_API_KEY is required')
  }

  const usingOpenRouterKey = Boolean(gateway.apiKey || envOpenRouterKey)
  const baseURL = usingOpenRouterKey ? (gateway.baseUrl ?? DEFAULT_OPENROUTER_BASE_URL) : undefined

  return new OpenAI({ apiKey, baseURL })
}
