import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Agent, WorkItem } from '@nitejar/database'
import { __triageTest, triageWorkItem, type TriageContext } from './triage'
import * as ModelClient from './model-client'
import * as Config from './config'
import * as PromptBuilder from './prompt-builder'

vi.mock('./model-client', async () => {
  const actual = await vi.importActual<typeof ModelClient>('./model-client')
  return {
    ...actual,
    getClient: vi.fn(),
    withProviderRetry: vi.fn(),
  }
})

vi.mock('./config', async () => {
  const actual = await vi.importActual<typeof Config>('./config')
  return {
    ...actual,
    parseAgentConfig: vi.fn(),
  }
})

vi.mock('./prompt-builder', async () => {
  const actual = await vi.importActual<typeof PromptBuilder>('./prompt-builder')
  return {
    ...actual,
    getModelConfig: vi.fn(),
    buildUserMessage: vi.fn(),
    buildIssuePreamble: vi.fn(),
  }
})

const mockedGetClient = vi.mocked(ModelClient.getClient)
const mockedWithProviderRetry = vi.mocked(ModelClient.withProviderRetry)
const mockedParseAgentConfig = vi.mocked(Config.parseAgentConfig)
const mockedGetModelConfig = vi.mocked(PromptBuilder.getModelConfig)
const mockedBuildUserMessage = vi.mocked(PromptBuilder.buildUserMessage)
const mockedBuildIssuePreamble = vi.mocked(PromptBuilder.buildIssuePreamble)

const agent: Agent = {
  id: 'agent-1',
  name: 'TestBot',
  handle: 'testbot',
  status: 'active',
  config: '{}',
  sprite_id: null,
  created_at: 0,
  updated_at: 0,
}

const workItem: WorkItem = {
  id: 'wi-1',
  plugin_instance_id: null,
  session_key: 'sess-1',
  source: 'telegram',
  source_ref: 'msg:123',
  title: 'Hello bot',
  payload: '{}',
  status: 'pending',
  created_at: 0,
  updated_at: 0,
}

const {
  normalizeForDuplicateComparison,
  dedupeRecentHistory,
  extractExclusiveDispatchLine,
  mergeArbiterTranscriptContext,
  extractExclusiveClaim,
} = __triageTest

function makeTriageContext(overrides: Partial<TriageContext> = {}): TriageContext {
  return {
    agentName: 'TestBot',
    agentHandle: 'testbot',
    agentTitle: 'QA Engineer',
    recentHistory: null,
    ...overrides,
  }
}

describe('normalizeForDuplicateComparison', () => {
  it('strips User prefix and lowercases content', () => {
    expect(normalizeForDuplicateComparison('User: Hello There')).toBe('hello there')
  })

  it('strips You prefix case-insensitively', () => {
    expect(normalizeForDuplicateComparison('yOu: HELLO')).toBe('hello')
  })

  it('strips [@handle]: prefix', () => {
    expect(normalizeForDuplicateComparison('[@pixel]: hello')).toBe('hello')
  })

  it('strips bracketed label prefix', () => {
    expect(normalizeForDuplicateComparison('[🎨 Pixel] hello')).toBe('hello')
  })

  it('removes session-only lines and keeps remaining content', () => {
    expect(normalizeForDuplicateComparison('User: hi\n[session: telegram:123]\nYou: there')).toBe(
      'hi there'
    )
  })

  it('collapses whitespace and trims', () => {
    expect(normalizeForDuplicateComparison('  User:    hello \n\n   there   ')).toBe('hello there')
  })

  it('handles multiline input by joining non-empty lines', () => {
    expect(normalizeForDuplicateComparison('User: one\n\n[@pixel]: TWO\n[🎨 Pixel]  three')).toBe(
      'one two three'
    )
  })

  it('returns empty string for empty or whitespace-only input', () => {
    expect(normalizeForDuplicateComparison('')).toBe('')
    expect(normalizeForDuplicateComparison('   \n\t  ')).toBe('')
  })

  it('returns empty string for session-only input', () => {
    expect(normalizeForDuplicateComparison('[session: telegram:123]')).toBe('')
  })
})

describe('dedupeRecentHistory', () => {
  it('returns undefined when context is undefined', () => {
    expect(dedupeRecentHistory(undefined, 'hello')).toBeUndefined()
  })

  it('returns context unchanged when recentHistory is null', () => {
    const context = makeTriageContext({ recentHistory: null })
    expect(dedupeRecentHistory(context, 'hello')).toBe(context)
  })

  it('removes last trailing line when it matches user content', () => {
    const context = makeTriageContext({
      recentHistory: 'User: one\n[@pixel]: 4',
    })

    const result = dedupeRecentHistory(context, '[🎨 Pixel] 4')

    expect(result?.recentHistory).toBe('User: one')
  })

  it('removes multiple trailing duplicates', () => {
    const context = makeTriageContext({
      recentHistory: 'User: one\n[@pixel]: 4\n[🎨 Pixel] 4',
    })

    const result = dedupeRecentHistory(context, 'You: 4')

    expect(result?.recentHistory).toBe('User: one')
  })

  it('stops removing when a non-matching trailing line is hit', () => {
    const context = makeTriageContext({
      recentHistory: 'User: one\nYou: 4\nUser: done',
    })

    const result = dedupeRecentHistory(context, '4')

    expect(result?.recentHistory).toBe('User: one\nYou: 4\nUser: done')
  })

  it('does not remove non-trailing matches', () => {
    const context = makeTriageContext({
      recentHistory: 'You: 4\nUser: keep this',
    })

    const result = dedupeRecentHistory(context, '4')

    expect(result?.recentHistory).toBe('You: 4\nUser: keep this')
  })

  it('returns unchanged context when there is no trailing match', () => {
    const context = makeTriageContext({
      recentHistory: 'User: one\nUser: two',
    })

    const result = dedupeRecentHistory(context, 'User: three')

    expect(result?.recentHistory).toBe('User: one\nUser: two')
  })

  it('returns recentHistory=null when all lines are duplicates', () => {
    const context = makeTriageContext({
      recentHistory: '[@pixel]: 4\n[🎨 Pixel] 4',
    })

    const result = dedupeRecentHistory(context, 'You: 4')

    expect(result?.recentHistory).toBeNull()
  })

  it('matches across prefix differences', () => {
    const context = makeTriageContext({
      recentHistory: 'User: intro\n[@pixel]: 4',
    })

    const result = dedupeRecentHistory(context, '[🎨 Pixel] 4')

    expect(result?.recentHistory).toBe('User: intro')
  })

  it('matches case-insensitively', () => {
    const context = makeTriageContext({
      recentHistory: 'User: intro\nYou: HeLLo',
    })

    const result = dedupeRecentHistory(context, 'hello')

    expect(result?.recentHistory).toBe('User: intro')
  })
})

describe('extractExclusiveDispatchLine', () => {
  it('extracts exclusive responder line', () => {
    expect(
      extractExclusiveDispatchLine(
        '@a active\nExclusive responder volunteer for this work item: @pixel\n@b pending'
      )
    ).toBe('Exclusive responder volunteer for this work item: @pixel')
  })

  it('returns null when no matching line exists', () => {
    expect(extractExclusiveDispatchLine('@a active\n@b pending')).toBeNull()
  })

  it('returns null for undefined and empty values', () => {
    expect(extractExclusiveDispatchLine(undefined)).toBeNull()
    expect(extractExclusiveDispatchLine('')).toBeNull()
  })

  it('matches case-insensitively and trims extracted line', () => {
    expect(
      extractExclusiveDispatchLine(
        '  exclusive responder volunteer for this work item: @pixel (Pixel)   \n@b pending'
      )
    ).toBe('exclusive responder volunteer for this work item: @pixel (Pixel)')
  })
})

describe('mergeArbiterTranscriptContext', () => {
  it('appends synthetic dispatch line to existing history', () => {
    expect(
      mergeArbiterTranscriptContext(
        'User: hello',
        'Exclusive responder volunteer for this work item: @pixel'
      )
    ).toBe(
      'User: hello\nSystem: [dispatch] Exclusive responder volunteer for this work item: @pixel'
    )
  })

  it('returns synthetic line when recentHistory is null', () => {
    expect(
      mergeArbiterTranscriptContext(
        null,
        'Exclusive responder volunteer for this work item: @pixel'
      )
    ).toBe('System: [dispatch] Exclusive responder volunteer for this work item: @pixel')
  })

  it('returns recentHistory unchanged when no exclusive line exists', () => {
    expect(mergeArbiterTranscriptContext('User: hello', '@pixel active')).toBe('User: hello')
  })

  it('does not duplicate synthetic line if already present', () => {
    const existing =
      'User: hello\nSystem: [dispatch] Exclusive responder volunteer for this work item: @pixel'
    expect(
      mergeArbiterTranscriptContext(
        existing,
        'Exclusive responder volunteer for this work item: @pixel'
      )
    ).toBe(existing)
  })

  it('returns null when no recentHistory and no exclusive line', () => {
    expect(mergeArbiterTranscriptContext(null, '@pixel active')).toBeNull()
  })

  it('treats whitespace-only recentHistory as null', () => {
    expect(
      mergeArbiterTranscriptContext(
        '   \n\t',
        'Exclusive responder volunteer for this work item: @pixel'
      )
    ).toBe('System: [dispatch] Exclusive responder volunteer for this work item: @pixel')
  })
})

describe('extractExclusiveClaim', () => {
  it('returns true for supported exclusive key variants', () => {
    expect(extractExclusiveClaim({ exclusive: true })).toBe(true)
    expect(extractExclusiveClaim({ exclusive_claim: true })).toBe(true)
    expect(extractExclusiveClaim({ exclusiveClaim: true })).toBe(true)
    expect(extractExclusiveClaim({ volunteer_exclusive: true })).toBe(true)
  })

  it('returns false for false, missing, null, or non-boolean values', () => {
    expect(extractExclusiveClaim({ exclusive: false })).toBe(false)
    expect(extractExclusiveClaim({})).toBe(false)
    expect(extractExclusiveClaim(null)).toBe(false)
    expect(extractExclusiveClaim({ exclusive: 'true' })).toBe(false)
  })
})

describe('triageWorkItem', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockedGetClient.mockResolvedValue({} as never)
    mockedParseAgentConfig.mockReturnValue({} as never)
    mockedGetModelConfig.mockReturnValue({
      model: 'test-model',
      temperature: 0,
      maxTokens: 4096,
    } as never)
    mockedBuildUserMessage.mockReturnValue('Hello bot')
    mockedBuildIssuePreamble.mockReturnValue(null)
  })

  it('parses a valid JSON triage response', async () => {
    mockedWithProviderRetry.mockResolvedValue({
      choices: [
        {
          message: {
            content:
              '{"readonly": false, "respond": true, "reason": "Will help with greeting", "resources": []}',
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
      model: 'test-model',
    } as never)

    const result = await triageWorkItem(agent, workItem)

    expect(result.isReadOnly).toBe(false)
    expect(result.shouldRespond).toBe(true)
    expect(result.reason).toBe('Will help with greeting')
    expect(result.reasonAutoDerived).toBe(false)
    expect(result.resources).toEqual([])
    expect(result.usage).toBeTruthy()
    expect(result.usage!.model).toBe('test-model')
  })

  it('parses triage response with resources', async () => {
    mockedWithProviderRetry.mockResolvedValue({
      choices: [
        {
          message: {
            content:
              '{"readonly": true, "respond": true, "reason": "Read PR", "resources": ["github:owner/repo/pulls/1"]}',
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
      model: 'test-model',
    } as never)

    const result = await triageWorkItem(agent, workItem)

    expect(result.isReadOnly).toBe(true)
    expect(result.resources).toEqual(['github:owner/repo/pulls/1'])
  })

  it('handles respond: false with reason', async () => {
    mockedWithProviderRetry.mockResolvedValue({
      choices: [
        {
          message: {
            content:
              '{"readonly": true, "respond": false, "reason": "Not my area", "resources": []}',
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
      model: 'test-model',
    } as never)

    const result = await triageWorkItem(agent, workItem)

    expect(result.shouldRespond).toBe(false)
    expect(result.reason).toBe('Not my area')
    expect(result.reasonAutoDerived).toBe(false)
  })

  it('handles markdown-fenced JSON', async () => {
    mockedWithProviderRetry.mockResolvedValue({
      choices: [
        {
          message: {
            content:
              '```json\n{"readonly": false, "respond": true, "reason": "fixing bug", "resources": []}\n```',
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
      model: 'test-model',
    } as never)

    const result = await triageWorkItem(agent, workItem)

    expect(result.isReadOnly).toBe(false)
    expect(result.reason).toBe('fixing bug')
  })

  it('handles empty response content', async () => {
    mockedWithProviderRetry.mockResolvedValue({
      choices: [{ message: { content: '' } }],
      usage: null,
      model: 'test-model',
    } as never)

    const result = await triageWorkItem(agent, workItem)

    expect(result.isReadOnly).toBe(true)
    expect(result.shouldRespond).toBe(false)
    expect(result.reason).toBe('Passing: triage response was empty.')
    expect(result.reasonAutoDerived).toBe(true)
    expect(result.usage).toBeNull()
  })

  it('handles unparseable freeform text (fail closed)', async () => {
    mockedWithProviderRetry.mockResolvedValue({
      choices: [
        {
          message: {
            content: 'I am not JSON, just some random text from a confused model',
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
      model: 'test-model',
    } as never)

    const result = await triageWorkItem(agent, workItem)

    expect(result.isReadOnly).toBe(true)
    expect(result.shouldRespond).toBe(false)
    expect(result.reason).toBe('Passing: triage response was invalid JSON.')
    expect(result.reasonAutoDerived).toBe(true)
  })

  it('requires explicit reason when respond=true', async () => {
    mockedWithProviderRetry.mockResolvedValue({
      choices: [
        {
          message: {
            content: '{"readonly": false, "respond": true, "reason": "   ", "resources": []}',
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
      model: 'test-model',
    } as never)

    const result = await triageWorkItem(agent, workItem)
    expect(result.shouldRespond).toBe(false)
    expect(result.reason).toBe('Passing: triage response did not provide an explicit reason.')
    expect(result.reasonAutoDerived).toBe(true)
  })

  it('fails closed on API error', async () => {
    mockedWithProviderRetry.mockRejectedValue(new Error('API down'))

    const result = await triageWorkItem(agent, workItem)

    expect(result.isReadOnly).toBe(true)
    expect(result.shouldRespond).toBe(false)
    expect(result.reason).toBe('Passing: triage failed before classification.')
    expect(result.reasonAutoDerived).toBe(true)
    expect(result.usage).toBeNull()
  })

  it('includes triage context in system prompt', async () => {
    mockedWithProviderRetry.mockResolvedValue({
      choices: [
        {
          message: {
            content: '{"readonly": true, "respond": true, "reason": "ok", "resources": []}',
          },
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 10 },
      model: 'test-model',
    } as never)

    const ctx: TriageContext = {
      agentName: 'TestBot',
      agentHandle: 'testbot',
      agentTitle: 'QA Engineer',
      recentHistory: 'user: hello\nassistant: hi',
      teamContext: 'scout is reviewing PR #5',
    }

    await triageWorkItem(agent, workItem, undefined, ctx)

    // Verify withProviderRetry was called (the system prompt is constructed internally)
    expect(mockedWithProviderRetry).toHaveBeenCalledOnce()
  })

  it('injects Slack app mention context into arbiter system prompt', async () => {
    const createCompletion = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            content: '{"readonly": true, "respond": true, "reason": "ok", "resources": []}',
          },
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 10 },
      model: 'test-model',
    })
    mockedGetClient.mockResolvedValue({
      chat: {
        completions: {
          create: createCompletion,
        },
      },
    } as never)
    mockedWithProviderRetry.mockImplementation((call) => call() as never)

    const slackWorkItem: WorkItem = {
      ...workItem,
      source: 'slack',
      payload: JSON.stringify({
        body: '@nitejardev pixel are you there?',
        source: 'slack',
        slackBotMentioned: true,
        slackBotHandle: 'nitejardev',
      }),
    }

    await triageWorkItem(agent, slackWorkItem, '@nitejardev pixel are you there?')

    const triageRequest = createCompletion.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>
    }
    const systemPrompt = triageRequest.messages[0]?.content ?? ''
    expect(systemPrompt).toContain('<ingress_context>')
    expect(systemPrompt).toContain('Slack ingress context:')
    expect(systemPrompt).toContain('@nitejardev')
    expect(systemPrompt).toContain('</ingress_context>')
  })

  it('uses coalescedText when provided instead of buildUserMessage', async () => {
    const createCompletion = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            content: '{"readonly": true, "respond": true, "reason": "ok", "resources": []}',
          },
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 10 },
      model: 'test-model',
    })
    mockedGetClient.mockResolvedValue({
      chat: {
        completions: {
          create: createCompletion,
        },
      },
    } as never)
    mockedWithProviderRetry.mockImplementation((call) => call() as never)

    await triageWorkItem(agent, workItem, 'coalesced inbound message')

    expect(mockedBuildUserMessage).not.toHaveBeenCalled()
    const triageRequest = createCompletion.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>
    }
    const userPrompt = triageRequest.messages[1]?.content ?? ''
    expect(userPrompt).toContain('coalesced inbound message')
    expect(userPrompt).toContain('[session: sess-1]')
  })

  it('falls back to buildUserMessage when coalescedText is undefined', async () => {
    const createCompletion = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            content: '{"readonly": true, "respond": true, "reason": "ok", "resources": []}',
          },
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 10 },
      model: 'test-model',
    })
    mockedGetClient.mockResolvedValue({
      chat: {
        completions: {
          create: createCompletion,
        },
      },
    } as never)
    mockedWithProviderRetry.mockImplementation((call) => call() as never)
    mockedBuildUserMessage.mockReturnValue('built user message')

    await triageWorkItem(agent, workItem)

    expect(mockedBuildUserMessage).toHaveBeenCalledWith(workItem)
    const triageRequest = createCompletion.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>
    }
    const userPrompt = triageRequest.messages[1]?.content ?? ''
    expect(userPrompt).toContain('built user message')
  })

  it('prepends issue preamble to user prompt when available', async () => {
    const createCompletion = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            content: '{"readonly": true, "respond": true, "reason": "ok", "resources": []}',
          },
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 10 },
      model: 'test-model',
    })
    mockedGetClient.mockResolvedValue({
      chat: {
        completions: {
          create: createCompletion,
        },
      },
    } as never)
    mockedWithProviderRetry.mockImplementation((call) => call() as never)
    mockedBuildIssuePreamble.mockReturnValue({ content: 'Issue preamble context' } as never)
    const githubWorkItem: WorkItem = { ...workItem, source: 'github' }

    await triageWorkItem(agent, githubWorkItem, 'coalesced body')

    const triageRequest = createCompletion.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>
    }
    const userPrompt = triageRequest.messages[1]?.content ?? ''
    expect(userPrompt).toContain('Issue preamble context\n\n---\n\ncoalesced body')
    expect(mockedBuildIssuePreamble).toHaveBeenCalledWith(githubWorkItem)
  })

  it('appends session_key context hint to user prompt', async () => {
    const createCompletion = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            content: '{"readonly": true, "respond": true, "reason": "ok", "resources": []}',
          },
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 10 },
      model: 'test-model',
    })
    mockedGetClient.mockResolvedValue({
      chat: {
        completions: {
          create: createCompletion,
        },
      },
    } as never)
    mockedWithProviderRetry.mockImplementation((call) => call() as never)
    const keyedWorkItem: WorkItem = { ...workItem, session_key: 'telegram:123' }

    await triageWorkItem(agent, keyedWorkItem, 'hello')

    const triageRequest = createCompletion.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>
    }
    const userPrompt = triageRequest.messages[1]?.content ?? ''
    expect(userPrompt).toContain('hello\n[session: telegram:123]')
  })

  it('triage context overrides agent identity fields in arbiter prompt', async () => {
    const createCompletion = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            content: '{"readonly": true, "respond": true, "reason": "ok", "resources": []}',
          },
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 10 },
      model: 'test-model',
    })
    mockedGetClient.mockResolvedValue({
      chat: {
        completions: {
          create: createCompletion,
        },
      },
    } as never)
    mockedWithProviderRetry.mockImplementation((call) => call() as never)

    await triageWorkItem(agent, workItem, 'hello', {
      agentName: 'Override Name',
      agentHandle: 'override-handle',
      agentTitle: 'Override Title',
      recentHistory: null,
    })

    const triageRequest = createCompletion.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>
    }
    const systemPrompt = triageRequest.messages[0]?.content ?? ''
    expect(systemPrompt).toContain(
      'You are a runtime routing arbiter for Override Name (Override Title).'
    )
    expect(systemPrompt).toContain('Target agent handle: @override-handle.')
  })

  it('passes active work snapshot through to arbiter context', async () => {
    const createCompletion = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            content: '{"readonly": true, "respond": true, "reason": "ok", "resources": []}',
          },
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 10 },
      model: 'test-model',
    })
    mockedGetClient.mockResolvedValue({
      chat: {
        completions: {
          create: createCompletion,
        },
      },
    } as never)
    mockedWithProviderRetry.mockImplementation((call) => call() as never)

    await triageWorkItem(agent, workItem, 'hello', {
      agentName: 'TestBot',
      agentHandle: 'testbot',
      agentTitle: 'QA Engineer',
      recentHistory: null,
      activeWorkSnapshot: 'wi-2: in_progress @github',
    })

    const triageRequest = createCompletion.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>
    }
    const systemPrompt = triageRequest.messages[0]?.content ?? ''
    expect(systemPrompt).toContain('<target_active_work>')
    expect(systemPrompt).toContain('wi-2: in_progress @github')
    expect(systemPrompt).toContain('</target_active_work>')
  })

  it('frames triage as routing and includes collaboration continuity rules', async () => {
    const createCompletion = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            content: '{"readonly": true, "respond": true, "reason": "ok", "resources": []}',
          },
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 10 },
      model: 'test-model',
    })

    mockedGetClient.mockResolvedValue({
      chat: {
        completions: {
          create: createCompletion,
        },
      },
    } as never)

    mockedWithProviderRetry.mockImplementation((call) => call() as never)

    const ctx: TriageContext = {
      agentName: 'Slopper',
      agentHandle: 'nitejar-dev',
      agentTitle: 'Senior Engineer',
      recentHistory: 'User: count together\nYou: 1 — @pixel continue with 2',
    }

    await triageWorkItem(agent, workItem, '[🎨 Pixel] 2', ctx)

    const triageRequest = createCompletion.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>
    }
    const systemPrompt = triageRequest.messages[0]?.content ?? ''

    expect(systemPrompt).toContain(
      'You are a runtime routing arbiter for Slopper (Senior Engineer).'
    )
    expect(systemPrompt).toContain(
      'You are not writing a user-visible reply. You only classify routing for this target agent.'
    )
    expect(systemPrompt).toContain(
      'Decision question: should the target agent respond to THIS incoming message immediately, or wait/pass for now?'
    )
    expect(systemPrompt).toContain(
      'Multiple agents can respond at once and may produce duplicate answers.'
    )
    expect(systemPrompt).toContain(
      'To prevent multiple agent replies for this work item turn, use exclusive access:'
    )
    expect(systemPrompt).toContain(
      'Ongoing shared exchanges (counting, brainstorming, turn-by-turn collaboration) are relevant even without a fresh @mention.'
    )
    expect(systemPrompt).toContain(
      'If the latest message is a direct continuation of the target agent\'s recent turn or baton handoff, set route="respond".'
    )
    expect(systemPrompt).toContain(
      'If team/dispatch context states a different agent is the exclusive responder for this work item, set route="pass" unless direct user override exists.'
    )
    expect(systemPrompt).toContain(
      'After that exclusive responder posts, re-evaluate on the next incoming turn; do not treat exclusivity as permanent.'
    )
    expect(systemPrompt).toContain(
      'When route="respond" and this target agent should be sole responder for this work item, include "exclusive": true. Otherwise include "exclusive": false.'
    )
    expect(systemPrompt).toContain('<recent_conversation>')
    expect(systemPrompt).toContain('</recent_conversation>')
    expect(systemPrompt).toContain('"exclusive"?: boolean')
  })

  it('escapes faux-XML tag text inside recent conversation payload', async () => {
    const createCompletion = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            content: '{"readonly": true, "respond": true, "reason": "ok", "resources": []}',
          },
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 10 },
      model: 'test-model',
    })

    mockedGetClient.mockResolvedValue({
      chat: {
        completions: {
          create: createCompletion,
        },
      },
    } as never)

    mockedWithProviderRetry.mockImplementation((call) => call() as never)

    const ctx: TriageContext = {
      agentName: 'Pixel',
      agentHandle: 'pixel',
      agentTitle: 'Designer',
      recentHistory: 'User: literal <recent_conversation> marker in text',
    }

    await triageWorkItem(agent, workItem, 'hello', ctx)

    const triageRequest = createCompletion.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>
    }
    const systemPrompt = triageRequest.messages[0]?.content ?? ''

    expect(systemPrompt).toContain('<recent_conversation>')
    expect(systemPrompt).toContain('</recent_conversation>')
    expect(systemPrompt).toContain('User: literal &lt;recent_conversation&gt; marker in text')
    expect(systemPrompt).not.toContain('User: literal <recent_conversation> marker in text')
  })

  it('mirrors exclusive dispatch signal into arbiter recent_conversation context', async () => {
    const createCompletion = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            content: '{"readonly": true, "respond": false, "reason": "waiting", "resources": []}',
          },
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 10 },
      model: 'test-model',
    })

    mockedGetClient.mockResolvedValue({
      chat: {
        completions: {
          create: createCompletion,
        },
      },
    } as never)

    mockedWithProviderRetry.mockImplementation((call) => call() as never)

    const ctx: TriageContext = {
      agentName: 'Pixel',
      agentHandle: 'pixel',
      agentTitle: 'Designer',
      recentHistory: 'User: continue count',
      teamContext:
        '@nitejar-dev (Slopper) — active\nExclusive responder volunteer for this work item: @nitejar-dev (Slopper).',
    }

    await triageWorkItem(agent, workItem, '[🫠 Slopper] 5', ctx)

    const triageRequest = createCompletion.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>
    }
    const systemPrompt = triageRequest.messages[0]?.content ?? ''

    expect(systemPrompt).toContain('<recent_conversation>')
    expect(systemPrompt).toContain(
      'System: [dispatch] Exclusive responder volunteer for this work item: @nitejar-dev (Slopper).'
    )
  })

  it('captures OpenRouter cost from usage', async () => {
    mockedWithProviderRetry.mockResolvedValue({
      choices: [
        {
          message: {
            content: '{"readonly": false, "respond": true, "reason": "ok", "resources": []}',
          },
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 50, cost: 0.0025 },
      model: 'test-model',
    } as never)

    const result = await triageWorkItem(agent, workItem)

    expect(result.usage!.costUsd).toBe(0.0025)
    expect(result.usage!.promptTokens).toBe(100)
    expect(result.usage!.completionTokens).toBe(50)
    expect(result.usage!.totalTokens).toBe(150)
  })

  it('dedupes trailing recent-history line that matches current inbound message', async () => {
    const createCompletion = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            content: '{"readonly": true, "respond": true, "reason": "ok", "resources": []}',
          },
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 10 },
      model: 'test-model',
    })

    mockedGetClient.mockResolvedValue({
      chat: {
        completions: {
          create: createCompletion,
        },
      },
    } as never)

    mockedWithProviderRetry.mockImplementation((call) => call() as never)

    const ctx: TriageContext = {
      agentName: 'Slopper',
      agentHandle: 'nitejar-dev',
      agentTitle: 'Senior Engineer',
      recentHistory:
        "User: y'all, count to 10 together.\nYou: 3 — @pixel, continue with 4.\n[@pixel]: 4",
    }

    await triageWorkItem(agent, workItem, '[🎨 Pixel] 4', ctx)

    const triageRequest = createCompletion.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>
    }
    const systemPrompt = triageRequest.messages[0]?.content ?? ''

    expect(systemPrompt).toContain('You: 3 — @pixel, continue with 4.')
    expect(systemPrompt).not.toContain('[@pixel]: 4')
  })

  it('captures exclusive volunteer signal from arbiter JSON', async () => {
    mockedWithProviderRetry.mockResolvedValue({
      choices: [
        {
          message: {
            content:
              '{"route":"respond","readonly":false,"reason":"I should take this one solo.","resources":[],"exclusive":true}',
          },
        },
      ],
      usage: { prompt_tokens: 9, completion_tokens: 4 },
      model: 'test-model',
    } as never)

    const result = await triageWorkItem(agent, workItem)

    expect(result.shouldRespond).toBe(true)
    expect(result.exclusiveClaim).toBe(true)
  })

  it('forces exclusiveClaim=false when route is pass even if exclusive is true', async () => {
    mockedWithProviderRetry.mockResolvedValue({
      choices: [
        {
          message: {
            content:
              '{"route":"pass","readonly":true,"reason":"Waiting for another agent","resources":[],"exclusive":true}',
          },
        },
      ],
      usage: { prompt_tokens: 9, completion_tokens: 4 },
      model: 'test-model',
    } as never)

    const result = await triageWorkItem(agent, workItem)

    expect(result.shouldRespond).toBe(false)
    expect(result.exclusiveClaim).toBe(false)
  })

  it.each(['exclusive_claim', 'exclusiveClaim', 'volunteer_exclusive'] as const)(
    'captures exclusive volunteer signal from %s key',
    async (exclusiveKey) => {
      mockedWithProviderRetry.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                route: 'respond',
                readonly: false,
                reason: 'taking this turn',
                resources: [],
                [exclusiveKey]: true,
              }),
            },
          },
        ],
        usage: { prompt_tokens: 9, completion_tokens: 4 },
        model: 'test-model',
      } as never)

      const result = await triageWorkItem(agent, workItem)

      expect(result.shouldRespond).toBe(true)
      expect(result.exclusiveClaim).toBe(true)
    }
  )
})
