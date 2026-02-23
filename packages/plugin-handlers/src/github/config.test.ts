import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getGitHubAppConfig, saveGitHubAppConfig } from './index'
import {
  decryptConfig,
  encryptConfig,
  findPluginInstanceById,
  updatePluginInstance,
  type PluginInstanceRecord,
} from '@nitejar/database'
import { GITHUB_SENSITIVE_FIELDS } from './types'

vi.mock('@nitejar/database', () => ({
  decryptConfig: vi.fn((config: Record<string, unknown>) => config),
  encryptConfig: vi.fn((config: Record<string, unknown>) => config),
  findPluginInstanceById: vi.fn(),
  updatePluginInstance: vi.fn(),
}))

const decryptConfigMock = vi.mocked(decryptConfig)
const encryptConfigMock = vi.mocked(encryptConfig)
const findPluginInstanceByIdMock = vi.mocked(findPluginInstanceById)
const updatePluginInstanceMock = vi.mocked(updatePluginInstance)

function createPluginInstance(config: Record<string, unknown>): PluginInstanceRecord {
  const configJson = JSON.stringify(config)
  return {
    id: 'integration-1',
    plugin_id: 'builtin.github',
    type: 'github',
    name: 'GitHub',
    config: configJson,
    config_json: configJson,
    scope: 'global',
    enabled: 1,
    created_at: Date.now(),
    updated_at: Date.now(),
  } satisfies PluginInstanceRecord
}

beforeEach(() => {
  decryptConfigMock.mockReset()
  encryptConfigMock.mockReset()
  findPluginInstanceByIdMock.mockReset()
  updatePluginInstanceMock.mockReset()
})

describe('getGitHubAppConfig', () => {
  it('decrypts sensitive fields', async () => {
    const pluginInstance = createPluginInstance({ privateKey: 'enc:key' })
    findPluginInstanceByIdMock.mockResolvedValue(pluginInstance)
    decryptConfigMock.mockReturnValue({ privateKey: 'plain-key' })

    const result = await getGitHubAppConfig(pluginInstance.id)

    expect(result).toEqual({ privateKey: 'plain-key' })
    expect(decryptConfigMock).toHaveBeenCalledWith(
      { privateKey: 'enc:key' },
      GITHUB_SENSITIVE_FIELDS
    )
  })
})

describe('saveGitHubAppConfig', () => {
  it('encrypts and persists merged config', async () => {
    const pluginInstance = createPluginInstance({ tokenTTL: 3600 })
    findPluginInstanceByIdMock.mockResolvedValue(pluginInstance)
    decryptConfigMock.mockReturnValue({ tokenTTL: 3600 })
    encryptConfigMock.mockImplementation((config: Record<string, unknown>) => ({
      ...config,
      privateKey: 'enc:new-key',
    }))
    updatePluginInstanceMock.mockResolvedValue(pluginInstance)

    await saveGitHubAppConfig(pluginInstance.id, { privateKey: 'new-key' })

    expect(encryptConfigMock).toHaveBeenCalledWith(
      { tokenTTL: 3600, privateKey: 'new-key' },
      GITHUB_SENSITIVE_FIELDS
    )
    expect(updatePluginInstanceMock).toHaveBeenCalledWith(pluginInstance.id, {
      config: JSON.stringify({ tokenTTL: 3600, privateKey: 'enc:new-key' }),
    })
  })
})
