import { describe, it, expect } from 'vitest'
import { encryptConfig, decryptConfig, getDb } from '@nitejar/database'
import { getPluginInstanceWithConfig, pluginHandlerRegistry } from '@nitejar/plugin-handlers'
import type { PluginHandler } from '@nitejar/plugin-handlers'
import { seedPluginInstance } from './helpers/seed'

const handlerType = 'integration-test-encryption'

const handler: PluginHandler = {
  type: handlerType,
  displayName: 'Integration Test Encryption',
  sensitiveFields: ['apiKey'],
  validateConfig: () => ({ valid: true }),
  parseWebhook: () => Promise.resolve({ shouldProcess: false }),
  postResponse: () => Promise.resolve({ success: true }),
}

if (!pluginHandlerRegistry.has(handlerType)) {
  pluginHandlerRegistry.register(handler)
}

describe('integration config encryption', () => {
  it('stores encrypted config and decrypts via service layer', async () => {
    const rawConfig = { apiKey: 'super-secret', label: 'test' }
    const encryptedConfig = encryptConfig(rawConfig, ['apiKey'])

    const pluginInstance = await seedPluginInstance({
      type: handlerType,
      config: JSON.stringify(encryptedConfig),
    })

    const db = getDb()
    const stored = await db
      .selectFrom('plugin_instances')
      .select(['config_json'])
      .where('id', '=', pluginInstance.id)
      .executeTakeFirstOrThrow()

    const parsed = JSON.parse(stored.config_json ?? '{}') as Record<string, string>
    expect(parsed.apiKey?.startsWith('enc:')).toBe(true)

    const decrypted = decryptConfig(parsed, ['apiKey'])
    expect(decrypted.apiKey).toBe('super-secret')

    const servicePluginInstance = await getPluginInstanceWithConfig(pluginInstance.id)
    const serviceConfig = JSON.parse(servicePluginInstance?.config ?? '{}') as Record<
      string,
      string
    >
    expect(serviceConfig.apiKey).toBe('super-secret')
  })
})
