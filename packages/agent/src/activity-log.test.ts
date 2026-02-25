import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActivityLogEntry } from '@nitejar/database'

vi.mock('@nitejar/database', () => ({
  updateActivityStatus: vi.fn(),
  findByResources: vi.fn().mockResolvedValue([]),
  findSimilarActivityEntries: vi.fn().mockResolvedValue([]),
  serializeEmbedding: vi.fn(),
  appendActivityEntry: vi.fn(),
}))

vi.mock('./embeddings', () => ({
  generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
  isEmbeddingsAvailable: vi.fn().mockReturnValue(false),
}))

vi.mock('./agent-logger', () => ({
  agentWarn: vi.fn(),
}))

import { updateActivityStatus, findByResources } from '@nitejar/database'
import { recordCompletedActivity, getRelevantActivity } from './activity-log'

const mockedUpdateActivityStatus = vi.mocked(updateActivityStatus)
const mockedFindByResources = vi.mocked(findByResources)

describe('recordCompletedActivity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedUpdateActivityStatus.mockResolvedValue(null)
  })

  it('does nothing when activityId is null', async () => {
    await recordCompletedActivity(null)
    expect(mockedUpdateActivityStatus).not.toHaveBeenCalled()
  })

  it('calls updateActivityStatus with completed status', async () => {
    await recordCompletedActivity('act-1')
    expect(mockedUpdateActivityStatus).toHaveBeenCalledWith('act-1', 'completed', undefined)
  })

  it('passes finalSummary to updateActivityStatus', async () => {
    await recordCompletedActivity('act-1', 'Responded with deployment info')
    expect(mockedUpdateActivityStatus).toHaveBeenCalledWith(
      'act-1',
      'completed',
      'Responded with deployment info'
    )
  })
})

describe('getRelevantActivity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('prefers final_summary over summary for completed entries', async () => {
    const entry: ActivityLogEntry = {
      id: 'act-1',
      agent_id: 'agent-1',
      agent_handle: 'scout',
      job_id: 'job-1',
      session_key: null,
      status: 'completed',
      summary: 'Triaging issue #42',
      final_summary: 'Resolved issue #42 by updating config',
      resources: JSON.stringify(['issue#42']),
      embedding: null,
      created_at: Math.floor(Date.now() / 1000) - 60,
    }

    mockedFindByResources.mockResolvedValue([entry])

    const result = await getRelevantActivity({
      isReadOnly: false,
      reason: 'Related to issue #42',
      reasonAutoDerived: false,
      resources: ['issue#42'],
      usage: null,
      shouldRespond: true,
      requestPayload: null,
      responsePayload: null,
    })

    expect(result).toContain('Resolved issue #42 by updating config')
    expect(result).not.toContain('Triaging issue #42')
  })

  it('falls back to summary when final_summary is null', async () => {
    const entry: ActivityLogEntry = {
      id: 'act-2',
      agent_id: 'agent-1',
      agent_handle: 'scout',
      job_id: 'job-2',
      session_key: null,
      status: 'completed',
      summary: 'Triaging issue #99',
      final_summary: null,
      resources: JSON.stringify(['issue#99']),
      embedding: null,
      created_at: Math.floor(Date.now() / 1000) - 120,
    }

    mockedFindByResources.mockResolvedValue([entry])

    const result = await getRelevantActivity({
      isReadOnly: false,
      reason: 'Related to issue #99',
      reasonAutoDerived: false,
      resources: ['issue#99'],
      usage: null,
      shouldRespond: true,
      requestPayload: null,
      responsePayload: null,
    })

    expect(result).toContain('Triaging issue #99')
  })

  it('uses summary for non-completed entries even if final_summary exists', async () => {
    const entry: ActivityLogEntry = {
      id: 'act-3',
      agent_id: 'agent-1',
      agent_handle: 'scout',
      job_id: 'job-3',
      session_key: null,
      status: 'starting',
      summary: 'Working on PR #5',
      final_summary: 'Should not appear',
      resources: JSON.stringify(['pr#5']),
      embedding: null,
      created_at: Math.floor(Date.now() / 1000) - 30,
    }

    mockedFindByResources.mockResolvedValue([entry])

    const result = await getRelevantActivity({
      isReadOnly: false,
      reason: 'Related to PR #5',
      reasonAutoDerived: false,
      resources: ['pr#5'],
      usage: null,
      shouldRespond: true,
      requestPayload: null,
      responsePayload: null,
    })

    expect(result).toContain('Working on PR #5')
    expect(result).not.toContain('Should not appear')
  })
})
