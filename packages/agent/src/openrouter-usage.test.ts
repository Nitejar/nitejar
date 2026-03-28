import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeOpenRouterChatCompletionUsage } from './openrouter-usage'

describe('normalizeOpenRouterChatCompletionUsage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads cache tokens from prompt token details when present', async () => {
    const result = await normalizeOpenRouterChatCompletionUsage({
      id: 'gen-1',
      usage: {
        prompt_tokens: 120,
        completion_tokens: 30,
        total_tokens: 150,
        cost: 0.01,
        prompt_tokens_details: {
          cached_tokens: 80,
          cache_write_tokens: 16,
        },
      },
    })

    expect(result).toEqual({
      promptTokens: 120,
      completionTokens: 30,
      totalTokens: 150,
      costUsd: 0.01,
      cacheReadTokens: 80,
      cacheWriteTokens: 16,
      generationId: 'gen-1',
    })
  })

  it('falls back to generation enrichment when cache details are missing', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          native_tokens_cached: 56448,
        },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await normalizeOpenRouterChatCompletionUsage(
      {
        id: 'gen-2',
        usage: {
          prompt_tokens: 100,
          completion_tokens: 20,
          total_tokens: 120,
          total_cost: 0.02,
        },
      },
      {
        apiKey: 'test-key',
        baseUrl: 'https://openrouter.ai/api/v1',
      }
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.cacheReadTokens).toBe(56448)
    expect(result.cacheWriteTokens).toBe(0)
    expect(result.costUsd).toBe(0.02)
  })

  it('returns base usage when enrichment fails', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('boom'))
    const warn = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await normalizeOpenRouterChatCompletionUsage(
      {
        id: 'gen-3',
        usage: {
          prompt_tokens: 50,
          completion_tokens: 10,
          total_tokens: 60,
          cost: 0.004,
        },
      },
      {
        apiKey: 'test-key',
        baseUrl: 'https://openrouter.ai/api/v1',
        warn,
      }
    )

    expect(result).toEqual({
      promptTokens: 50,
      completionTokens: 10,
      totalTokens: 60,
      costUsd: 0.004,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      generationId: 'gen-3',
    })
    expect(warn).toHaveBeenCalled()
  })
})
