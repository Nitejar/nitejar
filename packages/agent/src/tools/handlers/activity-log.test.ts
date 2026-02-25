import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActivityLogEntry } from '@nitejar/database'

vi.mock('@nitejar/database', () => ({
  queryActivityLog: vi.fn(),
}))

vi.mock('../../embeddings', () => ({
  generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
  isEmbeddingsAvailable: vi.fn().mockReturnValue(false),
}))

import { queryActivityLog } from '@nitejar/database'
import { queryActivityTool } from './activity-log'
import type { ToolContext } from '../types'

const mockedQueryActivityLog = vi.mocked(queryActivityLog)

const stubContext: ToolContext = { spriteName: 'test-sprite' }

function makeEntry(overrides: Partial<ActivityLogEntry> = {}): ActivityLogEntry {
  return {
    id: 'act-1',
    agent_id: 'agent-1',
    agent_handle: 'scout',
    job_id: 'job-1',
    session_key: null,
    status: 'completed',
    summary: 'Triaging issue',
    final_summary: null,
    resources: null,
    embedding: null,
    created_at: Math.floor(Date.now() / 1000) - 60,
    ...overrides,
  }
}

describe('queryActivityTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('displays final_summary for completed entries when available', async () => {
    mockedQueryActivityLog.mockResolvedValue([
      makeEntry({
        status: 'completed',
        summary: 'Triaging issue #42',
        final_summary: 'Resolved issue #42 with a config fix',
      }),
    ])

    const result = await queryActivityTool({ query: 'issue 42' }, stubContext)

    expect(result.success).toBe(true)
    expect(result.output).toContain('Resolved issue #42 with a config fix')
    expect(result.output).not.toContain('Triaging issue #42')
  })

  it('falls back to summary when final_summary is null', async () => {
    mockedQueryActivityLog.mockResolvedValue([
      makeEntry({
        status: 'completed',
        summary: 'Triaging issue #99',
        final_summary: null,
      }),
    ])

    const result = await queryActivityTool({ query: 'issue 99' }, stubContext)

    expect(result.success).toBe(true)
    expect(result.output).toContain('Triaging issue #99')
  })

  it('uses summary for non-completed entries', async () => {
    mockedQueryActivityLog.mockResolvedValue([
      makeEntry({
        status: 'starting',
        summary: 'Working on PR review',
        final_summary: 'This should not show',
      }),
    ])

    const result = await queryActivityTool({ query: 'PR review' }, stubContext)

    expect(result.success).toBe(true)
    expect(result.output).toContain('Working on PR review')
    expect(result.output).not.toContain('This should not show')
  })
})
