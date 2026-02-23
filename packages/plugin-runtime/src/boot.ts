import type { HandlerRegistry, ProviderRegistry, BootResult, LoadResult } from './types'
import { PluginLoader } from './loader'
import { PluginInstaller } from './installer'
import { listPlugins, getPluginArtifact } from '@nitejar/database'
import { getCurrentPath, ensurePluginDirs, swapCurrentSymlink } from './fs-layout'
import { initHookSystem } from './hooks'
import { initCrashGuard } from './crash-guard'

export interface BootOptions {
  handlerRegistry: HandlerRegistry
  providerRegistry?: ProviderRegistry | null
  /** Override trust mode for testing. Defaults to SLOPBOT_PLUGIN_TRUST_MODE env. */
  trustMode?: string
  /** Override event budget for hook dispatch (ms). */
  hookEventBudgetMs?: number
  /** Override crash guard threshold. */
  crashThreshold?: number
  /** Override crash guard window (ms). */
  crashWindowMs?: number
}

type PluginTrustMode = 'self_host_open' | 'self_host_guarded' | 'saas_locked'

function resolvePluginTrustModeFromEnv(): PluginTrustMode {
  const raw = process.env.SLOPBOT_PLUGIN_TRUST_MODE
  if (raw === 'self_host_open' || raw === 'self_host_guarded' || raw === 'saas_locked') {
    return raw
  }
  return 'self_host_guarded'
}

/**
 * Boot all enabled non-builtin plugins.
 *
 * 1. Check trust mode — if saas_locked, skip all third-party plugins.
 * 2. Query DB for enabled plugins.
 * 3. For each non-builtin: hydrate cache from DB if needed, then load.
 * 4. Return boot results.
 *
 * Called from instrumentation.ts at server startup.
 */
export async function bootPlugins(options: BootOptions): Promise<BootResult> {
  const loader = new PluginLoader(options.handlerRegistry, options.providerRegistry ?? null)
  const installer = new PluginInstaller()
  const result: BootResult = { loaded: [], skipped: [], errors: [] }

  // Initialize hook system and crash guard singletons
  initHookSystem(options.hookEventBudgetMs)
  initCrashGuard({
    threshold: options.crashThreshold,
    windowMs: options.crashWindowMs,
  })

  // 1. Check trust mode
  const trustMode = (options.trustMode ?? resolvePluginTrustModeFromEnv()) as PluginTrustMode
  if (trustMode === 'saas_locked') {
    return result
  }

  // 2. Query DB for all enabled plugins
  let plugins: Awaited<ReturnType<typeof listPlugins>>
  try {
    plugins = await listPlugins()
  } catch {
    // If DB query fails (e.g., no tables yet), return empty result
    return result
  }

  const enabledNonBuiltin = plugins.filter((p) => p.enabled === 1 && p.source_kind !== 'builtin')

  // 3. For each plugin: hydrate cache if needed, then load
  for (const plugin of enabledNonBuiltin) {
    try {
      await hydratePluginCache(plugin, installer)
      const loadResult = await loader.loadPlugin(plugin)
      if (loadResult.success) {
        result.loaded.push(loadResult)
      } else {
        result.errors.push(loadResult)
      }
    } catch (err) {
      const errorResult: LoadResult = {
        pluginId: plugin.id,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      }
      result.errors.push(errorResult)
    }
  }

  return result
}

/**
 * Ensure a plugin's files exist on disk (warm cache).
 * If the current symlink doesn't resolve, attempt to hydrate from the DB artifact.
 */
async function hydratePluginCache(
  plugin: {
    id: string
    current_version: string | null
    source_kind: string
    manifest_json: string
  },
  installer: PluginInstaller
): Promise<void> {
  // Already on disk?
  const currentPath = await getCurrentPath(plugin.id)
  if (currentPath) return

  // No version to hydrate
  const version = plugin.current_version
  if (!version) return

  // Try to get artifact from DB
  const artifact = await getPluginArtifact(plugin.id, version)
  if (!artifact) {
    // For npm plugins we could re-fetch, but not for v1
    console.warn(
      `[plugin-runtime] No artifact found for plugin "${plugin.id}" v${version}, skipping cache hydration`
    )
    return
  }

  // Extract to cache
  const versionDir = await ensurePluginDirs(plugin.id, version)
  await installer.extractTgzToDir(artifact.tgz_blob, versionDir)
  await swapCurrentSymlink(plugin.id, version)
}
