import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@nitejar/database', () => ({
  getRuntimeControl: vi.fn(),
  setRuntimeProcessingEnabled: vi.fn(),
  incrementRuntimeControlEpoch: vi.fn(),
  getRuntimeControlStats: vi.fn(),
  markStaleRunningDispatchesAbandoned: vi.fn(),
  markAllActiveDispatchesAbandoned: vi.fn(),
  markStaleSendingEffectsUnknown: vi.fn(),
  markAllSendingEffectsUnknown: vi.fn(),
  requestPauseRunDispatchByJob: vi.fn(),
  clearPauseRunDispatchByJob: vi.fn(),
  requestCancelRunDispatchByJob: vi.fn(),
  pauseQueueLane: vi.fn(),
  resumeQueueLane: vi.fn(),
  cancelPendingQueueMessagesForQueue: vi.fn(),
  cancelPendingEffectsByDispatch: vi.fn(),
  findRunDispatchByJobId: vi.fn(),
  pauseJob: vi.fn(),
  resumeJob: vi.fn(),
  cancelJob: vi.fn(),
  failStartingActivityByJobIds: vi.fn(),
  getDb: vi.fn(() => ({})),
}))

vi.mock('@nitejar/sprites', () => ({
  closeSpriteSessionForConversation: vi.fn(),
  killBackgroundTaskSession: vi.fn(),
}))

import {
  cancelJob,
  cancelPendingEffectsByDispatch,
  cancelPendingQueueMessagesForQueue,
  findRunDispatchByJobId,
  pauseQueueLane,
  requestCancelRunDispatchByJob,
  resumeQueueLane,
} from '@nitejar/database'
import { closeSpriteSessionForConversation } from '@nitejar/sprites'
import { cancelRunByJob } from './runtime-control'

const mockedRequestCancelRunDispatchByJob = vi.mocked(requestCancelRunDispatchByJob)
const mockedFindRunDispatchByJobId = vi.mocked(findRunDispatchByJobId)
const mockedPauseQueueLane = vi.mocked(pauseQueueLane)
const mockedResumeQueueLane = vi.mocked(resumeQueueLane)
const mockedCancelPendingQueueMessagesForQueue = vi.mocked(cancelPendingQueueMessagesForQueue)
const mockedCancelPendingEffectsByDispatch = vi.mocked(cancelPendingEffectsByDispatch)
const mockedCancelJob = vi.mocked(cancelJob)
const mockedCloseSpriteSessionForConversation = vi.mocked(closeSpriteSessionForConversation)

describe('runtime control cancellation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedPauseQueueLane.mockResolvedValue(null)
    mockedResumeQueueLane.mockResolvedValue(null)
    mockedCancelPendingQueueMessagesForQueue.mockResolvedValue(0)
    mockedCancelPendingEffectsByDispatch.mockResolvedValue(0)
    mockedCancelJob.mockResolvedValue(null)
    mockedCloseSpriteSessionForConversation.mockResolvedValue(undefined)
  })

  it('resumes the queue lane after successful cancellation', async () => {
    mockedRequestCancelRunDispatchByJob.mockResolvedValue({
      id: 'dispatch-1',
      queue_key: 'queue-1',
      job_id: null,
      session_key: 'session-1',
      agent_id: 'agent-1',
    } as never)

    const result = await cancelRunByJob({ jobId: 'job-1', actor: 'tester', reason: 'cancel it' })

    expect(result).toEqual({ ok: true, dispatchId: 'dispatch-1' })
    expect(mockedPauseQueueLane).toHaveBeenCalledWith('queue-1', 'cancel it', 'tester')
    expect(mockedResumeQueueLane).toHaveBeenCalledWith('queue-1')
  })

  it('resumes the queue lane even when cancellation cleanup fails', async () => {
    mockedRequestCancelRunDispatchByJob.mockResolvedValue({
      id: 'dispatch-2',
      queue_key: 'queue-2',
      job_id: null,
      session_key: 'session-2',
      agent_id: 'agent-2',
    } as never)
    mockedCancelPendingEffectsByDispatch.mockRejectedValueOnce(new Error('effect cancel failed'))

    await expect(
      cancelRunByJob({ jobId: 'job-2', actor: 'tester', reason: 'cancel with error' })
    ).rejects.toThrow('effect cancel failed')

    expect(mockedPauseQueueLane).toHaveBeenCalledWith('queue-2', 'cancel with error', 'tester')
    expect(mockedResumeQueueLane).toHaveBeenCalledWith('queue-2')
  })

  it('resumes fallback lane when dispatch is no longer active', async () => {
    mockedRequestCancelRunDispatchByJob.mockResolvedValue(null)
    mockedFindRunDispatchByJobId.mockResolvedValue({
      id: 'dispatch-fallback',
      queue_key: 'queue-fallback',
      job_id: null,
      session_key: 'session-fallback',
      agent_id: 'agent-fallback',
    } as never)

    const result = await cancelRunByJob({
      jobId: 'job-fallback',
      actor: 'tester',
      reason: 'cancel fallback',
    })

    expect(result).toEqual({ ok: true, dispatchId: 'dispatch-fallback' })
    expect(mockedResumeQueueLane).toHaveBeenCalledWith('queue-fallback')
  })
})
