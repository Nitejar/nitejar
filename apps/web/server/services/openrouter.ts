export type OpenRouterPricing = {
  prompt?: number | null
  completion?: number | null
  request?: number | null
  image?: number | null
  input_cache_read?: number | null
  input_cache_write?: number | null
  cache_read?: number | null
  cache_write?: number | null
  internal_reasoning?: number | null
  unit?: string | null
}

export interface NormalizedModel {
  externalId: string
  name: string
  contextLength: number | null
  modalities: string[]
  supportedParameters: string[] | null
  pricing: OpenRouterPricing | null
  supportsTools: boolean
  source: 'openrouter' | 'fallback'
}

export const CURATED_OPENROUTER_MODELS: NormalizedModel[] = [
  {
    externalId: 'openai/gpt-4o-mini',
    name: 'GPT-4o Mini',
    contextLength: 128000,
    modalities: ['text', 'image'],
    supportedParameters: null,
    pricing: null,
    supportsTools: true,
    source: 'fallback',
  },
  {
    externalId: 'anthropic/claude-3.5-sonnet',
    name: 'Claude 3.5 Sonnet',
    contextLength: 200000,
    modalities: ['text'],
    supportedParameters: null,
    pricing: null,
    supportsTools: true,
    source: 'fallback',
  },
  {
    externalId: 'openai/gpt-4.1-mini',
    name: 'GPT-4.1 Mini',
    contextLength: 128000,
    modalities: ['text'],
    supportedParameters: null,
    pricing: null,
    supportsTools: true,
    source: 'fallback',
  },
]

type OpenRouterModel = {
  id?: unknown
  name?: unknown
  context_length?: unknown
  architecture?: {
    modality?: unknown
    input_modalities?: unknown
    output_modalities?: unknown
  }
  pricing?: Record<string, unknown> | null
  supported_parameters?: unknown
}

type OpenRouterModelsResponse = {
  data?: unknown
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function normalizeModalities(model: OpenRouterModel): string[] {
  const architecture = model.architecture

  const inputModalities = Array.isArray(architecture?.input_modalities)
    ? architecture?.input_modalities.filter((value) => typeof value === 'string')
    : []

  const outputModalities = Array.isArray(architecture?.output_modalities)
    ? architecture?.output_modalities.filter((value) => typeof value === 'string')
    : []

  const combined = [...inputModalities, ...outputModalities].filter(
    (value, index, arr) => arr.indexOf(value) === index
  )

  if (combined.length > 0) {
    return combined
  }

  const modality = typeof architecture?.modality === 'string' ? architecture?.modality : ''
  if (modality) {
    return modality
      .split('+')
      .map((value) => value.trim())
      .filter(Boolean)
  }

  return ['text']
}

function supportsTools(model: OpenRouterModel): boolean {
  const supported = Array.isArray(model.supported_parameters) ? model.supported_parameters : []

  return supported.some(
    (value) =>
      typeof value === 'string' &&
      ['tools', 'tool_calls', 'function_call', 'functions'].includes(value)
  )
}

function normalizeSupportedParameters(model: OpenRouterModel): string[] | null {
  if (!Array.isArray(model.supported_parameters)) {
    return null
  }

  const supported = model.supported_parameters
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)

  return Array.from(new Set(supported))
}

function normalizePricing(model: OpenRouterModel): OpenRouterPricing | null {
  if (!model.pricing || typeof model.pricing !== 'object') return null

  const prompt = normalizeNumber(model.pricing.prompt)
  const completion = normalizeNumber(model.pricing.completion)
  const request = normalizeNumber(model.pricing.request)
  const image = normalizeNumber(model.pricing.image)
  const inputCacheRead = normalizeNumber(model.pricing.input_cache_read)
  const inputCacheWrite = normalizeNumber(model.pricing.input_cache_write)
  const cacheRead = normalizeNumber(model.pricing.cache_read)
  const cacheWrite = normalizeNumber(model.pricing.cache_write)
  const internalReasoning = normalizeNumber(model.pricing.internal_reasoning)
  const unit = typeof model.pricing.unit === 'string' ? model.pricing.unit : null

  if (
    [
      prompt,
      completion,
      request,
      image,
      inputCacheRead,
      inputCacheWrite,
      cacheRead,
      cacheWrite,
      internalReasoning,
      unit,
    ].every((value) => value === null)
  ) {
    return null
  }

  return {
    prompt,
    completion,
    request,
    image,
    input_cache_read: inputCacheRead,
    input_cache_write: inputCacheWrite,
    cache_read: cacheRead,
    cache_write: cacheWrite,
    internal_reasoning: internalReasoning,
    unit,
  }
}

function normalizeModel(model: OpenRouterModel): NormalizedModel | null {
  const externalId = typeof model.id === 'string' ? model.id : null
  const name = typeof model.name === 'string' ? model.name : externalId

  if (!externalId || !name) return null

  return {
    externalId,
    name,
    contextLength: normalizeNumber(model.context_length),
    modalities: normalizeModalities(model),
    supportedParameters: normalizeSupportedParameters(model),
    pricing: normalizePricing(model),
    supportsTools: supportsTools(model),
    source: 'openrouter',
  }
}

export async function fetchOpenRouterModels(options?: {
  apiKey?: string | null
  baseUrl?: string | null
  timeoutMs?: number
}): Promise<{ models: NormalizedModel[]; source: 'openrouter' | 'fallback'; error?: string }> {
  const baseUrl = options?.baseUrl?.trim() || 'https://openrouter.ai/api/v1'
  const apiKey = options?.apiKey ?? null
  const timeoutMs = options?.timeoutMs ?? 10000

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
      signal: controller.signal,
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`OpenRouter error ${response.status}: ${text}`)
    }

    const payload: unknown = await response.json()
    const responseData =
      payload && typeof payload === 'object'
        ? (payload as OpenRouterModelsResponse).data
        : undefined
    const data: OpenRouterModel[] = Array.isArray(responseData)
      ? (responseData as OpenRouterModel[])
      : []

    const models = data
      .map((model) => normalizeModel(model))
      .filter((model): model is NormalizedModel => Boolean(model))

    return { models, source: 'openrouter' }
  } catch (error) {
    return {
      models: CURATED_OPENROUTER_MODELS,
      source: 'fallback',
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    clearTimeout(timeoutId)
  }
}
