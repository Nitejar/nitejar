export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { ensureRuntimeWorkers } = await import('./server/services/runtime-workers')
    await ensureRuntimeWorkers()

    // Boot third-party plugins (load enabled non-builtin plugins from DB)
    try {
      const { bootPlugins } = await import('@nitejar/plugin-runtime')
      const { pluginHandlerRegistry } = await import('@nitejar/plugin-handlers')
      const { providerRegistry } = await import('@nitejar/agent/integrations/registry')
      const result = await bootPlugins({
        handlerRegistry: pluginHandlerRegistry,
        providerRegistry,
      })
      if (result.loaded.length > 0) {
        console.log(`[plugin-runtime] Booted ${result.loaded.length} plugin(s)`)
      }
      if (result.errors.length > 0) {
        console.warn(
          `[plugin-runtime] ${result.errors.length} plugin(s) failed to load:`,
          result.errors.map((e) => `${e.pluginId}: ${e.error}`).join(', ')
        )
      }
    } catch (err) {
      console.warn('[plugin-runtime] Plugin boot failed:', err)
    }
  }
}
