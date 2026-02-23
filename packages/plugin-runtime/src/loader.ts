import * as path from 'node:path'
import type { HandlerRegistry, ProviderRegistry, LoadResult } from './types'
import type { PluginExport } from '@nitejar/plugin-sdk'
import { validateNoPathTraversal, parseManifest } from './validation'
import { updatePlugin, createPluginEvent } from '@nitejar/database'
import { getHookRegistry, type HookName, HOOK_NAMES } from './hooks'
import { getCrashGuard } from './crash-guard'

/** Handler types that are built into the platform and cannot be overridden by plugins. */
const BUILTIN_TYPES = new Set(['telegram', 'github'])

interface PluginRow {
  id: string
  manifest_json: string
  current_install_path: string | null
  source_kind: string
}

/**
 * Dynamically loads plugin entry modules and registers their handlers.
 * Uses dependency injection for registries to keep the loader testable.
 */
export class PluginLoader {
  constructor(
    private handlerRegistry: HandlerRegistry,
    private providerRegistry: ProviderRegistry | null
  ) {}

  /**
   * Load a plugin from disk and register its handler (and optionally its provider).
   *
   * On success: registers handler, updates DB with last_loaded_at, creates 'load' event.
   * On failure: updates DB with last_load_error, creates error event. Does NOT throw.
   */
  async loadPlugin(pluginRow: PluginRow): Promise<LoadResult> {
    const { id: pluginId } = pluginRow
    try {
      // Skip builtins — they're statically imported
      if (pluginRow.source_kind === 'builtin') {
        return { pluginId, success: true, handlerType: pluginId.replace('builtin.', '') }
      }

      // Parse manifest
      const manifest = parseManifest(pluginRow.manifest_json)
      if (!manifest) {
        throw new Error('Invalid manifest JSON')
      }

      // Must have an entry point for non-builtins
      if (!manifest.entry) {
        throw new Error('Manifest does not specify an entry point')
      }

      // Must have an install path
      if (!pluginRow.current_install_path) {
        throw new Error('Plugin has no install path')
      }

      // Resolve entry path
      const entryPath = path.resolve(pluginRow.current_install_path, manifest.entry)
      validateNoPathTraversal(entryPath, pluginRow.current_install_path)

      // Dynamic import
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      const pluginExport: PluginExport = (await import(/* webpackIgnore: true */ entryPath)).default

      // Validate shape
      if (!pluginExport?.handler) {
        throw new Error('Plugin module does not default-export an object with a "handler" property')
      }

      const { handler, provider } = pluginExport
      const handlerType = handler.type

      if (!handlerType || typeof handlerType !== 'string') {
        throw new Error('Plugin handler.type must be a non-empty string')
      }

      // Prevent overriding builtins
      if (BUILTIN_TYPES.has(handlerType)) {
        throw new Error(
          `Cannot register handler type "${handlerType}" — it conflicts with a builtin plugin`
        )
      }

      // Check required methods
      if (typeof handler.validateConfig !== 'function') {
        throw new Error(`Handler "${handlerType}" is missing validateConfig()`)
      }
      if (typeof handler.parseWebhook !== 'function') {
        throw new Error(`Handler "${handlerType}" is missing parseWebhook()`)
      }
      if (typeof handler.postResponse !== 'function') {
        throw new Error(`Handler "${handlerType}" is missing postResponse()`)
      }

      // Unregister existing handler if present (for reloads), then register new one
      this.handlerRegistry.unregister(handlerType)
      this.handlerRegistry.register(handler)

      // Register provider if present
      if (provider && this.providerRegistry) {
        this.providerRegistry.unregister(handlerType)
        this.providerRegistry.register(provider)
      }

      // Register hooks if present
      const { hooks } = pluginExport
      if (hooks) {
        const hookRegistry = getHookRegistry()
        if (hookRegistry) {
          // Unregister any previous hooks for this plugin (e.g. on reload)
          hookRegistry.unregister(pluginId)

          for (const [hookName, hookHandler] of Object.entries(hooks)) {
            if (hookHandler && HOOK_NAMES.includes(hookName as HookName)) {
              hookRegistry.register({
                pluginId,
                hookName: hookName as HookName,
                handler: hookHandler,
                priority: 0,
                failPolicy: 'fail_open',
                timeoutMs: 1500,
              })
            }
          }
        }
      }

      // Update DB: mark as loaded
      await updatePlugin(pluginId, {
        last_loaded_at: Date.now(),
        last_load_error: null,
      }).catch(() => {}) // Non-fatal if DB update fails

      // Create audit event
      await createPluginEvent({
        plugin_id: pluginId,
        plugin_version: manifest.version,
        kind: 'load',
        status: 'ok',
        detail_json: JSON.stringify({ handlerType }),
      }).catch(() => {})

      return { pluginId, success: true, handlerType }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)

      // Record failure in crash guard
      const crashGuard = getCrashGuard()
      if (crashGuard) {
        crashGuard.recordFailure(pluginId)
      }

      // Update DB: record error
      await updatePlugin(pluginId, {
        last_load_error: errorMessage,
      }).catch(() => {})

      // Create error event
      await createPluginEvent({
        plugin_id: pluginId,
        kind: 'load',
        status: 'error',
        detail_json: JSON.stringify({ error: errorMessage }),
      }).catch(() => {})

      return { pluginId, success: false, error: errorMessage }
    }
  }

  /**
   * Unload a plugin: unregister its handler and provider.
   */
  async unloadPlugin(pluginId: string, handlerType: string): Promise<void> {
    this.handlerRegistry.unregister(handlerType)
    this.providerRegistry?.unregister(handlerType)

    // Unregister hooks for this plugin
    const hookRegistry = getHookRegistry()
    if (hookRegistry) {
      hookRegistry.unregister(pluginId)
    }

    await updatePlugin(pluginId, {
      last_loaded_at: null,
    }).catch(() => {})

    await createPluginEvent({
      plugin_id: pluginId,
      kind: 'unload',
      status: 'ok',
      detail_json: JSON.stringify({ handlerType }),
    }).catch(() => {})
  }
}
