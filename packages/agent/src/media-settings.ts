import { decrypt, getDb } from '@nitejar/database'

const DEFAULT_GATEWAY_ID = 'default'
const IMAGE_CAPABILITY_ID = 'image_generation'
const STT_CAPABILITY_ID = 'speech_to_text'
const TTS_CAPABILITY_ID = 'text_to_speech'

const DEFAULT_IMAGE_MODEL = 'google/gemini-2.5-flash-image-preview'
const DEFAULT_STT_MODEL = 'google/gemini-2.5-flash'
const DEFAULT_TTS_PROVIDER = 'openai'
const DEFAULT_TTS_MODEL = 'tts-1'

interface CapabilityConfig {
  model?: unknown
  provider?: unknown
  cost_per_1k_chars_usd?: unknown
}

function parseConfig(raw: string | null): CapabilityConfig {
  if (!raw) return {}
  try {
    return JSON.parse(raw) as CapabilityConfig
  } catch {
    return {}
  }
}

async function getCapabilityRow(id: string): Promise<{
  provider: string
  api_key_encrypted: string | null
  enabled: number
  config: string | null
} | null> {
  try {
    const db = getDb()
    const row = await db
      .selectFrom('capability_settings')
      .select(['provider', 'api_key_encrypted', 'enabled', 'config'])
      .where('id', '=', id)
      .executeTakeFirst()
    return row ?? null
  } catch {
    return null
  }
}

async function getGatewayApiKey(): Promise<string | null> {
  try {
    const db = getDb()
    const row = await db
      .selectFrom('gateway_settings')
      .select(['api_key_encrypted'])
      .where('id', '=', DEFAULT_GATEWAY_ID)
      .executeTakeFirst()
    if (row?.api_key_encrypted) {
      return decrypt(row.api_key_encrypted)
    }
  } catch {
    // Fall through to environment variable fallback.
  }

  return process.env.OPENROUTER_API_KEY ?? process.env.OPENAI_API_KEY ?? null
}

function isCapabilityEnabledByDefault(row: { enabled: number } | null): boolean {
  return row ? row.enabled === 1 : true
}

export async function isImageGenAvailable(): Promise<boolean> {
  const [gatewayApiKey, capability] = await Promise.all([
    getGatewayApiKey(),
    getCapabilityRow(IMAGE_CAPABILITY_ID),
  ])
  return Boolean(gatewayApiKey) && isCapabilityEnabledByDefault(capability)
}

export async function isSTTAvailable(): Promise<boolean> {
  const [gatewayApiKey, capability] = await Promise.all([
    getGatewayApiKey(),
    getCapabilityRow(STT_CAPABILITY_ID),
  ])
  return Boolean(gatewayApiKey) && isCapabilityEnabledByDefault(capability)
}

interface TTSSettings {
  enabled: boolean
  provider: string
  apiKey: string | null
  model: string
  costPer1kCharsUsd: number | null
}

export async function getTTSSettings(): Promise<TTSSettings> {
  const row = await getCapabilityRow(TTS_CAPABILITY_ID)
  const config = parseConfig(row?.config ?? null)
  const provider =
    (typeof config.provider === 'string' && config.provider.trim()) ||
    row?.provider ||
    DEFAULT_TTS_PROVIDER
  const model = (typeof config.model === 'string' && config.model.trim()) || DEFAULT_TTS_MODEL
  const costPer1kCharsUsd =
    typeof config.cost_per_1k_chars_usd === 'number' &&
    Number.isFinite(config.cost_per_1k_chars_usd) &&
    config.cost_per_1k_chars_usd > 0
      ? config.cost_per_1k_chars_usd
      : null

  let apiKey: string | null = null
  if (row?.api_key_encrypted) {
    try {
      apiKey = decrypt(row.api_key_encrypted)
    } catch {
      apiKey = null
    }
  }

  return {
    enabled: row?.enabled === 1,
    provider,
    apiKey,
    model,
    costPer1kCharsUsd,
  }
}

export async function isTTSAvailable(): Promise<boolean> {
  const tts = await getTTSSettings()
  return tts.enabled && Boolean(tts.apiKey) && tts.provider === 'openai'
}

export async function getTTSProvider(): Promise<string> {
  const tts = await getTTSSettings()
  return tts.provider
}

export async function getImageGenModel(): Promise<string> {
  const row = await getCapabilityRow(IMAGE_CAPABILITY_ID)
  const config = parseConfig(row?.config ?? null)
  return (typeof config.model === 'string' && config.model.trim()) || DEFAULT_IMAGE_MODEL
}

export async function getSTTModel(): Promise<string> {
  const row = await getCapabilityRow(STT_CAPABILITY_ID)
  const config = parseConfig(row?.config ?? null)
  return (typeof config.model === 'string' && config.model.trim()) || DEFAULT_STT_MODEL
}

export async function getTTSModel(): Promise<string> {
  const tts = await getTTSSettings()
  return tts.model
}

export async function getTTSCostPer1KCharsUsd(): Promise<number | null> {
  const tts = await getTTSSettings()
  return tts.costPer1kCharsUsd
}
