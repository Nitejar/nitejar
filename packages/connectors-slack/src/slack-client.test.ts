import { afterEach, describe, expect, it, vi } from 'vitest'

const { apiCallMock, webClientCtorMock } = vi.hoisted(() => ({
  apiCallMock: vi.fn(),
  webClientCtorMock: vi.fn(),
}))

vi.mock('@slack/web-api', () => {
  class MockWebClient {
    readonly token: string

    constructor(token: string) {
      this.token = token
      webClientCtorMock(token)
    }

    apiCall(method: string, body?: Record<string, unknown>): Promise<unknown> {
      return apiCallMock(this.token, method, body)
    }
  }

  return {
    WebClient: MockWebClient,
    ErrorCode: {
      RateLimitedError: 'slack_webapi_rate_limited_error',
      PlatformError: 'slack_webapi_platform_error',
    },
  }
})

import { createSlackClient, SlackApiError, SlackRateLimitError } from './slack-client'

afterEach(() => {
  vi.clearAllMocks()
})

describe('slack client (sdk transport)', () => {
  it('lists users with pagination metadata', async () => {
    apiCallMock.mockResolvedValue({
      ok: true,
      members: [{ id: 'U1', name: 'josh' }],
      response_metadata: { next_cursor: 'cursor-users-1' },
    })

    const client = createSlackClient({ botToken: 'xoxb-test' })
    const page = await client.listUsers({ limit: 50, cursor: 'cursor-users-0' })

    expect(page.items[0]?.id).toBe('U1')
    expect(page.nextCursor).toBe('cursor-users-1')
    expect(apiCallMock).toHaveBeenCalledWith('xoxb-test', 'users.list', {
      limit: 50,
      cursor: 'cursor-users-0',
    })
  })

  it('lists channels with pagination metadata', async () => {
    apiCallMock.mockResolvedValue({
      ok: true,
      channels: [{ id: 'C1', name: 'general' }],
      response_metadata: { next_cursor: 'cursor-1' },
    })

    const client = createSlackClient({ botToken: 'xoxb-test' })
    const page = await client.listChannels({ limit: 20, cursor: 'cursor-0' })

    expect(page.items[0]?.id).toBe('C1')
    expect(page.nextCursor).toBe('cursor-1')
    expect(apiCallMock).toHaveBeenCalledWith('xoxb-test', 'conversations.list', {
      limit: 20,
      cursor: 'cursor-0',
      exclude_archived: true,
    })
  })

  it('searches channel history with bounded matches', async () => {
    apiCallMock.mockResolvedValue({
      ok: true,
      messages: [
        { type: 'message', ts: '1.0', text: 'build failed in prod' },
        { type: 'message', ts: '2.0', text: 'all good' },
      ],
    })

    const client = createSlackClient({ botToken: 'xoxb-test' })
    const page = await client.searchInChannel('C1', 'prod', { limit: 5 })

    expect(page.items).toHaveLength(1)
    expect(page.items[0]?.text).toContain('prod')
    expect(page.scannedCount).toBe(2)
  })

  it('requires action token for workspace context search', async () => {
    const client = createSlackClient({ botToken: 'xoxb-test' })
    await expect(client.searchWorkspaceContext('deploy')).rejects.toBeInstanceOf(SlackApiError)
    expect(apiCallMock).not.toHaveBeenCalled()
  })

  it('uses action token for workspace context search requests', async () => {
    apiCallMock.mockImplementation(async (_token: string, method: string) => {
      if (method === 'assistant.search.context') {
        return {
          ok: true,
          matches: [{ channel: 'C1', ts: '1.0', text: 'deploy status', user: 'U1' }],
          total: 1,
        }
      }

      throw new Error(`Unexpected method: ${method}`)
    })

    const client = createSlackClient({ botToken: 'xoxb-test' })
    const result = await client.searchWorkspaceContext('deploy', { actionToken: 'xapp-action' })

    expect(result.matches).toHaveLength(1)
    expect(apiCallMock).toHaveBeenCalledWith('xapp-action', 'assistant.search.context', {
      query: 'deploy',
    })
  })

  it('maps sdk rate limits into SlackRateLimitError', async () => {
    apiCallMock.mockRejectedValue({
      code: 'slack_webapi_rate_limited_error',
      retryAfter: 7,
    })

    const client = createSlackClient({ botToken: 'xoxb-test' })
    await expect(client.listChannels()).rejects.toBeInstanceOf(SlackRateLimitError)
  })

  it('exports trigger response payload', async () => {
    apiCallMock.mockResolvedValue({
      ok: true,
      response: {
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'Hello' } }],
      },
    })

    const client = createSlackClient({ botToken: 'xoxb-test' })
    const exported = await client.exportResponse('Ft123')

    expect(exported.triggerId).toBe('Ft123')
    expect(exported.payload).toHaveProperty('response')
    expect(apiCallMock).toHaveBeenCalledWith('xoxb-test', 'responses.export', {
      trigger_id: 'Ft123',
    })
  })
})
