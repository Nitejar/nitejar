import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ToolContext } from './tools/types'
import type { PluginInstanceRecord } from '@nitejar/database'
import * as Database from '@nitejar/database'
import type * as Handlers from '@nitejar/plugin-handlers'
import { SlackApiError } from '@nitejar/plugin-handlers'

import './integrations/slack'
import { extractIntegrationTools, resolveIntegrationProviders } from './integrations/registry'

const {
  postMessageMock,
  getThreadMock,
  getHistoryMock,
  getChannelInfoMock,
  listChannelsMock,
  searchInChannelMock,
  searchWorkspaceContextMock,
  exportResponseMock,
  createSlackClientMock,
} = vi.hoisted(() => ({
  postMessageMock: vi.fn(),
  getThreadMock: vi.fn(),
  getHistoryMock: vi.fn(),
  getChannelInfoMock: vi.fn(),
  listChannelsMock: vi.fn(),
  searchInChannelMock: vi.fn(),
  searchWorkspaceContextMock: vi.fn(),
  exportResponseMock: vi.fn(),
  createSlackClientMock: vi.fn(),
}))

vi.mock('@nitejar/database', async () => {
  const actual = await vi.importActual<typeof Database>('@nitejar/database')
  return {
    ...actual,
    findPluginInstanceById: vi.fn(),
    getAgentPluginInstanceAssignment: vi.fn(),
  }
})

vi.mock('@nitejar/plugin-handlers', async () => {
  const actual = await vi.importActual<typeof Handlers>('@nitejar/plugin-handlers')
  return {
    ...actual,
    createSlackClient: createSlackClientMock,
    slackHandler: { sensitiveFields: [] },
  }
})

const mockedFindPluginInstanceById = vi.mocked(Database.findPluginInstanceById)
const mockedGetAgentPluginInstanceAssignment = vi.mocked(Database.getAgentPluginInstanceAssignment)

const basePluginInstance: PluginInstanceRecord = {
  id: 'slack-1',
  plugin_id: 'builtin.slack',
  name: 'Slack',
  type: 'slack',
  scope: 'global',
  enabled: 1,
  config: JSON.stringify({ botToken: 'xoxb-test', signingSecret: 'secret' }),
  config_json: JSON.stringify({ botToken: 'xoxb-test', signingSecret: 'secret' }),
  created_at: 0,
  updated_at: 0,
}

const context: ToolContext = {
  spriteName: 'sprite-1',
  cwd: '/home/sprite',
  agentId: 'agent-1',
  pluginInstanceId: 'slack-1',
  responseContext: {
    channel: 'C111',
    threadTs: '1710000000.000100',
    messageTs: '1710000000.000100',
  },
}

const slackTools = extractIntegrationTools(resolveIntegrationProviders(['slack']))

beforeEach(() => {
  mockedFindPluginInstanceById.mockReset()
  postMessageMock.mockReset()
  getThreadMock.mockReset()
  getHistoryMock.mockReset()
  getChannelInfoMock.mockReset()
  listChannelsMock.mockReset()
  searchInChannelMock.mockReset()
  searchWorkspaceContextMock.mockReset()
  createSlackClientMock.mockReset()

  createSlackClientMock.mockReturnValue({
    postMessage: postMessageMock,
    getThread: getThreadMock,
    getHistory: getHistoryMock,
    getChannelInfo: getChannelInfoMock,
    listChannels: listChannelsMock,
    searchInChannel: searchInChannelMock,
    searchWorkspaceContext: searchWorkspaceContextMock,
    exportResponse: exportResponseMock,
  })

  mockedGetAgentPluginInstanceAssignment.mockResolvedValue(null)
})

describe('slack_get_channel_info tool', () => {
  const handler = slackTools.handlers['slack_get_channel_info']!

  it('returns channel metadata using context channel', async () => {
    mockedFindPluginInstanceById.mockResolvedValue(basePluginInstance)
    getChannelInfoMock.mockResolvedValue({
      id: 'C111',
      name: 'general',
      is_channel: true,
      is_member: true,
      topic: { value: 'General chat' },
      num_members: 42,
    })

    const result = await handler({}, context)

    expect(result.success).toBe(true)
    expect(result.output).toContain('name: general')
    expect(result.output).toContain('topic: General chat')
    expect(result.output).toContain('members: 42')
    expect(getChannelInfoMock).toHaveBeenCalledWith('C111')
  })

  it('fails when channel info is unavailable', async () => {
    mockedFindPluginInstanceById.mockResolvedValue(basePluginInstance)
    getChannelInfoMock.mockResolvedValue(null)

    const result = await handler({}, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Could not retrieve info')
  })
})

describe('slack_get_thread tool', () => {
  const handler = slackTools.handlers['slack_get_thread']!

  it('returns formatted thread messages', async () => {
    mockedFindPluginInstanceById.mockResolvedValue(basePluginInstance)
    getThreadMock.mockResolvedValue({
      items: [
        { ts: '1710000000.000100', user: 'U1', text: 'first' },
        { ts: '1710000001.000100', user: 'U2', text: 'second' },
      ],
      hasMore: false,
    })

    const result = await handler({}, context)

    expect(result.success).toBe(true)
    expect(result.output).toContain('meta=')
    expect(result.output).toContain('U1: first')
    expect(result.output).toContain('U2: second')
  })
})

describe('slack_get_channel_history tool', () => {
  const handler = slackTools.handlers['slack_get_channel_history']!

  it('returns formatted channel history', async () => {
    mockedFindPluginInstanceById.mockResolvedValue(basePluginInstance)
    getHistoryMock.mockResolvedValue({
      items: [{ ts: '1710000000.000100', user: 'U1', text: 'status' }],
      hasMore: false,
    })

    const result = await handler({ channel: 'C999', limit: 5 }, context)

    expect(result.success).toBe(true)
    expect(getHistoryMock).toHaveBeenCalledWith('C999', { limit: 5 })
    expect(result.output).toContain('U1: status')
  })

  it('enforces assignment action gate before invoking Slack API', async () => {
    mockedFindPluginInstanceById.mockResolvedValue(basePluginInstance)
    mockedGetAgentPluginInstanceAssignment.mockResolvedValue({
      agent_id: 'agent-1',
      plugin_instance_id: 'slack-1',
      created_at: 0,
      policy_json: JSON.stringify({
        mode: 'allow_list',
        allowedActions: ['read_thread'],
      }),
    })

    const result = await handler({ channel: 'C999', limit: 5 }, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain('disabled by this agent-plugin assignment policy')
    expect(getHistoryMock).not.toHaveBeenCalled()
  })
})

describe('slack_list_channels tool', () => {
  const handler = slackTools.handlers['slack_list_channels']!

  it('returns channel list with metadata', async () => {
    mockedFindPluginInstanceById.mockResolvedValue(basePluginInstance)
    listChannelsMock.mockResolvedValue({
      items: [{ id: 'C111', name: 'general', is_member: true }],
      hasMore: false,
    })

    const result = await handler({}, context)

    expect(result.success).toBe(true)
    expect(result.output).toContain('C111')
    expect(result.output).toContain('general')
    expect(result.output).toContain('meta=')
  })
})

describe('slack_search_channel_messages tool', () => {
  const handler = slackTools.handlers['slack_search_channel_messages']!

  it('returns bounded search results', async () => {
    mockedFindPluginInstanceById.mockResolvedValue(basePluginInstance)
    searchInChannelMock.mockResolvedValue({
      items: [{ ts: '1710000000.000100', user: 'U1', text: 'deploy started' }],
      hasMore: true,
      matchedCount: 2,
      scannedCount: 50,
      nextCursor: 'cursor-1',
    })

    const result = await handler({ query: 'deploy' }, context)

    expect(result.success).toBe(true)
    expect(result.output).toContain('deploy started')
    expect(result.output).toContain('matched_count')
  })
})

describe('slack_search_workspace_context tool', () => {
  const handler = slackTools.handlers['slack_search_workspace_context']!

  it('falls back cleanly without action token', async () => {
    mockedFindPluginInstanceById.mockResolvedValue(basePluginInstance)

    const result = await handler({ query: 'deploy' }, context)

    expect(result.success).toBe(true)
    expect(result.output).toContain('no action token')
  })

  it('returns workspace search results with action token', async () => {
    mockedFindPluginInstanceById.mockResolvedValue(basePluginInstance)
    searchWorkspaceContextMock.mockResolvedValue({
      query: 'deploy',
      matches: [{ channel: 'C111', ts: '1710000000.000100', text: 'deploy status', user: 'U1' }],
    })

    const result = await handler(
      { query: 'deploy' },
      {
        ...context,
        responseContext: {
          ...(context.responseContext as Record<string, unknown>),
          actionToken: 'xapp-action',
        },
      }
    )

    expect(result.success).toBe(true)
    expect(result.output).toContain('workspace_context_search')
  })
})

describe('slack_export_response tool', () => {
  const handler = slackTools.handlers['slack_export_response']!

  it('returns structured trigger export payload', async () => {
    mockedFindPluginInstanceById.mockResolvedValue(basePluginInstance)
    exportResponseMock.mockResolvedValue({
      triggerId: 'Ft123',
      payload: { response: { blocks: [{ type: 'section' }] } },
    })

    const result = await handler({ trigger_id: 'Ft123' }, context)

    expect(result.success).toBe(true)
    expect(result.output).toContain('response_export')
    expect(result.output).toContain('Ft123')
  })

  it('classifies unsupported token types as capability constraints', async () => {
    mockedFindPluginInstanceById.mockResolvedValue(basePluginInstance)
    exportResponseMock.mockRejectedValue(
      new SlackApiError({
        method: 'responses.export',
        status: 403,
        message: 'token type unsupported',
        code: 'not_allowed_token_type',
      })
    )

    const result = await handler({ trigger_id: 'Ft123' }, context)

    expect(result.success).toBe(true)
    expect(result.output).toContain('capability constraint')
    expect(result.output).toContain('not_allowed_token_type')
  })
})
