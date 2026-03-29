let builtinHandlersReady: Promise<void> | null = null

const builtinHandlerLoaders = {
  telegram: async () => {
    const [{ telegramHandler }, { pluginHandlerRegistry }] = await Promise.all([
      import('@nitejar/plugin-handlers/telegram'),
      import('@nitejar/plugin-handlers/registry'),
    ])
    if (!pluginHandlerRegistry.has(telegramHandler.type)) {
      pluginHandlerRegistry.register(telegramHandler)
    }
  },
  github: async () => {
    const [{ githubHandler }, { pluginHandlerRegistry }] = await Promise.all([
      import('@nitejar/plugin-handlers/github'),
      import('@nitejar/plugin-handlers/registry'),
    ])
    if (!pluginHandlerRegistry.has(githubHandler.type)) {
      pluginHandlerRegistry.register(githubHandler)
    }
  },
  discord: async () => {
    const [{ discordHandler }, { pluginHandlerRegistry }] = await Promise.all([
      import('@nitejar/plugin-handlers/discord'),
      import('@nitejar/plugin-handlers/registry'),
    ])
    if (!pluginHandlerRegistry.has(discordHandler.type)) {
      pluginHandlerRegistry.register(discordHandler)
    }
  },
  slack: async () => {
    const [{ slackHandler }, { pluginHandlerRegistry }] = await Promise.all([
      import('@nitejar/plugin-handlers/slack'),
      import('@nitejar/plugin-handlers/registry'),
    ])
    if (!pluginHandlerRegistry.has(slackHandler.type)) {
      pluginHandlerRegistry.register(slackHandler)
    }
  },
} satisfies Record<string, () => Promise<void>>

export async function ensurePluginHandlerLoaded(type: string): Promise<void> {
  const loadHandler = builtinHandlerLoaders[type as keyof typeof builtinHandlerLoaders]
  if (!loadHandler) {
    return
  }

  await loadHandler()
}

export async function ensureBuiltinPluginHandlersLoaded(): Promise<void> {
  if (!builtinHandlersReady) {
    builtinHandlersReady = import('@nitejar/plugin-handlers').then(() => undefined)
  }
  await builtinHandlersReady
}
