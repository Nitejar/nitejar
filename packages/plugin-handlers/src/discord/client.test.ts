import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  editOriginalResponse,
  getChannelMessages,
  getCurrentBotUser,
  registerGuildCommands,
  sendChannelMessage,
  sendFollowUpMessage,
  splitDiscordMessage,
} from './client'

const fetchMock = vi.spyOn(globalThis, 'fetch')

afterEach(() => {
  fetchMock.mockReset()
})

describe('splitDiscordMessage', () => {
  it('returns empty for blank content', () => {
    expect(splitDiscordMessage('   ')).toEqual([])
  })

  it('keeps short content intact', () => {
    expect(splitDiscordMessage('hello')).toEqual(['hello'])
  })

  it('splits long content and long single lines', () => {
    const chunks = splitDiscordMessage(`line\n${'x'.repeat(2105)}`)
    expect(chunks.length).toBe(3)
    expect(chunks[0]!.length).toBeLessThanOrEqual(2000)
    expect(chunks[1]!.length).toBeLessThanOrEqual(2000)
    expect(chunks[2]!.length).toBeLessThanOrEqual(2000)
  })
})

describe('discord client API helpers', () => {
  it('sends follow-up messages', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'm1', channel_id: 'c1', content: 'ok' }), { status: 200 })
    )

    const result = await sendFollowUpMessage('app-1', 'token-1', 'hello')

    expect(result.id).toBe('m1')
    expect(fetchMock).toHaveBeenCalledWith('https://discord.com/api/v10/webhooks/app-1/token-1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'hello' }),
    })
  })

  it('edits original deferred response', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'm2', channel_id: 'c1', content: 'edited' }), {
        status: 200,
      })
    )

    const result = await editOriginalResponse('app-1', 'token-1', 'edited')
    expect(result.content).toBe('edited')
  })

  it('registers guild commands with bot auth', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify([{ name: 'ask' }]), { status: 200 })
    )

    const result = await registerGuildCommands('app-1', 'bot-1', 'guild-1', [
      { name: 'ask', description: 'Ask something' },
    ])

    expect(result[0]?.name).toBe('ask')
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://discord.com/api/v10/applications/app-1/guilds/guild-1/commands'
    )
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(init.method).toBe('PUT')
    expect(init.headers).toMatchObject({ Authorization: 'Bot bot-1' })
  })

  it('sends channel messages with optional reply references', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'm3', channel_id: 'c1', content: 'hello' }), {
        status: 200,
      })
    )

    const result = await sendChannelMessage('bot-1', 'c1', 'hello', 'reply-1')
    expect(result.id).toBe('m3')

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(init.body).toBe(
      JSON.stringify({
        content: 'hello',
        message_reference: { message_id: 'reply-1' },
      })
    )
  })

  it('reads channel messages with bounded limit', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify([{ id: 'm4', channel_id: 'c1', content: 'hi' }]), { status: 200 })
    )

    const result = await getChannelMessages('bot-1', 'c1', 999)
    expect(result).toHaveLength(1)
    expect(fetchMock.mock.calls[0]?.[0]).toContain('limit=100')
  })

  it('fetches the current bot user', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'u1', username: 'bot' })))

    const result = await getCurrentBotUser('bot-1')
    expect(result.username).toBe('bot')
  })

  it('surfaces Discord API errors from JSON and plain text responses', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Invalid token', code: 50014 }), { status: 401 })
    )
    await expect(sendFollowUpMessage('app-1', 'token-1', 'hello')).rejects.toThrow(
      'Discord API error (401/50014): Invalid token'
    )

    fetchMock.mockResolvedValueOnce(new Response('Gateway blew up', { status: 502 }))
    await expect(sendChannelMessage('bot-1', 'c1', 'hello')).rejects.toThrow(
      'Discord API error (502): Gateway blew up'
    )
  })
})
