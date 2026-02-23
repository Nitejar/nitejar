import type { PluginExport, PluginProvider } from '@nitejar/plugin-sdk'
import type { IntegrationHandler } from '@nitejar/plugin-handlers'

export type { PluginExport, PluginProvider }

/**
 * Result of loading a single plugin.
 */
export interface LoadResult {
  pluginId: string
  success: boolean
  handlerType?: string
  error?: string
}

/**
 * Result of the boot sequence (loading all enabled plugins at startup).
 */
export interface BootResult {
  loaded: LoadResult[]
  skipped: string[]
  errors: LoadResult[]
}

/**
 * Result of installing a plugin from npm, tgz, or local path.
 */
export interface InstallResult {
  success: boolean
  pluginId: string
  version?: string
  installPath?: string
  error?: string
}

/**
 * Injection interface for the webhook handler registry.
 * Matches the shape of IntegrationRegistry from @nitejar/plugin-handlers.
 */
export interface HandlerRegistry {
  register(handler: IntegrationHandler): void
  unregister(type: string): boolean
  has(type: string): boolean
  get(type: string): IntegrationHandler | undefined
}

/**
 * Injection interface for the agent-side provider registry.
 * Matches the shape of providerRegistry from @nitejar/agent.
 */
export interface ProviderRegistry {
  register(provider: PluginProvider): void
  unregister(type: string): boolean
  has(type: string): boolean
}
