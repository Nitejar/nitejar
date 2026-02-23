import { tavily, type TavilySearchResponse, type TavilyExtractResponse } from '@tavily/core'
import { getDb, decrypt } from '@nitejar/database'

// Cost estimation defaults
const DEFAULT_COST_PER_CREDIT = 0.008
const SEARCH_ADVANCED_CREDITS = 2
const EXTRACT_BASIC_CREDITS_PER_URL = 1
const EXTRACT_ADVANCED_CREDITS_PER_URL = 2

interface TavilySettings {
  apiKey: string | null
  costPerCredit: number
}

/**
 * Load Tavily settings from capability_settings (DB) with env var fallback.
 */
async function getTavilySettings(): Promise<TavilySettings> {
  let costPerCredit = DEFAULT_COST_PER_CREDIT

  try {
    const db = getDb()
    const row = await db
      .selectFrom('capability_settings')
      .select(['api_key_encrypted', 'enabled', 'config'])
      .where('id', '=', 'web_search')
      .executeTakeFirst()

    if (row?.config) {
      try {
        const config = JSON.parse(row.config) as Record<string, unknown>
        if (typeof config.cost_per_credit === 'number' && config.cost_per_credit > 0) {
          costPerCredit = config.cost_per_credit
        }
      } catch {
        // Invalid JSON, use default
      }
    }

    if (row?.api_key_encrypted && row.enabled === 1) {
      try {
        return { apiKey: decrypt(row.api_key_encrypted), costPerCredit }
      } catch {
        // Decryption failed, fall through to env
      }
    }
  } catch {
    // Table may not exist yet, fall through to env
  }

  return { apiKey: process.env.TAVILY_API_KEY ?? null, costPerCredit }
}

/**
 * Load Tavily API key from capability_settings (DB) with env var fallback.
 */
export async function getTavilyApiKey(): Promise<string | null> {
  const settings = await getTavilySettings()
  return settings.apiKey
}

/**
 * Check if Tavily web search is available (API key configured).
 */
export async function isTavilyAvailable(): Promise<boolean> {
  const key = await getTavilyApiKey()
  return key !== null && key.length > 0
}

export interface WebSearchOptions {
  query: string
  maxResults?: number
  topic?: 'general' | 'news' | 'finance'
  timeRange?: 'day' | 'week' | 'month' | 'year'
  includeDomains?: string[]
  excludeDomains?: string[]
}

export interface WebSearchResult {
  response: TavilySearchResponse
  creditsUsed: number
  costUsd: number
  durationMs: number
}

/**
 * Perform a web search via Tavily.
 */
export async function webSearch(options: WebSearchOptions): Promise<WebSearchResult> {
  const settings = await getTavilySettings()
  if (!settings.apiKey) {
    throw new Error('Tavily API key not configured. Add it in Settings > Capabilities.')
  }

  const client = tavily({ apiKey: settings.apiKey })
  const start = Date.now()

  const response = await client.search(options.query, {
    searchDepth: 'advanced',
    includeAnswer: false,
    includeRawContent: false,
    maxResults: options.maxResults ?? 5,
    topic: options.topic,
    timeRange: options.timeRange,
    includeDomains: options.includeDomains,
    excludeDomains: options.excludeDomains,
  })

  const durationMs = Date.now() - start
  const creditsUsed = response.usage?.credits ?? SEARCH_ADVANCED_CREDITS
  const costUsd = creditsUsed * settings.costPerCredit

  return { response, creditsUsed, costUsd, durationMs }
}

export interface ExtractUrlOptions {
  urls: string[]
  query?: string
  chunksPerSource?: number
}

export interface ExtractUrlResult {
  response: TavilyExtractResponse
  creditsUsed: number
  costUsd: number
  durationMs: number
}

/**
 * Extract content from URLs via Tavily.
 * Starts with basic depth, retries with advanced on failure.
 */
export async function extractUrls(options: ExtractUrlOptions): Promise<ExtractUrlResult> {
  const settings = await getTavilySettings()
  if (!settings.apiKey) {
    throw new Error('Tavily API key not configured. Add it in Settings > Capabilities.')
  }

  const client = tavily({ apiKey: settings.apiKey })
  const start = Date.now()

  let response: TavilyExtractResponse
  let usedAdvanced = false

  try {
    response = await client.extract(options.urls, {
      extractDepth: 'basic',
      format: 'markdown',
      query: options.query,
      chunksPerSource: options.query ? (options.chunksPerSource ?? 3) : undefined,
    })
  } catch {
    // Retry with advanced depth on failure
    response = await client.extract(options.urls, {
      extractDepth: 'advanced',
      format: 'markdown',
      query: options.query,
      chunksPerSource: options.query ? (options.chunksPerSource ?? 3) : undefined,
    })
    usedAdvanced = true
  }

  const durationMs = Date.now() - start
  const creditsPerUrl = usedAdvanced
    ? EXTRACT_ADVANCED_CREDITS_PER_URL
    : EXTRACT_BASIC_CREDITS_PER_URL
  const creditsUsed = response.usage?.credits ?? options.urls.length * creditsPerUrl
  const costUsd = creditsUsed * settings.costPerCredit

  return { response, creditsUsed, costUsd, durationMs }
}

/**
 * Format search results for the model.
 */
export function formatSearchResults(result: WebSearchResult): string {
  const { response, durationMs } = result
  const results = response.results

  if (results.length === 0) {
    return `No results found for "${response.query}".`
  }

  const lines: string[] = [
    `Found ${results.length} result${results.length === 1 ? '' : 's'} for "${response.query}":\n`,
  ]

  for (let i = 0; i < results.length; i++) {
    const r = results[i]!
    lines.push(`[${i + 1}] "${r.title}" (score: ${r.score.toFixed(2)})`)
    lines.push(`    URL: ${r.url}`)
    if (r.content) {
      lines.push(`    ${r.content}`)
    }
    lines.push('')
  }

  lines.push(`Search completed in ${(durationMs / 1000).toFixed(1)}s`)

  return lines.join('\n')
}

/**
 * Format extract results for the model.
 */
export function formatExtractResults(result: ExtractUrlResult): string {
  const { response, durationMs } = result
  const lines: string[] = []

  if (response.results.length > 0) {
    lines.push(
      `Extracted content from ${response.results.length} URL${response.results.length === 1 ? '' : 's'}:\n`
    )

    for (const r of response.results) {
      lines.push(`--- ${r.title ?? r.url} ---`)
      lines.push(`URL: ${r.url}`)
      if (r.rawContent) {
        lines.push(r.rawContent)
      }
      lines.push('')
    }
  }

  if (response.failedResults.length > 0) {
    lines.push(
      `Failed to extract ${response.failedResults.length} URL${response.failedResults.length === 1 ? '' : 's'}:`
    )
    for (const f of response.failedResults) {
      lines.push(`  - ${f.url}: ${f.error}`)
    }
    lines.push('')
  }

  lines.push(`Extraction completed in ${(durationMs / 1000).toFixed(1)}s`)

  return lines.join('\n')
}
