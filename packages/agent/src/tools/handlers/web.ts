import type Anthropic from '@anthropic-ai/sdk'
import { extractUrls, formatExtractResults, formatSearchResults, webSearch } from '../../web-search'
import type { ToolHandler } from '../types'

export const webDefinitions: Anthropic.Tool[] = [
  {
    name: 'web_search',
    description:
      'Search the web for information. Returns top results with titles, URLs, content snippets, and relevance scores.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'The search query (max 400 characters).',
        },
        max_results: {
          type: 'integer',
          description: 'Maximum number of results to return (1-20, default: 5).',
        },
        topic: {
          type: 'string',
          enum: ['general', 'news', 'finance'],
          description: 'Search topic category (default: general).',
        },
        time_range: {
          type: 'string',
          enum: ['day', 'week', 'month', 'year'],
          description: 'Limit results to a time range.',
        },
        include_domains: {
          type: 'array',
          items: { type: 'string' },
          description: 'Only include results from these domains.',
        },
        exclude_domains: {
          type: 'array',
          items: { type: 'string' },
          description: 'Exclude results from these domains.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'extract_url',
    description:
      'Extract content from specific URLs. Returns the page content as markdown. Use this when you already have a URL and need to read its contents.',
    input_schema: {
      type: 'object' as const,
      properties: {
        urls: {
          type: 'array',
          items: { type: 'string' },
          description: 'URLs to extract content from (max 20).',
        },
        query: {
          type: 'string',
          description:
            'Optional query to extract only the most relevant chunks from each page instead of full content.',
        },
        chunks_per_source: {
          type: 'integer',
          description:
            'Number of relevant chunks per source when query is provided (1-5, default: 3).',
        },
      },
      required: ['urls'],
    },
  },
]

export const webSearchTool: ToolHandler = async (input) => {
  const query = typeof input.query === 'string' ? input.query.trim() : ''
  if (!query) {
    return { success: false, error: 'query is required.' }
  }
  if (query.length > 400) {
    return { success: false, error: 'query must be 400 characters or fewer.' }
  }

  const maxResults = Math.min(Math.max((input.max_results as number) || 5, 1), 20)
  const topic = input.topic as 'general' | 'news' | 'finance' | undefined
  const timeRange = input.time_range as 'day' | 'week' | 'month' | 'year' | undefined
  const includeDomains = Array.isArray(input.include_domains)
    ? (input.include_domains as string[])
    : undefined
  const excludeDomains = Array.isArray(input.exclude_domains)
    ? (input.exclude_domains as string[])
    : undefined

  try {
    const result = await webSearch({
      query,
      maxResults,
      topic,
      timeRange,
      includeDomains,
      excludeDomains,
    })

    return {
      success: true,
      output: formatSearchResults(result),
      _meta: {
        externalApiCost: {
          provider: 'tavily',
          operation: 'search',
          creditsUsed: result.creditsUsed,
          costUsd: result.costUsd,
          durationMs: result.durationMs,
        },
      },
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export const extractUrlTool: ToolHandler = async (input) => {
  const urls = Array.isArray(input.urls) ? (input.urls as string[]) : []
  if (urls.length === 0) {
    return { success: false, error: 'urls is required and must be a non-empty array.' }
  }
  if (urls.length > 20) {
    return { success: false, error: 'Maximum 20 URLs per request.' }
  }

  const query = typeof input.query === 'string' ? input.query.trim() || undefined : undefined
  const chunksPerSource = query
    ? Math.min(Math.max((input.chunks_per_source as number) || 3, 1), 5)
    : undefined

  try {
    const result = await extractUrls({ urls, query, chunksPerSource })

    return {
      success: true,
      output: formatExtractResults(result),
      _meta: {
        externalApiCost: {
          provider: 'tavily',
          operation: 'extract',
          creditsUsed: result.creditsUsed,
          costUsd: result.costUsd,
          durationMs: result.durationMs,
        },
      },
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
