import { afterEach, describe, expect, it, vi } from 'vitest'
import type OpenAI from 'openai'
import type * as MessageUtils from './message-utils'

const originalEnv = { ...process.env }

async function loadMessageUtils(env: Record<string, string | undefined> = {}) {
  vi.resetModules()
  process.env = { ...originalEnv }
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key]
      continue
    }
    process.env[key] = value
  }
  return import('./message-utils')
}

afterEach(() => {
  process.env = { ...originalEnv }
})

describe('parsePositiveIntEnv', () => {
  it('returns fallback when env var is not set', async () => {
    const { parsePositiveIntEnv } = await loadMessageUtils({ TEST_VAR: undefined })
    expect(parsePositiveIntEnv('TEST_VAR', 42)).toBe(42)
  })

  it('parses a valid positive integer', async () => {
    const { parsePositiveIntEnv } = await loadMessageUtils({ TEST_VAR: '100' })
    expect(parsePositiveIntEnv('TEST_VAR', 42)).toBe(100)
  })

  it('returns fallback for zero', async () => {
    const { parsePositiveIntEnv } = await loadMessageUtils({ TEST_VAR: '0' })
    expect(parsePositiveIntEnv('TEST_VAR', 42)).toBe(42)
  })

  it('returns fallback for negative numbers', async () => {
    const { parsePositiveIntEnv } = await loadMessageUtils({ TEST_VAR: '-5' })
    expect(parsePositiveIntEnv('TEST_VAR', 42)).toBe(42)
  })

  it('returns fallback for non-numeric strings', async () => {
    const { parsePositiveIntEnv } = await loadMessageUtils({ TEST_VAR: 'abc' })
    expect(parsePositiveIntEnv('TEST_VAR', 42)).toBe(42)
  })
})

describe('buildToolResultContent', () => {
  it('returns output on success', async () => {
    const { buildToolResultContent } = await loadMessageUtils()
    expect(buildToolResultContent({ success: true, output: 'done' })).toBe('done')
  })

  it('returns "Success" when success has no output', async () => {
    const { buildToolResultContent } = await loadMessageUtils()
    expect(buildToolResultContent({ success: true })).toBe('Success')
  })

  it('returns output + error on failure when both exist', async () => {
    const { buildToolResultContent } = await loadMessageUtils()
    expect(buildToolResultContent({ success: false, output: 'partial', error: 'boom' })).toBe(
      'partial\n\nError: boom'
    )
  })

  it('returns error when failure has no output', async () => {
    const { buildToolResultContent } = await loadMessageUtils()
    expect(buildToolResultContent({ success: false, error: 'boom' })).toBe('Error: boom')
  })

  it('returns "Error: undefined" when failure has neither output nor error', async () => {
    const { buildToolResultContent } = await loadMessageUtils()
    expect(buildToolResultContent({ success: false })).toBe('Error: undefined')
  })
})

describe('truncateWithNotice', () => {
  it('returns text unchanged when under maxChars', async () => {
    const { truncateWithNotice } = await loadMessageUtils()
    expect(truncateWithNotice('short', 100, 'output')).toBe('short')
  })

  it('returns text unchanged when exactly at maxChars', async () => {
    const { truncateWithNotice } = await loadMessageUtils()
    const text = 'x'.repeat(10)
    expect(truncateWithNotice(text, 10, 'output')).toBe(text)
  })

  it('truncates and includes omitted character count notice', async () => {
    const { truncateWithNotice } = await loadMessageUtils()
    const text = 'a'.repeat(1000)
    const result = truncateWithNotice(text, 200, 'output')
    expect(result).toContain('[output truncated: omitted 870 chars]')
  })

  it('keeps 75% head and 25% tail of kept content', async () => {
    const { truncateWithNotice } = await loadMessageUtils()
    const text = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(100)
    const maxChars = 200
    const reserved = Math.min(240, Math.floor(maxChars * 0.35))
    const keep = Math.max(0, maxChars - reserved)
    const head = Math.max(0, Math.floor(keep * 0.75))
    const tail = Math.max(0, keep - head)

    const result = truncateWithNotice(text, maxChars, 'content')

    expect(result.startsWith(text.slice(0, head))).toBe(true)
    expect(result.endsWith(text.slice(text.length - tail))).toBe(true)
  })

  it('works with very short maxChars', async () => {
    const { truncateWithNotice } = await loadMessageUtils()
    const text = 'abcdefghij'
    const result = truncateWithNotice(text, 5, 'tiny')
    expect(result).toContain('[tiny truncated: omitted 6 chars]')
    expect(result.startsWith('abc')).toBe(true)
    expect(result.endsWith('j')).toBe(true)
  })

  it('handles empty string input', async () => {
    const { truncateWithNotice } = await loadMessageUtils()
    expect(truncateWithNotice('', 10, 'empty')).toBe('')
  })

  it('handles single-character input with maxChars=1', async () => {
    const { truncateWithNotice } = await loadMessageUtils()
    expect(truncateWithNotice('a', 1, 'single')).toBe('a')
  })
})

describe('extractContentText', () => {
  it('extracts text from string content', async () => {
    const { extractContentText } = await loadMessageUtils()
    expect(extractContentText('hello')).toBe('hello')
  })

  it('extracts and concatenates text from content part arrays', async () => {
    const { extractContentText } = await loadMessageUtils()
    const parts: OpenAI.ChatCompletionContentPart[] = [
      { type: 'text', text: 'hello ' },
      { type: 'text', text: 'world' },
    ]
    expect(extractContentText(parts)).toBe('hello world')
  })

  it('returns empty string for null/undefined content', async () => {
    const { extractContentText } = await loadMessageUtils()
    expect(
      extractContentText(null as unknown as OpenAI.ChatCompletionMessageParam['content'])
    ).toBe('')
    expect(
      extractContentText(undefined as unknown as OpenAI.ChatCompletionMessageParam['content'])
    ).toBe('')
  })

  it('returns empty string for non-string, non-array content', async () => {
    const { extractContentText } = await loadMessageUtils()
    expect(extractContentText(42 as unknown as OpenAI.ChatCompletionMessageParam['content'])).toBe(
      ''
    )
  })

  it('ignores image_url parts and returns text only', async () => {
    const { extractContentText } = await loadMessageUtils()
    const parts: OpenAI.ChatCompletionContentPart[] = [
      { type: 'text', text: 'caption' },
      { type: 'image_url', image_url: { url: 'https://example.com/image.png' } },
    ]
    expect(extractContentText(parts)).toBe('caption')
  })

  it('handles mixed arrays of strings and objects', async () => {
    const { extractContentText } = await loadMessageUtils()
    const parts = [
      'prefix ',
      { type: 'text', text: 'middle' },
      { type: 'image_url', image_url: { url: 'https://example.com/image.png' } },
      { text: ' suffix' },
    ] as unknown as OpenAI.ChatCompletionMessageParam['content']
    expect(extractContentText(parts)).toBe('prefix middle suffix')
  })
})

describe('getMessageContentLength', () => {
  it('returns string length for string content', async () => {
    const { getMessageContentLength } = await loadMessageUtils()
    const message: OpenAI.ChatCompletionMessageParam = { role: 'user', content: 'hello' }
    expect(getMessageContentLength(message)).toBe(5)
  })

  it('returns combined length for array content', async () => {
    const { getMessageContentLength } = await loadMessageUtils()
    const message = {
      role: 'user',
      content: [
        { type: 'text', text: 'hello ' },
        { type: 'text', text: 'world' },
      ],
    } as OpenAI.ChatCompletionMessageParam
    expect(getMessageContentLength(message)).toBe(11)
  })

  it('returns 0 for empty content', async () => {
    const { getMessageContentLength } = await loadMessageUtils()
    const message: OpenAI.ChatCompletionMessageParam = {
      role: 'assistant',
      content: '',
    }
    expect(getMessageContentLength(message)).toBe(0)
  })
})

describe('setStringContent', () => {
  it('mutates message content in place', async () => {
    const { setStringContent } = await loadMessageUtils()
    const message: OpenAI.ChatCompletionMessageParam = { role: 'user', content: 'old' }
    setStringContent(message, 'new')
    expect(message.content).toBe('new')
  })
})

describe('stripImageInputs', () => {
  it('converts user messages with array content to string content', async () => {
    const { stripImageInputs } = await loadMessageUtils()
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'describe this' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
        ],
      },
    ]

    const result = stripImageInputs(messages)
    expect(result[0]?.content).toBe('describe this')
  })

  it('leaves non-user messages unchanged', async () => {
    const { stripImageInputs } = await loadMessageUtils()
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: 'rules' },
      { role: 'assistant', content: 'answer' },
    ]

    const result = stripImageInputs(messages)
    expect(result[0]).toBe(messages[0])
    expect(result[1]).toBe(messages[1])
  })

  it('leaves user messages with string content unchanged', async () => {
    const { stripImageInputs } = await loadMessageUtils()
    const messages: OpenAI.ChatCompletionMessageParam[] = [{ role: 'user', content: 'hello' }]

    const result = stripImageInputs(messages)
    expect(result[0]).toBe(messages[0])
  })

  it('handles multiple mixed messages', async () => {
    const { stripImageInputs } = await loadMessageUtils()
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: 'policy' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'one ' },
          { type: 'image_url', image_url: { url: 'https://example.com/1.png' } },
          { type: 'text', text: 'two' },
        ],
      },
      { role: 'assistant', content: 'done' },
    ]

    const result = stripImageInputs(messages)
    expect(result[0]?.content).toBe('policy')
    expect(result[1]?.content).toBe('one two')
    expect(result[2]?.content).toBe('done')
  })
})

describe('prepareMessagesForModel', () => {
  it('returns messages unchanged when under MAX_MODEL_INPUT_CHARS', async () => {
    const { prepareMessagesForModel } = await loadMessageUtils({
      AGENT_MODEL_INPUT_MAX_CHARS: '1000',
    })
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: 'hello' },
      { role: 'user', content: 'world' },
    ]

    const result = prepareMessagesForModel(messages)

    expect(result.messages).toEqual(messages)
    expect(result.compactedToolMessages).toBe(0)
    expect(result.compactedNonToolMessages).toBe(0)
    expect(result.initialChars).toBe(10)
    expect(result.finalChars).toBe(10)
  })

  it('compacts tool messages first when over limit', async () => {
    const { prepareMessagesForModel } = await loadMessageUtils({
      AGENT_MODEL_INPUT_MAX_CHARS: '700',
    })
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: 's'.repeat(200) },
      {
        role: 'tool',
        tool_call_id: 'call-1',
        content: 't'.repeat(700),
      } as OpenAI.ChatCompletionMessageParam,
      { role: 'assistant', content: 'a'.repeat(200) },
    ]

    const result = prepareMessagesForModel(messages)

    expect(result.compactedToolMessages).toBe(1)
    expect(result.compactedNonToolMessages).toBe(0)
    const compacted = result.messages[1]?.content
    expect(typeof compacted).toBe('string')
    if (typeof compacted !== 'string') {
      throw new Error('expected compacted tool content to be a string')
    }
    expect(compacted).toContain('[Tool output omitted')
  })

  it("compacts non-tool middle messages when tool compaction isn't enough", async () => {
    const { prepareMessagesForModel } = await loadMessageUtils({
      AGENT_MODEL_INPUT_MAX_CHARS: '900',
    })
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: 's'.repeat(400) },
      {
        role: 'tool',
        tool_call_id: 'call-1',
        content: 't'.repeat(500),
      } as OpenAI.ChatCompletionMessageParam,
      { role: 'user', content: 'u'.repeat(500) },
      { role: 'assistant', content: 'a'.repeat(400) },
    ]

    const result = prepareMessagesForModel(messages)

    expect(result.compactedToolMessages).toBe(1)
    expect(result.compactedNonToolMessages).toBe(1)
    const compacted = result.messages[2]?.content
    expect(typeof compacted).toBe('string')
    if (typeof compacted !== 'string') {
      throw new Error('expected compacted non-tool content to be a string')
    }
    expect(compacted).toContain('[user message omitted to fit model input limits.]')
  })

  it('does not compact first or last messages', async () => {
    const { prepareMessagesForModel } = await loadMessageUtils({
      AGENT_MODEL_INPUT_MAX_CHARS: '700',
    })
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: 's'.repeat(600) },
      { role: 'user', content: 'u'.repeat(100) },
      { role: 'assistant', content: 'a'.repeat(600) },
    ]

    const result = prepareMessagesForModel(messages)

    expect(result.compactedToolMessages).toBe(0)
    expect(result.compactedNonToolMessages).toBe(0)
    expect(result.messages[0]?.content).toBe(messages[0]?.content)
    expect(result.messages[2]?.content).toBe(messages[2]?.content)
  })

  it('preserves middle messages at or below MIN_MESSAGE_PRESERVE_CHARS', async () => {
    const { prepareMessagesForModel, MIN_MESSAGE_PRESERVE_CHARS } = await loadMessageUtils({
      AGENT_MODEL_INPUT_MAX_CHARS: '500',
    })
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: 's'.repeat(400) },
      { role: 'user', content: 'u'.repeat(MIN_MESSAGE_PRESERVE_CHARS) },
      { role: 'assistant', content: 'a'.repeat(400) },
    ]

    const result = prepareMessagesForModel(messages)

    expect(result.compactedNonToolMessages).toBe(0)
    expect(result.messages[1]?.content).toBe(messages[1]?.content)
  })

  it('reports correct initialChars and finalChars after compaction', async () => {
    const utils = await loadMessageUtils({
      AGENT_MODEL_INPUT_MAX_CHARS: '900',
    })
    const { prepareMessagesForModel, getMessageContentLength } = utils
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: 's'.repeat(400) },
      {
        role: 'tool',
        tool_call_id: 'call-1',
        content: 't'.repeat(500),
      } as OpenAI.ChatCompletionMessageParam,
      { role: 'user', content: 'u'.repeat(500) },
      { role: 'assistant', content: 'a'.repeat(400) },
    ]
    const expectedInitial = messages.reduce(
      (sum, message) => sum + getMessageContentLength(message),
      0
    )

    const result = prepareMessagesForModel(messages)
    const computedFinal = result.messages.reduce(
      (sum, message) => sum + getMessageContentLength(message),
      0
    )

    expect(result.initialChars).toBe(expectedInitial)
    expect(result.finalChars).toBe(computedFinal)
    expect(result.finalChars).toBeLessThan(result.initialChars)
    expect(result.compactedToolMessages).toBe(1)
    expect(result.compactedNonToolMessages).toBe(1)
  })

  it('does not mutate original input messages', async () => {
    const { prepareMessagesForModel } = await loadMessageUtils({
      AGENT_MODEL_INPUT_MAX_CHARS: '100',
    })
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: 's'.repeat(80) },
      { role: 'user', content: 'u'.repeat(80) },
      { role: 'assistant', content: 'a'.repeat(80) },
    ]
    const snapshot = messages.map((message) => ({ ...message }))

    prepareMessagesForModel(messages)

    expect(messages).toEqual(snapshot)
  })
})

describe('module shape', () => {
  it('exports expected constants', async () => {
    const utils: typeof MessageUtils = await loadMessageUtils()
    expect(utils.MIN_MESSAGE_PRESERVE_CHARS).toBe(256)
    expect(utils.MAX_TOOL_RESULT_CHARS).toBeGreaterThan(0)
    expect(utils.MAX_MODEL_INPUT_CHARS).toBeGreaterThan(0)
  })
})
