import { beforeEach, describe, expect, it } from 'vitest'
import type { Agent, WorkItem } from '@nitejar/database'
import {
  registerIntegrationProvider,
  resolveIntegrationProviders,
  getProviderForSource,
  extractIntegrationTools,
  collectPromptSections,
  CriticalContextError,
  _resetRegistryForTest,
  type IntegrationProvider,
  type PromptSection,
} from './registry'

// Import real providers so they self-register (exactly as runner.ts does)
import './github'
import './telegram'
import './discord'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseAgent: Agent = {
  id: 'agent-1',
  handle: 'agent',
  name: 'Agent One',
  sprite_id: null,
  config: JSON.stringify({}),
  status: 'idle',
  created_at: 0,
  updated_at: 0,
}

const telegramWorkItem: WorkItem = {
  id: 'wi-1',
  plugin_instance_id: 'int-1',
  session_key: 'telegram:123',
  source: 'telegram',
  source_ref: 'telegram:123:456',
  status: 'NEW',
  title: 'Hello',
  payload: JSON.stringify({ body: 'Hi there' }),
  created_at: 0,
  updated_at: 0,
}

const githubWorkItem: WorkItem = {
  id: 'wi-2',
  plugin_instance_id: 'int-2',
  session_key: 'github:owner/repo#issue:42',
  source: 'github',
  source_ref: 'owner/repo#issue:42',
  status: 'NEW',
  title: 'Fix bug',
  payload: JSON.stringify({
    issueTitle: 'Fix the widget',
    issueNumber: 42,
    issueState: 'open',
    issueUrl: 'https://github.com/owner/repo/issues/42',
    issueBody: 'The widget is broken.',
    owner: 'owner',
    repo: 'repo',
  }),
  created_at: 0,
  updated_at: 0,
}

// ---------------------------------------------------------------------------
// Registry core functions (isolated — uses _resetRegistryForTest)
// ---------------------------------------------------------------------------

describe('registry core', () => {
  // We need a fresh registry for these tests. Save and restore the real
  // providers around the isolated block so subsequent describes still work.
  let savedProviders: IntegrationProvider[]

  beforeEach(() => {
    // Snapshot all currently registered providers
    savedProviders = resolveIntegrationProviders(['telegram', 'github', 'discord'])
    _resetRegistryForTest()
  })

  // Re-register real providers after each test so the global state is restored
  // for the "real provider" tests below. Wrap in afterEach to ensure it runs
  // even if a test throws.
  const restoreProviders = () => {
    _resetRegistryForTest()
    for (const p of savedProviders) {
      registerIntegrationProvider(p)
    }
  }

  it('registerIntegrationProvider throws on duplicate integrationType', () => {
    registerIntegrationProvider({ integrationType: 'dup' })
    expect(() => registerIntegrationProvider({ integrationType: 'dup' })).toThrow(
      /already registered for type "dup"/
    )
    restoreProviders()
  })

  it('resolveIntegrationProviders returns matching providers in order', () => {
    registerIntegrationProvider({ integrationType: 'a' })
    registerIntegrationProvider({ integrationType: 'b' })
    registerIntegrationProvider({ integrationType: 'c' })

    const resolved = resolveIntegrationProviders(['c', 'a'])
    expect(resolved.map((p) => p.integrationType)).toEqual(['c', 'a'])
    restoreProviders()
  })

  it('resolveIntegrationProviders skips unregistered types', () => {
    registerIntegrationProvider({ integrationType: 'x' })
    const resolved = resolveIntegrationProviders(['x', 'missing'])
    expect(resolved).toHaveLength(1)
    expect(resolved[0]!.integrationType).toBe('x')
    restoreProviders()
  })

  it('getProviderForSource returns the registered provider', () => {
    registerIntegrationProvider({ integrationType: 'src' })
    expect(getProviderForSource('src')?.integrationType).toBe('src')
    restoreProviders()
  })

  it('getProviderForSource returns undefined for null', () => {
    expect(getProviderForSource(null)).toBeUndefined()
    restoreProviders()
  })

  it('getProviderForSource returns undefined for unknown source', () => {
    expect(getProviderForSource('nope')).toBeUndefined()
    restoreProviders()
  })

  it('extractIntegrationTools merges tools from multiple providers', () => {
    const p1: IntegrationProvider = {
      integrationType: 'p1',
      toolDefinitions: [
        { name: 'tool_a', description: 'a', input_schema: { type: 'object' as const } },
      ],
      toolHandlers: { tool_a: () => Promise.resolve({ success: true, output: 'a' }) },
    }
    const p2: IntegrationProvider = {
      integrationType: 'p2',
      toolDefinitions: [
        { name: 'tool_b', description: 'b', input_schema: { type: 'object' as const } },
      ],
      toolHandlers: { tool_b: () => Promise.resolve({ success: true, output: 'b' }) },
    }

    const result = extractIntegrationTools([p1, p2])
    expect(result.definitions.map((d) => d.name)).toEqual(['tool_a', 'tool_b'])
    expect(result.handlers['tool_a']).toBeTypeOf('function')
    expect(result.handlers['tool_b']).toBeTypeOf('function')
    restoreProviders()
  })

  it('extractIntegrationTools returns empty for context-only providers', () => {
    const contextOnly: IntegrationProvider = {
      integrationType: 'ctx',
      getSystemPromptSections() {
        return Promise.resolve([{ id: 'ctx:section', content: 'hello' }])
      },
    }

    const result = extractIntegrationTools([contextOnly])
    expect(result.definitions).toHaveLength(0)
    expect(Object.keys(result.handlers)).toHaveLength(0)
    restoreProviders()
  })

  it('_resetRegistryForTest clears all providers', () => {
    registerIntegrationProvider({ integrationType: 'temp' })
    expect(getProviderForSource('temp')).toBeDefined()
    _resetRegistryForTest()
    expect(getProviderForSource('temp')).toBeUndefined()
    restoreProviders()
  })
})

// ---------------------------------------------------------------------------
// collectPromptSections
// ---------------------------------------------------------------------------

describe('collectPromptSections', () => {
  it('deduplicates by id (first writer wins)', () => {
    const sections: PromptSection[] = [
      { id: 'dup', content: 'first' },
      { id: 'dup', content: 'second' },
      { id: 'unique', content: 'only' },
    ]
    const result = collectPromptSections(sections)
    expect(result).toHaveLength(2)
    expect(result[0]!.content).toBe('first')
    expect(result[1]!.content).toBe('only')
  })

  it('sorts by priority ascending', () => {
    const sections: PromptSection[] = [
      { id: 'c', content: 'C', priority: 30 },
      { id: 'a', content: 'A', priority: 10 },
      { id: 'b', content: 'B', priority: 20 },
    ]
    const result = collectPromptSections(sections)
    expect(result.map((s) => s.id)).toEqual(['a', 'b', 'c'])
  })

  it('defaults priority to 0', () => {
    const sections: PromptSection[] = [
      { id: 'explicit', content: 'E', priority: 5 },
      { id: 'default', content: 'D' },
    ]
    const result = collectPromptSections(sections)
    // default (0) sorts before explicit (5)
    expect(result[0]!.id).toBe('default')
    expect(result[1]!.id).toBe('explicit')
  })

  it('returns empty array for empty input', () => {
    expect(collectPromptSections([])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// CriticalContextError
// ---------------------------------------------------------------------------

describe('CriticalContextError', () => {
  it('has name CriticalContextError', () => {
    const err = new CriticalContextError('boom')
    expect(err.name).toBe('CriticalContextError')
  })

  it('has critical = true', () => {
    const err = new CriticalContextError('boom')
    expect(err.critical).toBe(true)
  })

  it('is an instance of Error', () => {
    const err = new CriticalContextError('boom')
    expect(err).toBeInstanceOf(Error)
  })

  it('preserves the message', () => {
    const err = new CriticalContextError('something broke')
    expect(err.message).toBe('something broke')
  })
})

// ---------------------------------------------------------------------------
// Real providers — Telegram
// ---------------------------------------------------------------------------

describe('telegram provider', () => {
  it('is registered and resolvable', () => {
    const [provider] = resolveIntegrationProviders(['telegram'])
    expect(provider).toBeDefined()
    expect(provider!.integrationType).toBe('telegram')
  })

  it('contributes 4 tool definitions with matching handlers', () => {
    const [provider] = resolveIntegrationProviders(['telegram'])
    expect(provider!.toolDefinitions).toHaveLength(4)
    const names = provider!.toolDefinitions!.map((d) => d.name)
    expect(names).toContain('send_telegram_message')
    expect(names).toContain('list_telegram_threads')
    expect(names).toContain('read_telegram_thread')
    expect(names).toContain('send_file')

    for (const def of provider!.toolDefinitions!) {
      expect(provider!.toolHandlers![def.name]).toBeTypeOf('function')
    }
  })

  it('contributes a platform system prompt section', async () => {
    const [provider] = resolveIntegrationProviders(['telegram'])
    const sections = await provider!.getSystemPromptSections!(baseAgent, telegramWorkItem)
    expect(sections).toHaveLength(1)
    expect(sections[0]!.id).toBe('telegram:platform')
    expect(sections[0]!.content).toContain('Platform: Telegram')
    expect(sections[0]!.priority).toBe(5)
  })

  it('does not contribute preamble or directory hint', () => {
    const [provider] = resolveIntegrationProviders(['telegram'])
    expect('getPreambleMessage' in provider!).toBe(false)
    expect('getPreambleLabel' in provider!).toBe(false)
    expect('getDirectoryContextHint' in provider!).toBe(false)
  })

  it('is returned by getProviderForSource("telegram")', () => {
    const provider = getProviderForSource('telegram')
    expect(provider).toBeDefined()
    expect(provider!.integrationType).toBe('telegram')
  })
})

// ---------------------------------------------------------------------------
// Real providers — GitHub
// ---------------------------------------------------------------------------

describe('github provider', () => {
  it('is registered and resolvable', () => {
    const [provider] = resolveIntegrationProviders(['github'])
    expect(provider).toBeDefined()
    expect(provider!.integrationType).toBe('github')
  })

  it('has no tool definitions or handlers', () => {
    const [provider] = resolveIntegrationProviders(['github'])
    expect(provider!.toolDefinitions).toBeUndefined()
    expect(provider!.toolHandlers).toBeUndefined()
  })

  it('contributes workflow and platform system prompt sections', async () => {
    const [provider] = resolveIntegrationProviders(['github'])
    const sections = await provider!.getSystemPromptSections!(baseAgent, githubWorkItem)
    const ids = sections.map((s) => s.id)
    expect(ids).toContain('github:workflow')
    expect(ids).toContain('github:platform')
  })

  it('github:workflow section contains workflow rules', async () => {
    const [provider] = resolveIntegrationProviders(['github'])
    const sections = await provider!.getSystemPromptSections!(baseAgent, githubWorkItem)
    const workflow = sections.find((s) => s.id === 'github:workflow')!
    expect(workflow.content).toContain('GitHub workflow rules')
    expect(workflow.content).toContain('configure_github_credentials')
    expect(workflow.priority).toBe(10)
  })

  it('github:platform section contains platform formatting', async () => {
    const [provider] = resolveIntegrationProviders(['github'])
    const sections = await provider!.getSystemPromptSections!(baseAgent, githubWorkItem)
    const platform = sections.find((s) => s.id === 'github:platform')!
    expect(platform.content).toContain('Platform: GitHub')
    expect(platform.priority).toBe(5)
  })

  it('contributes a preamble message for issue work items', () => {
    const [provider] = resolveIntegrationProviders(['github'])
    const preamble = provider!.getPreambleMessage!(githubWorkItem)
    expect(preamble).not.toBeNull()
    expect(preamble!.role).toBe('user')
    expect(preamble!.content).toContain('#42')
    expect(preamble!.content).toContain('Fix the widget')
  })

  it('returns null preamble for work items with no payload', () => {
    const [provider] = resolveIntegrationProviders(['github'])
    const emptyWi: WorkItem = {
      ...githubWorkItem,
      payload: null,
    }
    const preamble = provider!.getPreambleMessage!(emptyWi)
    expect(preamble).toBeNull()
  })

  it('contributes a preamble label', () => {
    const [provider] = resolveIntegrationProviders(['github'])
    const label = provider!.getPreambleLabel!(githubWorkItem)
    expect(label).toContain('Issue')
    expect(label).toContain('#42')
    expect(label).toContain('Fix the widget')
  })

  it('contributes a directory context hint from payload owner/repo', () => {
    const [provider] = resolveIntegrationProviders(['github'])
    const hint = provider!.getDirectoryContextHint!(githubWorkItem)
    expect(hint).toBe('/home/sprite/repos/owner/repo')
  })

  it('falls back to source_ref for directory hint when payload has no owner/repo', () => {
    const [provider] = resolveIntegrationProviders(['github'])
    const wi: WorkItem = {
      ...githubWorkItem,
      payload: JSON.stringify({ issueTitle: 'test' }),
      source_ref: 'acme/widgets#issue:7',
    }
    const hint = provider!.getDirectoryContextHint!(wi)
    expect(hint).toBe('/home/sprite/repos/acme/widgets')
  })

  it('is returned by getProviderForSource("github")', () => {
    const provider = getProviderForSource('github')
    expect(provider).toBeDefined()
    expect(provider!.integrationType).toBe('github')
  })
})

// ---------------------------------------------------------------------------
// Real providers — Discord
// ---------------------------------------------------------------------------

describe('discord provider', () => {
  it('is registered and resolvable', () => {
    const [provider] = resolveIntegrationProviders(['discord'])
    expect(provider).toBeDefined()
    expect(provider!.integrationType).toBe('discord')
  })

  it('contributes two tool definitions with matching handlers', () => {
    const [provider] = resolveIntegrationProviders(['discord'])
    expect(provider!.toolDefinitions).toHaveLength(2)
    const names = provider!.toolDefinitions!.map((d) => d.name)
    expect(names).toContain('send_discord_message')
    expect(names).toContain('read_discord_channel')

    for (const def of provider!.toolDefinitions!) {
      expect(provider!.toolHandlers![def.name]).toBeTypeOf('function')
    }
  })

  it('contributes a platform system prompt section', async () => {
    const [provider] = resolveIntegrationProviders(['discord'])
    const sections = await provider!.getSystemPromptSections!(baseAgent, telegramWorkItem)
    expect(sections).toHaveLength(1)
    expect(sections[0]!.id).toBe('discord:platform')
    expect(sections[0]!.content).toContain('Platform: Discord')
    expect(sections[0]!.priority).toBe(5)
  })

  it('is returned by getProviderForSource("discord")', () => {
    const provider = getProviderForSource('discord')
    expect(provider).toBeDefined()
    expect(provider!.integrationType).toBe('discord')
  })
})

// ---------------------------------------------------------------------------
// Combined behavior — both providers enabled
// ---------------------------------------------------------------------------

describe('combined providers', () => {
  it('resolves both when both types are enabled', () => {
    const providers = resolveIntegrationProviders(['telegram', 'github'])
    expect(providers).toHaveLength(2)
    const types = providers.map((p) => p.integrationType)
    expect(types).toContain('telegram')
    expect(types).toContain('github')
  })

  it('extractIntegrationTools returns only Telegram tools (GitHub is context-only)', () => {
    const providers = resolveIntegrationProviders(['telegram', 'github'])
    const tools = extractIntegrationTools(providers)
    // All tools come from Telegram
    expect(tools.definitions).toHaveLength(4)
    const names = tools.definitions.map((d) => d.name)
    expect(names).toContain('send_telegram_message')
    expect(names).toContain('send_file')
    // Every definition has a handler
    for (const def of tools.definitions) {
      expect(tools.handlers[def.name]).toBeTypeOf('function')
    }
  })

  it('both providers contribute system prompt sections', async () => {
    const providers = resolveIntegrationProviders(['telegram', 'github'])

    const allSections: PromptSection[] = []
    for (const provider of providers) {
      if (provider.getSystemPromptSections) {
        const sections = await provider.getSystemPromptSections(baseAgent, githubWorkItem)
        allSections.push(...sections)
      }
    }

    const collected = collectPromptSections(allSections)
    const ids = collected.map((s) => s.id)
    expect(ids).toContain('telegram:platform')
    expect(ids).toContain('github:workflow')
    expect(ids).toContain('github:platform')
  })

  it('sections from both providers sort by priority', async () => {
    const providers = resolveIntegrationProviders(['telegram', 'github'])

    const allSections: PromptSection[] = []
    for (const provider of providers) {
      if (provider.getSystemPromptSections) {
        const sections = await provider.getSystemPromptSections(baseAgent, githubWorkItem)
        allSections.push(...sections)
      }
    }

    const collected = collectPromptSections(allSections)
    // telegram:platform (5) and github:platform (5) before github:workflow (10)
    const workflowIdx = collected.findIndex((s) => s.id === 'github:workflow')
    const platformIds = collected.filter((s) => s.priority === 5).map((s) => s.id)
    expect(platformIds.length).toBeGreaterThanOrEqual(2)
    // workflow (priority 10) should come after the platform sections (priority 5)
    for (const ps of collected.filter((s) => s.priority === 5)) {
      expect(collected.indexOf(ps)).toBeLessThan(workflowIdx)
    }
  })

  it('getProviderForSource distinguishes between integration types', () => {
    const tg = getProviderForSource('telegram')
    const gh = getProviderForSource('github')
    expect(tg!.integrationType).toBe('telegram')
    expect(gh!.integrationType).toBe('github')
    expect(getProviderForSource('linear')).toBeUndefined()
  })
})
