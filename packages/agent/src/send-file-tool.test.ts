import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ToolContext } from './tools/types'
import type { PluginInstanceRecord } from '@nitejar/database'
import * as Database from '@nitejar/database'
import * as Integrations from '@nitejar/plugin-handlers'
import * as Sprites from '@nitejar/sprites'

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
    sendPhoto: vi.fn(),
    sendDocument: vi.fn(),
    sendChatAction: vi.fn().mockResolvedValue(undefined),
    telegramHandler: { sensitiveFields: [] },
  }
})

vi.mock('@nitejar/sprites', async () => {
  const actual = await vi.importActual<typeof Sprites>('@nitejar/sprites')
  return {
    ...actual,
    spriteExec: vi.fn(),
  }
})

const mockedFindPluginInstanceById = vi.mocked(Database.findPluginInstanceById)
const mockedSendPhoto = vi.mocked(Integrations.sendPhoto)
const mockedSendDocument = vi.mocked(Integrations.sendDocument)
const mockedSendChatAction = vi.mocked(Integrations.sendChatAction)
const mockedSpriteExec = vi.mocked(Sprites.spriteExec)

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
  mockedSendPhoto.mockReset()
  mockedSendDocument.mockReset()
  mockedSendChatAction.mockReset().mockResolvedValue(undefined)
  mockedSpriteExec.mockReset()
})

describe('send_file tool', () => {
  const handler = telegramTools.handlers['send_file']!

  it('sends a PNG as photo (auto-detect)', async () => {
    mockedFindPluginInstanceById.mockResolvedValue(basePluginInstance)
    // 10 bytes of fake PNG data base64-encoded
    const fakeBase64 = Buffer.from('fake-png-data').toString('base64')
    mockedSpriteExec.mockResolvedValue({
      stdout: fakeBase64,
      stderr: '',
      exitCode: 0,
      duration: 10,
    })

    const result = await handler({ file_path: '/tmp/screenshot.png' }, context)

    expect(result.success).toBe(true)
    expect(result.output).toContain('screenshot.png')
    expect(result.output).toContain('photo')
    expect(mockedSendPhoto).toHaveBeenCalledWith(
      expect.objectContaining({ botToken: 'test-token' }),
      789,
      expect.any(Buffer),
      'screenshot.png',
      { caption: undefined, messageThreadId: 42 }
    )
    expect(mockedSendDocument).not.toHaveBeenCalled()
  })

  it('sends a PDF as document (auto-detect)', async () => {
    mockedFindPluginInstanceById.mockResolvedValue(basePluginInstance)
    const fakeBase64 = Buffer.from('fake-pdf-data').toString('base64')
    mockedSpriteExec.mockResolvedValue({
      stdout: fakeBase64,
      stderr: '',
      exitCode: 0,
      duration: 10,
    })

    const result = await handler({ file_path: '/tmp/report.pdf' }, context)

    expect(result.success).toBe(true)
    expect(result.output).toContain('report.pdf')
    expect(result.output).toContain('document')
    expect(mockedSendDocument).toHaveBeenCalledWith(
      expect.objectContaining({ botToken: 'test-token' }),
      789,
      expect.any(Buffer),
      'report.pdf',
      { caption: undefined, messageThreadId: 42 }
    )
    expect(mockedSendPhoto).not.toHaveBeenCalled()
  })

  it('send_as=document overrides image auto-detect', async () => {
    mockedFindPluginInstanceById.mockResolvedValue(basePluginInstance)
    const fakeBase64 = Buffer.from('fake-png-data').toString('base64')
    mockedSpriteExec.mockResolvedValue({
      stdout: fakeBase64,
      stderr: '',
      exitCode: 0,
      duration: 10,
    })

    const result = await handler({ file_path: '/tmp/screenshot.png', send_as: 'document' }, context)

    expect(result.success).toBe(true)
    expect(result.output).toContain('document')
    expect(mockedSendDocument).toHaveBeenCalled()
    expect(mockedSendPhoto).not.toHaveBeenCalled()
  })

  it('uses responseContext for chat_id/thread_id when not provided', async () => {
    mockedFindPluginInstanceById.mockResolvedValue(basePluginInstance)
    const fakeBase64 = Buffer.from('data').toString('base64')
    mockedSpriteExec.mockResolvedValue({
      stdout: fakeBase64,
      stderr: '',
      exitCode: 0,
      duration: 10,
    })

    await handler({ file_path: '/tmp/file.txt' }, context)

    expect(mockedSendDocument).toHaveBeenCalledWith(
      expect.anything(),
      789, // from responseContext.chatId
      expect.any(Buffer),
      'file.txt',
      expect.objectContaining({ messageThreadId: 42 }) // from responseContext.messageThreadId
    )
  })

  it('explicit chat_id and thread_id override context', async () => {
    mockedFindPluginInstanceById.mockResolvedValue(basePluginInstance)
    const fakeBase64 = Buffer.from('data').toString('base64')
    mockedSpriteExec.mockResolvedValue({
      stdout: fakeBase64,
      stderr: '',
      exitCode: 0,
      duration: 10,
    })

    await handler({ file_path: '/tmp/file.txt', chat_id: 111, thread_id: 222 }, context)

    expect(mockedSendDocument).toHaveBeenCalledWith(
      expect.anything(),
      111, // explicit
      expect.any(Buffer),
      'file.txt',
      expect.objectContaining({ messageThreadId: 222 }) // explicit
    )
  })

  it('sends correct chat action for photos', async () => {
    mockedFindPluginInstanceById.mockResolvedValue(basePluginInstance)
    const fakeBase64 = Buffer.from('data').toString('base64')
    mockedSpriteExec.mockResolvedValue({
      stdout: fakeBase64,
      stderr: '',
      exitCode: 0,
      duration: 10,
    })

    await handler({ file_path: '/tmp/image.jpg' }, context)

    expect(mockedSendChatAction).toHaveBeenCalledWith(
      expect.objectContaining({ botToken: 'test-token' }),
      789,
      'upload_photo',
      { messageThreadId: 42 }
    )
  })

  it('sends correct chat action for documents', async () => {
    mockedFindPluginInstanceById.mockResolvedValue(basePluginInstance)
    const fakeBase64 = Buffer.from('data').toString('base64')
    mockedSpriteExec.mockResolvedValue({
      stdout: fakeBase64,
      stderr: '',
      exitCode: 0,
      duration: 10,
    })

    await handler({ file_path: '/tmp/data.csv' }, context)

    expect(mockedSendChatAction).toHaveBeenCalledWith(
      expect.objectContaining({ botToken: 'test-token' }),
      789,
      'upload_document',
      { messageThreadId: 42 }
    )
  })

  it('returns error when file not found', async () => {
    mockedFindPluginInstanceById.mockResolvedValue(basePluginInstance)
    mockedSpriteExec.mockResolvedValue({
      stdout: '',
      stderr: 'base64: No such file or directory',
      exitCode: 1,
      duration: 5,
    })

    const result = await handler({ file_path: '/tmp/missing.png' }, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain('File not found')
  })

  it('returns error when file too large for photo', async () => {
    mockedFindPluginInstanceById.mockResolvedValue(basePluginInstance)
    // Create a base64 string that decodes to > 10 MB
    const bigBuffer = Buffer.alloc(11 * 1024 * 1024)
    mockedSpriteExec.mockResolvedValue({
      stdout: bigBuffer.toString('base64'),
      stderr: '',
      exitCode: 0,
      duration: 10,
    })

    const result = await handler({ file_path: '/tmp/huge.png' }, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain('File too large')
    expect(result.error).toContain('10 MB')
  })

  it('returns error when missing plugin instance context', async () => {
    const noIntCtx: ToolContext = { spriteName: 'sprite-1', cwd: '/home/sprite' }
    const result = await handler({ file_path: '/tmp/file.png' }, noIntCtx)
    expect(result.success).toBe(false)
    expect(result.error).toContain('No plugin instance context')
  })

  it('passes through Telegram API errors', async () => {
    mockedFindPluginInstanceById.mockResolvedValue(basePluginInstance)
    const fakeBase64 = Buffer.from('data').toString('base64')
    mockedSpriteExec.mockResolvedValue({
      stdout: fakeBase64,
      stderr: '',
      exitCode: 0,
      duration: 10,
    })
    mockedSendDocument.mockRejectedValue(new Error('Telegram API error: Bad Request'))

    const result = await handler({ file_path: '/tmp/file.txt' }, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Telegram API error')
  })

  it('includes caption when provided', async () => {
    mockedFindPluginInstanceById.mockResolvedValue(basePluginInstance)
    const fakeBase64 = Buffer.from('data').toString('base64')
    mockedSpriteExec.mockResolvedValue({
      stdout: fakeBase64,
      stderr: '',
      exitCode: 0,
      duration: 10,
    })

    await handler({ file_path: '/tmp/chart.png', caption: 'Weekly stats' }, context)

    expect(mockedSendPhoto).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.any(Buffer),
      'chart.png',
      expect.objectContaining({ caption: 'Weekly stats' })
    )
  })

  it('fails when file_path is empty', async () => {
    const result = await handler({ file_path: '' }, context)
    expect(result.success).toBe(false)
    expect(result.error).toContain('file_path is required')
  })
})
