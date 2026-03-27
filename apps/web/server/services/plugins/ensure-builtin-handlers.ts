let builtinHandlersReady: Promise<void> | null = null

export async function ensureBuiltinPluginHandlersLoaded(): Promise<void> {
  if (!builtinHandlersReady) {
    builtinHandlersReady = import('@nitejar/plugin-handlers').then(() => undefined)
  }
  await builtinHandlersReady
}
