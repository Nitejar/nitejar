import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginInstanceRecord } from '@nitejar/database'
import type * as SlackConnectors from '@nitejar/connectors-slack'
import { slackHandler } from './index'
import { SlackRateLimitError } from '@nitejar/connectors-slack'

const {
  createSlackClientMock,
  markdownToSlackMrkdwnMock,
  postMessageMock,
  removeReactionMock,
  addReactionMock,
  listChannelsMock,
  listUsersMock,
  getUserInfoMock,
  authTestMock,
} = vi.hoisted(() => ({
  createSlackClientMock: vi.fn(),
  markdownToSlackMrkdwnMock: vi.fn((value: string) => value),
  postMessageMock: vi.fn(),
  removeReactionMock: vi.fn(),
  addReactionMock: vi.fn(),
  listChannelsMock: vi.fn(),
  listUsersMock: vi.fn(),
  getUserInfoMock: vi.fn(),
  authTestMock: vi.fn(),
}))

vi.mock('@nitejar/connectors-slack', async () => {
  const actual = await vi.importActual<typeof SlackConnectors>('@nitejar/connectors-slack')

  return {
    ...actual,
    createSlackClient: createSlackClientMock,
    markdownToSlackMrkdwn: markdownToSlackMrkdwnMock,
  }
})

function makePluginInstance(config: Record<string, unknown>): PluginInstanceRecord {
  const now = Math.floor(Date.now() / 1000)
  const configJson = JSON.stringify(config)

  return {
    id: 'slack-instance-index',
    plugin_id: 'builtin.slack',
    type: 'slack',
    name: 'Slack',
    config: configJson,
    config_json: configJson,
    scope: 'global',
    enabled: 1,
    created_at: now,
    updated_at: now,
  } satisfies PluginInstanceRecord
}

beforeEach(() => {
  createSlackClientMock.mockReset()
  markdownToSlackMrkdwnMock.mockReset()
  postMessageMock.mockReset()
  removeReactionMock.mockReset()
  addReactionMock.mockReset()
  listChannelsMock.mockReset()
  listUsersMock.mockReset()
  getUserInfoMock.mockReset()
  authTestMock.mockReset()

  markdownToSlackMrkdwnMock.mockImplementation((value: string) => value)
  listChannelsMock.mockResolvedValue({ items: [], hasMore: false, nextCursor: undefined })
  listUsersMock.mockResolvedValue({ items: [], hasMore: false, nextCursor: undefined })
  getUserInfoMock.mockResolvedValue(null)

  createSlackClientMock.mockReturnValue({
    postMessage: postMessageMock,
    removeReaction: removeReactionMock,
    addReaction: addReactionMock,
    listChannels: listChannelsMock,
    listUsers: listUsersMock,
    getUserInfo: getUserInfoMock,
    authTest: authTestMock,
  })
})

describe('slackHandler.postResponse', () => {
  it('returns error when bot token is missing', async () => {
    const result = await slackHandler.postResponse(
      makePluginInstance({ signingSecret: 'secret' }),
      'work-1',
      'hello',
      { channel: 'C1', threadTs: '1.0', messageTs: '1.0' }
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('bot token')
  })

  it('returns error when response context is missing', async () => {
    const result = await slackHandler.postResponse(
      makePluginInstance({ botToken: 'xoxb-1', signingSecret: 'secret' }),
      'work-2',
      'hello',
      undefined
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('response context')
  })

  it('posts a new message on first response', async () => {
    postMessageMock.mockResolvedValue('1700000000.000100')
    removeReactionMock.mockResolvedValue(undefined)

    const result = await slackHandler.postResponse(
      makePluginInstance({ botToken: 'xoxb-1', signingSecret: 'secret' }),
      'work-3',
      'hello world',
      { channel: 'C1', threadTs: '1700000000.000001', messageTs: '1700000000.000001' }
    )

    expect(result.success).toBe(true)
    expect(result.providerRef).toBe('C1:1700000000.000100')
    expect(postMessageMock).toHaveBeenCalledWith('C1', 'hello world', {
      threadTs: '1700000000.000001',
      mrkdwn: true,
    })
  })

  it('normalizes plain mentions and channel references to Slack mrkdwn tokens', async () => {
    postMessageMock.mockResolvedValue('1700000000.000100')
    removeReactionMock.mockResolvedValue(undefined)
    listChannelsMock.mockResolvedValue({
      items: [{ id: 'C1', name: 'general' }],
      hasMore: false,
      nextCursor: undefined,
    })
    listUsersMock.mockResolvedValue({
      items: [{ id: 'U_BOT', name: 'nitejardev' }],
      hasMore: false,
      nextCursor: undefined,
    })
    getUserInfoMock.mockResolvedValue({ id: 'U_BOT', name: 'nitejardev' })

    await slackHandler.postResponse(
      makePluginInstance({
        botToken: 'xoxb-1',
        signingSecret: 'secret',
        botUserId: 'U_BOT',
      }),
      'work-mentions',
      'Ping @nitejardev in #general and @here',
      { channel: 'C1', threadTs: '1700000000.000001', messageTs: '1700000000.000001' }
    )

    expect(postMessageMock).toHaveBeenCalledWith(
      'C1',
      'Ping <@U_BOT> in <#C1|general> and <!here>',
      {
        threadTs: '1700000000.000001',
        mrkdwn: true,
      }
    )
  })

  it('does not rewrite mentions inside inline/code blocks', async () => {
    postMessageMock.mockResolvedValue('1700000000.000100')
    removeReactionMock.mockResolvedValue(undefined)
    listChannelsMock.mockResolvedValue({
      items: [{ id: 'C1', name: 'general' }],
      hasMore: false,
      nextCursor: undefined,
    })
    listUsersMock.mockResolvedValue({
      items: [{ id: 'U_BOT', name: 'nitejardev' }],
      hasMore: false,
      nextCursor: undefined,
    })
    getUserInfoMock.mockResolvedValue({ id: 'U_BOT', name: 'nitejardev' })

    const content = `Code \`@nitejardev #general\` and \`\`\`txt
@nitejardev #general
\`\`\` outside @nitejardev #general`

    await slackHandler.postResponse(
      makePluginInstance({
        botToken: 'xoxb-1',
        signingSecret: 'secret',
        botUserId: 'U_BOT',
      }),
      'work-code-mentions',
      content,
      { channel: 'C1', threadTs: '1700000000.000001', messageTs: '1700000000.000001' }
    )

    expect(postMessageMock).toHaveBeenCalledWith(
      'C1',
      `Code \`@nitejardev #general\` and \`\`\`txt
@nitejardev #general\`\`\` outside <@U_BOT> <#C1|general>`,
      {
        threadTs: '1700000000.000001',
        mrkdwn: true,
      }
    )
  })

  it('keeps unknown @handles as plain text when no Slack user mapping exists', async () => {
    postMessageMock.mockResolvedValue('1700000000.000100')
    removeReactionMock.mockResolvedValue(undefined)

    await slackHandler.postResponse(
      makePluginInstance({
        botToken: 'xoxb-1',
        signingSecret: 'secret',
        botUserId: 'U_BOT',
      }),
      'work-unknown-handle',
      'Unknown mention @pixel should stay plain',
      { channel: 'C1', threadTs: '1700000000.000001', messageTs: '1700000000.000001' }
    )

    expect(postMessageMock).toHaveBeenCalledWith('C1', 'Unknown mention @pixel should stay plain', {
      threadTs: '1700000000.000001',
      mrkdwn: true,
    })
  })

  it('marks rate-limit errors as retryable', async () => {
    postMessageMock.mockRejectedValue(new SlackRateLimitError('chat.postMessage', 5))

    const result = await slackHandler.postResponse(
      makePluginInstance({ botToken: 'xoxb-1', signingSecret: 'secret' }),
      'work-5',
      'hello',
      { channel: 'C1', threadTs: '1.0', messageTs: '1.0' }
    )

    expect(result.success).toBe(false)
    expect(result.retryable).toBe(true)
  })

  it('returns failed outcome on generic errors', async () => {
    postMessageMock.mockRejectedValue(new Error('slack down'))

    const result = await slackHandler.postResponse(
      makePluginInstance({ botToken: 'xoxb-1', signingSecret: 'secret' }),
      'work-6',
      'hello',
      { channel: 'C1', threadTs: '1.0', messageTs: '1.0' }
    )

    expect(result.success).toBe(false)
    expect(result.outcome).toBe('failed')
    expect(result.error).toContain('slack down')
  })
})

describe('slackHandler.testConnection', () => {
  it('returns error when required config is missing', async () => {
    const result = await slackHandler.testConnection?.({ botToken: 'xoxb-1' } as never)
    expect(result?.ok).toBe(false)
  })

  it('returns bot user id on success', async () => {
    authTestMock.mockResolvedValue({ user_id: 'U_BOT' })

    const result = await slackHandler.testConnection?.({
      botToken: 'xoxb-1',
      signingSecret: 'secret',
    })

    expect(result?.ok).toBe(true)
    expect(result).toEqual({ ok: true, configUpdates: { botUserId: 'U_BOT' } })
  })

  it('returns error when auth test fails', async () => {
    authTestMock.mockRejectedValue(new Error('bad token'))

    const result = await slackHandler.testConnection?.({
      botToken: 'xoxb-1',
      signingSecret: 'secret',
    })

    expect(result?.ok).toBe(false)
    expect(result?.error).toContain('bad token')
  })
})

describe('slackHandler.acknowledgeReceipt', () => {
  it('adds eyes reaction when context is valid', async () => {
    addReactionMock.mockResolvedValue(undefined)

    await slackHandler.acknowledgeReceipt?.(
      makePluginInstance({ botToken: 'xoxb-1', signingSecret: 'secret' }),
      { channel: 'C123', messageTs: '1700.1', threadTs: '1700.1' }
    )

    expect(addReactionMock).toHaveBeenCalledWith('C123', '1700.1', 'eyes')
  })
})
