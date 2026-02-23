import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RunOptions, RunResult } from '@nitejar/agent/runner'
import type { TeamContext } from '@nitejar/agent/prompt-builder'
import type {
  ActiveRunDispatchSnapshot,
  ClaimedRunDispatch,
  RunControlDirective,
  RuntimeControl,
} from '@nitejar/database'

const {
  mockClaimNextRunDispatch,
  mockAttachJobIdToRunDispatch,
  mockHeartbeatRunDispatch,
  mockFinalizeRunDispatch,
  mockCreateEffectOutbox,
  mockListQueueMessagesByDispatch,
  mockConsumeSteeringMessages,
  mockConsumeSteeringMessagesByIds,
  mockDropPendingQueueMessagesByIds,
  mockUpdateWorkItem,
  mockGetRuntimeControl,
  mockGetRunDispatchControlDirective,
  mockAnnotateRunDispatchDecision,
  mockListActiveRunDispatchSnapshotsForAgent,
  mockListLatestSessionActivityByAgents,
  mockSetRunDispatchPaused,
  mockSetRunDispatchRunningFromPause,
  mockCancelJob,
  mockPauseJob,
  mockResumeJob,
  mockFindRunDispatchById,
  mockFindAgentById,
  mockFindWorkItemById,
  mockGetAgentsForPluginInstance,
  mockListAppSessionParticipantAgents,
  mockFindLatestExclusiveClaimForWorkItem,
  mockReapExpiredLeases,
  mockRunAgent,
  mockCreateEventCallback,
  mockDecideSteeringAction,
  mockParseAgentConfig,
  mockGetPluginInstanceWithConfig,
  mockPluginHandlerGet,
  mockCreateRunnerHookDispatch,
  mockMaybeEnqueuePassiveMemory,
  mockMaybeEnqueueEvalPipeline,
} = vi.hoisted(() => {
  const claimNextRunDispatch = vi.fn()
  const attachJobIdToRunDispatch = vi.fn()
  const heartbeatRunDispatch = vi.fn()
  const finalizeRunDispatch = vi.fn()
  const createEffectOutbox = vi.fn()
  const listQueueMessagesByDispatch = vi.fn()
  const consumeSteeringMessages = vi.fn()
  const consumeSteeringMessagesByIds = vi.fn()
  const dropPendingQueueMessagesByIds = vi.fn()
  const updateWorkItem = vi.fn()
  const getRuntimeControl = vi.fn()
  const getRunDispatchControlDirective = vi.fn()
  const annotateRunDispatchDecision = vi.fn()
  const listActiveRunDispatchSnapshotsForAgent = vi.fn()
  const listLatestSessionActivityByAgents = vi.fn()
  const setRunDispatchPaused = vi.fn()
  const setRunDispatchRunningFromPause = vi.fn()
  const cancelJob = vi.fn()
  const pauseJob = vi.fn()
  const resumeJob = vi.fn()
  const findRunDispatchById = vi.fn()
  const findAgentById = vi.fn()
  const findWorkItemById = vi.fn()
  const getAgentsForPluginInstance = vi.fn()
  const listAppSessionParticipantAgents = vi.fn()
  const findLatestExclusiveClaimForWorkItem = vi.fn()
  const reapExpiredLeases = vi.fn()

  const runAgent =
    vi.fn<(agentId: string, workItemId: string, options?: RunOptions) => Promise<RunResult>>()
  const createEventCallback = vi.fn(() => vi.fn())
  const decideSteeringAction = vi.fn()
  const parseAgentConfig = vi.fn(() => ({}))

  const getPluginInstanceWithConfig = vi.fn()
  const pluginHandlerGet = vi.fn()
  const createRunnerHookDispatch = vi.fn(() => vi.fn())

  const maybeEnqueuePassiveMemory = vi.fn(() => Promise.resolve())
  const maybeEnqueueEvalPipeline = vi.fn(() => Promise.resolve())

  return {
    mockClaimNextRunDispatch: claimNextRunDispatch,
    mockAttachJobIdToRunDispatch: attachJobIdToRunDispatch,
    mockHeartbeatRunDispatch: heartbeatRunDispatch,
    mockFinalizeRunDispatch: finalizeRunDispatch,
    mockCreateEffectOutbox: createEffectOutbox,
    mockListQueueMessagesByDispatch: listQueueMessagesByDispatch,
    mockConsumeSteeringMessages: consumeSteeringMessages,
    mockConsumeSteeringMessagesByIds: consumeSteeringMessagesByIds,
    mockDropPendingQueueMessagesByIds: dropPendingQueueMessagesByIds,
    mockUpdateWorkItem: updateWorkItem,
    mockGetRuntimeControl: getRuntimeControl,
    mockGetRunDispatchControlDirective: getRunDispatchControlDirective,
    mockAnnotateRunDispatchDecision: annotateRunDispatchDecision,
    mockListActiveRunDispatchSnapshotsForAgent: listActiveRunDispatchSnapshotsForAgent,
    mockListLatestSessionActivityByAgents: listLatestSessionActivityByAgents,
    mockSetRunDispatchPaused: setRunDispatchPaused,
    mockSetRunDispatchRunningFromPause: setRunDispatchRunningFromPause,
    mockCancelJob: cancelJob,
    mockPauseJob: pauseJob,
    mockResumeJob: resumeJob,
    mockFindRunDispatchById: findRunDispatchById,
    mockFindAgentById: findAgentById,
    mockFindWorkItemById: findWorkItemById,
    mockGetAgentsForPluginInstance: getAgentsForPluginInstance,
    mockListAppSessionParticipantAgents: listAppSessionParticipantAgents,
    mockFindLatestExclusiveClaimForWorkItem: findLatestExclusiveClaimForWorkItem,
    mockReapExpiredLeases: reapExpiredLeases,
    mockRunAgent: runAgent,
    mockCreateEventCallback: createEventCallback,
    mockDecideSteeringAction: decideSteeringAction,
    mockParseAgentConfig: parseAgentConfig,
    mockGetPluginInstanceWithConfig: getPluginInstanceWithConfig,
    mockPluginHandlerGet: pluginHandlerGet,
    mockCreateRunnerHookDispatch: createRunnerHookDispatch,
    mockMaybeEnqueuePassiveMemory: maybeEnqueuePassiveMemory,
    mockMaybeEnqueueEvalPipeline: maybeEnqueueEvalPipeline,
  }
})

vi.mock('@nitejar/database', () => ({
  claimNextRunDispatch: mockClaimNextRunDispatch,
  attachJobIdToRunDispatch: mockAttachJobIdToRunDispatch,
  heartbeatRunDispatch: mockHeartbeatRunDispatch,
  finalizeRunDispatch: mockFinalizeRunDispatch,
  createEffectOutbox: mockCreateEffectOutbox,
  listQueueMessagesByDispatch: mockListQueueMessagesByDispatch,
  consumeSteeringMessages: mockConsumeSteeringMessages,
  consumeSteeringMessagesByIds: mockConsumeSteeringMessagesByIds,
  dropPendingQueueMessagesByIds: mockDropPendingQueueMessagesByIds,
  updateWorkItem: mockUpdateWorkItem,
  getRuntimeControl: mockGetRuntimeControl,
  getRunDispatchControlDirective: mockGetRunDispatchControlDirective,
  annotateRunDispatchDecision: mockAnnotateRunDispatchDecision,
  listActiveRunDispatchSnapshotsForAgent: mockListActiveRunDispatchSnapshotsForAgent,
  listLatestSessionActivityByAgents: mockListLatestSessionActivityByAgents,
  setRunDispatchPaused: mockSetRunDispatchPaused,
  setRunDispatchRunningFromPause: mockSetRunDispatchRunningFromPause,
  cancelJob: mockCancelJob,
  pauseJob: mockPauseJob,
  resumeJob: mockResumeJob,
  findRunDispatchById: mockFindRunDispatchById,
  findAgentById: mockFindAgentById,
  findWorkItemById: mockFindWorkItemById,
  getAgentsForPluginInstance: mockGetAgentsForPluginInstance,
  listAppSessionParticipantAgents: mockListAppSessionParticipantAgents,
  findLatestExclusiveClaimForWorkItem: mockFindLatestExclusiveClaimForWorkItem,
  reapExpiredLeases: mockReapExpiredLeases,
}))

vi.mock('@nitejar/agent/runner', () => ({
  runAgent: mockRunAgent,
}))

vi.mock('@nitejar/agent/streaming', () => ({
  createEventCallback: mockCreateEventCallback,
}))

vi.mock('@nitejar/agent/steer-arbiter', () => ({
  decideSteeringAction: mockDecideSteeringAction,
}))

vi.mock('@nitejar/agent/config', () => ({
  parseAgentConfig: mockParseAgentConfig,
}))

vi.mock('@nitejar/plugin-handlers', () => ({
  getPluginInstanceWithConfig: mockGetPluginInstanceWithConfig,
  pluginHandlerRegistry: {
    get: mockPluginHandlerGet,
  },
}))

vi.mock('./plugins/hook-dispatch', () => ({
  createRunnerHookDispatch: mockCreateRunnerHookDispatch,
}))

vi.mock('./passive-memory-enqueue', () => ({
  maybeEnqueuePassiveMemory: mockMaybeEnqueuePassiveMemory,
}))

vi.mock('./eval-enqueue', () => ({
  maybeEnqueueEvalPipeline: mockMaybeEnqueueEvalPipeline,
}))

import { __dispatchWorkerTest } from './run-dispatch-worker'

const runtimeControl: RuntimeControl = {
  id: 'default',
  processing_enabled: 1,
  pause_mode: 'soft',
  pause_reason: null,
  paused_by: null,
  paused_at: null,
  control_epoch: 7,
  max_concurrent_dispatches: 2,
  updated_at: 0,
}

const mockAgent = {
  id: 'agent-1',
  name: 'TestBot',
  handle: 'testbot',
  status: 'active',
  config: '{}',
  sprite_id: null,
  created_at: 0,
  updated_at: 0,
}

const mockWorkItem = {
  id: 'wi-1',
  plugin_instance_id: 'int-1',
  session_key: 'telegram:123',
  source: 'telegram',
  source_ref: 'msg:456',
  title: 'Hello bot',
  payload: '{}',
  status: 'NEW',
  created_at: 0,
  updated_at: 0,
}

const baseDispatch = {
  id: 'dispatch-1',
  run_key: 'run-1',
  queue_key: 'telegram:123:agent-1',
  work_item_id: 'wi-1',
  agent_id: 'agent-1',
  plugin_instance_id: 'int-1',
  session_key: 'telegram:123',
  status: 'running',
  input_text: 'Hello bot',
  coalesced_text: null,
  response_context: null,
  job_id: null,
  attempt_count: 0,
  claimed_by: 'worker-1',
  lease_expires_at: Math.floor(Date.now() / 1000) + 120,
  claimed_epoch: 1,
  control_state: null,
  control_reason: null,
  replay_of_dispatch_id: null,
  created_at: 0,
  updated_at: 0,
}

function makeClaimedDispatch(overrides: Record<string, unknown> = {}): ClaimedRunDispatch {
  return {
    dispatch: { ...baseDispatch, ...overrides } as unknown as ClaimedRunDispatch['dispatch'],
    messages: [] as ClaimedRunDispatch['messages'],
  }
}

function makeRunResult(finalResponse: string | null): RunResult {
  return {
    job: { id: 'job-1' } as RunResult['job'],
    finalResponse,
    hitLimit: false,
  }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('run dispatch worker control flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    __dispatchWorkerTest.resetState()

    mockGetRuntimeControl.mockResolvedValue(runtimeControl)
    mockClaimNextRunDispatch.mockResolvedValue(null)
    mockReapExpiredLeases.mockResolvedValue(0)

    mockFindAgentById.mockResolvedValue(mockAgent)
    mockFindWorkItemById.mockResolvedValue(mockWorkItem)
    mockGetPluginInstanceWithConfig.mockResolvedValue({
      id: 'int-1',
      type: 'telegram',
      config: null,
    })
    mockPluginHandlerGet.mockReturnValue({ responseMode: 'streaming' })
    mockGetAgentsForPluginInstance.mockResolvedValue([mockAgent])
    mockListAppSessionParticipantAgents.mockResolvedValue([])
    mockListActiveRunDispatchSnapshotsForAgent.mockResolvedValue([])
    mockListLatestSessionActivityByAgents.mockResolvedValue([])
    mockFindLatestExclusiveClaimForWorkItem.mockResolvedValue(null)

    mockGetRunDispatchControlDirective.mockResolvedValue({ action: 'continue' })
    mockDecideSteeringAction.mockResolvedValue({ decision: 'interrupt_now', reason: 'urgent' })
    mockConsumeSteeringMessagesByIds.mockResolvedValue([])
    mockConsumeSteeringMessages.mockResolvedValue([])
    mockDropPendingQueueMessagesByIds.mockResolvedValue(0)
    mockAnnotateRunDispatchDecision.mockResolvedValue(undefined)

    mockHeartbeatRunDispatch.mockResolvedValue(undefined)
    mockAttachJobIdToRunDispatch.mockResolvedValue(undefined)
    mockFinalizeRunDispatch.mockResolvedValue(true)
    mockListQueueMessagesByDispatch.mockResolvedValue([])
    mockUpdateWorkItem.mockResolvedValue(undefined)
    mockCreateEffectOutbox.mockResolvedValue(undefined)

    mockPauseJob.mockResolvedValue(undefined)
    mockResumeJob.mockResolvedValue(undefined)
    mockCancelJob.mockResolvedValue(undefined)
    mockSetRunDispatchPaused.mockResolvedValue(undefined)
    mockSetRunDispatchRunningFromPause.mockResolvedValue(undefined)
    mockFindRunDispatchById.mockResolvedValue(null)

    mockRunAgent.mockResolvedValue(makeRunResult(null))
  })

  afterEach(() => {
    vi.useRealTimers()
    __dispatchWorkerTest.resetState()
  })

  describe('claiming dispatches', () => {
    it('does nothing when processing is disabled', async () => {
      mockGetRuntimeControl.mockResolvedValue({ ...runtimeControl, processing_enabled: 0 })

      await __dispatchWorkerTest.claimAndDispatch()

      expect(mockClaimNextRunDispatch).not.toHaveBeenCalled()
      expect(mockRunAgent).not.toHaveBeenCalled()
    })

    it('does nothing when no dispatch is available', async () => {
      mockClaimNextRunDispatch.mockResolvedValue(null)

      await __dispatchWorkerTest.claimAndDispatch()

      expect(mockClaimNextRunDispatch).toHaveBeenCalledTimes(1)
      expect(mockRunAgent).not.toHaveBeenCalled()
    })

    it('claims dispatches with worker id and lease seconds', async () => {
      mockClaimNextRunDispatch
        .mockResolvedValueOnce(makeClaimedDispatch())
        .mockResolvedValueOnce(null)

      await __dispatchWorkerTest.claimAndDispatch()
      await flushPromises()

      expect(mockClaimNextRunDispatch).toHaveBeenCalled()
      expect(mockClaimNextRunDispatch.mock.calls[0]?.[0]).toMatch(/^run-worker:/)
      expect(mockClaimNextRunDispatch.mock.calls[0]?.[1]).toEqual({ leaseSeconds: 120 })
    })
  })

  describe('lease and heartbeat management', () => {
    it('attaches heartbeat while running and clears it after completion', async () => {
      vi.useFakeTimers()
      const clearSpy = vi.spyOn(global, 'clearInterval')
      mockRunAgent.mockImplementation(
        () =>
          new Promise<RunResult>((resolve) => {
            setTimeout(() => resolve(makeRunResult(null)), 30_000)
          })
      )

      const executePromise = __dispatchWorkerTest.executeDispatch(
        makeClaimedDispatch(),
        runtimeControl
      )
      await vi.advanceTimersByTimeAsync(20_000)
      expect(mockHeartbeatRunDispatch).toHaveBeenCalledWith('dispatch-1', 120)

      await vi.advanceTimersByTimeAsync(10_000)
      await executePromise
      await vi.advanceTimersByTimeAsync(40_000)

      expect(mockHeartbeatRunDispatch).toHaveBeenCalledTimes(1)
      expect(clearSpy).toHaveBeenCalled()
      clearSpy.mockRestore()
    })

    it('clears heartbeat and fails dispatch when run throws', async () => {
      vi.useFakeTimers()
      const clearSpy = vi.spyOn(global, 'clearInterval')
      mockRunAgent.mockRejectedValue(new Error('boom'))

      await __dispatchWorkerTest.executeDispatch(makeClaimedDispatch(), runtimeControl)

      expect(mockFinalizeRunDispatch).toHaveBeenCalledWith(
        'dispatch-1',
        expect.objectContaining({
          status: 'failed',
          error: 'boom',
          expectedEpoch: 1,
        })
      )
      expect(clearSpy).toHaveBeenCalled()
      clearSpy.mockRestore()
    })
  })

  describe('pre-run validation', () => {
    it('fails dispatch when work item is not found', async () => {
      mockFindWorkItemById.mockResolvedValue(null)
      mockRunAgent.mockRejectedValue(new Error('Work item not found: wi-1'))

      await __dispatchWorkerTest.executeDispatch(makeClaimedDispatch(), runtimeControl)

      expect(mockFinalizeRunDispatch).toHaveBeenCalledWith(
        'dispatch-1',
        expect.objectContaining({ status: 'failed', error: 'Work item not found: wi-1' })
      )
      expect(mockUpdateWorkItem).toHaveBeenCalledWith('wi-1', { status: 'FAILED' })
    })

    it('fails dispatch when agent is not found', async () => {
      mockFindAgentById.mockResolvedValue(null)
      mockRunAgent.mockRejectedValue(new Error('Agent not found: agent-1'))

      await __dispatchWorkerTest.executeDispatch(makeClaimedDispatch(), runtimeControl)

      expect(mockFinalizeRunDispatch).toHaveBeenCalledWith(
        'dispatch-1',
        expect.objectContaining({ status: 'failed', error: 'Agent not found: agent-1' })
      )
    })

    it('loads teammate config before running', async () => {
      const teammate = {
        id: 'agent-2',
        name: 'Pixel',
        handle: 'pixel',
        status: 'idle',
        config: '{"title":"Ops"}',
        sprite_id: null,
        created_at: 0,
        updated_at: 0,
      }
      mockGetAgentsForPluginInstance.mockResolvedValue([mockAgent, teammate])
      mockParseAgentConfig.mockReturnValue({ title: 'Ops' })

      let capturedTeamContext: TeamContext | undefined
      mockRunAgent.mockImplementation(
        (_agentId: string, _workItemId: string, options?: RunOptions) => {
          capturedTeamContext = options?.teamContext
          return Promise.resolve(makeRunResult(null))
        }
      )

      await __dispatchWorkerTest.executeDispatch(makeClaimedDispatch(), runtimeControl)

      expect(mockParseAgentConfig).toHaveBeenCalledWith('{"title":"Ops"}')
      expect(capturedTeamContext).toMatchObject({
        teammates: [{ handle: 'pixel', name: 'Pixel', role: 'Ops' }],
      })
    })
  })

  describe('team context assembly', () => {
    it('includes exclusive claim and teammate activity in dispatch info', async () => {
      const teammate = {
        id: 'agent-2',
        name: 'Pixel',
        handle: 'pixel',
        status: 'idle',
        config: '{}',
        sprite_id: null,
        created_at: 0,
        updated_at: 0,
      }
      mockGetAgentsForPluginInstance.mockResolvedValue([mockAgent, teammate])
      mockFindLatestExclusiveClaimForWorkItem.mockResolvedValue({
        dispatch_id: 'dispatch-teammate',
        agent_id: 'agent-2',
        work_item_id: 'wi-1',
        session_key: 'telegram:123',
        control_reason: 'arbiter:exclusive_claim:triage_volunteer:agent-2',
        control_updated_at: 10,
        updated_at: 10,
      })
      mockListLatestSessionActivityByAgents.mockResolvedValue([
        {
          agent_id: 'agent-2',
          agent_handle: 'pixel',
          status: 'passed',
          summary: 'Already handled by teammate.',
        },
      ])
      mockListActiveRunDispatchSnapshotsForAgent.mockResolvedValue([
        {
          dispatch_id: 'dispatch-teammate',
          status: 'running',
          queue_key: 'telegram:123:agent-2',
          session_key: 'telegram:123',
          source: 'telegram',
          title: 'help',
          created_at: 1,
        },
      ])

      let optionsTeamContext: TeamContext | undefined
      mockRunAgent.mockImplementation(
        (_agentId: string, _workItemId: string, options?: RunOptions) => {
          optionsTeamContext = options?.teamContext
          return Promise.resolve(makeRunResult(null))
        }
      )

      await __dispatchWorkerTest.executeDispatch(makeClaimedDispatch(), runtimeControl)

      expect(mockFindLatestExclusiveClaimForWorkItem).toHaveBeenCalledWith('wi-1', {
        excludeDispatchId: 'dispatch-1',
      })
      expect(optionsTeamContext?.dispatchInfo).toContain(
        'Exclusive responder volunteer for this work item'
      )
      expect(optionsTeamContext?.dispatchInfo).toContain('Recent triage log:')
      expect(optionsTeamContext?.dispatchInfo).toContain('route=pass')
    })
  })

  describe('run execution', () => {
    it('calls runAgent with expected parameters', async () => {
      mockPluginHandlerGet.mockReturnValue({ responseMode: 'final' })

      await __dispatchWorkerTest.executeDispatch(
        makeClaimedDispatch({ coalesced_text: 'Merged text' }),
        runtimeControl
      )

      const runCall = mockRunAgent.mock.calls[0]
      expect(runCall?.[0]).toBe('agent-1')
      expect(runCall?.[1]).toBe('wi-1')
      const options = runCall?.[2]
      expect(options?.coalescedText).toBe('Merged text')
      expect(options?.skipTriage).toBe(false)
      expect(options?.responseMode).toBe('final')
      expect(typeof options?.hookDispatch).toBe('function')
      expect(typeof options?.onEvent).toBe('function')
      expect(typeof options?.getRunControlDirective).toBe('function')
    })
  })

  describe('post-run processing', () => {
    it('creates effect outbox entry when final response exists', async () => {
      const teammate = {
        id: 'agent-2',
        name: 'Pixel',
        handle: 'pixel',
        status: 'idle',
        config: '{}',
        sprite_id: null,
        created_at: 0,
        updated_at: 0,
      }
      mockGetAgentsForPluginInstance.mockResolvedValue([mockAgent, teammate])
      mockRunAgent.mockResolvedValue(makeRunResult('Hello world'))

      await __dispatchWorkerTest.executeDispatch(makeClaimedDispatch(), runtimeControl)

      expect(mockFinalizeRunDispatch).toHaveBeenCalledWith(
        'dispatch-1',
        expect.objectContaining({ status: 'completed', expectedEpoch: 1 })
      )
      expect(mockUpdateWorkItem).toHaveBeenCalledWith('wi-1', { status: 'DONE' })
      expect(mockCreateEffectOutbox).toHaveBeenCalledTimes(1)

      const outboxCall = mockCreateEffectOutbox.mock.calls[0]?.[0] as
        | { payload: string }
        | undefined
      expect(outboxCall).toBeDefined()
      const effectPayload = JSON.parse(outboxCall!.payload) as { content?: string }
      expect(effectPayload.content).toBe('[TestBot] Hello world')
    })

    it('does not create effect outbox entry when final response is empty', async () => {
      mockRunAgent.mockResolvedValue(makeRunResult(null))

      await __dispatchWorkerTest.executeDispatch(makeClaimedDispatch(), runtimeControl)

      expect(mockCreateEffectOutbox).not.toHaveBeenCalled()
    })

    it('records exclusive claim annotation when triage returns exclusive', async () => {
      mockRunAgent.mockImplementation(
        (_agentId: string, _workItemId: string, options?: RunOptions) => {
          options?.onEvent?.({
            type: 'triage',
            shouldRespond: true,
            reason: 'I should answer',
            exclusiveClaim: true,
          })
          return Promise.resolve(makeRunResult(null))
        }
      )

      await __dispatchWorkerTest.executeDispatch(makeClaimedDispatch(), runtimeControl)

      expect(mockAnnotateRunDispatchDecision).toHaveBeenCalledWith(
        'dispatch-1',
        'arbiter:exclusive_claim:triage_volunteer:agent-1'
      )
    })

    it('marks dispatch failed and work item failed when runAgent throws', async () => {
      mockRunAgent.mockRejectedValue(new Error('model crashed'))

      await __dispatchWorkerTest.executeDispatch(makeClaimedDispatch(), runtimeControl)

      expect(mockFinalizeRunDispatch).toHaveBeenCalledWith(
        'dispatch-1',
        expect.objectContaining({ status: 'failed', error: 'model crashed' })
      )
      expect(mockUpdateWorkItem).toHaveBeenCalledWith('wi-1', { status: 'FAILED' })
    })
  })

  describe('control flow callbacks', () => {
    it('pauses dispatch and pauses job on onPaused callback', async () => {
      mockRunAgent.mockImplementation(
        async (_agentId: string, _workItemId: string, options?: RunOptions) => {
          options?.onEvent?.({ type: 'job_started', jobId: 'job-42' })
          await options?.onPaused?.()
          return makeRunResult(null)
        }
      )

      await __dispatchWorkerTest.executeDispatch(makeClaimedDispatch(), runtimeControl)

      expect(mockSetRunDispatchPaused).toHaveBeenCalledWith('dispatch-1')
      expect(mockPauseJob).toHaveBeenCalledWith('job-42')
    })

    it('resumes dispatch and resumes job on onResumed callback', async () => {
      mockRunAgent.mockImplementation(
        async (_agentId: string, _workItemId: string, options?: RunOptions) => {
          options?.onEvent?.({ type: 'job_started', jobId: 'job-43' })
          await options?.onResumed?.()
          return makeRunResult(null)
        }
      )

      await __dispatchWorkerTest.executeDispatch(makeClaimedDispatch(), runtimeControl)

      expect(mockSetRunDispatchRunningFromPause).toHaveBeenCalledWith('dispatch-1')
      expect(mockResumeJob).toHaveBeenCalledWith('job-43')
    })

    it('cancels running job on onCancelled callback', async () => {
      mockRunAgent.mockImplementation(
        async (_agentId: string, _workItemId: string, options?: RunOptions) => {
          options?.onEvent?.({ type: 'job_started', jobId: 'job-44' })
          await options?.onCancelled?.()
          return makeRunResult(null)
        }
      )

      await __dispatchWorkerTest.executeDispatch(makeClaimedDispatch(), runtimeControl)

      expect(mockCancelJob).toHaveBeenCalledWith('job-44', 'Cancelled by operator')
    })

    it('routes steer directives through steer arbiter and consumes selected messages', async () => {
      mockGetRunDispatchControlDirective.mockResolvedValue({
        action: 'steer',
        messages: [{ id: 'msg-1', text: 'Please switch context', senderName: 'Josh' }],
      })
      mockDecideSteeringAction.mockResolvedValue({
        decision: 'interrupt_now',
        reason: 'new urgent ask',
      })
      mockListActiveRunDispatchSnapshotsForAgent.mockImplementation(
        (
          agentId: string,
          options?: { excludeDispatchId?: string }
        ): Promise<ActiveRunDispatchSnapshot[]> => {
          if (agentId === 'agent-1' && options?.excludeDispatchId) {
            return Promise.resolve([
              {
                dispatch_id: 'dispatch-other',
                status: 'running',
                queue_key: 'telegram:999:agent-1',
                session_key: 'telegram:999',
                source: 'telegram',
                title: 'old ask',
                created_at: 1,
              },
            ])
          }
          return Promise.resolve([])
        }
      )
      mockConsumeSteeringMessagesByIds.mockResolvedValue([
        {
          id: 'msg-1',
          text: 'Please switch context',
          sender_name: 'Josh',
        },
      ])

      mockRunAgent.mockImplementation(
        async (_agentId: string, _workItemId: string, options?: RunOptions) => {
          const directive = (await options?.getRunControlDirective?.()) as
            | RunControlDirective
            | undefined
          expect(directive).toEqual({
            action: 'steer',
            messages: [{ id: 'msg-1', text: 'Please switch context', senderName: 'Josh' }],
          })

          const steered = await options?.onSteered?.()
          expect(steered).toEqual([{ text: 'Please switch context', senderName: 'Josh' }])
          return makeRunResult(null)
        }
      )

      await __dispatchWorkerTest.executeDispatch(makeClaimedDispatch(), runtimeControl)

      expect(mockDecideSteeringAction).toHaveBeenCalledWith(
        expect.objectContaining({
          queueKey: 'telegram:123:agent-1',
          pendingMessages: [{ id: 'msg-1', text: 'Please switch context', senderName: 'Josh' }],
          activeWork: [
            expect.objectContaining({
              dispatchId: 'dispatch-other',
              status: 'running',
            }),
          ],
        })
      )
      expect(mockAnnotateRunDispatchDecision).toHaveBeenCalledWith(
        'dispatch-1',
        'arbiter:interrupt_now:new urgent ask'
      )
      expect(mockConsumeSteeringMessagesByIds).toHaveBeenCalledWith(['msg-1'], 'dispatch-1')
    })

    it('drops steering messages when arbiter chooses ignore', async () => {
      mockGetRunDispatchControlDirective.mockResolvedValue({
        action: 'steer',
        messages: [{ id: 'msg-9', text: 'noise', senderName: 'Bot' }],
      })
      mockDecideSteeringAction.mockResolvedValue({
        decision: 'ignore',
        reason: 'duplicate',
      })

      mockRunAgent.mockImplementation(
        async (_agentId: string, _workItemId: string, options?: RunOptions) => {
          const directive = (await options?.getRunControlDirective?.()) as
            | RunControlDirective
            | undefined
          expect(directive).toEqual({ action: 'continue' })
          return makeRunResult(null)
        }
      )

      await __dispatchWorkerTest.executeDispatch(makeClaimedDispatch(), runtimeControl)

      expect(mockDropPendingQueueMessagesByIds).toHaveBeenCalledWith(
        ['msg-9'],
        'arbiter:ignore:duplicate'
      )
      expect(mockConsumeSteeringMessagesByIds).not.toHaveBeenCalled()
    })
  })
})
