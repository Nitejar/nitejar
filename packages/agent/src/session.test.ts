import { describe, expect, it } from 'vitest'
import type OpenAI from 'openai'
import type { SessionMessage } from '@nitejar/database'
import {
  estimateTokens,
  toOpenAIMessage,
  groupIntoTurnGroups,
  estimateGroupTokens,
  compactTurnGroup,
  truncateTurnGroups,
  calculateSessionCutoff,
  isSessionExpired,
  formatSessionMessages,
  normalizeRelayToHandle,
  type TurnGroup,
  type SessionContext,
} from './session'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSessionMessage(
  overrides: Partial<SessionMessage> & Pick<SessionMessage, 'role' | 'content'>
): SessionMessage {
  return {
    id: 'msg-1',
    job_id: 'job-1',
    created_at: 1000,
    embedding: null,
    workItemTitle: 'test work item',
    workItemCreatedAt: 1000,
    jobCreatedAt: 1000,
    agentId: 'agent-1',
    agentHandle: 'slopper',
    agentName: 'Slopper',
    jobHasFinalResponse: false,
    ...overrides,
  }
}

function makeUserMsg(text: string): SessionMessage {
  return makeSessionMessage({ role: 'user', content: JSON.stringify({ text }) })
}

function makeAssistantMsg(text: string): SessionMessage {
  return makeSessionMessage({ role: 'assistant', content: JSON.stringify({ text }) })
}

function makeAssistantToolCallMsg(toolCallId: string, name: string, args: string): SessionMessage {
  return makeSessionMessage({
    role: 'assistant',
    content: JSON.stringify({
      tool_calls: [{ type: 'function', id: toolCallId, function: { name, arguments: args } }],
    }),
  })
}

function makeToolMsg(toolCallId: string, content: string): SessionMessage {
  return makeSessionMessage({
    role: 'tool',
    content: JSON.stringify({ tool_call_id: toolCallId, content }),
  })
}

function makeSystemMsg(text: string): SessionMessage {
  return makeSessionMessage({ role: 'system', content: JSON.stringify({ text }) })
}

// ---------------------------------------------------------------------------
// estimateTokens
// ---------------------------------------------------------------------------

describe('estimateTokens', () => {
  it('estimates ~1 token per 4 chars', () => {
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('abcde')).toBe(2) // ceil(5/4)
  })

  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// toOpenAIMessage
// ---------------------------------------------------------------------------

describe('toOpenAIMessage', () => {
  it('converts user message', () => {
    const result = toOpenAIMessage(makeUserMsg('hello'))
    expect(result).toEqual({ role: 'user', content: 'hello' })
  })

  it('converts assistant text message', () => {
    const result = toOpenAIMessage(makeAssistantMsg('response'))
    expect(result).toEqual({ role: 'assistant', content: 'response' })
  })

  it('converts assistant tool_calls message', () => {
    const result = toOpenAIMessage(makeAssistantToolCallMsg('tc-1', 'bash', '{"command":"ls"}'))
    expect(result).not.toBeNull()
    expect(result!.role).toBe('assistant')
    const msg = result as OpenAI.ChatCompletionAssistantMessageParam
    expect(msg.tool_calls).toHaveLength(1)
  })

  it('converts tool result message', () => {
    const result = toOpenAIMessage(makeToolMsg('tc-1', 'stdout: hello'))
    expect(result).toEqual({ role: 'tool', tool_call_id: 'tc-1', content: 'stdout: hello' })
  })

  it('skips system messages', () => {
    expect(toOpenAIMessage(makeSystemMsg('system prompt'))).toBeNull()
  })

  it('skips user messages with empty text', () => {
    expect(toOpenAIMessage(makeUserMsg(''))).toBeNull()
  })

  it('skips assistant messages with no text and no tool_calls', () => {
    const msg = makeSessionMessage({
      role: 'assistant',
      content: JSON.stringify({}),
    })
    expect(toOpenAIMessage(msg)).toBeNull()
  })

  it('skips tool messages with no tool_call_id', () => {
    const msg = makeSessionMessage({
      role: 'tool',
      content: JSON.stringify({ content: 'orphaned' }),
    })
    expect(toOpenAIMessage(msg)).toBeNull()
  })

  it('attributes other agent assistant messages with handle', () => {
    const msg = makeAssistantMsg('I fixed the bug')
    msg.agentId = 'agent-2'
    msg.agentHandle = 'pixel'
    msg.agentName = 'Pixel'
    const result = toOpenAIMessage(msg, 'agent-1')
    expect(result).toEqual({ role: 'user', content: '[@pixel]: I fixed the bug' })
  })

  it('skips other agent tool results', () => {
    const msg = makeToolMsg('tc-1', 'stdout: hello')
    msg.agentId = 'agent-2'
    const result = toOpenAIMessage(msg, 'agent-1')
    expect(result).toBeNull()
  })

  it('skips other agent tool_calls-only messages', () => {
    const msg = makeAssistantToolCallMsg('tc-1', 'bash', '{"command":"ls"}')
    msg.agentId = 'agent-2'
    msg.agentHandle = 'pixel'
    const result = toOpenAIMessage(msg, 'agent-1')
    // No text content, only tool_calls — should be null for other agents
    expect(result).toBeNull()
  })

  it('does not attribute own messages', () => {
    const msg = makeAssistantMsg('my response')
    const result = toOpenAIMessage(msg, 'agent-1')
    expect(result).toEqual({ role: 'assistant', content: 'my response' })
  })

  it('keeps final response as clean assistant message in final-mode jobs', () => {
    const msg = makeSessionMessage({
      role: 'assistant',
      content: JSON.stringify({ text: 'Here is a summary', is_final_response: true }),
      jobHasFinalResponse: true,
    })
    const result = toOpenAIMessage(msg, 'agent-1')
    expect(result).toEqual({
      role: 'assistant',
      content: 'Here is a summary',
    })
  })

  it('converts intermediate reasoning to user-role agent_scratchpad in final-mode jobs', () => {
    const msg = makeSessionMessage({
      role: 'assistant',
      content: JSON.stringify({ text: 'Let me search for that...' }),
      jobHasFinalResponse: true,
    })
    const result = toOpenAIMessage(msg, 'agent-1')
    expect(result).toEqual({
      role: 'user',
      content: '<agent_scratchpad>\nLet me search for that...\n</agent_scratchpad>',
    })
  })

  it('does not wrap tool_calls messages in final-mode jobs', () => {
    const msg = makeAssistantToolCallMsg('tc-1', 'bash', '{"command":"ls"}')
    msg.jobHasFinalResponse = true
    const result = toOpenAIMessage(msg, 'agent-1')
    expect(result).not.toBeNull()
    expect(result!.role).toBe('assistant')
    // Tool call messages should NOT be wrapped as internal reasoning
    const asstMsg = result as { content?: string; tool_calls?: unknown[] }
    expect(asstMsg.content).toBeUndefined()
    expect(asstMsg.tool_calls).toHaveLength(1)
  })

  it('does not wrap messages in streaming-mode jobs', () => {
    const msg = makeAssistantMsg('thinking out loud')
    // jobHasFinalResponse is false = streaming-mode job
    msg.jobHasFinalResponse = false
    const result = toOpenAIMessage(msg, 'agent-1')
    expect(result).toEqual({ role: 'assistant', content: 'thinking out loud' })
  })

  it('skips other agent user messages (they are duplicates)', () => {
    const msg = makeUserMsg('hello from user')
    msg.agentId = 'agent-2'
    const result = toOpenAIMessage(msg, 'agent-1')
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// groupIntoTurnGroups
// ---------------------------------------------------------------------------

describe('groupIntoTurnGroups', () => {
  it('groups messages by user turns', () => {
    const messages = [
      makeUserMsg('q1'),
      makeAssistantMsg('a1'),
      makeUserMsg('q2'),
      makeAssistantMsg('a2'),
    ]
    const groups = groupIntoTurnGroups(messages)
    expect(groups).toHaveLength(2)
    expect(groups[0]).toHaveLength(2) // user + assistant
    expect(groups[1]).toHaveLength(2)
  })

  it('includes tool calls and results in the same group', () => {
    const messages = [
      makeUserMsg('do something'),
      makeAssistantToolCallMsg('tc-1', 'bash', '{"command":"ls"}'),
      makeToolMsg('tc-1', 'file1\nfile2'),
      makeAssistantMsg('found files'),
    ]
    const groups = groupIntoTurnGroups(messages)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toHaveLength(4) // user + tool_call + tool_result + assistant
  })

  it('skips system messages', () => {
    const messages = [makeSystemMsg('system prompt'), makeUserMsg('hello'), makeAssistantMsg('hi')]
    const groups = groupIntoTurnGroups(messages)
    expect(groups).toHaveLength(1)
    expect(groups[0]![0]).toEqual({ role: 'user', content: 'hello' })
  })

  it('returns empty array for empty input', () => {
    expect(groupIntoTurnGroups([])).toEqual([])
  })

  it('handles orphaned assistant/tool messages before first user message', () => {
    const messages = [makeAssistantMsg('orphan'), makeUserMsg('hello'), makeAssistantMsg('hi')]
    const groups = groupIntoTurnGroups(messages)
    // orphan assistant becomes its own group (no user prefix), then user+assistant
    expect(groups).toHaveLength(2)
  })

  it('dedupes relay echo duplicates across handle + display forms', () => {
    const fromOtherAgent = makeAssistantMsg('6')
    fromOtherAgent.agentId = 'agent-2'
    fromOtherAgent.agentHandle = 'pixel'
    fromOtherAgent.agentName = 'Pixel'

    const relayedDisplay = makeUserMsg('[🎨 Pixel] 6')
    relayedDisplay.agentId = 'agent-1'

    const groups = groupIntoTurnGroups([fromOtherAgent, relayedDisplay], 'agent-1')

    expect(groups).toHaveLength(1)
    expect(groups[0]).toHaveLength(1)
    expect(groups[0]![0]).toEqual({ role: 'user', content: '[@pixel]: 6' })
  })

  it('keeps repeated user messages when they are not cross-format relay duplicates', () => {
    const groups = groupIntoTurnGroups([makeUserMsg('2'), makeUserMsg('2')], 'agent-1')

    expect(groups).toHaveLength(2)
    expect(groups[0]![0]).toEqual({ role: 'user', content: '2' })
    expect(groups[1]![0]).toEqual({ role: 'user', content: '2' })
  })
})

// ---------------------------------------------------------------------------
// normalizeRelayToHandle
// ---------------------------------------------------------------------------

describe('normalizeRelayToHandle', () => {
  const nameToHandle = new Map([
    ['slopper', 'nitejar-dev'],
    ['pixel', 'pixel'],
  ])

  it('rewrites display-name relay to handle format', () => {
    expect(normalizeRelayToHandle('[🫠 Slopper] 5', nameToHandle)).toBe('[@nitejar-dev]: 5')
  })

  it('rewrites emoji-prefixed display names', () => {
    expect(normalizeRelayToHandle('[🎨 Pixel] hello world', nameToHandle)).toBe(
      '[@pixel]: hello world'
    )
  })

  it('returns original text when no display relay pattern', () => {
    expect(normalizeRelayToHandle('just a normal message', nameToHandle)).toBe(
      'just a normal message'
    )
  })

  it('returns original text when agent name not in map', () => {
    expect(normalizeRelayToHandle('[🤖 Unknown] 3', nameToHandle)).toBe('[🤖 Unknown] 3')
  })

  it('does not rewrite handle format (already canonical)', () => {
    expect(normalizeRelayToHandle('[@nitejar-dev]: 5', nameToHandle)).toBe('[@nitejar-dev]: 5')
  })

  it('preserves multiline payload', () => {
    expect(normalizeRelayToHandle('[🫠 Slopper] line1\nline2', nameToHandle)).toBe(
      '[@nitejar-dev]: line1\nline2'
    )
  })
})

// ---------------------------------------------------------------------------
// estimateGroupTokens
// ---------------------------------------------------------------------------

describe('estimateGroupTokens', () => {
  it('estimates tokens from text content', () => {
    const group: TurnGroup = [
      { role: 'user', content: 'a'.repeat(100) },
      { role: 'assistant', content: 'b'.repeat(200) },
    ]
    expect(estimateGroupTokens(group)).toBe(75) // ceil(100/4) + ceil(200/4)
  })

  it('includes tool_calls arguments in estimate', () => {
    const group: TurnGroup = [
      { role: 'user', content: 'test' },
      {
        role: 'assistant',
        tool_calls: [
          {
            id: 'tc-1',
            type: 'function' as const,
            function: { name: 'bash', arguments: 'a'.repeat(400) },
          },
        ],
      },
    ]
    // user: ceil(4/4)=1, assistant has no content but tool_calls args: ceil(400/4)=100
    expect(estimateGroupTokens(group)).toBe(101)
  })

  it('returns 0 for empty group', () => {
    expect(estimateGroupTokens([])).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// compactTurnGroup
// ---------------------------------------------------------------------------

describe('compactTurnGroup', () => {
  it('does not modify small messages', () => {
    const group: TurnGroup = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ]
    const result = compactTurnGroup(group)
    expect(result[0]).toBe(group[0]) // same reference — not cloned
    expect(result[1]).toBe(group[1])
  })

  it('truncates oversized tool results', () => {
    const bigContent = 'x'.repeat(20_000)
    const group: TurnGroup = [
      { role: 'user', content: 'run it' },
      { role: 'tool' as const, tool_call_id: 'tc-1', content: bigContent },
    ]
    const result = compactTurnGroup(group)
    expect(result[0]).toBe(group[0]) // user message untouched
    const toolMsg = result[1] as { content: string }
    expect(toolMsg.content.length).toBeLessThan(bigContent.length)
    expect(toolMsg.content).toContain('truncated')
    expect(toolMsg.content).toContain('session history')
  })

  it('truncates oversized assistant messages', () => {
    const group: TurnGroup = [
      { role: 'user', content: 'explain' },
      { role: 'assistant', content: 'a'.repeat(5_000) },
    ]
    const result = compactTurnGroup(group)
    const assistantMsg = result[1] as { content: string }
    expect(assistantMsg.content.length).toBeLessThan(5_000)
    expect(assistantMsg.content).toContain('truncated')
  })

  it('does not mutate original messages', () => {
    const original = 'x'.repeat(2_000)
    const group: TurnGroup = [{ role: 'tool' as const, tool_call_id: 'tc-1', content: original }]
    compactTurnGroup(group)
    expect((group[0] as { content: string }).content).toBe(original)
  })

  it('preserves messages without string content', () => {
    const group: TurnGroup = [
      {
        role: 'assistant',
        tool_calls: [
          { id: 'tc-1', type: 'function' as const, function: { name: 'bash', arguments: '{}' } },
        ],
      },
    ]
    const result = compactTurnGroup(group)
    expect(result[0]).toBe(group[0])
  })
})

// ---------------------------------------------------------------------------
// truncateTurnGroups
// ---------------------------------------------------------------------------

describe('truncateTurnGroups', () => {
  function makeGroup(charCount: number): TurnGroup {
    return [{ role: 'user', content: 'x'.repeat(charCount) }]
  }

  it('keeps all groups when under both limits', () => {
    const groups = [makeGroup(40), makeGroup(40), makeGroup(40)]
    const result = truncateTurnGroups(groups, 10, 1000)
    expect(result.groups).toHaveLength(3)
    expect(result.truncated).toBe(false)
  })

  it('truncates by maxTurns', () => {
    const groups = [makeGroup(40), makeGroup(40), makeGroup(40), makeGroup(40)]
    const result = truncateTurnGroups(groups, 2, 100_000)
    expect(result.groups).toHaveLength(2)
    expect(result.truncated).toBe(true)
    // Should keep the 2 most recent (last 2)
    expect(result.groups[0]).toBe(groups[2])
    expect(result.groups[1]).toBe(groups[3])
  })

  it('truncates by maxTokens - drops oldest groups first', () => {
    // 3 groups: 100 chars each = 25 tokens each
    // maxTokens = 40 → only the most recent group fits (25 <= 40), second would push to 50
    const groups = [makeGroup(100), makeGroup(100), makeGroup(100)]
    const result = truncateTurnGroups(groups, 100, 40)
    expect(result.groups).toHaveLength(1)
    expect(result.truncated).toBe(true)
  })

  it('compacts oversized groups instead of dropping them', () => {
    // A turn group with a massive tool result that would exceed the budget
    // at full size but fits after compaction
    const bigGroup: TurnGroup = [
      { role: 'user', content: 'run it' },
      { role: 'tool' as const, tool_call_id: 'tc-1', content: 'x'.repeat(20_000) },
      { role: 'assistant', content: 'done' },
    ]
    // At full size: ~5000+ tokens. After compaction tool result is ~800 chars → ~210 tokens total
    // With a generous budget, the compacted group should fit
    const result = truncateTurnGroups([bigGroup], 10, 1000)
    expect(result.groups).toHaveLength(1)
    expect(result.truncated).toBe(true) // content was truncated
    // Verify the tool result was compacted
    const toolMsg = result.groups[0]![1] as { content: string }
    expect(toolMsg.content.length).toBeLessThan(1000)
    expect(toolMsg.content).toContain('truncated')
  })

  it('drops group when compaction still exceeds budget', () => {
    // Group with many large messages that even after compaction won't fit
    // in a very tight budget
    const group: TurnGroup = [
      { role: 'user', content: 'a'.repeat(2_000) },
      { role: 'assistant', content: 'b'.repeat(2_000) },
      { role: 'tool' as const, tool_call_id: 'tc-1', content: 'c'.repeat(2_000) },
      { role: 'assistant', content: 'd'.repeat(2_000) },
    ]
    // After compaction: each message compacted to ~800 chars → ~3200 chars total → ~800 tokens
    // Budget of 10 tokens → still won't fit
    const result = truncateTurnGroups([group], 10, 10)
    expect(result.groups).toHaveLength(0)
    expect(result.truncated).toBe(true)
  })

  it('handles mixed-size groups correctly', () => {
    // Groups: 400 chars (100 tokens), 40 chars (10 tokens), 40 chars (10 tokens)
    // maxTokens = 25 → newest (10) fits, second-newest (10+10=20) fits, oldest (400 chars=100 tokens) doesn't even compacted (400 < 800 so no compaction, still 100 tokens)
    const groups = [makeGroup(400), makeGroup(40), makeGroup(40)]
    const result = truncateTurnGroups(groups, 100, 25)
    expect(result.groups).toHaveLength(2)
    expect(result.truncated).toBe(true)
  })

  it('handles empty input', () => {
    const result = truncateTurnGroups([], 10, 1000)
    expect(result.groups).toHaveLength(0)
    expect(result.truncated).toBe(false)
    expect(result.totalTokens).toBe(0)
  })

  it('applies both maxTurns and maxTokens', () => {
    // 5 groups of 40 chars (10 tokens each)
    // maxTurns=3 slices to last 3, then maxTokens=15 further trims to last 1
    const groups = [makeGroup(40), makeGroup(40), makeGroup(40), makeGroup(40), makeGroup(40)]
    const result = truncateTurnGroups(groups, 3, 15)
    expect(result.groups).toHaveLength(1)
    expect(result.truncated).toBe(true)
  })

  it('keeps turn with big tool result by compacting it', () => {
    // This is the key scenario: a turn group with a 20KB tool result
    // should be kept (compacted) rather than dropped entirely
    const bigGroup: TurnGroup = [
      { role: 'user', content: 'run it' },
      {
        role: 'assistant',
        tool_calls: [
          {
            id: 'tc-1',
            type: 'function' as const,
            function: { name: 'bash', arguments: '{"command":"cat big.log"}' },
          },
        ],
      },
      { role: 'tool' as const, tool_call_id: 'tc-1', content: 'x'.repeat(20_000) },
      { role: 'assistant', content: 'I found the results in the log file.' },
    ]
    const smallGroup: TurnGroup = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ]
    // Budget of 1000 tokens (4000 chars). Both groups should fit after compaction.
    const groups = [bigGroup, smallGroup]
    const result = truncateTurnGroups(groups, 100, 1000)
    expect(result.groups).toHaveLength(2) // both kept!
    expect(result.truncated).toBe(true) // content was compacted
    // The tool result should be truncated
    const toolMsg = result.groups[0]![2] as { content: string }
    expect(toolMsg.content).toContain('truncated')
  })
})

// ---------------------------------------------------------------------------
// calculateSessionCutoff
// ---------------------------------------------------------------------------

describe('calculateSessionCutoff', () => {
  it('returns null when dailyResetHour is null', () => {
    expect(calculateSessionCutoff(null)).toBeNull()
  })

  it('returns a unix timestamp for a valid hour', () => {
    const cutoff = calculateSessionCutoff(6)
    expect(cutoff).toBeTypeOf('number')
    expect(cutoff).toBeGreaterThan(0)
  })

  it('returns a timestamp in the past', () => {
    const now = Math.floor(Date.now() / 1000)
    const cutoff = calculateSessionCutoff(0)!
    expect(cutoff).toBeLessThanOrEqual(now)
  })

  it('uses referenceTimestamp when provided', () => {
    const reference = new Date(2026, 1, 12, 3, 45, 0) // local time
    const referenceTs = Math.floor(reference.getTime() / 1000)
    const cutoff = calculateSessionCutoff(6, referenceTs)!

    const expected = new Date(reference)
    expected.setHours(6, 0, 0, 0)
    if (expected > reference) {
      expected.setDate(expected.getDate() - 1)
    }

    expect(cutoff).toBe(Math.floor(expected.getTime() / 1000))
  })
})

// ---------------------------------------------------------------------------
// isSessionExpired
// ---------------------------------------------------------------------------

describe('isSessionExpired', () => {
  it('returns false when idle time is within timeout', () => {
    const now = Math.floor(Date.now() / 1000)
    expect(isSessionExpired(now - 60, 120)).toBe(false) // 1 min idle, 120 min timeout
  })

  it('returns true when idle time exceeds timeout', () => {
    const now = Math.floor(Date.now() / 1000)
    expect(isSessionExpired(now - 7300, 120)).toBe(true) // ~122 min idle, 120 min timeout
  })

  it('returns true for very old timestamps', () => {
    expect(isSessionExpired(0, 120)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// formatSessionMessages
// ---------------------------------------------------------------------------

describe('formatSessionMessages', () => {
  it('returns empty array for empty context', () => {
    const context: SessionContext = {
      turnGroups: [],
      totalTokens: 0,
      truncated: false,
      previousSummary: null,
      wasReset: false,
    }
    expect(formatSessionMessages(context)).toEqual([])
  })

  it('flattens turn groups into message sequence', () => {
    const context: SessionContext = {
      turnGroups: [
        [
          { role: 'user', content: 'q1' },
          { role: 'assistant', content: 'a1' },
        ],
        [
          { role: 'user', content: 'q2' },
          { role: 'assistant', content: 'a2' },
        ],
      ],
      totalTokens: 100,
      truncated: false,
      previousSummary: null,
      wasReset: false,
    }
    const messages = formatSessionMessages(context)
    expect(messages).toHaveLength(4)
    expect(messages[0]).toEqual({ role: 'user', content: 'q1' })
    expect(messages[3]).toEqual({ role: 'assistant', content: 'a2' })
  })

  it('prepends previous summary as system message', () => {
    const context: SessionContext = {
      turnGroups: [[{ role: 'user', content: 'hello' }]],
      totalTokens: 10,
      truncated: false,
      previousSummary: 'We discussed project setup.',
      wasReset: false,
    }
    const messages = formatSessionMessages(context)
    expect(messages).toHaveLength(2)
    expect(messages[0]!.role).toBe('system')
    expect(messages[0]!.content).toContain('Previous conversation summary')
    expect(messages[0]!.content).toContain('We discussed project setup.')
  })
})
