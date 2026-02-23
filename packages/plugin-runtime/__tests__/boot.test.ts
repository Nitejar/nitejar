import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { HandlerRegistry, ProviderRegistry } from '../src/types'

// Mock @nitejar/database before importing boot
vi.mock('@nitejar/database', () => ({
  listPlugins: vi.fn(),
  getPluginArtifact: vi.fn().mockResolvedValue(null),
  updatePlugin: vi.fn().mockResolvedValue(null),
  createPluginEvent: vi.fn().mockResolvedValue(null),
}))

// Mock fs-layout to avoid actual filesystem operations during boot
vi.mock('../src/fs-layout', () => ({
  getCurrentPath: vi.fn().mockResolvedValue('/fake/path'),
  ensurePluginDirs: vi.fn().mockResolvedValue('/fake/dir'),
  swapCurrentSymlink: vi.fn().mockResolvedValue(undefined),
  getPluginDir: vi.fn().mockReturnValue('/fake/plugins'),
  getPluginVersionDir: vi.fn().mockReturnValue('/fake/plugins/test/1.0.0'),
}))

import { bootPlugins } from '../src/boot'
import { listPlugins } from '@nitejar/database'

function createMockHandlerRegistry(): HandlerRegistry {
  const handlers = new Map<string, unknown>()
  return {
    register: vi.fn((handler: { type: string }) => {
      handlers.set(handler.type, handler)
    }),
    unregister: vi.fn((type: string) => handlers.delete(type)),
    has: vi.fn((type: string) => handlers.has(type)),
    get: vi.fn((type: string) => handlers.get(type) as ReturnType<HandlerRegistry['get']>),
  }
}

function createMockProviderRegistry(): ProviderRegistry {
  const providers = new Map<string, unknown>()
  return {
    register: vi.fn((provider: { integrationType: string }) => {
      providers.set(provider.integrationType, provider)
    }),
    unregister: vi.fn((type: string) => providers.delete(type)),
    has: vi.fn((type: string) => providers.has(type)),
  }
}

describe('bootPlugins', () => {
  let handlerRegistry: ReturnType<typeof createMockHandlerRegistry>
  let providerRegistry: ReturnType<typeof createMockProviderRegistry>

  beforeEach(() => {
    vi.clearAllMocks()
    handlerRegistry = createMockHandlerRegistry()
    providerRegistry = createMockProviderRegistry()
  })

  it('skips everything in saas_locked mode', async () => {
    const result = await bootPlugins({
      handlerRegistry,
      providerRegistry,
      trustMode: 'saas_locked',
    })

    expect(result.loaded).toHaveLength(0)
    expect(result.errors).toHaveLength(0)
    expect(result.skipped).toHaveLength(0)
    expect(listPlugins).not.toHaveBeenCalled()
  })

  it('skips builtin plugins', async () => {
    vi.mocked(listPlugins).mockResolvedValue([
      {
        id: 'builtin.telegram',
        name: 'Telegram',
        enabled: 1,
        trust_level: 'builtin',
        source_kind: 'builtin',
        source_ref: 'builtin',
        current_version: '1.0.0',
        current_checksum: 'abc',
        current_install_path: 'builtin://builtin.telegram',
        manifest_json: '{}',
        config_json: null,
        last_load_error: null,
        last_loaded_at: null,
        installed_at: Date.now(),
        updated_at: Date.now(),
      },
    ])

    const result = await bootPlugins({
      handlerRegistry,
      providerRegistry,
      trustMode: 'self_host_guarded',
    })

    // No non-builtin plugins to load
    expect(result.loaded).toHaveLength(0)
    expect(result.errors).toHaveLength(0)
  })

  it('returns empty result if DB query fails', async () => {
    vi.mocked(listPlugins).mockRejectedValue(new Error('DB not ready'))

    const result = await bootPlugins({
      handlerRegistry,
      providerRegistry,
      trustMode: 'self_host_guarded',
    })

    expect(result.loaded).toHaveLength(0)
    expect(result.errors).toHaveLength(0)
  })
})
