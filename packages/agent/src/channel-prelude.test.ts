import { describe, expect, it } from 'vitest'
import {
  buildChannelPrelude,
  CHANNEL_PRELUDE_MAX_CHARS,
  CHANNEL_PRELUDE_PER_MSG_MAX_CHARS,
} from './channel-prelude'
import type { ChannelThreadMessage } from '@nitejar/database'

function makeMsg(overrides: Partial<ChannelThreadMessage> = {}): ChannelThreadMessage {
  return {
    sessionKey: 'slack:C123:1710000000.000100',
    role: 'user',
    content: 'Hello world',
    agentHandle: 'testbot',
    jobCreatedAt: 1710000000,
    messageCreatedAt: 1710000001,
    ...overrides,
  }
}

describe('buildChannelPrelude', () => {
  it('returns null for empty messages array', () => {
    expect(buildChannelPrelude([])).toBeNull()
  })

  it('returns null when all messages have empty content', () => {
    const messages = [makeMsg({ content: null }), makeMsg({ content: '' })]
    expect(buildChannelPrelude(messages)).toBeNull()
  })

  it('formats user messages with User: prefix', () => {
    const messages = [makeMsg({ role: 'user', content: 'Hello' })]
    const result = buildChannelPrelude(messages)
    expect(result).toContain('User: Hello')
  })

  it('formats assistant messages with @handle prefix', () => {
    const messages = [makeMsg({ role: 'assistant', content: 'Hi there', agentHandle: 'mybot' })]
    const result = buildChannelPrelude(messages)
    expect(result).toContain('@mybot: Hi there')
  })

  it('groups messages by sessionKey with thread separators', () => {
    const messages = [
      makeMsg({
        sessionKey: 'slack:C123:thread1',
        role: 'user',
        content: 'Thread 1 msg',
        jobCreatedAt: 1710000000,
      }),
      makeMsg({
        sessionKey: 'slack:C123:thread2',
        role: 'user',
        content: 'Thread 2 msg',
        jobCreatedAt: 1710000010,
      }),
    ]
    const result = buildChannelPrelude(messages)!
    expect(result).toContain('--- thread (')
    expect(result).toContain('Thread 1 msg')
    expect(result).toContain('Thread 2 msg')
    // Should have two thread separators
    const threadSeps = result.match(/--- thread \(/g)
    expect(threadSeps).toHaveLength(2)
  })

  it('orders newest threads first', () => {
    const messages = [
      makeMsg({
        sessionKey: 'slack:C123:old',
        content: 'OLD_THREAD',
        jobCreatedAt: 1710000000,
      }),
      makeMsg({
        sessionKey: 'slack:C123:new',
        content: 'NEW_THREAD',
        jobCreatedAt: 1710001000,
      }),
    ]
    const result = buildChannelPrelude(messages)!
    const oldIdx = result.indexOf('OLD_THREAD')
    const newIdx = result.indexOf('NEW_THREAD')
    expect(newIdx).toBeLessThan(oldIdx)
  })

  it('truncates individual messages to per-message max chars', () => {
    const longText = 'A'.repeat(CHANNEL_PRELUDE_PER_MSG_MAX_CHARS + 100)
    const messages = [makeMsg({ content: longText })]
    const result = buildChannelPrelude(messages)!
    // Each formatted message line should be <=  perMsgMax + prefix length
    const lines = result.split('\n').filter((l) => l.startsWith('User:'))
    expect(lines).toHaveLength(1)
    // The actual text portion should be truncated with ellipsis
    const textPart = lines[0]!.replace('User: ', '')
    expect(textPart.length).toBeLessThanOrEqual(CHANNEL_PRELUDE_PER_MSG_MAX_CHARS)
    expect(textPart).toMatch(/\u2026$/)
  })

  it('respects total char budget and drops oldest threads', () => {
    // Create many threads that together exceed the budget
    const messages: ChannelThreadMessage[] = []
    for (let i = 0; i < 50; i++) {
      messages.push(
        makeMsg({
          sessionKey: `slack:C123:thread${i}`,
          content: `Message content for thread ${i} with some extra padding text to fill space`,
          jobCreatedAt: 1710000000 + i * 100,
        })
      )
    }
    const result = buildChannelPrelude(messages, { maxChars: 500 })!
    expect(result.length).toBeLessThanOrEqual(500)
    // Should include newer threads (content text has "thread 49" with a space)
    expect(result).toContain('thread 49')
    // Should not include all threads
    const threadSeps = result.match(/--- thread \(/g)
    expect(threadSeps!.length).toBeLessThan(50)
  })

  it('extracts text from JSON content with text field', () => {
    const messages = [makeMsg({ content: JSON.stringify({ text: 'Parsed from JSON' }) })]
    const result = buildChannelPrelude(messages)!
    expect(result).toContain('Parsed from JSON')
  })

  it('extracts text from JSON content with content field', () => {
    const messages = [makeMsg({ content: JSON.stringify({ content: 'From content field' }) })]
    const result = buildChannelPrelude(messages)!
    expect(result).toContain('From content field')
  })

  it('treats non-JSON content as plain text', () => {
    const messages = [makeMsg({ content: 'plain text message' })]
    const result = buildChannelPrelude(messages)!
    expect(result).toContain('plain text message')
  })

  it('skips messages with array JSON content', () => {
    const messages = [
      makeMsg({ content: JSON.stringify([{ type: 'tool_use' }]) }),
      makeMsg({ content: 'keepme', role: 'assistant' }),
    ]
    const result = buildChannelPrelude(messages)!
    expect(result).toContain('keepme')
    expect(result).not.toContain('tool_use')
  })

  it('accepts custom maxChars option', () => {
    const messages = [makeMsg({ content: 'A'.repeat(200) })]
    const result = buildChannelPrelude(messages, { maxChars: 100 })
    // With a very small budget, the header line alone might exceed it
    // or we get a truncated result
    if (result) {
      expect(result.length).toBeLessThanOrEqual(100)
    }
  })

  it('returns null when budget is too small for even one thread header', () => {
    const messages = [makeMsg({ content: 'hi' })]
    const result = buildChannelPrelude(messages, { maxChars: 5 })
    expect(result).toBeNull()
  })

  it('uses default MAX_CHARS constant', () => {
    // Smoke test: default budget is respected
    const messages: ChannelThreadMessage[] = []
    for (let i = 0; i < 200; i++) {
      messages.push(
        makeMsg({
          sessionKey: `slack:C123:thread${i}`,
          content: `Message ${i} ${'x'.repeat(100)}`,
          jobCreatedAt: 1710000000 + i,
        })
      )
    }
    const result = buildChannelPrelude(messages)
    if (result) {
      expect(result.length).toBeLessThanOrEqual(CHANNEL_PRELUDE_MAX_CHARS)
    }
  })
})
