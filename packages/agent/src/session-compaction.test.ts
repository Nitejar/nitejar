import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionMessage } from '@nitejar/database'
import { compactSession } from './session'

vi.mock('@nitejar/database', () => ({
  listMessagesBySession: vi.fn(),
  getLastSessionMessageTime: vi.fn(),
  findLatestSessionSummary: vi.fn(),
  createSessionSummary: vi.fn(),
  deleteNonPermanentMemoriesByAgent: vi.fn(),
}))

vi.mock('@nitejar/sprites', () => ({
  closeSpriteSessionForConversation: vi.fn(),
}))

import { listMessagesBySession, createSessionSummary } from '@nitejar/database'
import { closeSpriteSessionForConversation } from '@nitejar/sprites'

const mockedListMessagesBySession = vi.mocked(listMessagesBySession)
const mockedCreateSessionSummary = vi.mocked(createSessionSummary)
const mockedCloseSpriteSessionForConversation = vi.mocked(closeSpriteSessionForConversation)

function makeMessage(
  role: SessionMessage['role'],
  text: string,
  createdAt: number,
  id: string
): SessionMessage {
  return {
    id,
    job_id: `job-${id}`,
    role,
    content: JSON.stringify({ text }),
    created_at: createdAt,
    embedding: null,
    workItemTitle: 'work',
    workItemCreatedAt: createdAt,
    jobCreatedAt: createdAt,
    agentId: 'agent-1',
    agentHandle: 'slopper',
    agentName: 'Slopper',
    jobHasFinalResponse: false,
  }
}

describe('compactSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('stores summary and cleans up sprite session for a normal conversation', async () => {
    mockedListMessagesBySession.mockResolvedValue([
      makeMessage('user', 'hello', 1000, '1'),
      makeMessage('assistant', 'hi there', 1001, '2'),
      makeMessage('user', 'ship the fix', 1002, '3'),
      makeMessage('assistant', 'done', 1003, '4'),
    ])

    await compactSession(
      'session-1',
      'agent-1',
      {
        enabled: true,
        summaryMaxTokens: 500,
        extractMemories: false,
        loadPreviousSummary: true,
      },
      (messages) => Promise.resolve(`summary from ${messages.length} messages`)
    )

    expect(mockedCreateSessionSummary).toHaveBeenCalledTimes(1)
    const summaryInput = mockedCreateSessionSummary.mock.calls[0]?.[0]
    expect(summaryInput?.session_key).toBe('session-1')
    expect(summaryInput?.agent_id).toBe('agent-1')
    expect(summaryInput?.summary).toBe('summary from 4 messages')
    expect(summaryInput?.turn_count).toBe(2)
    expect(summaryInput?.start_time).toBe(1000)
    expect(summaryInput?.end_time).toBe(1003)

    expect(mockedCloseSpriteSessionForConversation).toHaveBeenCalledWith('session-1', 'agent-1')
  })

  it('handles long synthetic sessions and still writes compaction summary', async () => {
    const longMessages: SessionMessage[] = []
    for (let i = 0; i < 80; i++) {
      const createdAt = 2000 + i
      const role: SessionMessage['role'] = i % 2 === 0 ? 'user' : 'assistant'
      longMessages.push(makeMessage(role, `chunk-${i} ${'x'.repeat(600)}`, createdAt, String(i)))
    }

    mockedListMessagesBySession.mockResolvedValue(longMessages)

    const summarize = vi.fn((messages: SessionMessage[]) =>
      Promise.resolve(`long-summary-${messages.length}`)
    )

    await compactSession(
      'session-long',
      'agent-1',
      {
        enabled: true,
        summaryMaxTokens: 500,
        extractMemories: false,
        loadPreviousSummary: true,
      },
      summarize
    )

    expect(summarize).toHaveBeenCalledTimes(1)
    expect(summarize).toHaveBeenCalledWith(longMessages)
    expect(mockedCreateSessionSummary).toHaveBeenCalledTimes(1)
    expect(mockedCreateSessionSummary.mock.calls[0]?.[0]?.turn_count).toBe(40)
    expect(mockedCloseSpriteSessionForConversation).toHaveBeenCalledWith('session-long', 'agent-1')
  })

  it('does nothing when compaction is disabled', async () => {
    await compactSession('session-disabled', 'agent-1', {
      enabled: false,
      summaryMaxTokens: 500,
      extractMemories: false,
      loadPreviousSummary: true,
    })

    expect(mockedListMessagesBySession).not.toHaveBeenCalled()
    expect(mockedCreateSessionSummary).not.toHaveBeenCalled()
    expect(mockedCloseSpriteSessionForConversation).not.toHaveBeenCalled()
  })

  it('does nothing when there are no completed messages', async () => {
    mockedListMessagesBySession.mockResolvedValue([])

    await compactSession('session-empty', 'agent-1', {
      enabled: true,
      summaryMaxTokens: 500,
      extractMemories: false,
      loadPreviousSummary: true,
    })

    expect(mockedCreateSessionSummary).not.toHaveBeenCalled()
    expect(mockedCloseSpriteSessionForConversation).not.toHaveBeenCalled()
  })
})
