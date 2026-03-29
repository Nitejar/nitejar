import type OpenAI from 'openai'
import { DEFAULT_OPENROUTER_BASE_URL, loadGatewayConfig } from './model-client'

export interface OpenRouterUsageSummary {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  costUsd: number | null
  cacheReadTokens: number
  cacheWriteTokens: number
  generationId: string | null
}

export interface NormalizeOpenRouterUsageOptions {
  apiKey?: string | null
  baseUrl?: string | null
  timeoutMs?: number
  fetchImpl?: typeof fetch
  warn?: (message: string, meta?: Record<string, unknown>) => void
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

async function resolveOpenRouterAuth(
  options: NormalizeOpenRouterUsageOptions
): Promise<{ apiKey: string | null; baseUrl: string | null }> {
  if (options.apiKey || options.baseUrl) {
    return {
      apiKey: options.apiKey ?? null,
      baseUrl: options.baseUrl ?? DEFAULT_OPENROUTER_BASE_URL,
    }
  }

  const gateway = await loadGatewayConfig()
  const envOpenRouterKey = process.env.OPENROUTER_API_KEY
  const apiKey = gateway.apiKey || envOpenRouterKey
  if (!apiKey) {
    return { apiKey: null, baseUrl: null }
  }

  return {
    apiKey,
    baseUrl: gateway.baseUrl ?? DEFAULT_OPENROUTER_BASE_URL,
  }
}

function parseGenerationCacheDetails(payload: unknown): {
  cacheReadTokens: number
  cacheWriteTokens: number
} | null {
  const record = asRecord(payload)
  if (!record) return null

  const dataRecord = asRecord(record.data) ?? record
  const cacheReadTokens = asFiniteNumber(dataRecord.native_tokens_cached) ?? 0
  const cacheWriteTokens = asFiniteNumber(dataRecord.cache_write_tokens) ?? 0

  return {
    cacheReadTokens,
    cacheWriteTokens,
  }
}

async function fetchGenerationCacheDetails(
  generationId: string,
  options: NormalizeOpenRouterUsageOptions
): Promise<{ cacheReadTokens: number; cacheWriteTokens: number } | null> {
  const { apiKey, baseUrl } = await resolveOpenRouterAuth(options)
  if (!apiKey || !baseUrl) {
    return null
  }

  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? 3000
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const url = new URL(`${baseUrl.replace(/\/+$/, '')}/generation`)
    url.searchParams.set('id', generationId)

    const response = await fetchImpl(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
    })

    if (!response.ok) {
      options.warn?.('Failed to fetch OpenRouter generation metadata', {
        generationId,
        status: response.status,
      })
      return null
    }

    const payload: unknown = await response.json()
    return parseGenerationCacheDetails(payload)
  } catch (error) {
    options.warn?.('Failed to enrich OpenRouter usage from generation metadata', {
      generationId,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  } finally {
    clearTimeout(timeout)
  }
}

export async function normalizeOpenRouterChatCompletionUsage(
  response: OpenAI.ChatCompletion | Record<string, unknown>,
  options: NormalizeOpenRouterUsageOptions = {}
): Promise<OpenRouterUsageSummary> {
  const responseRecord = asRecord(response)
  const usage = asRecord(responseRecord?.usage)
  const usageDetails = asRecord(usage?.prompt_tokens_details)

  const promptTokens = asFiniteNumber(usage?.prompt_tokens) ?? 0
  const completionTokens = asFiniteNumber(usage?.completion_tokens) ?? 0
  const totalTokens = asFiniteNumber(usage?.total_tokens) ?? promptTokens + completionTokens
  const costUsd = asFiniteNumber(usage?.cost) ?? asFiniteNumber(usage?.total_cost)
  let cacheReadTokens = asFiniteNumber(usageDetails?.cached_tokens) ?? 0
  let cacheWriteTokens = asFiniteNumber(usageDetails?.cache_write_tokens) ?? 0
  const generationId = typeof responseRecord?.id === 'string' ? responseRecord.id : null

  if (generationId && cacheReadTokens === 0 && cacheWriteTokens === 0) {
    const generationDetails = await fetchGenerationCacheDetails(generationId, options)
    if (generationDetails) {
      cacheReadTokens = generationDetails.cacheReadTokens
      cacheWriteTokens = generationDetails.cacheWriteTokens
    }
  }

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    costUsd,
    cacheReadTokens,
    cacheWriteTokens,
    generationId,
  }
}
