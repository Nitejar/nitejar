import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeTool, type ToolContext } from './tools'
import * as Database from '@nitejar/database'

vi.mock('@nitejar/database', async () => {
  const actual = await vi.importActual<typeof Database>('@nitejar/database')
  return {
    ...actual,
    getDb: vi.fn(),
    listCredentialsForAgent: vi.fn(),
    getCredentialForAgentByAlias: vi.fn(),
  }
})

const mockedGetDb = vi.mocked(Database.getDb)
const mockedListCredentialsForAgent = vi.mocked(Database.listCredentialsForAgent)
const mockedGetCredentialForAgentByAlias = vi.mocked(Database.getCredentialForAgentByAlias)

function makeAuditDb() {
  return {
    insertInto: vi.fn(() => ({
      values: vi.fn(() => ({
        execute: vi.fn().mockResolvedValue(undefined),
      })),
    })),
  }
}

describe('credential tools', () => {
  const context: ToolContext = {
    spriteName: 'sprite-test',
    agentId: 'agent-1',
    jobId: 'job-1',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockedGetDb.mockReturnValue(makeAuditDb() as never)
  })

  it('lists only assigned credentials metadata with placeholder hint', async () => {
    mockedListCredentialsForAgent.mockResolvedValue([
      {
        id: 'cred-1',
        alias: 'instagram_graph_api',
        provider: 'instagram',
        allowedHosts: ['graph.facebook.com'],
        enabled: true,
        allowedInHeader: true,
        allowedInQuery: false,
        allowedInBody: false,
        createdAt: 1,
        updatedAt: 1,
      },
    ])

    const result = await executeTool('list_credentials', {}, context)
    expect(result.success).toBe(true)
    const payload = JSON.parse(result.output ?? '{}') as {
      credentials?: Array<Record<string, unknown>>
    }
    expect(payload.credentials).toHaveLength(1)
    expect(payload.credentials?.[0]?.alias).toBe('instagram_graph_api')
    expect(payload.credentials?.[0]?.placeholder).toBe('{instagram_graph_api}')
    expect(payload.credentials?.[0]?.secret).toBeUndefined()
  })

  it('denies secure request when credential is not assigned', async () => {
    mockedGetCredentialForAgentByAlias.mockResolvedValue(null)

    const result = await executeTool(
      'secure_http_request',
      {
        credential_alias: 'missing_alias',
        url: 'https://api.example.com/data',
      },
      context
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('not assigned')
  })

  it('interpolates {alias} placeholder in headers', async () => {
    mockedGetCredentialForAgentByAlias.mockResolvedValue({
      id: 'cred-1',
      alias: 'header_alias',
      provider: 'provider-a',
      allowedHosts: ['api.example.com'],
      enabled: true,
      allowedInHeader: true,
      allowedInQuery: false,
      allowedInBody: false,
      createdAt: 1,
      updatedAt: 1,
      secret: 'top-secret',
    })

    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      statusText: 'OK',
      ok: true,
      url: 'https://api.example.com/data',
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () => Promise.resolve('{"ok":true}'),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await executeTool(
      'secure_http_request',
      {
        credential_alias: 'header_alias',
        url: 'https://api.example.com/data',
        method: 'POST',
        headers: { Authorization: 'Bearer {header_alias}' },
        body_json: { test: true },
      },
      context
    )

    expect(result.success).toBe(true)
    expect(fetchMock).toHaveBeenCalled()
    expect(
      (fetchMock.mock.calls[0]?.[1] as { headers?: Record<string, string> }).headers
    ).toMatchObject({
      Authorization: 'Bearer top-secret',
    })
  })

  it('interpolates {alias} in query params, redacts output URL, and truncates long bodies', async () => {
    mockedGetCredentialForAgentByAlias.mockResolvedValue({
      id: 'cred-2',
      alias: 'query_alias',
      provider: 'provider-b',
      allowedHosts: ['api.example.com'],
      enabled: true,
      allowedInHeader: false,
      allowedInQuery: true,
      allowedInBody: false,
      createdAt: 1,
      updatedAt: 1,
      secret: 'token-value',
    })

    const longBody = 'x'.repeat(70_000)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 404,
        statusText: 'Not Found',
        ok: false,
        url: 'https://api.example.com/data?access_token=token-value',
        headers: new Headers({ 'content-type': 'text/plain' }),
        text: () => Promise.resolve(longBody),
      })
    )

    const result = await executeTool(
      'secure_http_request',
      {
        credential_alias: 'query_alias',
        url: 'https://api.example.com/data',
        query: { access_token: '{query_alias}' },
      },
      context
    )

    expect(result.success).toBe(true)
    const output = JSON.parse(result.output ?? '{}') as {
      httpOk?: boolean
      url?: string
      truncated?: boolean
      body?: string
    }
    expect(output.httpOk).toBe(false)
    expect(output.url).toContain('access_token=%5BREDACTED_SECRET%5D')
    expect(output.truncated).toBe(true)
    expect(output.body).toContain('[response body truncated:')
  })

  it('blocks disallowed hosts', async () => {
    mockedGetCredentialForAgentByAlias.mockResolvedValue({
      id: 'cred-3',
      alias: 'host_limited',
      provider: 'provider-c',
      allowedHosts: ['allowed.example.com'],
      enabled: true,
      allowedInHeader: true,
      allowedInQuery: false,
      allowedInBody: false,
      createdAt: 1,
      updatedAt: 1,
      secret: 'secret',
    })

    const result = await executeTool(
      'secure_http_request',
      {
        credential_alias: 'host_limited',
        url: 'https://blocked.example.com/anything',
        headers: { Authorization: 'Bearer {host_limited}' },
      },
      context
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('not allowed')
  })

  it('rejects when no placeholder is found', async () => {
    mockedGetCredentialForAgentByAlias.mockResolvedValue({
      id: 'cred-5',
      alias: 'no_placeholder',
      provider: 'provider-e',
      allowedHosts: ['api.example.com'],
      enabled: true,
      allowedInHeader: true,
      allowedInQuery: false,
      allowedInBody: false,
      createdAt: 1,
      updatedAt: 1,
      secret: 'secret',
    })

    const result = await executeTool(
      'secure_http_request',
      {
        credential_alias: 'no_placeholder',
        url: 'https://api.example.com/data',
      },
      context
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('No {no_placeholder} placeholder found')
  })

  it('rejects credential in disallowed location', async () => {
    mockedGetCredentialForAgentByAlias.mockResolvedValue({
      id: 'cred-6',
      alias: 'header_only',
      provider: 'provider-f',
      allowedHosts: ['api.example.com'],
      enabled: true,
      allowedInHeader: true,
      allowedInQuery: false,
      allowedInBody: false,
      createdAt: 1,
      updatedAt: 1,
      secret: 'secret',
    })

    const result = await executeTool(
      'secure_http_request',
      {
        credential_alias: 'header_only',
        url: 'https://api.example.com/data',
        query: { token: '{header_only}' },
      },
      context
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('not allowed in query')
  })

  it('returns deterministic timeout error', async () => {
    mockedGetCredentialForAgentByAlias.mockResolvedValue({
      id: 'cred-4',
      alias: 'timeout_alias',
      provider: 'provider-d',
      allowedHosts: ['api.example.com'],
      enabled: true,
      allowedInHeader: true,
      allowedInQuery: false,
      allowedInBody: false,
      createdAt: 1,
      updatedAt: 1,
      secret: 'secret',
    })

    const abortError = new Error('Request aborted')
    abortError.name = 'AbortError'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError))

    const result = await executeTool(
      'secure_http_request',
      {
        credential_alias: 'timeout_alias',
        url: 'https://api.example.com/slow',
        headers: { Authorization: 'Bearer {timeout_alias}' },
        timeout_ms: 50,
      },
      context
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('timed out')
  })
})
