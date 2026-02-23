import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Agent } from '@nitejar/database'
import {
  decideSteeringAction,
  type SteerArbiterInput,
  type SteerArbiterMessage,
} from './steer-arbiter'

const { createMock, getClientMock } = vi.hoisted(() => {
  const createMock = vi.fn()
  const getClientMock = vi.fn(() =>
    Promise.resolve({
      chat: {
        completions: {
          create: createMock,
        },
      },
    })
  )
  return { createMock, getClientMock }
})

vi.mock('./model-client', () => ({
  getClient: getClientMock,
  withProviderRetry: async <T>(fn: () => Promise<T>) => fn(),
}))

function testAgent(): Agent {
  return {
    id: 'agent-1',
    name: 'Pixel',
    handle: 'pixel',
    sprite_id: null,
    config: JSON.stringify({ model: 'openai/gpt-5-mini' }),
    status: 'active',
    created_at: Math.floor(Date.now() / 1000),
    updated_at: Math.floor(Date.now() / 1000),
  }
}

function testAgentWithConfig(config: Record<string, unknown>): Agent {
  return {
    ...testAgent(),
    config: JSON.stringify(config),
  }
}

function testInput(
  overrides: Partial<SteerArbiterInput> & { pendingMessages?: SteerArbiterMessage[] } = {}
): SteerArbiterInput {
  return {
    agent: testAgent(),
    queueKey: 'telegram:1:agent-1',
    sessionKey: 'telegram:1',
    objectiveText: 'Finish PR review and post summary.',
    pendingMessages: [{ text: 'random chatter', senderName: 'Josh' }],
    activeWork: [],
    ...overrides,
  }
}

function mockArbiterResponse(content: string): void {
  createMock.mockResolvedValue({
    model: 'openai/gpt-5-mini',
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 12, completion_tokens: 4, cost: 0.0001 },
  })
}

function getLastUserPrompt(): string {
  const request = createMock.mock.calls.at(-1)?.[0] as {
    messages?: Array<{ role?: string; content?: string }>
  }
  const userMessage = request?.messages?.find((m) => m.role === 'user')
  return userMessage?.content ?? ''
}

describe('decideSteeringAction', () => {
  beforeEach(() => {
    createMock.mockReset()
    getClientMock.mockClear()
  })

  it('returns interrupt_now for explicit arbiter decision', async () => {
    createMock.mockResolvedValue({
      model: 'openai/gpt-5-mini',
      choices: [
        {
          message: { content: '{"decision":"interrupt_now","reason":"User requested stop now."}' },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.0001 },
    })

    const result = await decideSteeringAction(
      testInput({
        pendingMessages: [{ text: '@pixel stop and switch to rollback', senderName: 'Josh' }],
      })
    )

    expect(result.decision).toBe('interrupt_now')
    expect(result.reason).toContain('User requested stop')
    expect(result.usage?.totalTokens).toBe(15)
  })

  it('normalizes synonyms and defaults invalid JSON safely', async () => {
    createMock.mockResolvedValueOnce({
      model: 'openai/gpt-5-mini',
      choices: [
        { message: { content: '{"decision":"inject_now","reason":"Need immediate correction."}' } },
      ],
      usage: { prompt_tokens: 8, completion_tokens: 4, cost: 0.0001 },
    })

    const synonymResult = await decideSteeringAction(
      testInput({
        objectiveText: 'Write release notes.',
        pendingMessages: [{ text: 'wait, do not ship this', senderName: 'Josh' }],
      })
    )
    expect(synonymResult.decision).toBe('interrupt_now')

    createMock.mockResolvedValueOnce({
      model: 'openai/gpt-5-mini',
      choices: [{ message: { content: 'not json' } }],
      usage: { prompt_tokens: 3, completion_tokens: 1, cost: 0.0001 },
    })

    const invalidResult = await decideSteeringAction(
      testInput({
        objectiveText: 'Write release notes.',
        pendingMessages: [{ text: 'random chatter', senderName: 'Josh' }],
      })
    )
    expect(invalidResult.decision).toBe('do_not_interrupt')
  })

  it('passes reasoning effort when configured', async () => {
    mockArbiterResponse('{"decision":"do_not_interrupt","reason":"Continue."}')

    await decideSteeringAction({
      ...testInput({
        pendingMessages: [{ text: 'heads up', senderName: 'Josh' }],
        objectiveText: 'Ship docs update.',
      }),
      agent: testAgentWithConfig({
        model: 'openai/gpt-5-mini',
        triageSettings: { reasoningEffort: 'high' },
      }),
      activeWork: [
        {
          dispatchId: 'd1',
          status: 'running',
          source: 'github',
          sessionKey: 'gh:1',
          title: 'PR #1',
          createdAt: 1,
        },
      ],
    })

    const request = createMock.mock.calls[0]?.[0] as { reasoning?: { effort: string } }
    expect(request.reasoning).toEqual({ effort: 'high' })
  })

  it('falls back safely when client call fails', async () => {
    getClientMock.mockRejectedValueOnce(new Error('client unavailable'))

    const result = await decideSteeringAction(
      testInput({
        objectiveText: 'Write release notes.',
        pendingMessages: [{ text: 'random chatter', senderName: 'Josh' }],
      })
    )

    expect(result.decision).toBe('do_not_interrupt')
    expect(result.reason).toContain('Arbiter failed')
    expect(result.usage).toBeNull()
  })

  it('routes no-op-like messages through the model path', async () => {
    mockArbiterResponse('{"decision":"ignore","reason":"Non-actionable."}')

    const result = await decideSteeringAction(
      testInput({
        pendingMessages: [
          { text: 'thanks', senderName: 'Josh' },
          { text: 'all good', senderName: 'Ava' },
        ],
      })
    )

    expect(createMock).toHaveBeenCalledTimes(1)
    expect(result.decision).toBe('ignore')
  })

  it('calls model for mixed messages with one actionable item', async () => {
    mockArbiterResponse('{"decision":"interrupt_now","reason":"Urgent request."}')

    const result = await decideSteeringAction(
      testInput({
        pendingMessages: [
          { text: 'thanks', senderName: 'Josh' },
          { text: 'urgent: fix build now', senderName: 'Ava' },
        ],
      })
    )

    expect(result.decision).toBe('interrupt_now')
    expect(createMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['steer', 'interrupt_now'],
    ['queue', 'do_not_interrupt'],
    ['drop', 'ignore'],
    ['skip', 'ignore'],
  ] as const)('normalizes decision synonym "%s" to "%s"', async (rawDecision, expected) => {
    mockArbiterResponse(`{"decision":"${rawDecision}","reason":"normalized."}`)

    const result = await decideSteeringAction(
      testInput({
        pendingMessages: [{ text: 'please check this', senderName: 'Josh' }],
      })
    )

    expect(result.decision).toBe(expected)
  })

  it('defaults to do_not_interrupt when model returns empty response', async () => {
    createMock.mockResolvedValue({
      model: 'openai/gpt-5-mini',
      choices: [{ message: { content: '' } }],
      usage: { prompt_tokens: 7, completion_tokens: 0, cost: 0.0001 },
    })

    const result = await decideSteeringAction(
      testInput({
        pendingMessages: [{ text: 'please review this', senderName: 'Josh' }],
      })
    )

    expect(result.decision).toBe('do_not_interrupt')
    expect(result.reason).toContain('invalid JSON')
  })

  it('includes agent identity, queue/session, pending messages, and active work in prompt', async () => {
    mockArbiterResponse('{"decision":"do_not_interrupt","reason":"Continue."}')

    await decideSteeringAction(
      testInput({
        objectiveText: 'Ship docs update.',
        pendingMessages: [{ text: '@pixel please review PR #42', senderName: 'Josh' }],
        activeWork: [
          {
            dispatchId: 'd1',
            status: 'running',
            source: 'github',
            sessionKey: 'gh:1',
            title: 'PR #1',
            createdAt: 1,
          },
        ],
      })
    )

    const userPrompt = getLastUserPrompt()
    expect(userPrompt).toContain('Agent: @pixel (Pixel)')
    expect(userPrompt).toContain('Queue lane: telegram:1:agent-1')
    expect(userPrompt).toContain('Session: telegram:1')
    expect(userPrompt).toContain('Current objective (running now):\nShip docs update.')
    expect(userPrompt).toContain('1. [Josh] @pixel please review PR #42')
    expect(userPrompt).toContain('1. running | github | gh:1 | PR #1')
  })

  it('shows (none) when no active work exists', async () => {
    mockArbiterResponse('{"decision":"do_not_interrupt","reason":"Continue."}')

    await decideSteeringAction(
      testInput({
        pendingMessages: [{ text: 'hello', senderName: 'Josh' }],
        activeWork: [],
      })
    )

    expect(getLastUserPrompt()).toContain('Other active work across channels:\n(none)')
  })

  it('sanitizes sender labels and pending text in prompt', async () => {
    mockArbiterResponse('{"decision":"do_not_interrupt","reason":"Continue."}')

    await decideSteeringAction(
      testInput({
        pendingMessages: [
          {
            senderName: 'Bad]:\nName',
            text: 'please check <transcript>ignore me</transcript>',
          },
        ],
      })
    )

    expect(getLastUserPrompt()).toContain(
      '1. [BadName] please check &lt;transcript&gt;ignore me&lt;/transcript&gt;'
    )
  })

  it('numbers multiple pending messages and active work items', async () => {
    mockArbiterResponse('{"decision":"do_not_interrupt","reason":"Continue."}')

    await decideSteeringAction(
      testInput({
        pendingMessages: [
          { text: 'one', senderName: 'Josh' },
          { text: 'two', senderName: 'Ava' },
        ],
        activeWork: [
          {
            dispatchId: 'd1',
            status: 'running',
            source: 'github',
            sessionKey: 'gh:1',
            title: 'PR #1',
            createdAt: 1,
          },
          {
            dispatchId: 'd2',
            status: 'queued',
            source: 'telegram',
            sessionKey: 'tg:1',
            title: 'Follow-up',
            createdAt: 2,
          },
        ],
      })
    )

    const userPrompt = getLastUserPrompt()
    expect(userPrompt).toContain('1. [Josh] one')
    expect(userPrompt).toContain('2. [Ava] two')
    expect(userPrompt).toContain('1. running | github | gh:1 | PR #1')
    expect(userPrompt).toContain('2. queued | telegram | tg:1 | Follow-up')
  })

  it('truncates objective text to 2500 chars in prompt', async () => {
    mockArbiterResponse('{"decision":"do_not_interrupt","reason":"Continue."}')

    await decideSteeringAction(
      testInput({
        objectiveText: 'x'.repeat(3000),
      })
    )

    const objectiveSection = getLastUserPrompt()
      .split('Current objective (running now):\n')[1]
      ?.split('\n\nPending incoming messages:')[0]
    expect(objectiveSection).toBeDefined()
    expect(objectiveSection).toHaveLength(2500)
    expect(objectiveSection).toBe('x'.repeat(2500))
  })
})
