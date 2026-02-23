import { describe, expect, it, vi } from 'vitest'
import type { PluginInstanceRecord } from '@nitejar/database'
import { parseTelegramWebhook, sendTypingIndicator } from './webhook'
import type { TelegramResponseContext } from './types'

const { sendChatActionMock } = vi.hoisted(() => ({
  sendChatActionMock: vi.fn(),
}))

vi.mock('./client', () => ({
  sendChatAction: sendChatActionMock,
}))

function makePluginInstance(): PluginInstanceRecord {
  return {
    id: 'int-telegram-test',
    type: 'telegram',
    name: 'Telegram Test',
    config: null,
    scope: 'global',
    enabled: 1,
    created_at: Math.floor(Date.now() / 1000),
    updated_at: Math.floor(Date.now() / 1000),
  } as PluginInstanceRecord
}

function makeRequest(payload: unknown): Request {
  return new Request('http://localhost/webhooks/telegram', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

interface ParsedPayload {
  attachments?: Array<{ type?: string; fileId?: string }>
  senderName?: string
  actor?: {
    kind?: string
    externalId?: string
    handle?: string
    displayName?: string
    source?: string
  }
}

describe('parseTelegramWebhook', () => {
  it('ignores bot-authored messages', async () => {
    const update = {
      update_id: 5001,
      message: {
        message_id: 12,
        date: 1700000000,
        text: 'bot echo',
        chat: { id: 999, type: 'group' },
        from: { id: 7, is_bot: true, first_name: 'Nitejar' },
      },
    }
    const result = await parseTelegramWebhook(makeRequest(update), makePluginInstance())
    expect(result.shouldProcess).toBe(false)
  })

  it('processes human-authored messages', async () => {
    const update = {
      update_id: 5002,
      message: {
        message_id: 13,
        date: 1700000001,
        text: 'hello from user',
        chat: { id: 999, type: 'group' },
        from: { id: 42, is_bot: false, first_name: 'Josh' },
      },
    }
    const result = await parseTelegramWebhook(makeRequest(update), makePluginInstance())
    expect(result.shouldProcess).toBe(true)
    expect(result.workItem?.source).toBe('telegram')
  })

  it('rejects request when webhook secret mismatches', async () => {
    const pluginInstance = makePluginInstance()
    pluginInstance.config = JSON.stringify({ webhookSecret: 'expected-secret' })
    const request = new Request('http://localhost/webhooks/telegram', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-telegram-bot-api-secret-token': 'wrong-secret',
      },
      body: JSON.stringify({ update_id: 77 }),
    })

    const result = await parseTelegramWebhook(request, pluginInstance)
    expect(result.shouldProcess).toBe(false)
  })

  it('filters disallowed chat ids', async () => {
    const pluginInstance = makePluginInstance()
    pluginInstance.config = JSON.stringify({ allowedChatIds: [111] })
    const update = {
      update_id: 5003,
      message: {
        message_id: 22,
        date: 1700000002,
        text: 'hello',
        chat: { id: 999, type: 'group' },
        from: { id: 42, is_bot: false, first_name: 'Josh' },
      },
    }

    const result = await parseTelegramWebhook(makeRequest(update), pluginInstance)
    expect(result.shouldProcess).toBe(false)
  })

  it('supports attachment-only messages and thread metadata', async () => {
    const pluginInstance = makePluginInstance()
    pluginInstance.config = JSON.stringify({ useMessageThreads: true })
    const update = {
      update_id: 5004,
      message: {
        message_id: 33,
        message_thread_id: 444,
        date: 1700000003,
        caption: 'screenshot',
        chat: { id: 999, type: 'supergroup', title: 'Eng Thread' },
        from: { id: 9, is_bot: false, first_name: 'Ari', last_name: 'Smith', username: 'ari' },
        photo: [
          {
            file_id: 'small',
            file_unique_id: 'u-small',
            width: 100,
            height: 100,
            file_size: 1_000,
          },
          {
            file_id: 'large',
            file_unique_id: 'u-large',
            width: 400,
            height: 400,
            file_size: 2_000,
          },
        ],
      },
    }

    const result = await parseTelegramWebhook(makeRequest(update), pluginInstance)
    expect(result.shouldProcess).toBe(true)
    expect(result.workItem?.session_key).toBe('telegram:999:thread:444')
    const responseContext = result.responseContext as TelegramResponseContext | undefined
    expect(responseContext?.messageThreadId).toBe(444)
    const payloadText = result.workItem?.payload
    expect(payloadText).toBeDefined()
    const payload = JSON.parse(payloadText as string) as ParsedPayload
    expect(payload.attachments?.[0]?.type).toBe('photo')
    expect(payload.attachments?.[0]?.fileId).toBe('large')
    expect(payload.senderName).toBe('Ari Smith')
    expect(payload.actor).toEqual({
      kind: 'human',
      externalId: '9',
      handle: 'ari',
      displayName: 'Ari Smith',
      source: 'telegram',
    })
  })

  it('omits thread routing when disabled and detects command', async () => {
    const pluginInstance = makePluginInstance()
    pluginInstance.config = JSON.stringify({ useMessageThreads: false })
    const update = {
      update_id: 5005,
      message: {
        message_id: 44,
        message_thread_id: 888,
        date: 1700000004,
        text: '/reset please',
        chat: { id: 777, type: 'supergroup', username: 'ops-room' },
        from: { id: 101, is_bot: false, first_name: 'Jo' },
      },
    }

    const result = await parseTelegramWebhook(makeRequest(update), pluginInstance)
    expect(result.shouldProcess).toBe(true)
    expect(result.command).toBe('reset')
    const responseContext = result.responseContext as TelegramResponseContext | undefined
    expect(responseContext?.messageThreadId).toBeUndefined()
    expect(result.workItem?.session_key).toBe('telegram:777')
    expect(result.workItem?.source_ref).toBe('telegram:777:44')
  })

  it('drops updates with no message or no usable content', async () => {
    const noMessage = await parseTelegramWebhook(
      makeRequest({ update_id: 9 }),
      makePluginInstance()
    )
    expect(noMessage.shouldProcess).toBe(false)

    const noContent = await parseTelegramWebhook(
      makeRequest({
        update_id: 10,
        message: {
          message_id: 99,
          date: 1700000010,
          chat: { id: 1, type: 'group' },
          from: { id: 2, is_bot: false, first_name: 'Nope' },
        },
      }),
      makePluginInstance()
    )
    expect(noContent.shouldProcess).toBe(false)
  })
})

describe('sendTypingIndicator', () => {
  it('forwards messageThreadId to sendChatAction', async () => {
    sendChatActionMock.mockResolvedValue(undefined)
    await sendTypingIndicator({ botToken: 'token' }, 123, 777)
    expect(sendChatActionMock).toHaveBeenCalledWith({ botToken: 'token' }, 123, 'typing', {
      messageThreadId: 777,
    })
  })

  it('swallows send errors', async () => {
    sendChatActionMock.mockRejectedValueOnce(new Error('telegram down'))
    await expect(sendTypingIndicator({ botToken: 'token' }, 123)).resolves.toBeUndefined()
  })
})
