import { describe, expect, it, vi } from 'vitest'
import { getDb } from '@nitejar/database'
import { GET, POST } from '../../../apps/web/app/api/settings/gateway/route'

vi.mock('@/lib/api-auth', () => ({
  requireApiAuth: vi.fn(() => Promise.resolve(null)),
  requireApiRole: vi.fn(() => Promise.resolve(null)),
}))

const getGateway = GET as unknown as (request: Request) => Promise<Response>
const postGateway = POST as unknown as (request: Request) => Promise<Response>

function createRequest(body?: Record<string, unknown>): Request {
  return new Request('http://localhost/api/settings/gateway', {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
}

describe('gateway settings API', () => {
  it('returns defaults when no settings exist', async () => {
    const response = await getGateway(createRequest())
    const data = await response.json()

    expect(data.provider).toBe('openrouter')
    expect(data.baseUrl).toBeNull()
    expect(data.hasApiKey).toBe(false)
  })

  it('persists settings and masks API key', async () => {
    const response = await postGateway(
      createRequest({
        provider: 'openrouter',
        apiKey: 'secret-key',
        baseUrl: 'https://openrouter.example',
      })
    )

    const data = await response.json()
    expect(data.provider).toBe('openrouter')
    expect(data.baseUrl).toBe('https://openrouter.example')
    expect(data.hasApiKey).toBe(true)

    const db = getDb()
    const row = await db
      .selectFrom('gateway_settings')
      .selectAll()
      .where('id', '=', 'default')
      .executeTakeFirst()

    expect(row?.api_key_encrypted).toMatch(/^enc:/)
  })

  it('rejects unsupported providers', async () => {
    const response = await postGateway(createRequest({ provider: 'anthropic' }))
    expect(response.status).toBe(400)
  })
})
