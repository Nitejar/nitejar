import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'
import { createPluginInstance, findWorkItemById } from '@nitejar/database'
import { routeWebhook, sendMessage } from '@nitejar/plugin-handlers'
import { buildUserMessage, executeTool, type ToolContext } from '@nitejar/agent'
import { spriteExec } from '@nitejar/sprites'

vi.mock('@nitejar/sprites', () => {
  return {
    spriteExec: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    listDir: vi.fn(),
  }
})

const mockedSpriteExec = vi.mocked(spriteExec)

describe('Telegram -> Agent workflow (mocked)', () => {
  beforeEach(() => {
    mockedSpriteExec.mockReset()
    mockedSpriteExec.mockResolvedValue({
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
      duration: 1,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('routes Telegram reply metadata into work item payload and agent context', async () => {
    const pluginInstance = await createPluginInstance({
      type: 'telegram',
      name: 'Telegram',
      config: null,
      scope: 'global',
      enabled: 1,
    })

    const update = {
      update_id: 1001,
      message: {
        message_id: 12,
        message_thread_id: 77,
        date: 1700000000,
        text: 'Yes, merge it',
        chat: { id: 999, type: 'private' },
        from: { id: 42, is_bot: false, first_name: 'Josh' },
        reply_to_message: {
          message_id: 11,
          date: 1700000000,
          text: 'Merge PR #123?',
          chat: { id: 999, type: 'private' },
          from: { id: 7, is_bot: true, first_name: 'Nitejar' },
        },
      },
    }

    const request = new Request('http://localhost/webhooks/telegram', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(update),
    })

    const result = await routeWebhook('telegram', pluginInstance.id, request)
    expect(result.status).toBe(201)
    expect(result.workItemId).toBeDefined()
    expect(result.sessionKey).toBe('telegram:999:thread:77')

    const workItem = await findWorkItemById(result.workItemId!)
    expect(workItem).not.toBeNull()

    const payload = JSON.parse(workItem!.payload ?? '{}') as Record<string, unknown>
    expect(payload.messageThreadId).toBe(77)
    expect(payload.replyToMessageId).toBe(11)
    expect(payload.replyToMessageText).toBe('Merge PR #123?')

    const responseContext = payload.responseContext as Record<string, unknown> | undefined
    expect(responseContext?.chatId).toBe(999)
    expect(responseContext?.messageThreadId).toBe(77)
    expect(responseContext?.replyToMessageId).toBe(11)

    const userMessage = buildUserMessage(workItem!)
    expect(userMessage).toContain('reply_to_message_id: 11')
    expect(userMessage).toContain('reply_to_message_text: Merge PR #123?')
  })

  it('keeps legacy chat-level session routing when useMessageThreads is disabled', async () => {
    const pluginInstance = await createPluginInstance({
      type: 'telegram',
      name: 'Telegram (Legacy Session Key)',
      config: JSON.stringify({ useMessageThreads: false }),
      scope: 'global',
      enabled: 1,
    })

    const update = {
      update_id: 1002,
      message: {
        message_id: 22,
        message_thread_id: 88,
        date: 1700000000,
        text: 'No thread routing please',
        chat: { id: 999, type: 'private' },
        from: { id: 42, is_bot: false, first_name: 'Josh' },
      },
    }

    const request = new Request('http://localhost/webhooks/telegram', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(update),
    })

    const result = await routeWebhook('telegram', pluginInstance.id, request)
    expect(result.status).toBe(201)
    expect(result.sessionKey).toBe('telegram:999')

    const workItem = await findWorkItemById(result.workItemId!)
    expect(workItem).not.toBeNull()

    const payload = JSON.parse(workItem!.payload ?? '{}') as Record<string, unknown>
    expect(payload.messageThreadId).toBeUndefined()
    const responseContext = payload.responseContext as Record<string, unknown> | undefined
    expect(responseContext?.messageThreadId).toBeUndefined()
  })

  it('sends Telegram messages via bot API (mocked)', async () => {
    const fetchMock = vi
      .fn<
        (
          input: string,
          init?: RequestInit
        ) => Promise<{ ok: boolean; json: () => Promise<{ ok: boolean }> }>
      >()
      .mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      })
    vi.stubGlobal('fetch', fetchMock)

    await sendMessage({ botToken: 'test-token' }, 123, 'Connectivity check', {
      messageThreadId: 77,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const firstCall = fetchMock.mock.calls[0]
    expect(firstCall).toBeDefined()
    if (!firstCall) {
      throw new Error('Expected fetch to be called')
    }
    const url = firstCall[0]
    const options = firstCall[1]
    expect(String(url)).toContain('https://api.telegram.org/bottest-token/sendMessage')
    const bodyText = typeof options?.body === 'string' ? options.body : null
    expect(bodyText).not.toBeNull()
    const body: unknown = bodyText ? JSON.parse(bodyText) : null
    expect(body).toMatchObject({
      chat_id: 123,
      text: 'Connectivity check',
      message_thread_id: 77,
    })
  })

  it('invokes merge command via bash tool (mocked)', async () => {
    const context: ToolContext = {
      spriteName: 'sprite-1',
      cwd: '/home/sprite',
    }

    const result = await executeTool(
      'bash',
      { command: 'gh pr merge 123 --merge --delete-branch' },
      context
    )

    expect(result.success).toBe(true)
    expect(mockedSpriteExec).toHaveBeenCalled()
    const command = mockedSpriteExec.mock.calls[0]?.[1] as string
    expect(command).toContain('gh pr merge 123')
    expect(command).toContain('~/.nitejar/env')
  })
})
