import { describe, expect, it } from 'vitest'
import { toolDefinitions } from './tools/definitions'
import { toolHandlers } from './tools/handlers'
import {
  resolveIntegrationProviders,
  extractIntegrationTools,
  registerIntegrationProvider,
} from './integrations/registry'

// Import telegram provider so it registers itself
import './integrations/slack'
import './integrations/telegram'

describe('tool registry', () => {
  it('has unique tool definition names', () => {
    const names = toolDefinitions.map((tool) => tool.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('has handlers for all defined tools', () => {
    for (const definition of toolDefinitions) {
      expect(toolHandlers[definition.name], `missing handler for "${definition.name}"`).toBeTypeOf(
        'function'
      )
    }
  })

  it('has no handler without a definition (all handlers have matching definitions)', () => {
    const definitionNames = new Set(toolDefinitions.map((tool) => tool.name))
    const handlersWithoutDefinitions = Object.keys(toolHandlers).filter(
      (name) => !definitionNames.has(name)
    )
    expect(handlersWithoutDefinitions).toEqual([])
  })
})

describe('integration tool providers', () => {
  it('resolves telegram tools when telegram type is enabled', () => {
    const providers = resolveIntegrationProviders(['telegram'])
    const result = extractIntegrationTools(providers)
    const names = result.definitions.map((d) => d.name)

    expect(names).toContain('send_telegram_message')
    expect(names).toContain('list_telegram_threads')
    expect(names).toContain('read_telegram_thread')

    // Each definition has a matching handler
    for (const def of result.definitions) {
      expect(result.handlers[def.name]).toBeTypeOf('function')
    }
  })

  it('returns empty for unknown integration types', () => {
    const providers = resolveIntegrationProviders(['unknown_type'])
    const result = extractIntegrationTools(providers)
    expect(result.definitions).toHaveLength(0)
    expect(Object.keys(result.handlers)).toHaveLength(0)
  })

  it('returns empty when no types are enabled', () => {
    const providers = resolveIntegrationProviders([])
    const result = extractIntegrationTools(providers)
    expect(result.definitions).toHaveLength(0)
    expect(Object.keys(result.handlers)).toHaveLength(0)
  })

  it('integration tool names do not collide with base tool names', () => {
    const baseNames = new Set(toolDefinitions.map((t) => t.name))
    const providers = resolveIntegrationProviders(['telegram', 'slack'])
    const integrationResult = extractIntegrationTools(providers)
    for (const def of integrationResult.definitions) {
      expect(baseNames.has(def.name)).toBe(false)
    }
  })

  it('resolves slack tools when slack type is enabled', () => {
    const providers = resolveIntegrationProviders(['slack'])
    const result = extractIntegrationTools(providers)
    const names = result.definitions.map((d) => d.name)

    expect(names).toContain('slack_get_thread')
    expect(names).toContain('slack_get_channel_history')
    expect(names).toContain('slack_get_channel_info')
    expect(names).toContain('slack_list_channels')
    expect(names).toContain('slack_search_channel_messages')
    expect(names).toContain('slack_search_workspace_context')
    expect(names).toContain('slack_export_response')
  })

  it('supports registering and resolving a custom provider', () => {
    registerIntegrationProvider({
      integrationType: '__test_type__',
      toolDefinitions: [
        {
          name: '__test_tool__',
          description: 'test',
          input_schema: { type: 'object' as const, properties: {} },
        },
      ],
      toolHandlers: {
        __test_tool__: () => Promise.resolve({ success: true, output: 'ok' }),
      },
    })

    const providers = resolveIntegrationProviders(['__test_type__'])
    const result = extractIntegrationTools(providers)
    expect(result.definitions).toHaveLength(1)
    expect(result.definitions[0]!.name).toBe('__test_tool__')
    expect(result.handlers['__test_tool__']).toBeTypeOf('function')
  })
})
