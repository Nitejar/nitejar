import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { PluginInstanceRecord } from '@nitejar/database'
import { discordHandler } from './index'
import { parseDiscordWebhook, verifyDiscordSignature } from './webhook'

const {
  sendFollowUpMessageMock,
  registerGuildCommandsMock,
  getCurrentBotUserMock,
  sendChannelMessageMock,
} = vi.hoisted(() => ({
  sendFollowUpMessageMock: vi.fn(),
  registerGuildCommandsMock: vi.fn(),
  getCurrentBotUserMock: vi.fn(),
  sendChannelMessageMock: vi.fn(),
}))

vi.mock('./client', async () => {
  const actual = await vi.importActual('./client')
  return {
    ...actual,
    sendFollowUpMessage: sendFollowUpMessageMock,
    registerGuildCommands: registerGuildCommandsMock,
    getCurrentBotUser: getCurrentBotUserMock,
    sendChannelMessage: sendChannelMessageMock,
  }
})

function publicKeyToHex(publicKey: KeyObject): string {
  const der = publicKey.export({ format: 'der', type: 'spki' }) as Buffer
  return der.subarray(-32).toString('hex')
}

function makePluginInstance(publicKeyHex: string): PluginInstanceRecord {
  return {
    id: 'int-discord-test',
    type: 'discord',
    name: 'Discord Test',
    config: JSON.stringify({
      applicationId: 'app-123',
      publicKey: publicKeyHex,
      botToken: 'bot-token',
      guildId: 'guild-123',
    }),
    scope: 'global',
    enabled: 1,
    created_at: Math.floor(Date.now() / 1000),
    updated_at: Math.floor(Date.now() / 1000),
  } as PluginInstanceRecord
}

function makePluginInstanceWithConfig(config: unknown): PluginInstanceRecord {
  return {
    id: 'int-discord-test',
    type: 'discord',
    name: 'Discord Test',
    config: JSON.stringify(config),
    scope: 'global',
    enabled: 1,
    created_at: Math.floor(Date.now() / 1000),
    updated_at: Math.floor(Date.now() / 1000),
  } as PluginInstanceRecord
}

function makeSignedRequest(
  payload: unknown,
  privateKey: KeyObject,
  timestamp = '1700000000'
): Request {
  const rawBody = JSON.stringify(payload)
  const signature = sign(null, Buffer.from(`${timestamp}${rawBody}`, 'utf8'), privateKey).toString(
    'hex'
  )

  return new Request('http://localhost/webhooks/discord', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-signature-ed25519': signature,
      'x-signature-timestamp': timestamp,
    },
    body: rawBody,
  })
}

describe('verifyDiscordSignature', () => {
  it('accepts valid signatures and rejects invalid signatures', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const rawBody = JSON.stringify({ type: 1 })
    const timestamp = '1700000000'
    const signature = sign(
      null,
      Buffer.from(`${timestamp}${rawBody}`, 'utf8'),
      privateKey
    ).toString('hex')
    const publicKeyHex = publicKeyToHex(publicKey)

    expect(verifyDiscordSignature(rawBody, signature, timestamp, publicKeyHex)).toBe(true)
    expect(verifyDiscordSignature(rawBody, '00'.repeat(64), timestamp, publicKeyHex)).toBe(false)
    expect(verifyDiscordSignature(rawBody, signature, timestamp, 'not-hex')).toBe(false)
  })
})

describe('parseDiscordWebhook', () => {
  it('ignores requests when config is missing a public key', async () => {
    const { privateKey } = generateKeyPairSync('ed25519')
    const payload = { id: 'i-no-key', application_id: 'app', type: 1, token: 'tok' }

    const result = await parseDiscordWebhook(
      makeSignedRequest(payload, privateKey),
      makePluginInstanceWithConfig({ applicationId: 'app-123' })
    )

    expect(result.shouldProcess).toBe(false)
    expect(result.webhookResponse).toBeUndefined()
  })

  it('returns type 1 response for PING interactions', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const payload = {
      id: 'i-1',
      application_id: 'app-123',
      type: 1,
      token: 'interaction-token',
    }

    const result = await parseDiscordWebhook(
      makeSignedRequest(payload, privateKey),
      makePluginInstance(publicKeyToHex(publicKey))
    )

    expect(result.shouldProcess).toBe(false)
    expect(result.webhookResponse).toEqual({ status: 200, body: { type: 1 } })
  })

  it('rejects invalid request signatures', async () => {
    const signer = generateKeyPairSync('ed25519')
    const verifier = generateKeyPairSync('ed25519')
    const payload = {
      id: 'i-2',
      application_id: 'app-123',
      type: 1,
      token: 'interaction-token',
    }

    const result = await parseDiscordWebhook(
      makeSignedRequest(payload, signer.privateKey),
      makePluginInstance(publicKeyToHex(verifier.publicKey))
    )

    expect(result.shouldProcess).toBe(false)
    expect(result.webhookResponse?.status).toBe(401)
  })

  it('rejects requests with missing signature headers', async () => {
    const { publicKey } = generateKeyPairSync('ed25519')
    const request = new Request('http://localhost/webhooks/discord', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 1 }),
    })

    const result = await parseDiscordWebhook(request, makePluginInstance(publicKeyToHex(publicKey)))
    expect(result.shouldProcess).toBe(false)
    expect(result.webhookResponse?.status).toBe(401)
  })

  it('returns 400 when payload is invalid JSON', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const timestamp = '1700000000'
    const rawBody = '{bad-json'
    const signature = sign(
      null,
      Buffer.from(`${timestamp}${rawBody}`, 'utf8'),
      privateKey
    ).toString('hex')
    const request = new Request('http://localhost/webhooks/discord', {
      method: 'POST',
      headers: {
        'x-signature-ed25519': signature,
        'x-signature-timestamp': timestamp,
      },
      body: rawBody,
    })

    const result = await parseDiscordWebhook(request, makePluginInstance(publicKeyToHex(publicKey)))
    expect(result.shouldProcess).toBe(false)
    expect(result.webhookResponse?.status).toBe(400)
  })

  it('returns type 6 deferred update for message components', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const payload = {
      id: 'i-component',
      application_id: 'app-123',
      type: 3,
      token: 'interaction-token',
    }

    const result = await parseDiscordWebhook(
      makeSignedRequest(payload, privateKey),
      makePluginInstance(publicKeyToHex(publicKey))
    )

    expect(result.shouldProcess).toBe(false)
    expect(result.webhookResponse).toEqual({ status: 200, body: { type: 6 } })
  })

  it('returns ephemeral unsupported response for unknown interaction types', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const payload = {
      id: 'i-unknown',
      application_id: 'app-123',
      type: 99,
      token: 'interaction-token',
    }

    const result = await parseDiscordWebhook(
      makeSignedRequest(payload, privateKey),
      makePluginInstance(publicKeyToHex(publicKey))
    )

    expect(result.shouldProcess).toBe(false)
    expect(result.webhookResponse).toEqual({
      status: 200,
      body: {
        type: 4,
        data: {
          content: 'Unsupported interaction type.',
          flags: 64,
        },
      },
    })
  })

  it('parses unsigned discord message payloads and captures attachments', async () => {
    const { publicKey } = generateKeyPairSync('ed25519')
    const payload = {
      id: 'm-1',
      guild_id: 'guild-msg',
      channel_id: 'channel-msg',
      content: 'Can you review this screenshot?',
      author: {
        id: 'user-msg',
        username: 'discord-user',
        global_name: 'Discord User',
        bot: false,
      },
      attachments: [
        {
          id: 'att-1',
          filename: 'ui.png',
          content_type: 'image/png',
          size: 2048,
          width: 640,
          height: 480,
          url: 'https://cdn.discordapp.com/attachments/1/2/ui.png',
          proxy_url: 'https://media.discordapp.net/attachments/1/2/ui.png',
        },
      ],
      timestamp: '2026-02-22T00:00:00.000Z',
    }

    const result = await parseDiscordWebhook(
      new Request('http://localhost/webhooks/discord', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
      makePluginInstance(publicKeyToHex(publicKey))
    )

    expect(result.shouldProcess).toBe(true)
    expect(result.webhookResponse).toEqual({ status: 200, body: {} })
    expect(result.responseContext).toEqual({
      applicationId: undefined,
      guildId: 'guild-msg',
      channelId: 'channel-msg',
      messageId: 'm-1',
    })
    expect(result.workItem?.session_key).toBe('discord:guild-msg:channel-msg')
    expect(result.workItem?.source_ref).toBe('discord:guild-msg:channel-msg:m-1')

    const parsedPayload = JSON.parse(result.workItem?.payload ?? '{}') as Record<string, unknown>
    expect(parsedPayload.body).toBe('Can you review this screenshot?')
    expect(parsedPayload.attachments).toEqual([
      {
        type: 'image',
        fileId: 'att-1',
        fileName: 'ui.png',
        mimeType: 'image/png',
        fileSize: 2048,
        width: 640,
        height: 480,
        fileUrl: 'https://media.discordapp.net/attachments/1/2/ui.png',
      },
    ])
  })

  it('ignores unsigned message payloads from bot accounts', async () => {
    const payload = {
      id: 'm-bot',
      channel_id: 'channel-msg',
      content: 'bot msg',
      author: {
        id: 'bot-id',
        username: 'bot',
        bot: true,
      },
    }

    const result = await parseDiscordWebhook(
      new Request('http://localhost/webhooks/discord', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
      makePluginInstance(publicKeyToHex(generateKeyPairSync('ed25519').publicKey))
    )

    expect(result.shouldProcess).toBe(false)
    expect(result.webhookResponse).toBeUndefined()
  })

  it('returns deferred ACK + work item for application commands', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const payload = {
      id: 'i-3',
      application_id: 'app-123',
      type: 2,
      token: 'interaction-token',
      guild_id: 'guild-1',
      channel_id: 'channel-1',
      data: {
        id: 'cmd-1',
        name: 'ask',
        type: 1,
        options: [{ name: 'prompt', type: 3, value: 'How do I deploy this?' }],
      },
      member: {
        nick: 'Josh',
        user: {
          id: 'user-1',
          username: 'josh',
          global_name: 'Josh M',
        },
      },
    }

    const result = await parseDiscordWebhook(
      makeSignedRequest(payload, privateKey),
      makePluginInstance(publicKeyToHex(publicKey))
    )

    expect(result.shouldProcess).toBe(true)
    expect(result.webhookResponse).toEqual({ status: 200, body: { type: 5 } })
    expect(result.idempotencyKey).toBe('discord:i-3')
    expect(result.workItem?.session_key).toBe('discord:guild-1:channel-1')

    const parsedPayload = JSON.parse(result.workItem?.payload ?? '{}') as Record<string, unknown>
    expect(parsedPayload.body).toBe('How do I deploy this?')
    expect(parsedPayload.commandName).toBe('ask')
    expect(parsedPayload.senderName).toBe('Josh')
    expect(parsedPayload.actor).toEqual({
      kind: 'human',
      externalId: 'user-1',
      handle: 'josh',
      displayName: 'Josh',
      source: 'discord',
    })
  })

  it('falls back to /command when command options do not include text', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const payload = {
      id: 'i-4',
      application_id: 'app-123',
      type: 2,
      token: 'interaction-token',
      channel_id: 'channel-1',
      data: {
        id: 'cmd-2',
        name: 'ask',
        type: 1,
      },
      user: {
        id: 'user-2',
        username: 'casey',
      },
    }

    const result = await parseDiscordWebhook(
      makeSignedRequest(payload, privateKey),
      makePluginInstance(publicKeyToHex(publicKey))
    )

    expect(result.shouldProcess).toBe(true)
    expect(result.workItem?.session_key).toBe('discord:dm:channel-1')
    const parsedPayload = JSON.parse(result.workItem?.payload ?? '{}') as Record<string, unknown>
    expect(parsedPayload.body).toBe('/ask')
    expect(parsedPayload.senderName).toBe('casey')
  })
})

describe('discordHandler', () => {
  beforeEach(() => {
    sendFollowUpMessageMock.mockReset()
    registerGuildCommandsMock.mockReset()
    getCurrentBotUserMock.mockReset()
    sendChannelMessageMock.mockReset()
  })

  it('posts follow-up responses in Discord-safe chunks', async () => {
    sendFollowUpMessageMock.mockResolvedValue({
      id: 'msg-1',
      channel_id: 'channel-1',
      content: 'ok',
    })

    const pluginInstance = makePluginInstance('11'.repeat(32))
    const longContent = `A${'x'.repeat(2105)}`

    const result = await discordHandler.postResponse(
      pluginInstance,
      'work-1',
      longContent,
      {
        applicationId: 'app-123',
        interactionId: 'i-9',
        interactionToken: 'interaction-token',
      },
      undefined
    )

    expect(result.success).toBe(true)
    expect(sendFollowUpMessageMock).toHaveBeenCalledTimes(2)
    expect(sendFollowUpMessageMock.mock.calls[0]?.[0]).toBe('app-123')
    expect(sendFollowUpMessageMock.mock.calls[0]?.[1]).toBe('interaction-token')
  })

  it('returns parse/config errors for malformed plugin instances', async () => {
    const result = await discordHandler.postResponse(
      {
        ...makePluginInstance('11'.repeat(32)),
        config: 'not-json',
      } as PluginInstanceRecord,
      'work-1',
      'hello',
      undefined
    )
    expect(result.success).toBe(false)
    expect(result.error).toContain('parse Discord configuration')
  })

  it('fails when applicationId is unavailable', async () => {
    const result = await discordHandler.postResponse(
      makePluginInstanceWithConfig({
        publicKey: '11'.repeat(32),
        botToken: 'bot-token',
        guildId: 'guild-123',
      }),
      'work-1',
      'hello',
      { interactionToken: 'tok' }
    )
    expect(result.success).toBe(false)
    expect(result.error).toContain('application ID')
  })

  it('fails when interaction token is unavailable', async () => {
    const result = await discordHandler.postResponse(
      makePluginInstance('11'.repeat(32)),
      'work-1',
      'hello',
      { applicationId: 'app-123' }
    )
    expect(result.success).toBe(false)
    expect(result.error).toContain('Missing Discord response channel or interaction context')
  })

  it('falls back to bot channel responses when interaction token is missing and channelId is provided', async () => {
    sendChannelMessageMock.mockResolvedValue({
      id: 'msg-2',
      channel_id: 'channel-1',
      content: 'hello',
    })

    const result = await discordHandler.postResponse(
      makePluginInstance('11'.repeat(32)),
      'work-1',
      'hello',
      {
        applicationId: 'app-123',
        channelId: 'channel-1',
        messageId: 'm-1',
      }
    )

    expect(result.success).toBe(true)
    expect(sendFollowUpMessageMock).not.toHaveBeenCalled()
    expect(sendChannelMessageMock).toHaveBeenCalledTimes(1)
    expect(sendChannelMessageMock.mock.calls[0]?.[1]).toBe('channel-1')
    expect(sendChannelMessageMock.mock.calls[0]?.[2]).toBe('hello')
    expect(sendChannelMessageMock.mock.calls[0]?.[3]).toBe('m-1')
  })

  it('returns failure when follow-up delivery throws', async () => {
    sendFollowUpMessageMock.mockRejectedValueOnce(new Error('discord down'))
    const result = await discordHandler.postResponse(
      makePluginInstance('11'.repeat(32)),
      'work-1',
      'hello',
      {
        applicationId: 'app-123',
        interactionId: 'i-9',
        interactionToken: 'interaction-token',
      }
    )

    expect(result.success).toBe(false)
    expect(result.outcome).toBe('failed')
    expect(result.error).toContain('discord down')
  })

  it('registers /ask slash command in testConnection', async () => {
    getCurrentBotUserMock.mockResolvedValue({ id: 'user-123', username: 'nitejar' })
    registerGuildCommandsMock.mockResolvedValue([])

    const result = await discordHandler.testConnection!({
      applicationId: 'app-123',
      publicKey: '22'.repeat(32),
      botToken: 'bot-token',
      guildId: 'guild-123',
    })

    expect(result.ok).toBe(true)
    expect(registerGuildCommandsMock).toHaveBeenCalledTimes(1)

    const commands = registerGuildCommandsMock.mock.calls[0]?.[3] as Array<Record<string, unknown>>
    expect(commands[0]?.name).toBe('ask')
    expect(commands[0]?.options).toEqual([
      {
        type: 3,
        name: 'prompt',
        description: 'What do you want help with?',
        required: true,
      },
    ])
  })

  it('returns error when testConnection fails', async () => {
    getCurrentBotUserMock.mockRejectedValueOnce(new Error('bad token'))

    const result = await discordHandler.testConnection!({
      applicationId: 'app-123',
      publicKey: '22'.repeat(32),
      botToken: 'bad-token',
      guildId: 'guild-123',
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('bad token')
  })

  it('validates configuration and reports field errors', () => {
    const validation = discordHandler.validateConfig({})
    expect(validation.valid).toBe(false)
    expect(validation.errors).toBeDefined()
    expect(validation.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('applicationId'),
        expect.stringContaining('publicKey'),
        expect.stringContaining('botToken'),
        expect.stringContaining('guildId'),
      ])
    )
  })
})
