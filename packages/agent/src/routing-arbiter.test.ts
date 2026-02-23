import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Agent } from '@nitejar/database'
import {
  __routingArbiterTest,
  runRoutingArbiter,
  type RunRoutingArbiterInput,
} from './routing-arbiter'
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
  }
})

const mockedGetClient = vi.mocked(ModelClient.getClient)
const mockedWithProviderRetry = vi.mocked(ModelClient.withProviderRetry)
const mockedParseAgentConfig = vi.mocked(Config.parseAgentConfig)
const mockedGetModelConfig = vi.mocked(PromptBuilder.getModelConfig)

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

function baseInput(overrides: Partial<RunRoutingArbiterInput> = {}): RunRoutingArbiterInput {
  return {
    mode: 'triage',
    agent,
    targetName: 'TestBot',
    targetHandle: 'testbot',
    targetTitle: 'QA Engineer',
    userPrompt: 'Please classify this incoming message.',
    recentHistory: null,
    teamContext: undefined,
    activeWorkSnapshot: undefined,
    rules: ['Always prioritize direct user asks.', 'Avoid duplicate responses.'],
    allowedRoutes: ['respond', 'pass', 'interrupt_now', 'do_not_interrupt', 'ignore'],
    defaultRoute: 'pass',
    defaultReason: 'Passing: routing arbiter default.',
    uncertaintyReason: 'Unclear ownership for this turn.',
    reasonMaxChars: 80,
    maxTokensDefault: 220,
    maxTokensCap: undefined,
    retryLabel: 'routing-arbiter',
    ...overrides,
  }
}

function setupClientWithResponse(response: unknown): {
  createCompletion: ReturnType<typeof vi.fn>
} {
  const createCompletion = vi.fn().mockResolvedValue(response)
  mockedGetClient.mockResolvedValue({
    chat: {
      completions: {
        create: createCompletion,
      },
    },
  } as never)
  return { createCompletion }
}

describe('stripMarkdownFence', () => {
  const { stripMarkdownFence } = __routingArbiterTest

  it('strips markdown fences with json prefix', () => {
    expect(stripMarkdownFence('```json\n{"route":"respond"}\n```')).toBe('{"route":"respond"}')
  })

  it('strips markdown fences without language tag', () => {
    expect(stripMarkdownFence('```\n{"route":"respond"}\n```')).toBe('{"route":"respond"}')
  })

  it('is case-insensitive for language tag', () => {
    expect(stripMarkdownFence('```JSON\n{"route":"respond"}\n```')).toBe('{"route":"respond"}')
  })

  it('is a no-op for plain text', () => {
    const value = '{"route":"respond"}'
    expect(stripMarkdownFence(value)).toBe(value)
  })

  it('handles whitespace around fences', () => {
    expect(stripMarkdownFence('  ```json\n{"route":"respond"}\n```  ')).toBe('{"route":"respond"}')
  })
})

describe('parseLooseJson', () => {
  const { parseLooseJson } = __routingArbiterTest

  it('parses a valid JSON object', () => {
    expect(parseLooseJson('{"route":"respond"}')).toEqual({ route: 'respond' })
  })

  it('parses JSON wrapped in markdown fences', () => {
    expect(parseLooseJson('```json\n{"route":"respond"}\n```')).toEqual({ route: 'respond' })
  })

  it('extracts JSON from prose', () => {
    expect(parseLooseJson('Here is my answer: {"route":"respond"} hope that helps')).toEqual({
      route: 'respond',
    })
  })

  it('returns null for completely invalid text', () => {
    expect(parseLooseJson('this is not json')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseLooseJson('')).toBeNull()
  })

  it('returns null for JSON array', () => {
    expect(parseLooseJson('["respond"]')).toBeNull()
  })

  it('handles nested braces inside strings', () => {
    expect(parseLooseJson('{"reason":"a { b } c"}')).toEqual({ reason: 'a { b } c' })
  })

  it('picks the first parseable object when multiple JSON objects are present', () => {
    expect(parseLooseJson('first {"route":"respond"} second {"route":"pass"}')).toEqual({
      route: 'respond',
    })
  })
})

describe('normalizeRouteLabel', () => {
  const { normalizeRouteLabel } = __routingArbiterTest

  it.each([
    ['respond', 'respond'],
    ['reply', 'respond'],
    ['act', 'respond'],
    ['handle', 'respond'],
    ['pass', 'pass'],
    ['defer', 'pass'],
    ['do_not_respond', 'pass'],
    ['do-not-respond', 'pass'],
    ['interrupt_now', 'interrupt_now'],
    ['inject_now', 'interrupt_now'],
    ['interrupt', 'interrupt_now'],
    ['steer', 'interrupt_now'],
    ['do_not_interrupt', 'do_not_interrupt'],
    ['queue', 'do_not_interrupt'],
    ['ignore', 'ignore'],
    ['drop', 'ignore'],
    ['skip', 'ignore'],
  ] as const)('normalizes %s -> %s', (raw, expected) => {
    expect(normalizeRouteLabel(raw)).toBe(expected)
  })

  it('returns null for unknown labels', () => {
    expect(normalizeRouteLabel('banana')).toBeNull()
    expect(normalizeRouteLabel('')).toBeNull()
    expect(normalizeRouteLabel('RESPOND_NOW')).toBeNull()
  })

  it('trims whitespace and is case-insensitive', () => {
    expect(normalizeRouteLabel('  respond  ')).toBe('respond')
    expect(normalizeRouteLabel('RESPOND')).toBe('respond')
    expect(normalizeRouteLabel('Pass')).toBe('pass')
  })
})

describe('coerceRouteFromParsed', () => {
  const { coerceRouteFromParsed } = __routingArbiterTest
  const allowed = ['respond', 'pass', 'interrupt_now', 'do_not_interrupt', 'ignore'] as const

  it('extracts route from parsed.route', () => {
    expect(coerceRouteFromParsed({ route: 'respond' }, [...allowed], 'pass')).toBe('respond')
  })

  it('extracts route from parsed.decision as fallback', () => {
    expect(coerceRouteFromParsed({ decision: 'respond' }, [...allowed], 'pass')).toBe('respond')
  })

  it('prefers parsed.route over parsed.decision', () => {
    expect(
      coerceRouteFromParsed({ route: 'pass', decision: 'respond' }, [...allowed], 'respond')
    ).toBe('pass')
  })

  it('normalizes route labels through normalizeRouteLabel', () => {
    expect(coerceRouteFromParsed({ route: 'reply' }, [...allowed], 'pass')).toBe('respond')
  })

  it('returns defaultRoute when normalized route is not allowed', () => {
    expect(
      coerceRouteFromParsed({ route: 'interrupt_now' }, ['respond', 'pass', 'ignore'], 'pass')
    ).toBe('pass')
  })

  it('falls back to parsed.respond when route/decision is missing', () => {
    expect(coerceRouteFromParsed({ respond: true }, [...allowed], 'pass')).toBe('respond')
    expect(coerceRouteFromParsed({ respond: false }, [...allowed], 'respond')).toBe('pass')
  })

  it('does not use parsed.respond when route/decision is present', () => {
    expect(coerceRouteFromParsed({ route: 'pass', respond: true }, [...allowed], 'respond')).toBe(
      'pass'
    )
  })

  it('returns defaultRoute when parsed.respond route is not allowed', () => {
    expect(coerceRouteFromParsed({ respond: true }, ['pass', 'ignore'], 'pass')).toBe('pass')
  })

  it('returns defaultRoute for empty parsed object', () => {
    expect(coerceRouteFromParsed({}, [...allowed], 'pass')).toBe('pass')
  })

  it('returns defaultRoute when route key is non-string', () => {
    expect(coerceRouteFromParsed({ route: 1 }, [...allowed], 'pass')).toBe('pass')
    expect(coerceRouteFromParsed({ route: null }, [...allowed], 'pass')).toBe('pass')
  })
})

describe('buildSystemPrompt', () => {
  const { buildSystemPrompt } = __routingArbiterTest

  it('includes target identity and handle lines', () => {
    const prompt = buildSystemPrompt(baseInput())

    expect(prompt).toContain('You are a runtime routing arbiter for TestBot (QA Engineer).')
    expect(prompt).toContain('Target agent handle: @testbot.')
  })

  it('omits handle line when targetHandle is not provided', () => {
    const prompt = buildSystemPrompt(baseInput({ targetHandle: undefined }))

    expect(prompt).not.toContain('Target agent handle:')
  })

  it('includes all rules and allowed routes schema', () => {
    const input = baseInput({
      rules: ['Rule one', 'Rule two'],
      allowedRoutes: ['respond', 'pass', 'interrupt_now'],
    })
    const prompt = buildSystemPrompt(input)

    expect(prompt).toContain('- Rule one')
    expect(prompt).toContain('- Rule two')
    expect(prompt).toContain('"respond" | "pass" | "interrupt_now"')
  })

  it('includes exclusive schema only in triage mode', () => {
    const triagePrompt = buildSystemPrompt(baseInput({ mode: 'triage' }))
    const steerPrompt = buildSystemPrompt(baseInput({ mode: 'steer' }))

    expect(triagePrompt).toContain('"exclusive"?: boolean')
    expect(steerPrompt).not.toContain('"exclusive"?: boolean')
  })

  it('includes recent conversation section only when provided', () => {
    const withHistory = buildSystemPrompt(baseInput({ recentHistory: 'User: hello' }))
    const withoutHistory = buildSystemPrompt(baseInput({ recentHistory: null }))

    expect(withHistory).toContain('<recent_conversation>')
    expect(withoutHistory).not.toContain('<recent_conversation>')
  })

  it('includes team context only when provided', () => {
    const withTeamContext = buildSystemPrompt(
      baseInput({ teamContext: 'dispatch says @pixel is active' })
    )
    const withoutTeamContext = buildSystemPrompt(baseInput({ teamContext: undefined }))

    expect(withTeamContext).toContain('<team_and_dispatch_context>')
    expect(withoutTeamContext).not.toContain('<team_and_dispatch_context>')
  })

  it('includes active work only when provided', () => {
    const withActive = buildSystemPrompt(baseInput({ activeWorkSnapshot: 'PR #12 in progress' }))
    const withoutActive = buildSystemPrompt(baseInput({ activeWorkSnapshot: undefined }))

    expect(withActive).toContain('<target_active_work>')
    expect(withoutActive).not.toContain('<target_active_work>')
  })

  it('includes triage framing only in triage mode', () => {
    const triagePrompt = buildSystemPrompt(baseInput({ mode: 'triage' }))
    const steerPrompt = buildSystemPrompt(baseInput({ mode: 'steer' }))

    expect(triagePrompt).toContain(
      'Decision question: should the target agent respond to THIS incoming message immediately, or wait/pass for now?'
    )
    expect(steerPrompt).not.toContain(
      'Decision question: should the target agent respond to THIS incoming message immediately, or wait/pass for now?'
    )
  })

  it('escapes xml in recentHistory, teamContext, and activeWorkSnapshot', () => {
    const prompt = buildSystemPrompt(
      baseInput({
        recentHistory: '<recent_conversation>hi & bye</recent_conversation>',
        teamContext: '<team_and_dispatch_context>route < pass</team_and_dispatch_context>',
        activeWorkSnapshot: '<target_active_work>fix & verify</target_active_work>',
      })
    )

    expect(prompt).toContain('&lt;recent_conversation&gt;hi &amp; bye&lt;/recent_conversation&gt;')
    expect(prompt).toContain(
      '&lt;team_and_dispatch_context&gt;route &lt; pass&lt;/team_and_dispatch_context&gt;'
    )
    expect(prompt).toContain(
      '&lt;target_active_work&gt;fix &amp; verify&lt;/target_active_work&gt;'
    )
  })
})

describe('parseRoutingResponse', () => {
  const { parseRoutingResponse } = __routingArbiterTest

  it('parses valid routing JSON', () => {
    const result = parseRoutingResponse(
      '{"route":"respond","reason":"Will handle this","resources":["pr:1"],"readonly":false}',
      baseInput()
    )

    expect(result).toBeTruthy()
    expect(result!.route).toBe('respond')
    expect(result!.reason).toBe('Will handle this')
    expect(result!.reasonAutoDerived).toBe(false)
    expect(result!.resources).toEqual(['pr:1'])
    expect(result!.readonly).toBe(false)
  })

  it('parses respond boolean form', () => {
    const result = parseRoutingResponse(
      '{"respond": true, "reason": "Ready", "readonly": true}',
      baseInput()
    )

    expect(result).toBeTruthy()
    expect(result!.route).toBe('respond')
    expect(result!.readonly).toBe(true)
  })

  it('returns null for unparseable or empty content', () => {
    expect(parseRoutingResponse('not json', baseInput())).toBeNull()
    expect(parseRoutingResponse('', baseInput())).toBeNull()
  })

  it('truncates reason to reasonMaxChars', () => {
    const result = parseRoutingResponse(
      '{"route":"respond","reason":"1234567890"}',
      baseInput({ reasonMaxChars: 5 })
    )

    expect(result!.reason).toBe('12345')
  })

  it('uses defaultReason and marks reasonAutoDerived when model reason is empty', () => {
    const result = parseRoutingResponse(
      '{"route":"respond","reason":"   "}',
      baseInput({ defaultReason: 'Fallback reason.' })
    )

    expect(result!.reason).toBe('Fallback reason.')
    expect(result!.reasonAutoDerived).toBe(true)
  })

  it('marks reasonAutoDerived=false when model provides reason', () => {
    const result = parseRoutingResponse('{"route":"respond","reason":"Specific"}', baseInput())

    expect(result!.reasonAutoDerived).toBe(false)
  })

  it('filters non-string resources and handles non-array resources', () => {
    const filtered = parseRoutingResponse(
      '{"route":"respond","reason":"ok","resources":["a",1,null,"b"]}',
      baseInput()
    )
    const empty = parseRoutingResponse(
      '{"route":"respond","reason":"ok","resources":"not-array"}',
      baseInput()
    )

    expect(filtered!.resources).toEqual(['a', 'b'])
    expect(empty!.resources).toEqual([])
  })

  it('coerces route synonyms and defaults unknown routes', () => {
    const synonym = parseRoutingResponse('{"route":"reply","reason":"ok"}', baseInput())
    const unknown = parseRoutingResponse('{"route":"banana","reason":"ok"}', baseInput())

    expect(synonym!.route).toBe('respond')
    expect(unknown!.route).toBe('pass')
  })

  it('sets readonly=true only when explicitly true', () => {
    const explicitTrue = parseRoutingResponse(
      '{"route":"respond","reason":"ok","readonly":true}',
      baseInput()
    )
    const truthyString = parseRoutingResponse(
      '{"route":"respond","reason":"ok","readonly":"true"}',
      baseInput()
    )

    expect(explicitTrue!.readonly).toBe(true)
    expect(truthyString!.readonly).toBe(false)
  })
})

describe('normalizeUsage', () => {
  const { normalizeUsage } = __routingArbiterTest

  it('extracts usage tokens and cost', () => {
    const usage = normalizeUsage(
      { prompt_tokens: 12, completion_tokens: 8, cost: 0.0003 } as never,
      'test-model',
      123
    )

    expect(usage.promptTokens).toBe(12)
    expect(usage.completionTokens).toBe(8)
    expect(usage.totalTokens).toBe(20)
    expect(usage.costUsd).toBe(0.0003)
    expect(usage.model).toBe('test-model')
    expect(usage.durationMs).toBe(123)
  })

  it('returns zero cost when usage cost is not numeric', () => {
    const usage = normalizeUsage(
      { prompt_tokens: 1, completion_tokens: 1, cost: '0.1' } as never,
      'test-model',
      50
    )

    expect(usage.costUsd).toBe(0)
  })

  it('handles undefined usage', () => {
    const usage = normalizeUsage(undefined, 'test-model', 77)

    expect(usage.promptTokens).toBe(0)
    expect(usage.completionTokens).toBe(0)
    expect(usage.totalTokens).toBe(0)
    expect(usage.costUsd).toBe(0)
    expect(usage.model).toBe('test-model')
    expect(usage.durationMs).toBe(77)
  })
})

describe('runRoutingArbiter', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockedParseAgentConfig.mockReturnValue({} as never)
    mockedGetModelConfig.mockReturnValue({
      model: 'test-model',
      temperature: 0,
      maxTokens: 4096,
    } as never)
    mockedWithProviderRetry.mockImplementation((call) => call() as never)
  })

  it('returns ok outcome with parsed route for valid model response', async () => {
    setupClientWithResponse({
      choices: [
        {
          message: {
            content:
              '{"route":"respond","reason":"I should answer","resources":["pr:1"],"readonly":false}',
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.0001 },
      model: 'test-model',
    })

    const result = await runRoutingArbiter(baseInput())

    expect(result.outcome).toBe('ok')
    expect(result.route).toBe('respond')
    expect(result.reason).toBe('I should answer')
    expect(result.reasonAutoDerived).toBe(false)
    expect(result.resources).toEqual(['pr:1'])
    expect(result.readonly).toBe(false)
    expect(result.usage).toBeTruthy()
    expect(result.usage!.promptTokens).toBe(10)
    expect(result.usage!.completionTokens).toBe(5)
    expect(result.usage!.totalTokens).toBe(15)
    expect(result.usage!.costUsd).toBe(0.0001)
  })

  it('returns default route/reason with reasonAutoDerived for failure outcomes', async () => {
    setupClientWithResponse({
      choices: [{ message: { content: '' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0.0001 },
      model: 'test-model',
    })
    const emptyResult = await runRoutingArbiter(baseInput())

    setupClientWithResponse({
      choices: [{ message: { content: 'not json' } }],
      usage: { prompt_tokens: 2, completion_tokens: 1, cost: 0.0001 },
      model: 'test-model',
    })
    const invalidResult = await runRoutingArbiter(baseInput())

    mockedWithProviderRetry.mockRejectedValueOnce(new Error('provider down'))
    mockedGetClient.mockResolvedValue({
      chat: {
        completions: {
          create: vi.fn(),
        },
      },
    } as never)
    const errorResult = await runRoutingArbiter(baseInput())

    for (const result of [emptyResult, invalidResult, errorResult]) {
      expect(result.route).toBe('pass')
      expect(result.reason).toBe('Passing: routing arbiter default.')
      expect(result.reasonAutoDerived).toBe(true)
    }

    expect(emptyResult.outcome).toBe('empty_response')
    expect(invalidResult.outcome).toBe('invalid_json')
    expect(errorResult.outcome).toBe('error')
    expect(emptyResult.usage).toBeTruthy()
    expect(invalidResult.usage).toBeTruthy()
    expect(errorResult.usage).toBeNull()
  })

  it('passes reasoning effort when configured', async () => {
    const { createCompletion } = setupClientWithResponse({
      choices: [{ message: { content: '{"route":"respond","reason":"ok"}' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
      model: 'test-model',
    })
    mockedParseAgentConfig.mockReturnValue({
      triageSettings: { reasoningEffort: 'high' },
    } as never)

    await runRoutingArbiter(baseInput())

    const request = createCompletion.mock.calls[0]?.[0] as { reasoning?: { effort: string } }
    expect(request.reasoning).toEqual({ effort: 'high' })
  })

  it('respects maxTokensCap and floors to 150 when capped lower', async () => {
    const { createCompletion } = setupClientWithResponse({
      choices: [{ message: { content: '{"route":"respond","reason":"ok"}' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
      model: 'test-model',
    })
    mockedParseAgentConfig.mockReturnValue({
      triageSettings: { maxTokens: 80 },
    } as never)

    await runRoutingArbiter(baseInput({ maxTokensCap: 90 }))

    const request = createCompletion.mock.calls[0]?.[0] as { max_tokens: number }
    expect(request.max_tokens).toBe(150)
  })

  it('uses triageSettings.maxTokens when configured', async () => {
    const { createCompletion } = setupClientWithResponse({
      choices: [{ message: { content: '{"route":"respond","reason":"ok"}' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
      model: 'test-model',
    })
    mockedParseAgentConfig.mockReturnValue({
      triageSettings: { maxTokens: 333 },
    } as never)

    await runRoutingArbiter(baseInput())

    const request = createCompletion.mock.calls[0]?.[0] as { max_tokens: number }
    expect(request.max_tokens).toBe(333)
  })

  it('falls back to input.maxTokensDefault when no triageSettings exist', async () => {
    const { createCompletion } = setupClientWithResponse({
      choices: [{ message: { content: '{"route":"respond","reason":"ok"}' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
      model: 'test-model',
    })
    mockedParseAgentConfig.mockReturnValue({} as never)

    await runRoutingArbiter(baseInput({ maxTokensDefault: 277 }))

    const request = createCompletion.mock.calls[0]?.[0] as { max_tokens: number }
    expect(request.max_tokens).toBe(277)
  })
})
