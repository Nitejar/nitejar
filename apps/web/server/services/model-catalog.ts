import { decrypt, getDb } from '@nitejar/database'
import {
  CURATED_OPENROUTER_MODELS,
  fetchOpenRouterModels,
  type NormalizedModel,
} from './openrouter'

const SETTINGS_ID = 'default'
const STALE_AFTER_SECONDS = 60 * 60 * 24
const REFRESH_INTERVAL_MS = 1000 * 60 * 30
const REFRESH_STATE_KEY = '__nitejarModelCatalogRefresh'

type RefreshState = {
  started: boolean
  running: boolean
  timer?: NodeJS.Timeout
  /** Swappable reference so HMR picks up new code without restarting the interval */
  processFn?: () => Promise<void>
}

export interface ModelCatalogRecord {
  id: number
  externalId: string
  name: string
  source: string
  isCurated: boolean
  refreshedAt: number | null
  metadata: Record<string, unknown> | null
}

function normalizeSupportedParameters(metadata: Record<string, unknown>): string[] | null {
  const raw = metadata.supportedParameters ?? metadata.supported_parameters
  if (!Array.isArray(raw)) {
    return null
  }

  const normalized = raw
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)

  return normalized.length > 0 ? Array.from(new Set(normalized)) : null
}

function supportsReasoningControl(
  metadata: Record<string, unknown>,
  supportedParameters: string[] | null
): boolean {
  if (typeof metadata.supportsReasoningControl === 'boolean') {
    return metadata.supportsReasoningControl
  }

  if (!supportedParameters) {
    return true
  }

  return supportedParameters.some((value) =>
    ['reasoning', 'include_reasoning', 'reasoning_effort'].includes(value)
  )
}

function supportsPromptCaching(
  metadata: Record<string, unknown>,
  supportedParameters: string[] | null
): boolean {
  if (typeof metadata.supportsPromptCaching === 'boolean') {
    return metadata.supportsPromptCaching
  }

  const pricing =
    metadata.pricing && typeof metadata.pricing === 'object'
      ? (metadata.pricing as Record<string, unknown>)
      : null
  if (
    pricing &&
    (pricing.input_cache_read != null ||
      pricing.input_cache_write != null ||
      pricing.inputCacheRead != null ||
      pricing.inputCacheWrite != null ||
      pricing.cache_read != null ||
      pricing.cache_write != null)
  ) {
    // Some providers (e.g. Gemini implicit caching) expose cache pricing
    // but do not advertise a cache_control request parameter.
    return true
  }

  if (!supportedParameters) {
    return false
  }

  return supportedParameters.some((value) =>
    ['cache_control', 'cache-control', 'prompt_cache_key'].includes(value)
  )
}

function now(): number {
  return Math.floor(Date.now() / 1000)
}

async function getGatewayCredentials(): Promise<{ apiKey: string | null; baseUrl: string | null }> {
  const db = getDb()
  const settings = await db
    .selectFrom('gateway_settings')
    .select(['api_key_encrypted', 'base_url'])
    .where('id', '=', SETTINGS_ID)
    .executeTakeFirst()

  if (!settings?.api_key_encrypted) {
    return { apiKey: null, baseUrl: settings?.base_url ?? null }
  }

  try {
    return {
      apiKey: decrypt(settings.api_key_encrypted),
      baseUrl: settings.base_url ?? null,
    }
  } catch (error) {
    console.warn('[Gateway] Failed to decrypt API key', error)
    return { apiKey: null, baseUrl: settings.base_url ?? null }
  }
}

function toRecord(row: {
  id: number
  external_id: string
  name: string
  source: string
  is_curated: number
  refreshed_at: number | null
  metadata_json: string | null
}): ModelCatalogRecord {
  let metadata: Record<string, unknown> | null = null
  if (row.metadata_json) {
    try {
      const parsed = JSON.parse(row.metadata_json) as Record<string, unknown>
      const supportedParameters = normalizeSupportedParameters(parsed)

      metadata = {
        ...parsed,
        ...(supportedParameters ? { supportedParameters } : {}),
        supportsReasoningControl: supportsReasoningControl(parsed, supportedParameters),
        supportsPromptCaching: supportsPromptCaching(parsed, supportedParameters),
      }
    } catch {
      metadata = null
    }
  }

  return {
    id: row.id,
    externalId: row.external_id,
    name: row.name,
    source: row.source,
    isCurated: row.is_curated === 1,
    refreshedAt: row.refreshed_at,
    metadata,
  }
}

function getRefreshState(): RefreshState {
  const globalWithState = globalThis as typeof globalThis & {
    [REFRESH_STATE_KEY]?: RefreshState
  }

  const existing = globalWithState[REFRESH_STATE_KEY]
  if (existing) {
    return existing
  }

  const initialized: RefreshState = { started: false, running: false }
  globalWithState[REFRESH_STATE_KEY] = initialized
  return initialized
}

async function refreshIfStale(): Promise<void> {
  const { isStale } = await listModelCatalog()
  if (isStale) {
    await refreshModelCatalog()
  }
}

export function ensureModelCatalogRefresh(): void {
  const state = getRefreshState()

  // Always update the process function so HMR picks up new code
  state.processFn = refreshIfStale

  if (state.started) return

  state.started = true

  const tick = async () => {
    if (state.running) return
    state.running = true
    try {
      await state.processFn!()
    } catch (error) {
      console.warn('[ModelCatalog] Background refresh failed', error)
    } finally {
      state.running = false
    }
  }

  void tick()
  state.timer = setInterval(() => {
    void tick()
  }, REFRESH_INTERVAL_MS)

  if (typeof state.timer.unref === 'function') {
    state.timer.unref()
  }
}

export async function listModelCatalog(): Promise<{
  models: ModelCatalogRecord[]
  isStale: boolean
}> {
  const db = getDb()
  const rows = await db.selectFrom('model_catalog').selectAll().orderBy('name', 'asc').execute()

  const models = rows.map(toRecord)
  const latestRefresh = rows.reduce((max, row) => Math.max(max, row.refreshed_at ?? 0), 0)
  const isStale = rows.length === 0 || latestRefresh < now() - STALE_AFTER_SECONDS

  return { models, isStale }
}

export async function getModelCatalogRecordByExternalId(
  externalId: string
): Promise<ModelCatalogRecord | null> {
  const db = getDb()
  const row = await db
    .selectFrom('model_catalog')
    .selectAll()
    .where('external_id', '=', externalId)
    .executeTakeFirst()

  return row ? toRecord(row) : null
}

export async function refreshModelCatalog(): Promise<{
  models: NormalizedModel[]
  source: 'openrouter' | 'fallback'
  error?: string
}> {
  const { apiKey, baseUrl } = await getGatewayCredentials()
  const result = await fetchOpenRouterModels({ apiKey, baseUrl })

  const curated = new Set(CURATED_OPENROUTER_MODELS.map((model) => model.externalId))
  const timestamp = now()

  if (result.models.length > 0) {
    const db = getDb()

    const rows = result.models.map((model) => ({
      external_id: model.externalId,
      name: model.name,
      metadata_json: JSON.stringify(model),
      source: model.source,
      is_curated: curated.has(model.externalId) ? 1 : 0,
      refreshed_at: timestamp,
    }))

    await db
      .insertInto('model_catalog')
      .values(rows)
      .onConflict((oc) =>
        oc.column('external_id').doUpdateSet({
          name: (eb) => eb.ref('excluded.name'),
          metadata_json: (eb) => eb.ref('excluded.metadata_json'),
          source: (eb) => eb.ref('excluded.source'),
          is_curated: (eb) => eb.ref('excluded.is_curated'),
          refreshed_at: (eb) => eb.ref('excluded.refreshed_at'),
        })
      )
      .execute()
  }

  return result
}
