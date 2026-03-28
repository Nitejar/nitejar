import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScheduledItem, WorkItem, Agent, QueueMessage } from '@nitejar/database'

// Mock transaction: execute runs the callback with mockTrx, simulating db.transaction().execute()
const mockExecuteTakeFirst = vi.fn<() => Promise<{ trigger_kind: string } | null>>(() =>
  Promise.resolve(null)
)
const mockWhere = vi.fn(() => ({ executeTakeFirst: mockExecuteTakeFirst }))
const mockSelect = vi.fn(() => ({ where: mockWhere }))
const mockSelectFrom = vi.fn(() => ({ select: mockSelect }))
const mockTrx = {
  selectFrom: mockSelectFrom,
} as never
const mockTransaction = { execute: vi.fn((cb: (trx: never) => Promise<unknown>) => cb(mockTrx)) }

vi.mock('@nitejar/database', () => ({
  getDb: vi.fn(() => ({ transaction: () => mockTransaction })),
  createTicketLink: vi.fn(),
  listPendingScheduledItems: vi.fn(),
  claimScheduledItem: vi.fn(),
  confirmScheduledItemFired: vi.fn(),
  releaseScheduledItem: vi.fn(),
  recoverStaleFiringItems: vi.fn(),
  createWorkItem: vi.fn(),
  enqueueToLane: vi.fn(),
  findAgentById: vi.fn(),
  findRoutineRunById: vi.fn(),
  findTicketById: vi.fn(),
  linkRoutineRunToWorkItemByScheduledItem: vi.fn(),
  parseAppSessionKey: vi.fn(() => ({
    isAppSession: false,
    isLegacy: false,
    raw: 'sess-1',
    contextKind: null,
    contextId: null,
    sessionId: null,
    familyKey: null,
    ownerUserId: null,
  })),
  updateRoutine: vi.fn(),
  archiveRoutine: vi.fn(),
}))

vi.mock('./routines/publish', () => ({
  publishRoutineEnvelopeFromWorkItem: vi.fn(() =>
    Promise.resolve({
      enqueued: true,
      eventKey: 'work_item:test',
    })
  ),
}))

vi.mock('./app-session-context', () => ({
  createRoutineAppSessionFromSeed: vi.fn(() => Promise.resolve(null)),
}))

import {
  createTicketLink,
  archiveRoutine,
  listPendingScheduledItems,
  claimScheduledItem,
  confirmScheduledItemFired,
  releaseScheduledItem,
  recoverStaleFiringItems,
  createWorkItem,
  enqueueToLane,
  findAgentById,
  findRoutineRunById,
  findTicketById,
  parseAppSessionKey,
} from '@nitejar/database'
import { createRoutineAppSessionFromSeed } from './app-session-context'

const TICKER_STATE_KEY = '__nitejarSchedulerTicker'

type TickerState = {
  started: boolean
  running: boolean
  timer?: NodeJS.Timeout
  processFn?: () => Promise<void>
}

async function runTick(): Promise<void> {
  const g = globalThis as unknown as Record<string, TickerState | undefined>

  // Pre-seed state with started=true so ensureSchedulerTicker skips the interval
  // setup and initial auto-fire. We only want it to install processFn.
  g[TICKER_STATE_KEY] = { started: true, running: false }

  const mod = await import('./scheduler-ticker')
  mod.ensureSchedulerTicker()

  const state = g[TICKER_STATE_KEY]
  if (!state?.processFn) {
    throw new Error('scheduler ticker processFn was not initialized in test setup')
  }
  await state.processFn()
}

const mockedListPending = vi.mocked(listPendingScheduledItems)
const mockedClaim = vi.mocked(claimScheduledItem)
const mockedConfirmFired = vi.mocked(confirmScheduledItemFired)
const mockedRelease = vi.mocked(releaseScheduledItem)
const mockedRecoverStale = vi.mocked(recoverStaleFiringItems)
const mockedCreateTicketLink = vi.mocked(createTicketLink)
const mockedCreateWorkItem = vi.mocked(createWorkItem)
const mockedEnqueueToLane = vi.mocked(enqueueToLane)
const mockedFindAgent = vi.mocked(findAgentById)
const mockedFindRoutineRunById = vi.mocked(findRoutineRunById)
const mockedFindTicketById = vi.mocked(findTicketById)
const mockedParseAppSessionKey = vi.mocked(parseAppSessionKey)
const mockedCreateRoutineAppSessionFromSeed = vi.mocked(createRoutineAppSessionFromSeed)
const mockedArchiveRoutine = vi.mocked(archiveRoutine)

type RoutineAppSession = NonNullable<Awaited<ReturnType<typeof createRoutineAppSessionFromSeed>>>
type RoutineRun = NonNullable<Awaited<ReturnType<typeof findRoutineRunById>>>
type TicketRecord = NonNullable<Awaited<ReturnType<typeof findTicketById>>>

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeScheduledItem(overrides?: Partial<ScheduledItem>): ScheduledItem {
  const merged: ScheduledItem = {
    id: 'si-1',
    agent_id: 'agent-1',
    session_key: 'sess-1',
    type: 'deferred',
    payload: '{"text":"hello"}',
    run_at: 1000,
    recurrence: null,
    status: 'pending',
    source_ref: null,
    plugin_instance_id: 'integ-1',
    response_context: '{"chat_id":123}',
    routine_id: null,
    routine_run_id: null,
    created_at: 900,
    fired_at: null,
    cancelled_at: null,
    ...overrides,
  }

  return {
    ...merged,
    routine_id: merged.routine_id ?? null,
    routine_run_id: merged.routine_run_id ?? null,
  }
}

function makeAgent(overrides?: Partial<Agent>): Agent {
  return {
    id: 'agent-1',
    name: 'TestBot',
    handle: 'testbot',
    status: 'active',
    config: '{}',
    sprite_id: null,
    created_at: 0,
    updated_at: 0,
    ...overrides,
  }
}

function makeWorkItem(overrides?: Partial<WorkItem>): WorkItem {
  return {
    id: 'wi-1',
    plugin_instance_id: 'integ-1',
    session_key: 'sess-1',
    source: 'scheduler',
    source_ref: 'scheduled:si-1',
    status: 'NEW',
    title: 'Scheduled: deferred',
    payload: '{"text":"hello"}',
    created_at: 1000,
    updated_at: 1000,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Helpers for common mock setups
// ---------------------------------------------------------------------------

/** Set up mocks for a successful happy-path tick */
function setupHappyPath(item: ScheduledItem, agent: Agent, workItem: WorkItem): void {
  mockedListPending.mockResolvedValue([item])
  mockedClaim.mockResolvedValue({ ...item, status: 'firing' })
  mockedFindAgent.mockResolvedValue(agent)
  mockedCreateWorkItem.mockResolvedValue(workItem)
  mockedEnqueueToLane.mockResolvedValue({} as QueueMessage)
  mockedConfirmFired.mockResolvedValue({ ...item, status: 'fired', fired_at: 1000 })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('scheduler-ticker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const g = globalThis as Record<string, unknown>
    delete g[TICKER_STATE_KEY]
    mockedRecoverStale.mockResolvedValue(0)
    mockedParseAppSessionKey.mockReturnValue({
      isAppSession: false,
      isLegacy: false,
      raw: 'sess-1',
      contextKind: null,
      contextId: null,
      sessionId: null,
      familyKey: null,
      ownerUserId: null,
    })
    mockedCreateRoutineAppSessionFromSeed.mockResolvedValue(null)
    mockedFindRoutineRunById.mockResolvedValue(null)
    mockedFindTicketById.mockResolvedValue(null)
    mockExecuteTakeFirst.mockResolvedValue(null)
    // Default: transaction runs callback synchronously with mockTrx
    mockTransaction.execute.mockImplementation((cb: (trx: never) => Promise<unknown>) =>
      cb(mockTrx)
    )
  })

  // -------------------------------------------------------------------------
  // Early-exit paths (no transaction needed)
  // -------------------------------------------------------------------------

  it('does nothing when no pending items', async () => {
    mockedListPending.mockResolvedValue([])

    await runTick()

    expect(mockedRecoverStale).toHaveBeenCalled()
    expect(mockedListPending).toHaveBeenCalled()
    expect(mockedClaim).not.toHaveBeenCalled()
    expect(mockedCreateWorkItem).not.toHaveBeenCalled()
  })

  it('runs stale recovery before processing items', async () => {
    mockedRecoverStale.mockResolvedValue(2)
    mockedListPending.mockResolvedValue([])

    await runTick()

    expect(mockedRecoverStale).toHaveBeenCalledWith(300)
  })

  it('links deferred ticket executions back to the ticket and uses the ticket title', async () => {
    const item = makeScheduledItem({
      id: 'si-ticket',
      routine_id: 'routine-1',
      routine_run_id: 'rr-1',
      session_key: 'app:routine:routine-1:seed',
    })
    const agent = makeAgent()
    const workItem = makeWorkItem({ id: 'wi-ticket', title: 'Scheduled ticket: Prune Revenue Ops' })

    setupHappyPath(item, agent, workItem)
    mockedParseAppSessionKey.mockReturnValue({
      isAppSession: true,
      isLegacy: false,
      raw: item.session_key,
      contextKind: 'routine',
      contextId: 'routine-1',
      sessionId: 'seed',
      familyKey: 'app:routine:routine-1',
      ownerUserId: null,
    })
    mockedCreateRoutineAppSessionFromSeed.mockResolvedValue({
      session_key: 'app:routine:routine-1:fresh',
      owner_user_id: 'user-1',
      primary_agent_id: 'agent-1',
      title: 'Deferred execution',
      forked_from_session_key: item.session_key,
      created_at: 1,
      updated_at: 1,
      last_activity_at: 1,
    } satisfies RoutineAppSession)
    mockedFindRoutineRunById.mockResolvedValue({
      id: 'rr-1',
      routine_id: 'routine-1',
      trigger_origin: 'oneshot',
      trigger_ref: 'ticket:ticket-1',
      envelope_json: null,
      decision: 'enqueue',
      decision_reason: null,
      scheduled_item_id: 'si-ticket',
      work_item_id: null,
      evaluated_at: 1,
      created_at: 1,
    } satisfies RoutineRun)
    mockedFindTicketById.mockResolvedValue({
      id: 'ticket-1',
      goal_id: null,
      parent_ticket_id: null,
      title: 'Prune Revenue Ops team to core 3 agents',
      body: null,
      status: 'in_progress',
      assignee_kind: 'agent',
      assignee_ref: 'agent-1',
      created_by_user_id: 'user-1',
      claimed_at: null,
      claimed_by_kind: null,
      claimed_by_ref: null,
      created_at: 1,
      updated_at: 1,
      archived_at: null,
      sort_order: 1,
    } satisfies TicketRecord)

    await runTick()

    expect(mockedCreateWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Scheduled ticket: Prune Revenue Ops team to core 3 agents',
        session_key: 'app:routine:routine-1:fresh',
      }),
      expect.anything()
    )
    expect(mockedCreateTicketLink).toHaveBeenCalledWith(
      expect.objectContaining({
        ticket_id: 'ticket-1',
        kind: 'session',
        ref: 'app:routine:routine-1:fresh',
      }),
      expect.anything()
    )
    expect(mockedCreateTicketLink).toHaveBeenCalledWith(
      expect.objectContaining({
        ticket_id: 'ticket-1',
        kind: 'work_item',
        ref: 'wi-ticket',
      }),
      expect.anything()
    )
  })

  it('skips item already claimed by another process', async () => {
    const item = makeScheduledItem()
    mockedListPending.mockResolvedValue([item])
    mockedClaim.mockResolvedValue(null)

    await runTick()

    expect(mockedClaim).toHaveBeenCalledWith(item.id)
    expect(mockedFindAgent).not.toHaveBeenCalled()
    expect(mockedCreateWorkItem).not.toHaveBeenCalled()
  })

  it('does not release if claim itself threw (never owned the item)', async () => {
    const item = makeScheduledItem()
    mockedListPending.mockResolvedValue([item])
    mockedClaim.mockRejectedValue(new Error('db timeout'))

    await runTick()

    expect(mockedRelease).not.toHaveBeenCalled()
    expect(mockedConfirmFired).not.toHaveBeenCalled()
  })

  it('confirms fired when agent has been deleted (no release)', async () => {
    const item = makeScheduledItem()
    mockedListPending.mockResolvedValue([item])
    mockedClaim.mockResolvedValue({ ...item, status: 'firing' })
    mockedFindAgent.mockResolvedValue(null)
    mockedConfirmFired.mockResolvedValue({ ...item, status: 'fired', fired_at: 1000 })

    await runTick()

    // Agent is gone — confirm fired (no trx, standalone call), don't release
    expect(mockedConfirmFired).toHaveBeenCalledWith(item.id)
    expect(mockedCreateWorkItem).not.toHaveBeenCalled()
    expect(mockedRelease).not.toHaveBeenCalled()
  })

  it('releases when deleted-agent confirm throws (standalone confirm failure)', async () => {
    const item = makeScheduledItem()
    mockedListPending.mockResolvedValue([item])
    mockedClaim.mockResolvedValue({ ...item, status: 'firing' })
    mockedFindAgent.mockResolvedValue(null)
    // Standalone confirm (no trx) fails — falls to catch
    mockedConfirmFired.mockRejectedValue(new Error('confirm failed'))
    mockedRelease.mockResolvedValue({ ...item, status: 'pending' })

    await runTick()

    // ownedByUs is true, catch releases back to pending
    expect(mockedRelease).toHaveBeenCalledWith(item.id)
  })

  // -------------------------------------------------------------------------
  // Happy path — full transaction
  // -------------------------------------------------------------------------

  it('creates work item, enqueues, and confirms all inside one transaction', async () => {
    const item = makeScheduledItem()
    const agent = makeAgent()
    const workItem = makeWorkItem()
    setupHappyPath(item, agent, workItem)

    await runTick()

    // Claim outside transaction
    expect(mockedClaim).toHaveBeenCalledWith(item.id)
    expect(mockedFindAgent).toHaveBeenCalledWith(item.agent_id)

    // All three writes receive the transaction handle
    expect(mockedCreateWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'scheduler',
        source_ref: `scheduled:${item.id}`,
        session_key: item.session_key,
        status: 'NEW',
      }),
      mockTrx
    )

    expect(mockedEnqueueToLane).toHaveBeenCalledWith(
      expect.objectContaining({
        queue_key: `sched:${item.session_key}:${item.agent_id}`,
        work_item_id: workItem.id,
        plugin_instance_id: item.plugin_instance_id,
        response_context: item.response_context,
        text: item.payload,
        status: 'pending',
      }),
      expect.objectContaining({
        queueKey: `sched:${item.session_key}:${item.agent_id}`,
        sessionKey: item.session_key,
        agentId: item.agent_id,
        pluginInstanceId: item.plugin_instance_id,
        debounceMs: 0,
        maxQueued: 1,
        mode: 'followup',
      }),
      mockTrx
    )

    expect(mockedConfirmFired).toHaveBeenCalledWith(item.id, mockTrx)

    // No rollback on success
    expect(mockedRelease).not.toHaveBeenCalled()
  })

  it('creates a fresh routine app session before enqueueing app-targeted routine work', async () => {
    const item = makeScheduledItem({
      session_key: 'app:standalone:user-1:seed',
      routine_id: 'routine-1',
    })
    const agent = makeAgent()
    const workItem = makeWorkItem({
      session_key: 'app:routine:routine-1:fresh',
      source: 'routine',
      source_ref: 'routine:routine-1:scheduled:si-1',
    })

    mockedParseAppSessionKey.mockReturnValue({
      isAppSession: true,
      isLegacy: false,
      raw: item.session_key,
      contextKind: 'standalone',
      contextId: 'user-1',
      sessionId: 'seed',
      familyKey: 'app:standalone:user-1',
      ownerUserId: 'user-1',
    })
    mockedCreateRoutineAppSessionFromSeed.mockResolvedValue({
      session_key: 'app:routine:routine-1:fresh',
      owner_user_id: 'user-1',
      primary_agent_id: 'agent-1',
      title: 'Routine conversation',
      forked_from_session_key: null,
      created_at: 1,
      updated_at: 1,
      last_activity_at: 1,
    })
    setupHappyPath(item, agent, workItem)

    await runTick()

    expect(mockedCreateRoutineAppSessionFromSeed).toHaveBeenCalledWith({
      routineId: 'routine-1',
      seedSessionKey: 'app:standalone:user-1:seed',
      agentId: 'agent-1',
    })
    expect(mockedCreateWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({
        session_key: 'app:routine:routine-1:fresh',
        source: 'routine',
      }),
      mockTrx
    )
    expect(mockedEnqueueToLane).toHaveBeenCalledWith(
      expect.objectContaining({
        queue_key: 'sched:app:routine:routine-1:fresh:agent-1',
      }),
      expect.objectContaining({
        sessionKey: 'app:routine:routine-1:fresh',
      }),
      mockTrx
    )
  })

  it('handles items with no plugin_instance_id', async () => {
    const item = makeScheduledItem({ plugin_instance_id: null, response_context: null })
    const agent = makeAgent()
    const workItem = makeWorkItem({ plugin_instance_id: null })
    setupHappyPath(item, agent, workItem)

    await runTick()

    expect(mockedEnqueueToLane).toHaveBeenCalledWith(
      expect.objectContaining({ plugin_instance_id: null, response_context: null }),
      expect.objectContaining({ pluginInstanceId: null }),
      mockTrx
    )
  })

  it('archives one-shot routines after they fire', async () => {
    const item = makeScheduledItem({ routine_id: 'routine-1' })
    const agent = makeAgent()
    const workItem = makeWorkItem()
    setupHappyPath(item, agent, workItem)
    mockExecuteTakeFirst.mockResolvedValue({ trigger_kind: 'oneshot' })

    await runTick()

    expect(mockedArchiveRoutine).toHaveBeenCalledWith('routine-1', mockTrx)
    expect(mockedConfirmFired).toHaveBeenCalledWith(item.id, mockTrx)
  })

  // -------------------------------------------------------------------------
  // Transaction failure — everything rolls back, release to pending
  // -------------------------------------------------------------------------

  it('releases to pending when transaction fails (all-or-nothing)', async () => {
    const item = makeScheduledItem()
    const agent = makeAgent()
    mockedListPending.mockResolvedValue([item])
    mockedClaim.mockResolvedValue({ ...item, status: 'firing' })
    mockedFindAgent.mockResolvedValue(agent)
    // Transaction rejects — no writes persisted (work item, message, lane, fired)
    mockTransaction.execute.mockRejectedValue(new Error('transaction failed'))
    mockedRelease.mockResolvedValue({ ...item, status: 'pending' })

    await runTick()

    expect(mockedRelease).toHaveBeenCalledWith(item.id)
    // confirmScheduledItemFired was never called (transaction didn't execute)
    expect(mockedConfirmFired).not.toHaveBeenCalled()
  })

  it('releases to pending when createWorkItem fails inside transaction', async () => {
    const item = makeScheduledItem()
    const agent = makeAgent()
    mockedListPending.mockResolvedValue([item])
    mockedClaim.mockResolvedValue({ ...item, status: 'firing' })
    mockedFindAgent.mockResolvedValue(agent)
    mockedCreateWorkItem.mockRejectedValue(new Error('work item insert failed'))
    mockedRelease.mockResolvedValue({ ...item, status: 'pending' })

    await runTick()

    // Transaction rolled back, release is safe
    expect(mockedRelease).toHaveBeenCalledWith(item.id)
    expect(mockedConfirmFired).not.toHaveBeenCalled()
  })

  it('releases to pending when enqueueToLane fails inside transaction', async () => {
    const item = makeScheduledItem()
    const agent = makeAgent()
    const workItem = makeWorkItem()
    mockedListPending.mockResolvedValue([item])
    mockedClaim.mockResolvedValue({ ...item, status: 'firing' })
    mockedFindAgent.mockResolvedValue(agent)
    mockedCreateWorkItem.mockResolvedValue(workItem)
    mockedEnqueueToLane.mockRejectedValue(new Error('enqueue failed'))
    mockedRelease.mockResolvedValue({ ...item, status: 'pending' })

    await runTick()

    expect(mockedRelease).toHaveBeenCalledWith(item.id)
    expect(mockedConfirmFired).not.toHaveBeenCalled()
  })

  it('releases to pending when confirmScheduledItemFired fails inside transaction', async () => {
    const item = makeScheduledItem()
    const agent = makeAgent()
    const workItem = makeWorkItem()
    mockedListPending.mockResolvedValue([item])
    mockedClaim.mockResolvedValue({ ...item, status: 'firing' })
    mockedFindAgent.mockResolvedValue(agent)
    mockedCreateWorkItem.mockResolvedValue(workItem)
    mockedEnqueueToLane.mockResolvedValue({} as QueueMessage)
    // confirm fails — transaction rolls back ALL writes (work item, message, lane)
    mockedConfirmFired.mockRejectedValue(new Error('confirm failed'))
    mockedRelease.mockResolvedValue({ ...item, status: 'pending' })

    await runTick()

    // Transaction rolled back everything — safe to release for retry
    expect(mockedRelease).toHaveBeenCalledWith(item.id)
  })

  it('rolls back when confirm returns null (concurrent state edit guard)', async () => {
    const item = makeScheduledItem()
    const agent = makeAgent()
    const workItem = makeWorkItem()
    mockedListPending.mockResolvedValue([item])
    mockedClaim.mockResolvedValue({ ...item, status: 'firing' })
    mockedFindAgent.mockResolvedValue(agent)
    mockedCreateWorkItem.mockResolvedValue(workItem)
    mockedEnqueueToLane.mockResolvedValue({} as QueueMessage)
    // confirm returns null — item was not in 'firing' state (unexpected concurrent edit)
    mockedConfirmFired.mockResolvedValue(null)
    mockedRelease.mockResolvedValue({ ...item, status: 'pending' })

    await runTick()

    // Null confirm throws inside transaction, rolling back all writes
    expect(mockedRelease).toHaveBeenCalledWith(item.id)
  })

  // -------------------------------------------------------------------------
  // Release failure — stale sweep safety net
  // -------------------------------------------------------------------------

  it('survives release failure (stale sweep will recover)', async () => {
    const item = makeScheduledItem()
    const agent = makeAgent()
    mockedListPending.mockResolvedValue([item])
    mockedClaim.mockResolvedValue({ ...item, status: 'firing' })
    mockedFindAgent.mockResolvedValue(agent)
    mockTransaction.execute.mockRejectedValue(new Error('transaction failed'))
    mockedRelease.mockRejectedValue(new Error('release also failed'))

    // Should not throw — error is caught and logged
    await runTick()

    expect(mockedRelease).toHaveBeenCalledWith(item.id)
    expect(mockedConfirmFired).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // Multi-item processing
  // -------------------------------------------------------------------------

  it('continues processing remaining items when one fails', async () => {
    const item1 = makeScheduledItem({ id: 'si-1' })
    const item2 = makeScheduledItem({ id: 'si-2', agent_id: 'agent-2' })
    const agent = makeAgent({ id: 'agent-2' })
    const workItem = makeWorkItem({ id: 'wi-2' })

    mockedListPending.mockResolvedValue([item1, item2])
    mockedClaim
      .mockRejectedValueOnce(new Error('db error'))
      .mockResolvedValueOnce({ ...item2, status: 'firing' })
    mockedFindAgent.mockResolvedValue(agent)
    mockedCreateWorkItem.mockResolvedValue(workItem)
    mockedEnqueueToLane.mockResolvedValue({} as QueueMessage)
    mockedConfirmFired.mockResolvedValue({ ...item2, status: 'fired', fired_at: 1000 })

    await runTick()

    expect(mockedClaim).toHaveBeenCalledTimes(2)
    expect(mockedCreateWorkItem).toHaveBeenCalledTimes(1)
    expect(mockedConfirmFired).toHaveBeenCalledTimes(1)
  })

  // -------------------------------------------------------------------------
  // Stale recovery integration
  // -------------------------------------------------------------------------

  it('recovered item is retried on next tick', async () => {
    const item = makeScheduledItem()
    const agent = makeAgent()
    const workItem = makeWorkItem()

    mockedRecoverStale.mockResolvedValue(1)
    setupHappyPath(item, agent, workItem)
    mockedClaim.mockResolvedValue({ ...item, status: 'firing', fired_at: 2000 })
    mockedConfirmFired.mockResolvedValue({ ...item, status: 'fired', fired_at: 2000 })

    await runTick()

    expect(mockedRecoverStale).toHaveBeenCalledWith(300)
    expect(mockedClaim).toHaveBeenCalledWith(item.id)
    expect(mockedConfirmFired).toHaveBeenCalledWith(item.id, mockTrx)
  })
})
