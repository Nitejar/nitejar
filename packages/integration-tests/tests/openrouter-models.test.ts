import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  CURATED_OPENROUTER_MODELS,
  fetchOpenRouterModels,
} from '../../../apps/web/server/services/openrouter'

const mockFetch = vi.fn()

vi.stubGlobal('fetch', mockFetch)

afterEach(() => {
  mockFetch.mockReset()
})

describe('fetchOpenRouterModels', () => {
  it('normalizes API responses', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [
            {
              id: 'openrouter/test-model',
              name: 'Test Model',
              context_length: 8192,
              architecture: { modality: 'text+image' },
              supported_parameters: ['tools'],
              pricing: { prompt: '0.1', completion: '0.2', unit: '1k' },
            },
          ],
        }),
    })

    const result = await fetchOpenRouterModels({ apiKey: 'key' })
    expect(result.source).toBe('openrouter')
    expect(result.models).toHaveLength(1)

    const model = result.models[0]
    expect(model.externalId).toBe('openrouter/test-model')
    expect(model.contextLength).toBe(8192)
    expect(model.modalities).toEqual(['text', 'image'])
    expect(model.supportsTools).toBe(true)
    expect(model.pricing?.prompt).toBe(0.1)
  })

  it('returns fallback models on API failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve('server error'),
    })

    const result = await fetchOpenRouterModels()
    expect(result.source).toBe('fallback')
    expect(result.models).toEqual(CURATED_OPENROUTER_MODELS)
  })
})
