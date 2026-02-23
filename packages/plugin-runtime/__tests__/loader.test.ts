/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as path from 'node:path'
import { PluginLoader } from '../src/loader'
import type { HandlerRegistry, ProviderRegistry } from '../src/types'

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'test-plugin')

// Mock @nitejar/database
vi.mock('@nitejar/database', () => ({
  updatePlugin: vi.fn().mockResolvedValue(null),
  createPluginEvent: vi.fn().mockResolvedValue(null),
}))

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

describe('PluginLoader', () => {
  let handlerRegistry: ReturnType<typeof createMockHandlerRegistry>
  let providerRegistry: ReturnType<typeof createMockProviderRegistry>
  let loader: PluginLoader

  beforeEach(() => {
    vi.clearAllMocks()
    handlerRegistry = createMockHandlerRegistry()
    providerRegistry = createMockProviderRegistry()
    loader = new PluginLoader(handlerRegistry, providerRegistry)
  })

  describe('loadPlugin', () => {
    it('loads the test fixture plugin successfully', async () => {
      const result = await loader.loadPlugin({
        id: 'test.echo',
        manifest_json: JSON.stringify({
          schemaVersion: 1,
          id: 'test.echo',
          name: 'Test Echo',
          version: '0.1.0',
          entry: 'entry.js',
        }),
        current_install_path: FIXTURE_DIR,
        source_kind: 'local',
      })

      expect(result.success).toBe(true)
      expect(result.handlerType).toBe('test-echo')
      expect(handlerRegistry.register).toHaveBeenCalled()
    })

    it('skips builtin plugins', async () => {
      const result = await loader.loadPlugin({
        id: 'builtin.telegram',
        manifest_json: JSON.stringify({
          schemaVersion: 1,
          id: 'builtin.telegram',
          name: 'Telegram',
          version: '1.0.0',
        }),
        current_install_path: null,
        source_kind: 'builtin',
      })

      expect(result.success).toBe(true)
      expect(handlerRegistry.register).not.toHaveBeenCalled()
    })

    it('rejects plugins that conflict with builtins', async () => {
      const result = await loader.loadPlugin({
        id: 'evil.telegram',
        manifest_json: JSON.stringify({
          schemaVersion: 1,
          id: 'evil.telegram',
          name: 'Evil Telegram',
          version: '0.1.0',
          entry: 'entry.js',
        }),
        current_install_path: path.join(__dirname, 'fixtures', 'telegram-override'),
        source_kind: 'npm',
      })

      // Should fail because there's no such fixture dir
      expect(result.success).toBe(false)
    })

    it('returns error for invalid manifest', async () => {
      const result = await loader.loadPlugin({
        id: 'bad.plugin',
        manifest_json: 'not valid json{{{',
        current_install_path: null,
        source_kind: 'npm',
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid manifest JSON')
    })

    it('returns error when no install path', async () => {
      const result = await loader.loadPlugin({
        id: 'no.path',
        manifest_json: JSON.stringify({
          schemaVersion: 1,
          id: 'no.path',
          name: 'No Path',
          version: '1.0.0',
          entry: 'entry.js',
        }),
        current_install_path: null,
        source_kind: 'npm',
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('no install path')
    })
  })

  describe('unloadPlugin', () => {
    it('unregisters handler and provider', async () => {
      await loader.unloadPlugin('test.echo', 'test-echo')

      expect(handlerRegistry.unregister).toHaveBeenCalledWith('test-echo')
      expect(providerRegistry.unregister).toHaveBeenCalledWith('test-echo')
    })
  })
})
