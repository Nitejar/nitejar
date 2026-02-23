import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ToolContext } from './tools/types'
import type { PluginInstanceRecord } from '@nitejar/database'
import * as Database from '@nitejar/database'
import * as Integrations from '@nitejar/plugin-handlers'

// Import the telegram provider to trigger registration
import './integrations/telegram'
import { resolveIntegrationProviders, extractIntegrationTools } from './integrations/registry'

vi.mock('@nitejar/database', async () => {
  const actual = await vi.importActual<typeof Database>('@nitejar/database')
  return {
    ...actual,
    findPluginInstanceById: vi.fn(),
    listTelegramSessionsForAgent: vi.fn(),
    listMessagesBySession: vi.fn(),
  }
})

vi.mock('@nitejar/plugin-handlers', async () => {
  const actual = await vi.importActual<typeof Integrations>('@nitejar/plugin-handlers')
  return {
    ...actual,
    sendMessage: vi.fn(),
    telegramHandler: { sensitiveFields: [] },
  }
})

const mockedFindPluginInstanceById = vi.mocked(Database.findPluginInstanceById)
const mockedSendMessage = vi.mocked(Integrations.sendMessage)
const mockedListTelegramSessions = vi.mocked(Database.listTelegramSessionsForAgent)
const mockedListMessagesBySession = vi.mocked(Database.listMessagesBySession)

const basePluginInstance: PluginInstanceRecord = {
  id: 'telegram-1',
  plugin_id: 'builtin.telegram',
  name: 'Telegram',
  type: 'telegram',
  scope: 'global',
  enabled: 1,
  config: JSON.stringify({ botToken: 'test-token', allowedChatIds: [456] }),
  config_json: JSON.stringify({ botToken: 'test-token', allowedChatIds: [456] }),
  created_at: 0,
  updated_at: 0,
}

const context: ToolContext = {
  spriteName: 'sprite-1',
  cwd: '/home/sprite',
  agentId: 'agent-1',
  pluginInstanceId: 'telegram-1',
  responseContext: { chatId: 789, messageThreadId: 42 },
}

// Resolve the telegram plugin-instance handlers
const telegramTools = extractIntegrationTools(resolveIntegrationProviders(['telegram']))

beforeEach(() => {
  mockedFindPluginInstanceById.mockReset()
  mockedSendMessage.mockReset()
  mockedListTelegramSessions.mockReset()
  mockedListMessagesBySession.mockReset()
})

describe('send_telegram_message tool (plugin provider)', () => {
  const handler = telegramTools.handlers['send_telegram_message']!

  it('sends message using responseContext when chat_id is omitted', async () => {
    mockedFindPluginInstanceById.mockResolvedValue(basePluginInstance)

    const result = await handler({ message: 'hello' }, context)

    expect(result.success).toBe(true)
    expect(mockedSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ botToken: 'test-token' }),
      789,
      'hello',
      { messageThreadId: 42 }
    )
  })

  it('uses explicit chat_id and thread_id when provided', async () => {
    mockedFindPluginInstanceById.mockResolvedValue(basePluginInstance)

    const result = await handler({ message: 'hello', chat_id: 123, thread_id: 99 }, context)

    expect(result.success).toBe(true)
    expect(mockedSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ botToken: 'test-token' }),
      123,
      'hello',
      { messageThreadId: 99 }
    )
  })

  it('fails when message is empty', async () => {
    const result = await handler({ message: '' }, context)
    expect(result.success).toBe(false)
    expect(result.error).toContain('message is required')
  })

  it('fails when no plugin instance context', async () => {
    const noIntCtx: ToolContext = { spriteName: 'sprite-1', cwd: '/home/sprite' }
    const result = await handler({ message: 'hello' }, noIntCtx)
    expect(result.success).toBe(false)
    expect(result.error).toContain('No plugin instance context')
  })
})

describe('list_telegram_threads tool', () => {
  const handler = telegramTools.handlers['list_telegram_threads']!

  it('lists sessions for the agent with enriched data', async () => {
    mockedListTelegramSessions.mockResolvedValue([
      {
        sessionKey: 'telegram:123',
        chatId: '123',
        threadId: null,
        chatName: 'Dev Chat',
        lastMessagePreview: 'hello there',
        lastSender: 'Alice',
        lastMessageTime: 1000,
      },
      {
        sessionKey: 'telegram:456:thread:78',
        chatId: '456',
        threadId: '78',
        chatName: 'Team Group',
        lastMessagePreview: 'fix the bug',
        lastSender: 'Bob',
        lastMessageTime: 2000,
      },
    ])

    const result = await handler({}, context)

    expect(result.success).toBe(true)
    expect(result.output).toContain('Dev Chat')
    expect(result.output).toContain('Team Group')
    expect(result.output).toContain('thread 78')
    expect(result.output).toContain('hello there')
    expect(result.output).toContain('[Alice]')
    expect(result.output).toContain('telegram:123')
    expect(result.output).toContain('telegram:456:thread:78')
    expect(mockedListTelegramSessions).toHaveBeenCalledWith('agent-1', { limit: 20 })
  })

  it('returns empty message when no sessions', async () => {
    mockedListTelegramSessions.mockResolvedValue([])

    const result = await handler({}, context)

    expect(result.success).toBe(true)
    expect(result.output).toContain('No Telegram threads found')
  })
})

describe('read_telegram_thread tool', () => {
  const handler = telegramTools.handlers['read_telegram_thread']!

  it('reads messages from a session', async () => {
    mockedListMessagesBySession.mockResolvedValue([
      {
        id: 'msg-1',
        job_id: 'job-1',
        role: 'user',
        content: JSON.stringify({ text: 'hello from user' }),
        embedding: null,
        created_at: 1000,
        workItemTitle: 'test',
        workItemCreatedAt: 1000,
        jobCreatedAt: 1000,
        agentId: 'agent-1',
        agentHandle: 'slopper',
        agentName: 'Slopper',
        jobHasFinalResponse: false,
      },
    ])

    const result = await handler({ session_key: 'telegram:123' }, context)

    expect(result.success).toBe(true)
    expect(result.output).toContain('user: hello from user')
    expect(mockedListMessagesBySession).toHaveBeenCalledWith('telegram:123', {
      agentId: 'agent-1',
      limit: 30,
    })
  })

  it('rejects non-telegram session keys', async () => {
    const result = await handler({ session_key: 'slack:123' }, context)
    expect(result.success).toBe(false)
    expect(result.error).toContain('must start with "telegram:"')
  })

  it('requires session_key', async () => {
    const result = await handler({}, context)
    expect(result.success).toBe(false)
    expect(result.error).toContain('session_key is required')
  })
})
