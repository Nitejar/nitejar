import { describe, expect, it, vi } from 'vitest'
import type OpenAI from 'openai'
import { persistFinalModeResponseIfNeeded } from './runner'

describe('persistFinalModeResponseIfNeeded', () => {
  it('marks the existing assistant message as final when post-processing is skipped', async () => {
    const updateJob = vi.fn(() => Promise.resolve(undefined))
    const markLastAssistantAsFinalResponse = vi.fn(() => Promise.resolve(undefined))
    const appendMessage = vi.fn(() => Promise.resolve(undefined))

    const currentRunMessages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'user', content: 'What is thum.io?' },
      { role: 'assistant', content: 'A screenshot API service.' },
    ]

    const result = await persistFinalModeResponseIfNeeded({
      responseMode: 'final',
      jobId: 'job-1',
      rawFinalResponse: 'A screenshot API service.',
      currentRunMessages,
      hitLimit: false,
      deps: {
        updateJob,
        markLastAssistantAsFinalResponse,
        appendMessage,
      },
    })

    expect(result).toEqual({
      finalResponse: 'A screenshot API service.',
      handled: true,
      skippedPostProcessing: true,
    })
    expect(updateJob).toHaveBeenCalledWith('job-1', { final_response: 'A screenshot API service.' })
    expect(markLastAssistantAsFinalResponse).toHaveBeenCalledWith('job-1')
    expect(appendMessage).not.toHaveBeenCalled()
  })

  it('appends a dedicated final response message when post-processing is required', async () => {
    const updateJob = vi.fn(() => Promise.resolve(undefined))
    const markLastAssistantAsFinalResponse = vi.fn(() => Promise.resolve(undefined))
    const appendMessage = vi.fn(() => Promise.resolve(undefined))

    const currentRunMessages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'user', content: 'Fix this issue' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'tc-1',
            type: 'function',
            function: { name: 'bash', arguments: '{}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'tc-1', content: 'patched' },
      { role: 'assistant', content: 'Done.' },
    ]

    const result = await persistFinalModeResponseIfNeeded({
      responseMode: 'final',
      jobId: 'job-2',
      rawFinalResponse: 'Done.',
      processedFinalResponse: 'Patch applied successfully.',
      currentRunMessages,
      hitLimit: false,
      deps: {
        updateJob,
        markLastAssistantAsFinalResponse,
        appendMessage,
      },
    })

    expect(result).toEqual({
      finalResponse: 'Patch applied successfully.',
      handled: true,
      skippedPostProcessing: false,
    })
    expect(updateJob).toHaveBeenCalledWith('job-2', {
      final_response: 'Patch applied successfully.',
    })
    expect(markLastAssistantAsFinalResponse).not.toHaveBeenCalled()
    expect(appendMessage).toHaveBeenCalledWith('job-2', 'assistant', {
      text: 'Patch applied successfully.',
      is_final_response: true,
    })
  })

  it('does nothing when raw final response is empty', async () => {
    const updateJob = vi.fn(() => Promise.resolve(undefined))
    const markLastAssistantAsFinalResponse = vi.fn(() => Promise.resolve(undefined))
    const appendMessage = vi.fn(() => Promise.resolve(undefined))

    const result = await persistFinalModeResponseIfNeeded({
      responseMode: 'final',
      jobId: 'job-3',
      rawFinalResponse: null,
      currentRunMessages: [{ role: 'user', content: 'hello' }],
      hitLimit: false,
      deps: {
        updateJob,
        markLastAssistantAsFinalResponse,
        appendMessage,
      },
    })

    expect(result).toEqual({
      finalResponse: null,
      handled: false,
      skippedPostProcessing: false,
    })
    expect(updateJob).not.toHaveBeenCalled()
    expect(markLastAssistantAsFinalResponse).not.toHaveBeenCalled()
    expect(appendMessage).not.toHaveBeenCalled()
  })

  it('does nothing in streaming mode', async () => {
    const updateJob = vi.fn(() => Promise.resolve(undefined))
    const markLastAssistantAsFinalResponse = vi.fn(() => Promise.resolve(undefined))
    const appendMessage = vi.fn(() => Promise.resolve(undefined))

    const result = await persistFinalModeResponseIfNeeded({
      responseMode: 'streaming',
      jobId: 'job-4',
      rawFinalResponse: 'hello',
      currentRunMessages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hello' },
      ],
      hitLimit: false,
      deps: {
        updateJob,
        markLastAssistantAsFinalResponse,
        appendMessage,
      },
    })

    expect(result).toEqual({
      finalResponse: 'hello',
      handled: false,
      skippedPostProcessing: false,
    })
    expect(updateJob).not.toHaveBeenCalled()
    expect(markLastAssistantAsFinalResponse).not.toHaveBeenCalled()
    expect(appendMessage).not.toHaveBeenCalled()
  })
})
