import { describe, expect, it } from 'vitest'
import type OpenAI from 'openai'
import { getSkippedFunctionToolCalls } from './steer-tool-batch'

function functionToolCall(id: string): OpenAI.Chat.Completions.ChatCompletionMessageToolCall {
  return {
    id,
    type: 'function',
    function: {
      name: `tool_${id}`,
      arguments: '{}',
    },
  }
}

describe('getSkippedFunctionToolCalls', () => {
  it('starts at index 0 when steeredAtIndex is -1', () => {
    const toolCalls: Array<OpenAI.Chat.Completions.ChatCompletionMessageToolCall | undefined> = [
      functionToolCall('a'),
      undefined,
      functionToolCall('b'),
    ]

    const skipped = getSkippedFunctionToolCalls(toolCalls, -1)

    expect(skipped.map((tc) => tc.id)).toEqual(['a', 'b'])
  })

  it('only includes unexecuted function calls from steered index onward', () => {
    const toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] = [
      functionToolCall('a'),
      functionToolCall('b'),
      functionToolCall('c'),
    ]

    const skipped = getSkippedFunctionToolCalls(toolCalls, 2)

    expect(skipped.map((tc) => tc.id)).toEqual(['c'])
  })

  it('returns empty array when steered index is beyond tool batch length', () => {
    const toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] = [
      functionToolCall('a'),
    ]

    const skipped = getSkippedFunctionToolCalls(toolCalls, 5)

    expect(skipped).toEqual([])
  })
})
