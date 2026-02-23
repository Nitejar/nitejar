import type Anthropic from '@anthropic-ai/sdk'
import type OpenAI from 'openai'
import type { Agent, WorkItem } from '@nitejar/database'
import type { ToolHandler } from '../tools/types'

/**
 * A section contributed to the system prompt by an integration provider.
 */
export interface PromptSection {
  /** Stable identifier for dedup and ordering (e.g. "github:workflow", "telegram:platform"). */
  id: string
  /** The prompt text to inject. */
  content: string
  /** Lower values sort first. Default: 0. Sections with the same priority preserve insertion order. */
  priority?: number
}

/**
 * Error subclass that signals a critical, unrecoverable provider failure.
 * When a provider throws this, the runner surfaces the error rather than swallowing it.
 */
export class CriticalContextError extends Error {
  readonly critical = true as const
  constructor(message: string) {
    super(message)
    this.name = 'CriticalContextError'
  }
}

/**
 * A unified integration provider.
 * Each integration type (e.g. "github", "telegram") can register a single
 * provider that contributes both tools and context to agent runs.
 *
 * All fields beyond `integrationType` are optional. Providers self-register
 * at import time.
 */
export interface IntegrationProvider {
  integrationType: string

  // Tool contributions (optional)
  toolDefinitions?: Anthropic.Tool[]
  toolHandlers?: Record<string, ToolHandler>

  // Context contributions (all optional)
  getSystemPromptSections?(agent: Agent, workItem: WorkItem): Promise<PromptSection[]>
  getPreambleMessage?(workItem: WorkItem): OpenAI.ChatCompletionMessageParam | null
  getPreambleLabel?(workItem: WorkItem): string | null
  getDirectoryContextHint?(workItem: WorkItem): string | null
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const providers = new Map<string, IntegrationProvider>()

/**
 * Register an integration provider.
 * Called at import time by each provider module.
 * Throws immediately if a provider with the same integrationType is already registered.
 */
export function registerIntegrationProvider(provider: IntegrationProvider): void {
  if (providers.has(provider.integrationType)) {
    throw new Error(`IntegrationProvider already registered for type "${provider.integrationType}"`)
  }
  providers.set(provider.integrationType, provider)
}

/**
 * Unregister an integration provider by type.
 */
export function unregisterIntegrationProvider(type: string): boolean {
  return providers.delete(type)
}

export const providerRegistry = {
  register: registerIntegrationProvider,
  unregister: unregisterIntegrationProvider,
  has: (type: string) => providers.has(type),
}

/**
 * Resolve integration providers for a set of enabled integration types.
 * Returns all matching providers.
 */
export function resolveIntegrationProviders(enabledTypes: string[]): IntegrationProvider[] {
  const result: IntegrationProvider[] = []
  for (const type of enabledTypes) {
    const provider = providers.get(type)
    if (provider) result.push(provider)
  }
  return result
}

/**
 * Get the single provider matching a work item's source type.
 * Returns undefined if no provider is registered for that source.
 */
export function getProviderForSource(source: string | null): IntegrationProvider | undefined {
  if (!source) return undefined
  return providers.get(source)
}

/**
 * Extract tool definitions and handlers from a set of providers.
 * Returns merged definitions and handlers for all providers that contribute tools.
 */
export function extractIntegrationTools(providerList: IntegrationProvider[]): {
  definitions: Anthropic.Tool[]
  handlers: Record<string, ToolHandler>
} {
  const definitions: Anthropic.Tool[] = []
  const handlers: Record<string, ToolHandler> = {}

  for (const provider of providerList) {
    if (provider.toolDefinitions) {
      definitions.push(...provider.toolDefinitions)
    }
    if (provider.toolHandlers) {
      Object.assign(handlers, provider.toolHandlers)
    }
  }

  return { definitions, handlers }
}

/**
 * Collect, deduplicate, and sort prompt sections from multiple providers.
 * - Sections are deduped by `id` (first writer wins).
 * - Sorted by `priority` (ascending). Equal priority preserves insertion order.
 */
export function collectPromptSections(sections: PromptSection[]): PromptSection[] {
  const seen = new Set<string>()
  const deduped: PromptSection[] = []
  for (const section of sections) {
    if (seen.has(section.id)) continue
    seen.add(section.id)
    deduped.push(section)
  }
  // Stable sort by priority (default 0)
  return deduped.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Reset the registry. Only for use in tests. */
export function _resetRegistryForTest(): void {
  providers.clear()
}
