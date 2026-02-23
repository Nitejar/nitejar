import { describe, expect, it, vi, beforeEach } from 'vitest'
import * as Integrations from '@nitejar/plugin-handlers'
import type { WorkItem } from '@nitejar/database'
import type { WorkItemPayload } from './types'
import type * as TelegramAttachments from './telegram-attachments'

vi.mock('@nitejar/plugin-handlers', async () => {
  const actual = await vi.importActual<typeof Integrations>('@nitejar/plugin-handlers')
  return {
    ...actual,
    getPluginInstanceWithConfig: vi.fn(),
    getFile: vi.fn(),
    downloadTelegramFileAsDataUrl: vi.fn(),
  }
})

vi.mock('./agent-logger', () => ({
  agentLog: vi.fn(),
  agentWarn: vi.fn(),
  agentError: vi.fn(),
}))

const mockedGetPluginInstance = vi.mocked(Integrations.getPluginInstanceWithConfig)
const mockedGetFile = vi.mocked(
  (Integrations as Record<string, unknown>).getFile as typeof Integrations.getFile
)
const mockedDownloadDataUrl = vi.mocked(Integrations.downloadTelegramFileAsDataUrl)

describe('safeParsePayload', () => {
  let safeParsePayload: typeof TelegramAttachments.safeParsePayload

  beforeEach(async () => {
    ;({ safeParsePayload } = await import('./telegram-attachments'))
  })

  it('returns null for null input', () => {
    expect(safeParsePayload(null)).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(safeParsePayload('')).toBeNull()
  })

  it('parses valid JSON', () => {
    const payload = JSON.stringify({ body: 'hello' })
    expect(safeParsePayload(payload)).toEqual({ body: 'hello' })
  })

  it('returns null for invalid JSON', () => {
    expect(safeParsePayload('not json')).toBeNull()
  })
})

describe('collectTelegramImageFileIds', () => {
  let collectTelegramImageFileIds: typeof TelegramAttachments.collectTelegramImageFileIds

  beforeEach(async () => {
    ;({ collectTelegramImageFileIds } = await import('./telegram-attachments'))
  })

  it('returns empty array for null payload', () => {
    expect(collectTelegramImageFileIds(null)).toEqual([])
  })

  it('returns empty array when no attachments', () => {
    expect(collectTelegramImageFileIds({ body: 'text' })).toEqual([])
  })

  it('extracts photo file IDs', () => {
    const payload: WorkItemPayload = {
      attachments: [
        { type: 'photo', fileId: 'file-1' },
        { type: 'photo', fileId: 'file-2' },
      ],
    }
    expect(collectTelegramImageFileIds(payload)).toEqual(['file-1', 'file-2'])
  })

  it('extracts document and image file IDs', () => {
    const payload: WorkItemPayload = {
      attachments: [
        { type: 'document', fileId: 'doc-1' },
        { type: 'image', fileId: 'img-1' },
      ],
    }
    expect(collectTelegramImageFileIds(payload)).toEqual(['doc-1', 'img-1'])
  })

  it('deduplicates file IDs', () => {
    const payload: WorkItemPayload = {
      attachments: [
        { type: 'photo', fileId: 'same-id' },
        { type: 'photo', fileId: 'same-id' },
      ],
    }
    expect(collectTelegramImageFileIds(payload)).toEqual(['same-id'])
  })

  it('limits to MAX_TELEGRAM_IMAGES_PER_MESSAGE', () => {
    const payload: WorkItemPayload = {
      attachments: [
        { type: 'photo', fileId: 'file-1' },
        { type: 'photo', fileId: 'file-2' },
        { type: 'photo', fileId: 'file-3' },
      ],
    }
    const result = collectTelegramImageFileIds(payload)
    expect(result.length).toBe(2)
  })

  it('skips attachments without fileId', () => {
    const payload: WorkItemPayload = {
      attachments: [{ type: 'photo' }, { type: 'photo', fileId: 'file-1' }],
    }
    expect(collectTelegramImageFileIds(payload)).toEqual(['file-1'])
  })
})

describe('collectDiscordImageUrls', () => {
  let collectDiscordImageUrls: typeof TelegramAttachments.collectDiscordImageUrls

  beforeEach(async () => {
    ;({ collectDiscordImageUrls } = await import('./telegram-attachments'))
  })

  it('returns image URLs for image attachments', () => {
    const payload: WorkItemPayload = {
      attachments: [
        { type: 'image', fileUrl: 'https://cdn.discordapp.com/attachments/1.png' },
        { type: 'document', fileUrl: 'https://cdn.discordapp.com/attachments/2.png' },
      ],
    }

    expect(collectDiscordImageUrls(payload)).toEqual([
      'https://cdn.discordapp.com/attachments/1.png',
    ])
  })
})

describe('parseTelegramConfig', () => {
  let parseTelegramConfig: typeof TelegramAttachments.parseTelegramConfig

  beforeEach(async () => {
    ;({ parseTelegramConfig } = await import('./telegram-attachments'))
  })

  it('returns null for falsy input', () => {
    expect(parseTelegramConfig(null)).toBeNull()
    expect(parseTelegramConfig(undefined)).toBeNull()
    expect(parseTelegramConfig('')).toBeNull()
  })

  it('parses valid JSON string', () => {
    const config = JSON.stringify({ botToken: 'abc123' })
    expect(parseTelegramConfig(config)).toEqual({ botToken: 'abc123' })
  })

  it('returns null for invalid JSON string', () => {
    expect(parseTelegramConfig('not json')).toBeNull()
  })

  it('returns object config directly', () => {
    const config = { botToken: 'abc123' }
    expect(parseTelegramConfig(config)).toBe(config)
  })

  it('returns null for non-object non-string types', () => {
    expect(parseTelegramConfig(42)).toBeNull()
    expect(parseTelegramConfig(true)).toBeNull()
  })
})

describe('buildUserMessageForModel', () => {
  let buildUserMessageForModel: typeof TelegramAttachments.buildUserMessageForModel

  beforeEach(async () => {
    vi.clearAllMocks()
    ;({ buildUserMessageForModel } = await import('./telegram-attachments'))
  })

  const makeWorkItem = (overrides: Partial<WorkItem> = {}): WorkItem =>
    ({
      id: 'wi-1',
      agent_id: 'agent-1',
      session_key: 'session-1',
      source: 'telegram',
      plugin_instance_id: 'int-1',
      payload: null,
      content: 'hello',
      status: 'PENDING',
      created_at: 1,
      updated_at: 1,
      ...overrides,
    }) as WorkItem

  it('returns plain text message for non-telegram sources', async () => {
    const workItem = makeWorkItem({ source: 'api', plugin_instance_id: null })
    const result = await buildUserMessageForModel(workItem, 'hello')
    expect(result).toEqual({ role: 'user', content: 'hello' })
  })

  it('returns plain text when no plugin_instance_id', async () => {
    const workItem = makeWorkItem({ plugin_instance_id: null })
    const result = await buildUserMessageForModel(workItem, 'hello')
    expect(result).toEqual({ role: 'user', content: 'hello' })
  })

  it('returns plain text when no image attachments', async () => {
    const workItem = makeWorkItem({
      payload: JSON.stringify({ body: 'text only' }),
    })
    const result = await buildUserMessageForModel(workItem, 'hello')
    expect(result).toEqual({ role: 'user', content: 'hello' })
  })

  it('includes images when available', async () => {
    const workItem = makeWorkItem({
      payload: JSON.stringify({
        attachments: [{ type: 'photo', fileId: 'file-1' }],
      }),
    })

    mockedGetPluginInstance.mockResolvedValue({
      id: 'int-1',
      plugin_id: 'builtin.telegram',
      type: 'telegram',
      config: JSON.stringify({ botToken: 'token123' }),
      config_json: JSON.stringify({ botToken: 'token123' }),
      name: 'test',
      scope: 'global',
      enabled: 1,
      created_at: 1,
      updated_at: 1,
    })

    mockedGetFile.mockResolvedValue({
      file_id: 'file-1',
      file_unique_id: 'unique-1',
      file_path: 'photos/file.jpg',
      file_size: 1024,
    })

    mockedDownloadDataUrl.mockResolvedValue('data:image/jpeg;base64,abc123')

    const result = await buildUserMessageForModel(workItem, 'describe this')

    expect(Array.isArray(result.content)).toBe(true)
    const parts = result.content as Array<{ type: string }>
    expect(parts[0]).toEqual({ type: 'text', text: 'describe this' })
    expect(parts[1]).toHaveProperty('type', 'image_url')
  })

  it('falls back to text when integration lookup fails', async () => {
    const workItem = makeWorkItem({
      payload: JSON.stringify({
        attachments: [{ type: 'photo', fileId: 'file-1' }],
      }),
    })

    mockedGetPluginInstance.mockRejectedValue(new Error('DB error'))

    const result = await buildUserMessageForModel(workItem, 'hello')
    expect(result).toEqual({ role: 'user', content: 'hello' })
  })

  it('falls back to text when integration is not telegram type', async () => {
    const workItem = makeWorkItem({
      payload: JSON.stringify({
        attachments: [{ type: 'photo', fileId: 'file-1' }],
      }),
    })

    mockedGetPluginInstance.mockResolvedValue({
      id: 'int-1',
      plugin_id: 'builtin.slack',
      type: 'slack',
      config: JSON.stringify({}),
      config_json: JSON.stringify({}),
      name: 'test',
      scope: 'global',
      enabled: 1,
      created_at: 1,
      updated_at: 1,
    })

    const result = await buildUserMessageForModel(workItem, 'hello')
    expect(result).toEqual({ role: 'user', content: 'hello' })
  })

  it('includes discord image URLs for model input', async () => {
    const workItem = makeWorkItem({
      source: 'discord',
      payload: JSON.stringify({
        attachments: [{ type: 'image', fileUrl: 'https://media.discordapp.net/example.png' }],
      }),
    })

    const result = await buildUserMessageForModel(workItem, 'here is image')

    expect(Array.isArray(result.content)).toBe(true)
    const parts = result.content as Array<{ type: string }>
    expect(parts[0]).toEqual({ type: 'text', text: 'here is image' })
    expect(parts[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'https://media.discordapp.net/example.png' },
    })
  })

  it('ignores non-image discord attachments in model input', async () => {
    const workItem = makeWorkItem({
      source: 'discord',
      payload: JSON.stringify({
        attachments: [{ type: 'document', fileUrl: 'https://cdn.discordapp.com/file.zip' }],
      }),
    })

    const result = await buildUserMessageForModel(workItem, 'text only')
    expect(result).toEqual({ role: 'user', content: 'text only' })
  })
})
