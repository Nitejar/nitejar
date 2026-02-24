import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCreatePluginInstance,
  mockEncryptConfig,
  mockDecryptConfig,
  mockFindPluginInstanceById,
  mockFindPluginById,
  mockUpdatePluginInstance,
  mockDeletePluginInstance,
  mockPluginHandlerGet,
  mockListPluginInstancesOp,
  mockGetPluginInstanceOp,
  mockSetPluginInstanceAgentAssignmentOp,
  mockSetPluginInstanceEnabledOp,
} = vi.hoisted(() => ({
  mockCreatePluginInstance: vi.fn(),
  mockEncryptConfig: vi.fn(),
  mockDecryptConfig: vi.fn(),
  mockFindPluginInstanceById: vi.fn(),
  mockFindPluginById: vi.fn(),
  mockUpdatePluginInstance: vi.fn(),
  mockDeletePluginInstance: vi.fn(),
  mockPluginHandlerGet: vi.fn(),
  mockListPluginInstancesOp: vi.fn(),
  mockGetPluginInstanceOp: vi.fn(),
  mockSetPluginInstanceAgentAssignmentOp: vi.fn(),
  mockSetPluginInstanceEnabledOp: vi.fn(),
}))

vi.mock('@nitejar/database', () => ({
  createPluginInstance: mockCreatePluginInstance,
  encryptConfig: mockEncryptConfig,
  decryptConfig: mockDecryptConfig,
  findPluginInstanceById: mockFindPluginInstanceById,
  findPluginById: mockFindPluginById,
  updatePluginInstance: mockUpdatePluginInstance,
  deletePluginInstance: mockDeletePluginInstance,
}))

vi.mock('@nitejar/plugin-handlers', () => ({
  pluginHandlerRegistry: {
    get: mockPluginHandlerGet,
  },
}))

vi.mock('@nitejar/plugin-runtime', () => ({
  PluginLoader: class {
    async loadPlugin(): Promise<void> {
      return Promise.resolve()
    }
  },
}))

vi.mock('../services/ops/plugin-instances', () => ({
  listPluginInstancesOp: mockListPluginInstancesOp,
  getPluginInstanceOp: mockGetPluginInstanceOp,
  setPluginInstanceAgentAssignmentOp: mockSetPluginInstanceAgentAssignmentOp,
  setPluginInstanceEnabledOp: mockSetPluginInstanceEnabledOp,
}))

import {
  createPluginInstance,
  decryptConfig,
  encryptConfig,
  findPluginInstanceById,
  updatePluginInstance,
} from '@nitejar/database'
import { pluginInstancesRouter } from './plugin-instances'

const mockedCreatePluginInstance = vi.mocked(createPluginInstance)
const mockedEncryptConfig = vi.mocked(encryptConfig)
const mockedDecryptConfig = vi.mocked(decryptConfig)
const mockedFindPluginInstanceById = vi.mocked(findPluginInstanceById)
const mockedUpdatePluginInstance = vi.mocked(updatePluginInstance)

const caller = pluginInstancesRouter.createCaller({
  session: { user: { id: 'user-1' } } as never,
})

describe('pluginInstancesRouter.createInstance', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockedEncryptConfig.mockImplementation((config) => config)
    mockedDecryptConfig.mockImplementation((config) => config)
    mockedCreatePluginInstance.mockResolvedValue({
      id: 'pi-1',
      plugin_id: 'builtin.telegram',
      type: 'telegram',
      name: 'My Telegram',
      scope: 'global',
      enabled: 1,
      config: null,
      config_json: null,
      created_at: 1,
      updated_at: 1,
    } as never)
    mockedUpdatePluginInstance.mockResolvedValue({
      id: 'pi-1',
      plugin_id: 'builtin.slack',
      type: 'slack',
      name: 'My Slack',
      scope: 'global',
      enabled: 1,
      config: null,
      config_json: null,
      created_at: 1,
      updated_at: 2,
    } as never)
  })

  it('rejects enabled create when connection test fails', async () => {
    const testConnection = vi.fn().mockResolvedValue({
      ok: false,
      error: 'Invalid bot token',
    })
    mockPluginHandlerGet.mockReturnValue({
      setupConfig: { fields: [], supportsTestBeforeSave: true },
      sensitiveFields: ['botToken'],
      validateConfig: () => ({ valid: true }),
      testConnection,
    })

    await expect(
      caller.createInstance({
        type: 'telegram',
        name: 'My Telegram',
        config: { botToken: 'bad-token' },
        enabled: true,
      })
    ).rejects.toThrow('Connection test failed: Invalid bot token')

    expect(testConnection).toHaveBeenCalledWith({ botToken: 'bad-token' })
    expect(mockedCreatePluginInstance).not.toHaveBeenCalled()
  })

  it('merges config updates from successful pre-create connection test', async () => {
    const testConnection = vi.fn().mockResolvedValue({
      ok: true,
      configUpdates: { botUserId: 'U123' },
    })
    mockPluginHandlerGet.mockReturnValue({
      setupConfig: { fields: [], supportsTestBeforeSave: true },
      sensitiveFields: ['botToken'],
      validateConfig: () => ({ valid: true }),
      testConnection,
    })

    await caller.createInstance({
      type: 'telegram',
      name: 'My Telegram',
      config: { botToken: 'xoxb-valid' },
      enabled: true,
    })

    expect(testConnection).toHaveBeenCalledWith({ botToken: 'xoxb-valid' })
    expect(mockedEncryptConfig).toHaveBeenCalledWith(
      {
        botToken: 'xoxb-valid',
        botUserId: 'U123',
      },
      ['botToken']
    )
    expect(mockedCreatePluginInstance).toHaveBeenCalledTimes(1)
    const createCall = mockedCreatePluginInstance.mock.calls[0]?.[0] as
      | { config_json?: string | null; enabled?: number }
      | undefined
    expect(createCall?.enabled).toBe(1)
    expect(JSON.parse(createCall?.config_json ?? '{}')).toEqual({
      botToken: 'xoxb-valid',
      botUserId: 'U123',
    })
  })

  it('preserves existing sensitive config on partial update', async () => {
    mockPluginHandlerGet.mockReturnValue({
      sensitiveFields: ['botToken', 'signingSecret'],
      validateConfig: () => ({ valid: true }),
    })
    mockedFindPluginInstanceById.mockResolvedValue({
      id: 'pi-1',
      plugin_id: 'builtin.slack',
      type: 'slack',
      name: 'My Slack',
      scope: 'global',
      enabled: 1,
      config: JSON.stringify({
        botToken: 'xoxb-existing',
        signingSecret: 'secret-existing',
        inboundPolicy: 'mentions',
      }),
      config_json: JSON.stringify({
        botToken: 'xoxb-existing',
        signingSecret: 'secret-existing',
        inboundPolicy: 'mentions',
      }),
      created_at: 1,
      updated_at: 1,
    } as never)

    await caller.update({
      pluginInstanceId: 'pi-1',
      config: {
        inboundPolicy: 'all',
      },
    })

    expect(mockedEncryptConfig).toHaveBeenCalledWith(
      {
        botToken: 'xoxb-existing',
        signingSecret: 'secret-existing',
        inboundPolicy: 'all',
      },
      ['botToken', 'signingSecret']
    )
    expect(mockedUpdatePluginInstance).toHaveBeenCalledWith(
      'pi-1',
      expect.objectContaining({
        config_json: JSON.stringify({
          botToken: 'xoxb-existing',
          signingSecret: 'secret-existing',
          inboundPolicy: 'all',
        }),
      })
    )
  })
})
