import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs/promises', () => ({
  access: vi.fn(),
  readFile: vi.fn(),
}))

vi.mock('@nitejar/database', () => ({
  countPassiveMemoryQueueByWorkItem: vi.fn(),
  countQueueMessagesByWorkItem: vi.fn(),
  findActivityEntriesByJobIds: vi.fn(),
  findMessageById: vi.fn(),
  findRunDispatchById: vi.fn(),
  findWorkItemById: vi.fn(),
  listPassiveMemoryQueueByWorkItem: vi.fn(),
  listJobsByWorkItem: vi.fn(),
  listQueueMessagesByWorkItem: vi.fn(),
  listRunDispatchesByWorkItem: vi.fn(),
}))

import { access, readFile } from 'node:fs/promises'
import {
  countPassiveMemoryQueueByWorkItem,
  countQueueMessagesByWorkItem,
  findActivityEntriesByJobIds,
  findMessageById,
  findRunDispatchById,
  findWorkItemById,
  listPassiveMemoryQueueByWorkItem,
  listJobsByWorkItem,
  listQueueMessagesByWorkItem,
  listRunDispatchesByWorkItem,
} from '@nitejar/database'
import {
  getDispatchDecisionsOp,
  getMessageChunkOp,
  getPassiveMemoryReceiptsOp,
  getWorkItemQueueMessagesOp,
  getWorkItemTriageReceiptsOp,
} from './receipts'

const mockedCountPassiveMemoryQueueByWorkItem = vi.mocked(countPassiveMemoryQueueByWorkItem)
const mockedReadFile = vi.mocked(readFile)
const mockedAccess = vi.mocked(access)
const mockedCountQueueMessagesByWorkItem = vi.mocked(countQueueMessagesByWorkItem)
const mockedFindActivityEntriesByJobIds = vi.mocked(findActivityEntriesByJobIds)
const mockedFindMessageById = vi.mocked(findMessageById)
const mockedFindRunDispatchById = vi.mocked(findRunDispatchById)
const mockedFindWorkItemById = vi.mocked(findWorkItemById)
const mockedListPassiveMemoryQueueByWorkItem = vi.mocked(listPassiveMemoryQueueByWorkItem)
const mockedListJobsByWorkItem = vi.mocked(listJobsByWorkItem)
const mockedListQueueMessagesByWorkItem = vi.mocked(listQueueMessagesByWorkItem)
const mockedListRunDispatchesByWorkItem = vi.mocked(listRunDispatchesByWorkItem)

describe('receipts ops', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedAccess.mockResolvedValue(undefined)
  })

  it('returns queue messages with page metadata', async () => {
    mockedFindWorkItemById.mockResolvedValue({ id: 'wi-1' } as never)
    mockedCountQueueMessagesByWorkItem.mockResolvedValue(3)
    mockedListQueueMessagesByWorkItem.mockResolvedValue([
      { id: 'qm-1', status: 'included' },
      { id: 'qm-2', status: 'pending' },
    ] as never)

    const result = await getWorkItemQueueMessagesOp({ workItemId: 'wi-1', offset: 0, limit: 2 })
    expect(result.workItemId).toBe('wi-1')
    expect(result.queueMessages).toHaveLength(2)
    expect(result.page.total).toBe(3)
    expect(result.page.hasMore).toBe(true)
  })

  it('parses arbiter decisions from dispatch control reasons', async () => {
    mockedListRunDispatchesByWorkItem.mockResolvedValue([
      {
        id: 'd-1',
        work_item_id: 'wi-1',
        queue_key: 'q-1',
        status: 'completed',
        control_state: 'normal',
        control_reason: 'arbiter:interrupt_now:urgent correction',
        control_updated_at: 15,
        started_at: 10,
        finished_at: 20,
        created_at: 9,
        updated_at: 20,
      },
      {
        id: 'd-2',
        work_item_id: 'wi-1',
        queue_key: 'q-1',
        status: 'completed',
        control_state: 'normal',
        control_reason: null,
        control_updated_at: null,
        started_at: 21,
        finished_at: 22,
        created_at: 21,
        updated_at: 22,
      },
    ] as never)

    const result = await getDispatchDecisionsOp({
      workItemId: 'wi-1',
      includeNonArbiter: false,
      offset: 0,
      limit: 10,
    })

    expect(result.decisions).toHaveLength(1)
    expect(result.decisions[0]?.arbiter.decision).toBe('interrupt_now')
    expect(result.decisions[0]?.arbiter.reason).toBe('urgent correction')
  })

  it('parses triage jsonl entries and joins job/activity metadata', async () => {
    mockedFindWorkItemById.mockResolvedValue({ id: 'wi-1' } as never)
    mockedListJobsByWorkItem.mockResolvedValue([
      { id: 'job-1', agent_id: 'agent-1', status: 'COMPLETED' },
    ] as never)
    mockedFindActivityEntriesByJobIds.mockResolvedValue([
      {
        id: 'act-1',
        job_id: 'job-1',
        status: 'completed',
        summary: 'triaged',
        resources: '[]',
        created_at: 1700000001,
      },
    ] as never)
    mockedReadFile.mockResolvedValue(
      `${JSON.stringify({
        timestamp: '2026-02-18T10:00:00.000Z',
        agentId: 'agent-1',
        agentHandle: 'slopper',
        workItemId: 'wi-1',
        result: { isReadOnly: false, shouldRespond: true, reason: 'direct ask', resources: [] },
        usage: {
          promptTokens: 1,
          completionTokens: 2,
          totalTokens: 3,
          costUsd: 0.001,
          durationMs: 10,
        },
      })}\n`
    )

    const result = await getWorkItemTriageReceiptsOp({ workItemId: 'wi-1', offset: 0, limit: 10 })
    expect(result.triageReceipts).toHaveLength(1)
    expect(result.triageReceipts[0]?.result.shouldRespond).toBe(true)
    expect(result.triageReceipts[0]?.usage?.totalTokens).toBe(3)
    expect(result.triageReceipts[0]?.job?.id).toBe('job-1')
  })

  it('returns deterministic message chunks', async () => {
    mockedFindMessageById.mockResolvedValue({
      id: 'm-1',
      job_id: 'job-1',
      role: 'assistant',
      content: 'abcdefghij',
      created_at: 1,
    } as never)

    const result = await getMessageChunkOp({ messageId: 'm-1', chunkIndex: 1, chunkSize: 4 })
    expect(result.contentChunk.chunk).toBe('efgh')
    expect(result.contentChunk.totalChunks).toBe(3)
    expect(result.contentChunk.chunkIndex).toBe(1)
  })

  it('supports dispatchId selector mode', async () => {
    mockedFindRunDispatchById.mockResolvedValue({
      id: 'd-9',
      work_item_id: 'wi-9',
      queue_key: 'q-9',
      status: 'running',
      control_state: 'normal',
      control_reason: 'arbiter:do_not_interrupt:defer for now',
      control_updated_at: 2,
      started_at: 1,
      finished_at: null,
      created_at: 1,
      updated_at: 2,
    } as never)

    const result = await getDispatchDecisionsOp({ dispatchId: 'd-9', offset: 0, limit: 10 })
    expect(result.decisions).toHaveLength(1)
    expect(result.decisions[0]?.dispatchId).toBe('d-9')
    expect(result.decisions[0]?.arbiter.decision).toBe('do_not_interrupt')
  })

  it('returns passive memory receipts with pagination metadata', async () => {
    mockedFindWorkItemById.mockResolvedValue({ id: 'wi-1' } as never)
    mockedCountPassiveMemoryQueueByWorkItem.mockResolvedValue(2)
    mockedListPassiveMemoryQueueByWorkItem.mockResolvedValue([
      {
        id: 'pmq-1',
        status: 'completed',
      },
    ] as never)

    const result = await getPassiveMemoryReceiptsOp({ workItemId: 'wi-1', offset: 0, limit: 1 })
    expect(result.workItemId).toBe('wi-1')
    expect(result.passiveMemoryReceipts).toHaveLength(1)
    expect(result.page.total).toBe(2)
    expect(result.page.hasMore).toBe(true)
  })
})
