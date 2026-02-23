import type { PluginExport } from './types'

export function definePlugin(pluginExport: PluginExport): PluginExport {
  const { handler, provider } = pluginExport

  if (!handler || typeof handler.type !== 'string' || handler.type.length === 0) {
    throw new Error('Plugin handler must have a non-empty "type" string')
  }
  if (typeof handler.validateConfig !== 'function') {
    throw new Error(`Plugin handler "${handler.type}" must implement validateConfig()`)
  }
  if (typeof handler.parseWebhook !== 'function') {
    throw new Error(`Plugin handler "${handler.type}" must implement parseWebhook()`)
  }
  if (typeof handler.postResponse !== 'function') {
    throw new Error(`Plugin handler "${handler.type}" must implement postResponse()`)
  }
  if (provider && provider.integrationType !== handler.type) {
    throw new Error(
      `Plugin provider integrationType "${provider.integrationType}" must match handler type "${handler.type}"`
    )
  }

  return pluginExport
}
