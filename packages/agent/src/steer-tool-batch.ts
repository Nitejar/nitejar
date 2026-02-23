import type OpenAI from 'openai'

type ToolCall = OpenAI.Chat.Completions.ChatCompletionMessageToolCall

/**
 * Returns function tool calls that should receive synthetic skipped results
 * when a run is steered mid-tool-batch.
 */
export function getSkippedFunctionToolCalls(
  toolCalls: readonly (ToolCall | undefined)[],
  steeredAtIndex: number
): ToolCall[] {
  const skipped: ToolCall[] = []
  const firstUnexecutedIndex = steeredAtIndex < 0 ? 0 : steeredAtIndex

  for (let i = firstUnexecutedIndex; i < toolCalls.length; i++) {
    const toolCall = toolCalls[i]
    if (!toolCall || toolCall.type !== 'function') continue
    skipped.push(toolCall)
  }

  return skipped
}
