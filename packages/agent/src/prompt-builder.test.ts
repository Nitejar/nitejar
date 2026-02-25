import { describe, expect, it, vi, beforeEach } from 'vitest'
import { buildSystemPrompt, buildUserMessage } from './prompt-builder'
import type { Agent, WorkItem } from '@nitejar/database'
import * as Database from '@nitejar/database'
import * as Sprites from '@nitejar/sprites'
import type { IntegrationProvider, PromptSection } from './integrations/registry'

vi.mock('@nitejar/database', async () => {
  const actual = await vi.importActual<typeof Database>('@nitejar/database')
  return {
    ...actual,
    listAgentSandboxes: vi.fn(),
  }
})

vi.mock('@nitejar/sprites', async () => {
  const actual = await vi.importActual<typeof Sprites>('@nitejar/sprites')
  return {
    ...actual,
    getSpritesTokenSettings: vi.fn(),
    isSpritesExecutionAvailable: vi.fn(
      (settings: { enabled: boolean; token: string | null }) =>
        settings.enabled && Boolean(settings.token)
    ),
  }
})

const baseAgent: Agent = {
  id: 'agent-1',
  handle: 'agent',
  name: 'Agent One',
  sprite_id: null,
  config: JSON.stringify({ memorySettings: { enabled: false } }),
  status: 'idle',
  created_at: 0,
  updated_at: 0,
}

const baseWorkItem: WorkItem = {
  id: 'work-1',
  plugin_instance_id: null,
  session_key: 'session-1',
  source: 'telegram',
  source_ref: 'telegram:1:1',
  status: 'NEW',
  title: 'Hello',
  payload: JSON.stringify({ body: 'Hi there' }),
  created_at: 0,
  updated_at: 0,
}

const mockedListAgentSandboxes = vi.mocked(Database.listAgentSandboxes)
const mockedGetSpritesTokenSettings = vi.mocked(Sprites.getSpritesTokenSettings)
const mockedIsSpritesExecutionAvailable = vi.mocked(Sprites.isSpritesExecutionAvailable)

beforeEach(() => {
  mockedListAgentSandboxes.mockReset()
  mockedGetSpritesTokenSettings.mockReset()
  mockedIsSpritesExecutionAvailable.mockReset()
  mockedListAgentSandboxes.mockResolvedValue([])
  mockedGetSpritesTokenSettings.mockResolvedValue({
    enabled: true,
    token: 'test-token',
    source: 'capability_settings',
  })
  mockedIsSpritesExecutionAvailable.mockImplementation(
    (settings: { enabled: boolean; token: string | null }) =>
      settings.enabled && Boolean(settings.token)
  )
})

describe('buildUserMessage', () => {
  it('includes message thread metadata when present', () => {
    const workItem: WorkItem = {
      ...baseWorkItem,
      payload: JSON.stringify({
        body: 'Please check topic context',
        messageThreadId: 77,
      }),
    }

    const message = buildUserMessage(workItem)
    expect(message).toContain('message_thread_id: 77')
  })

  it('includes reply metadata when present', () => {
    const workItem: WorkItem = {
      ...baseWorkItem,
      payload: JSON.stringify({
        body: 'Please merge',
        replyToMessageId: 42,
        replyToMessageText: 'Ready to merge this?',
      }),
    }

    const message = buildUserMessage(workItem)
    expect(message).toContain('reply_to_message_id: 42')
    expect(message).toContain('reply_to_message_text: Ready to merge this?')
  })
})

describe('buildSystemPrompt', () => {
  it('injects filesystem conventions for deterministic workspace behavior', async () => {
    const prompt = await buildSystemPrompt(baseAgent, baseWorkItem)
    expect(prompt).toContain('TASK —')
    expect(prompt).toContain('FACT —')
    expect(prompt).toContain('add_memory')
    expect(prompt).toContain('permanent=true')
    expect(prompt).toContain('Things You Remember')
    expect(prompt).toContain('Memory is private per-agent')
    expect(prompt).toContain('Never imply that storing a memory updates other agents automatically')
    expect(prompt).toContain('Filesystem and workspace conventions')
    expect(prompt).toContain('/home/sprite')
    expect(prompt).toContain('/home/sprite/repos/<owner>/<repo>')
    expect(prompt).toContain('/tmp/nitejar/<task-name>')
    expect(prompt).toContain('/home/sprite/.nitejar')
    expect(prompt).toContain('exit code: 127')
    expect(prompt).toContain('command -v')
    expect(prompt).toContain('Do not pivot to a weaker/manual strategy')
  })

  it('injects provider sections when context providers are supplied', async () => {
    const mockProvider: IntegrationProvider = {
      integrationType: 'github',
      getSystemPromptSections(): Promise<PromptSection[]> {
        return Promise.resolve([
          { id: 'github:workflow', content: 'GitHub workflow rules: test content', priority: 10 },
          { id: 'github:repo-access', content: 'Repo access: test/repo', priority: 11 },
        ])
      },
    }

    const prompt = await buildSystemPrompt(baseAgent, baseWorkItem, {
      contextProviders: [mockProvider],
    })
    expect(prompt).toContain('GitHub workflow rules: test content')
    expect(prompt).toContain('Repo access: test/repo')
  })

  it('omits provider sections when no context providers are supplied', async () => {
    const prompt = await buildSystemPrompt(baseAgent, baseWorkItem)
    expect(prompt).not.toContain('GitHub workflow rules')
  })

  it('deduplicates sections by id (first writer wins)', async () => {
    const providerA: IntegrationProvider = {
      integrationType: 'a',
      getSystemPromptSections(): Promise<PromptSection[]> {
        return Promise.resolve([{ id: 'shared:section', content: 'from provider A', priority: 0 }])
      },
    }
    const providerB: IntegrationProvider = {
      integrationType: 'b',
      getSystemPromptSections(): Promise<PromptSection[]> {
        return Promise.resolve([{ id: 'shared:section', content: 'from provider B', priority: 0 }])
      },
    }

    const prompt = await buildSystemPrompt(baseAgent, baseWorkItem, {
      contextProviders: [providerA, providerB],
    })
    expect(prompt).toContain('from provider A')
    expect(prompt).not.toContain('from provider B')
  })

  it('sorts sections by priority', async () => {
    const mockProvider: IntegrationProvider = {
      integrationType: 'test',
      getSystemPromptSections(): Promise<PromptSection[]> {
        return Promise.resolve([
          { id: 'test:high', content: 'HIGH_PRIORITY_SECTION', priority: 100 },
          { id: 'test:low', content: 'LOW_PRIORITY_SECTION', priority: 1 },
        ])
      },
    }

    const prompt = await buildSystemPrompt(baseAgent, baseWorkItem, {
      contextProviders: [mockProvider],
    })
    const lowIdx = prompt.indexOf('LOW_PRIORITY_SECTION')
    const highIdx = prompt.indexOf('HIGH_PRIORITY_SECTION')
    expect(lowIdx).toBeLessThan(highIdx)
  })

  it('skips a provider that throws and includes sections from other providers', async () => {
    const failingProvider: IntegrationProvider = {
      integrationType: 'failing',
      getSystemPromptSections(): Promise<PromptSection[]> {
        return Promise.reject(new Error('provider exploded'))
      },
    }
    const goodProvider: IntegrationProvider = {
      integrationType: 'good',
      getSystemPromptSections(): Promise<PromptSection[]> {
        return Promise.resolve([{ id: 'good:section', content: 'GOOD_SECTION_CONTENT' }])
      },
    }

    const prompt = await buildSystemPrompt(baseAgent, baseWorkItem, {
      contextProviders: [failingProvider, goodProvider],
    })
    expect(prompt).toContain('GOOD_SECTION_CONTENT')
  })

  it('produces base prompt when no providers are given', async () => {
    const prompt = await buildSystemPrompt(baseAgent, baseWorkItem)
    // Base prompt always includes capabilities and memory sections
    expect(prompt).toContain('You are Agent One (@agent).')
    expect(prompt).toContain('Guidelines:')
    expect(prompt).toContain('Memory:')
  })

  it('includes sandbox catalog when agent has sandboxes', async () => {
    mockedListAgentSandboxes.mockResolvedValue([
      {
        id: 'sb-1',
        agent_id: 'agent-1',
        name: 'home',
        description: 'Persistent home sandbox',
        sprite_name: 'nitejar-agent',
        kind: 'home',
        created_by: 'system',
        created_at: 0,
        updated_at: 0,
        last_used_at: 0,
      },
    ])

    const prompt = await buildSystemPrompt(baseAgent, baseWorkItem)
    expect(prompt).toContain('Your sandboxes:')
    expect(prompt).toContain('home (home)')
    expect(prompt).toContain('switch_sandbox')
  })

  it('omits sandbox catalog when tool execution is disabled', async () => {
    mockedGetSpritesTokenSettings.mockResolvedValue({
      enabled: false,
      token: 'test-token',
      source: 'capability_settings',
    })
    mockedListAgentSandboxes.mockResolvedValue([
      {
        id: 'sb-1',
        agent_id: 'agent-1',
        name: 'home',
        description: 'Persistent home sandbox',
        sprite_name: 'nitejar-agent',
        kind: 'home',
        created_by: 'system',
        created_at: 0,
        updated_at: 0,
        last_used_at: 0,
      },
    ])

    const prompt = await buildSystemPrompt(baseAgent, baseWorkItem)
    expect(prompt).not.toContain('Your sandboxes:')
  })

  it('omits sandbox catalog when tool execution has no API key', async () => {
    mockedGetSpritesTokenSettings.mockResolvedValue({
      enabled: true,
      token: null,
      source: 'none',
    })
    mockedListAgentSandboxes.mockResolvedValue([
      {
        id: 'sb-1',
        agent_id: 'agent-1',
        name: 'home',
        description: 'Persistent home sandbox',
        sprite_name: 'nitejar-agent',
        kind: 'home',
        created_by: 'system',
        created_at: 0,
        updated_at: 0,
        last_used_at: 0,
      },
    ])

    const prompt = await buildSystemPrompt(baseAgent, baseWorkItem)
    expect(prompt).not.toContain('Your sandboxes:')
  })

  it('includes clear team routing guidance for single-owner requests and high-signal follow-ups', async () => {
    const prompt = await buildSystemPrompt(baseAgent, baseWorkItem, {
      teamContext: {
        teammates: [{ handle: 'pixel', name: 'Pixel', role: 'Designer', status: 'idle' }],
      },
    })

    expect(prompt).toContain('single agent and they already resolved it')
    expect(prompt).toContain('unique, high-signal information')
  })
})
