import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDb } from '@nitejar/database'
import { GET as listModels } from '../../../apps/web/app/api/models/route'
import { POST as refreshEndpoint } from '../../../apps/web/app/api/models/refresh/route'

vi.mock('@/lib/api-auth', () => ({
  requireApiAuth: vi.fn(() => Promise.resolve(null)),
  requireApiRole: vi.fn(() => Promise.resolve(null)),
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)
const getModels = listModels as unknown as (request: Request) => Promise<Response>
const refreshModels = refreshEndpoint as unknown as (request: Request) => Promise<Response>

function createRequest(method: 'GET' | 'POST'): Request {
  return new Request('http://localhost/api/models', { method })
}

afterEach(() => {
  mockFetch.mockReset()
})

describe('model catalog API', () => {
  it('refresh endpoint persists fetched models', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [
            {
              id: 'openai/gpt-4o-mini',
              name: 'GPT-4o Mini',
              context_length: 128000,
              architecture: { modality: 'text' },
              supported_parameters: ['tools'],
            },
            {
              id: 'openrouter/test-model',
              name: 'Test Model',
              context_length: 4096,
              architecture: { modality: 'text' },
              supported_parameters: [],
            },
          ],
        }),
    })

    const response = await refreshModels(createRequest('POST'))
    const data: unknown = await response.json()

    expect(data).toMatchObject({
      count: 2,
      source: 'openrouter',
    })

    const db = getDb()
    const curated = await db
      .selectFrom('model_catalog')
      .selectAll()
      .where('external_id', '=', 'openai/gpt-4o-mini')
      .executeTakeFirst()

    expect(curated?.is_curated).toBe(1)
  })

  it('list endpoint returns cached models', async () => {
    const db = getDb()
    await db
      .insertInto('model_catalog')
      .values({
        external_id: 'openrouter/cached-model',
        name: 'Cached Model',
        metadata_json: JSON.stringify({ externalId: 'openrouter/cached-model' }),
        source: 'openrouter',
        is_curated: 0,
        refreshed_at: Math.floor(Date.now() / 1000),
      })
      .execute()

    const response = await getModels(createRequest('GET'))
    const data: unknown = await response.json()

    expect(data).toMatchObject({
      refreshing: false,
      models: [{ externalId: 'openrouter/cached-model' }],
    })
  })

  it('marks stale cache as refreshing and triggers background refresh', async () => {
    const db = getDb()
    await db
      .insertInto('model_catalog')
      .values({
        external_id: 'openrouter/stale-model',
        name: 'Stale Model',
        metadata_json: JSON.stringify({ externalId: 'openrouter/stale-model' }),
        source: 'openrouter',
        is_curated: 0,
        refreshed_at: Math.floor(Date.now() / 1000) - 60 * 60 * 25,
      })
      .execute()

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: [] }),
    })

    const response = await getModels(createRequest('GET'))
    const data: unknown = await response.json()

    expect(data).toMatchObject({ refreshing: true })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mockFetch).toHaveBeenCalled()
  })
})
