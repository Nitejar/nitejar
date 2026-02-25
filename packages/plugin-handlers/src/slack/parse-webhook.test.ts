import { createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as SlackConnectors from '@nitejar/connectors-slack'
import type { PluginInstanceRecord } from '@nitejar/database'
import { parseSlackWebhook } from './parse-webhook'

const { createSlackClientMock, getUserInfoMock, getChannelInfoMock } = vi.hoisted(() => ({
  createSlackClientMock: vi.fn(),
  getUserInfoMock: vi.fn(),
  getChannelInfoMock: vi.fn(),
}))

vi.mock('@nitejar/connectors-slack', async () => {
  const actual = await vi.importActual<typeof SlackConnectors>('@nitejar/connectors-slack')
  return {
    ...actual,
    createSlackClient: createSlackClientMock,
  }
})

function makePluginInstance(config: Record<string, unknown>): PluginInstanceRecord {
  const now = Math.floor(Date.now() / 1000)
  return {
    id: 'slack-instance-1',
    plugin_id: 'builtin.slack',
    type: 'slack',
    name: 'Slack',
    config: JSON.stringify(config),
    config_json: JSON.stringify(config),
    scope: 'global',
    enabled: 1,
    created_at: now,
    updated_at: now,
  } satisfies PluginInstanceRecord
}

function sign(secret: string, timestamp: string, body: string): string {
  const base = `v0:${timestamp}:${body}`
  return `v0=${createHmac('sha256', secret).update(base).digest('hex')}`
}

function makeSignedRequest(secret: string, payload: unknown): Request {
  const raw = JSON.stringify(payload)
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = sign(secret, timestamp, raw)

  return new Request('http://localhost/webhooks/slack', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-slack-request-timestamp': timestamp,
      'x-slack-signature': signature,
    },
    body: raw,
  })
}

function extractPayloadBody(result: Awaited<ReturnType<typeof parseSlackWebhook>>): string | null {
  const payload = extractPayload(result)
  if (!payload) return null
  return typeof payload.body === 'string' ? payload.body : null
}

function extractPayload(
  result: Awaited<ReturnType<typeof parseSlackWebhook>>
): Record<string, unknown> | null {
  const rawPayload = result.workItem?.payload
  if (typeof rawPayload !== 'string') return null
  return JSON.parse(rawPayload) as Record<string, unknown>
}

beforeEach(() => {
  createSlackClientMock.mockReset()
  getUserInfoMock.mockReset()
  getChannelInfoMock.mockReset()

  getUserInfoMock.mockImplementation((userId: string) => {
    if (userId === 'U999') {
      return Promise.resolve({
        id: 'U999',
        name: 'slopbot',
        profile: { display_name: 'Slopbot' },
      })
    }
    return Promise.resolve({
      id: 'U123',
      name: 'alice',
      profile: { display_name: 'Alice' },
    })
  })
  getChannelInfoMock.mockResolvedValue({
    id: 'C111',
    name: 'general',
  })
  createSlackClientMock.mockReturnValue({
    getUserInfo: getUserInfoMock,
    getChannelInfo: getChannelInfoMock,
  })
})

describe('parseSlackWebhook', () => {
  it('ignores webhook when config is invalid', async () => {
    const request = makeSignedRequest('secret', {
      type: 'url_verification',
      challenge: 'abc',
    })
    const invalid = makePluginInstance({ botToken: 'xoxb-1' })
    invalid.config = '{bad-json'

    const result = await parseSlackWebhook(request, invalid)
    expect(result.shouldProcess).toBe(false)
  })

  it('ignores webhook when body is not JSON', async () => {
    const body = 'not-json'
    const timestamp = String(Math.floor(Date.now() / 1000))
    const signature = sign('secret', timestamp, body)
    const request = new Request('http://localhost/webhooks/slack', {
      method: 'POST',
      headers: {
        'x-slack-request-timestamp': timestamp,
        'x-slack-signature': signature,
      },
      body,
    })

    const result = await parseSlackWebhook(
      request,
      makePluginInstance({ botToken: 'xoxb-1', signingSecret: 'secret' })
    )

    expect(result.shouldProcess).toBe(false)
  })

  it('rejects invalid signatures', async () => {
    const request = new Request('http://localhost/webhooks/slack', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-slack-request-timestamp': String(Math.floor(Date.now() / 1000)),
        'x-slack-signature': 'v0=bad',
      },
      body: JSON.stringify({
        type: 'event_callback',
        event_id: 'EvInvalidSig',
        event: {
          type: 'app_mention',
          user: 'U123',
          text: '<@U999> hello',
          ts: `${Math.floor(Date.now() / 1000)}.000001`,
          channel: 'C111',
        },
      }),
    })

    const result = await parseSlackWebhook(
      request,
      makePluginInstance({ botToken: 'xoxb-1', signingSecret: 'secret' })
    )

    expect(result.shouldProcess).toBe(false)
    expect(result.webhookResponse).toBeUndefined()
  })

  it('returns challenge response for url verification', async () => {
    const payload = { type: 'url_verification', challenge: 'challenge-token' }
    const result = await parseSlackWebhook(
      makeSignedRequest('secret', payload),
      makePluginInstance({ botToken: 'xoxb-1', signingSecret: 'secret' })
    )

    expect(result.shouldProcess).toBe(false)
    expect(result.webhookResponse).toEqual({ status: 200, body: { challenge: 'challenge-token' } })
  })

  it('returns challenge response for url verification without signature headers', async () => {
    const request = new Request('http://localhost/webhooks/slack', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ type: 'url_verification', challenge: 'challenge-token' }),
    })

    const result = await parseSlackWebhook(
      request,
      makePluginInstance({ botToken: 'xoxb-1', signingSecret: 'secret' })
    )

    expect(result.shouldProcess).toBe(false)
    expect(result.webhookResponse).toEqual({ status: 200, body: { challenge: 'challenge-token' } })
  })

  it('creates a work item for app mentions', async () => {
    const eventTs = `${Math.floor(Date.now() / 1000)}.000100`
    const payload = {
      type: 'event_callback',
      event_id: 'Ev123',
      event: {
        type: 'app_mention',
        user: 'U123',
        text: '<@U999> hi there',
        ts: eventTs,
        channel: 'C111',
        thread_ts: eventTs,
      },
    }

    const result = await parseSlackWebhook(
      makeSignedRequest('secret', payload),
      makePluginInstance({
        botToken: 'xoxb-1',
        signingSecret: 'secret',
        botUserId: 'U999',
        inboundPolicy: 'mentions',
      })
    )

    expect(result.shouldProcess).toBe(true)
    const expectedCanonicalKey = `slack:v1:msg:unknown:C111:${eventTs}`
    expect(result.idempotencyKey).toBe(expectedCanonicalKey)
    expect(result.idempotencyKeys).toEqual([expectedCanonicalKey, 'slack:event:Ev123'])
    expect(result.workItem?.source).toBe('slack')
    expect(result.workItem?.session_key).toBe(`slack:C111:${eventTs}`)
    const context = result.responseContext as { teamId?: string; eventType?: string }
    expect(context.teamId).toBeUndefined()
    expect(context.eventType).toBe('app_mention')
    expect((result.responseContext as { slackBotMentioned?: boolean })?.slackBotMentioned).toBe(
      true
    )
    expect(extractPayloadBody(result)).toBe('@Slopbot hi there')
    const payloadBody = extractPayload(result)
    expect(payloadBody?.slackBotMentioned).toBe(true)
    expect(payloadBody?.slackBotDisplayName).toBe('Slopbot')
    expect(payloadBody?.slackBotHandle).toBe('slopbot')
    expect(payloadBody?.slackBotUserId).toBe('U999')
  })

  it('includes channelKey in payload JSON', async () => {
    const eventTs = `${Math.floor(Date.now() / 1000)}.000100`
    const payload = {
      type: 'event_callback',
      event_id: 'EvCK1',
      event: {
        type: 'app_mention',
        user: 'U123',
        text: '<@U999> check this',
        ts: eventTs,
        channel: 'C222',
        thread_ts: eventTs,
      },
    }

    const result = await parseSlackWebhook(
      makeSignedRequest('secret', payload),
      makePluginInstance({
        botToken: 'xoxb-1',
        signingSecret: 'secret',
        botUserId: 'U999',
        inboundPolicy: 'mentions',
      })
    )

    expect(result.shouldProcess).toBe(true)
    const parsedPayload = extractPayload(result)
    expect(parsedPayload?.channelKey).toBe('slack:C222')
  })

  it('keeps mention-prefixed body text while still parsing slash commands', async () => {
    const eventTs = `${Math.floor(Date.now() / 1000)}.000105`
    const payload = {
      type: 'event_callback',
      event_id: 'EvCommand',
      event: {
        type: 'app_mention',
        user: 'U123',
        text: '<@U999> /clear please',
        ts: eventTs,
        channel: 'C111',
      },
    }

    const result = await parseSlackWebhook(
      makeSignedRequest('secret', payload),
      makePluginInstance({
        botToken: 'xoxb-1',
        signingSecret: 'secret',
        botUserId: 'U999',
        inboundPolicy: 'mentions',
      })
    )

    expect(result.shouldProcess).toBe(true)
    expect(extractPayloadBody(result)).toBe('@Slopbot /clear please')
    expect(result.command).toBe('clear')
  })

  it('accepts direct messages when policy is mentions', async () => {
    const eventTs = `${Math.floor(Date.now() / 1000)}.000111`
    const payload = {
      type: 'event_callback',
      event_id: 'EvDm',
      event: {
        type: 'message',
        user: 'U123',
        text: 'dm hello',
        ts: eventTs,
        channel: 'D111',
        channel_type: 'im',
      },
    }

    const result = await parseSlackWebhook(
      makeSignedRequest('secret', payload),
      makePluginInstance({
        botToken: 'xoxb-1',
        signingSecret: 'secret',
        inboundPolicy: 'mentions',
      })
    )

    expect(result.shouldProcess).toBe(true)
    expect(result.workItem?.session_key).toBe(`slack:D111:${eventTs}`)
  })

  it('skips non-mention messages when policy is mentions', async () => {
    const eventTs = `${Math.floor(Date.now() / 1000)}.000200`
    const payload = {
      type: 'event_callback',
      event_id: 'Ev124',
      event: {
        type: 'message',
        user: 'U123',
        text: 'hello team',
        ts: eventTs,
        channel: 'C111',
      },
    }

    const result = await parseSlackWebhook(
      makeSignedRequest('secret', payload),
      makePluginInstance({
        botToken: 'xoxb-1',
        signingSecret: 'secret',
        botUserId: 'U999',
        inboundPolicy: 'mentions',
      })
    )

    expect(result.shouldProcess).toBe(false)
  })

  it('accepts mention-bearing message events when policy is mentions', async () => {
    const eventTs = `${Math.floor(Date.now() / 1000)}.000210`
    const payload = {
      type: 'event_callback',
      event_id: 'EvDup',
      event: {
        type: 'message',
        user: 'U123',
        text: '<@U999> hello duplicate',
        ts: eventTs,
        channel: 'C111',
      },
    }

    const result = await parseSlackWebhook(
      makeSignedRequest('secret', payload),
      makePluginInstance({
        botToken: 'xoxb-1',
        signingSecret: 'secret',
        botUserId: 'U999',
        inboundPolicy: 'mentions',
      })
    )

    expect(result.shouldProcess).toBe(true)
    expect(result.idempotencyKey).toBe(`slack:v1:msg:unknown:C111:${eventTs}`)
    expect(result.idempotencyKeys).toEqual([
      `slack:v1:msg:unknown:C111:${eventTs}`,
      'slack:event:EvDup',
    ])
    expect(extractPayloadBody(result)).toBe('@Slopbot hello duplicate')
  })

  it('skips messages from disallowed channels', async () => {
    const eventTs = `${Math.floor(Date.now() / 1000)}.000250`
    const payload = {
      type: 'event_callback',
      event_id: 'EvAllowed',
      event: {
        type: 'message',
        user: 'U123',
        text: 'hello world',
        ts: eventTs,
        channel: 'C111',
      },
    }

    const result = await parseSlackWebhook(
      makeSignedRequest('secret', payload),
      makePluginInstance({
        botToken: 'xoxb-1',
        signingSecret: 'secret',
        inboundPolicy: 'all',
        allowedChannels: ['C999'],
      })
    )

    expect(result.shouldProcess).toBe(false)
  })

  it('skips self-authored messages based on botUserId', async () => {
    const eventTs = `${Math.floor(Date.now() / 1000)}.000280`
    const payload = {
      type: 'event_callback',
      event_id: 'EvSelf',
      event: {
        type: 'message',
        user: 'U_BOT',
        text: 'loop',
        ts: eventTs,
        channel: 'C111',
      },
    }

    const result = await parseSlackWebhook(
      makeSignedRequest('secret', payload),
      makePluginInstance({
        botToken: 'xoxb-1',
        signingSecret: 'secret',
        inboundPolicy: 'all',
        botUserId: 'U_BOT',
      })
    )

    expect(result.shouldProcess).toBe(false)
  })

  it('skips bot-authored events', async () => {
    const eventTs = `${Math.floor(Date.now() / 1000)}.000300`
    const payload = {
      type: 'event_callback',
      event_id: 'Ev125',
      event: {
        type: 'message',
        bot_id: 'B123',
        text: 'bot echo',
        ts: eventTs,
        channel: 'C111',
      },
    }

    const result = await parseSlackWebhook(
      makeSignedRequest('secret', payload),
      makePluginInstance({ botToken: 'xoxb-1', signingSecret: 'secret', inboundPolicy: 'all' })
    )

    expect(result.shouldProcess).toBe(false)
  })

  it('ignores unsupported event payload shapes', async () => {
    const result = await parseSlackWebhook(
      makeSignedRequest('secret', {
        type: 'event_callback',
        event_id: 'EvBad',
        event: { type: 'reaction_added', user: 'U1' },
      }),
      makePluginInstance({ botToken: 'xoxb-1', signingSecret: 'secret' })
    )

    expect(result.shouldProcess).toBe(false)
  })

  it('captures optional action token + team metadata when present', async () => {
    const eventTs = `${Math.floor(Date.now() / 1000)}.000310`
    const payload = {
      type: 'event_callback',
      team_id: 'T111',
      action_token: 'xapp-action',
      event_id: 'EvToken',
      event: {
        type: 'app_mention',
        user: 'U123',
        text: '<@U999> hey',
        ts: eventTs,
        channel: 'C111',
      },
    }

    const result = await parseSlackWebhook(
      makeSignedRequest('secret', payload),
      makePluginInstance({
        botToken: 'xoxb-1',
        signingSecret: 'secret',
        botUserId: 'U999',
        inboundPolicy: 'mentions',
      })
    )

    expect(result.shouldProcess).toBe(true)
    expect(result.idempotencyKey).toBe(`slack:v1:msg:T111:C111:${eventTs}`)
    expect(result.idempotencyKeys).toEqual([
      `slack:v1:msg:T111:C111:${eventTs}`,
      'slack:event:EvToken',
    ])
    const context = result.responseContext as { teamId?: string; actionToken?: string }
    expect(context.teamId).toBe('T111')
    expect(context.actionToken).toBe('xapp-action')
  })
})
