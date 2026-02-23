import { describe, it, expect } from 'vitest'
import { findIdempotencyKey, findPluginInstanceById } from '@nitejar/database'
import { seedIdempotencyKey, seedPluginInstance, seedWorkItem } from './helpers/seed'

describe('integration test smoke', () => {
  it('persists and retrieves records via repositories', async () => {
    const pluginInstance = await seedPluginInstance()
    const fetchedPluginInstance = await findPluginInstanceById(pluginInstance.id)

    expect(fetchedPluginInstance?.id).toBe(pluginInstance.id)

    const workItem = await seedWorkItem({ plugin_instance_id: pluginInstance.id })
    await seedIdempotencyKey('integration-smoke', workItem.id)

    const fetchedKey = await findIdempotencyKey('integration-smoke')
    expect(fetchedKey?.work_item_id).toBe(workItem.id)
  })
})
