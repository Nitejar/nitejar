import type { PluginHandler, PluginType } from './types'

/**
 * Registry of all plugin handlers
 */
class PluginHandlerRegistry {
  private handlers: Map<string, PluginHandler> = new Map()

  /**
   * Register a plugin handler
   */
  register(handler: PluginHandler): void {
    if (this.handlers.has(handler.type)) {
      throw new Error(`Plugin handler '${handler.type}' is already registered`)
    }
    this.handlers.set(handler.type, handler)
  }

  /**
   * Get a handler by plugin type
   */
  get(type: string): PluginHandler | undefined {
    return this.handlers.get(type)
  }

  /**
   * Get a handler by plugin type (throws if not found)
   */
  getOrThrow(type: string): PluginHandler {
    const handler = this.handlers.get(type)
    if (!handler) {
      throw new Error(`No plugin handler registered for type '${type}'`)
    }
    return handler
  }

  /**
   * Get all registered plugin types
   */
  getTypes(): PluginType[] {
    return Array.from(this.handlers.keys()) as PluginType[]
  }

  /**
   * Get all registered handlers
   */
  getAll(): PluginHandler[] {
    return Array.from(this.handlers.values())
  }

  /**
   * Unregister a handler by plugin type
   */
  unregister(type: string): boolean {
    return this.handlers.delete(type)
  }

  /**
   * Check if a handler exists for a type
   */
  has(type: string): boolean {
    return this.handlers.has(type)
  }
}

// Singleton instance
export const pluginHandlerRegistry = new PluginHandlerRegistry()

/** @deprecated Use pluginHandlerRegistry instead */
export const integrationRegistry = pluginHandlerRegistry

/**
 * Helper to register a handler
 */
export function registerPluginHandler(handler: PluginHandler): PluginHandler {
  pluginHandlerRegistry.register(handler)
  return handler
}

/** @deprecated Use registerPluginHandler instead */
export const registerIntegration = registerPluginHandler
