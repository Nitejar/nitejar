import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@nitejar/database', () => ({
  searchWorkItems: vi.fn(),
  getCostByWorkItems: vi.fn(),
  findWorkItemById: vi.fn(),
  listJobsByWorkItem: vi.fn(),
  listRunDispatchesByWorkItem: vi.fn(),
  listEffectOutboxByWorkItem: vi.fn(),
}))

import {
  searchWorkItems,
  getCostByWorkItems,
  findWorkItemById,
  listJobsByWorkItem,
  listRunDispatchesByWorkItem,
  listEffectOutboxByWorkItem,
} from '@nitejar/database'
import { getWorkItemOp, searchWorkItemsOp } from './work-items'

const mockedSearchWorkItems = vi.mocked(searchWorkItems)
const mockedGetCostByWorkItems = vi.mocked(getCostByWorkItems)
const mockedFindWorkItemById = vi.mocked(findWorkItemById)
const mockedListJobsByWorkItem = vi.mocked(listJobsByWorkItem)
const mockedListRunDispatchesByWorkItem = vi.mocked(listRunDispatchesByWorkItem)
const mockedListEffectOutboxByWorkItem = vi.mocked(listEffectOutboxByWorkItem)

describe('work-items ops', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('decodes cursor, delegates search, and re-encodes next cursor', async () => {
    mockedSearchWorkItems.mockResolvedValue({
      items: [
        {
          id: 'wi-1',
          plugin_instance_id: null,
          session_key: 'telegram:1',
          source: 'telegram',
          source_ref: 'chat:1',
          status: 'NEW',
          title: 'hello',
          payload: null,
          created_at: 100,
          updated_at: 100,
        },
      ],
      nextCursor: { createdAt: 90, id: 'wi-0' },
    })
    mockedGetCostByWorkItems.mockResolvedValue([
      {
        work_item_id: 'wi-1',
        total_cost: 1.23,
        prompt_tokens: 10,
        completion_tokens: 20,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
      },
    ])

    const cursor = Buffer.from(JSON.stringify({ createdAt: 120, id: 'wi-9' }), 'utf8').toString(
      'base64url'
    )
    const result = await searchWorkItemsOp({ q: 'hello', cursor })

    expect(mockedSearchWorkItems).toHaveBeenCalledWith(
      expect.objectContaining({
        q: 'hello',
        cursor: { createdAt: 120, id: 'wi-9' },
      })
    )
    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.cost?.total_cost).toBe(1.23)
    expect(result.nextCursor).toBe(
      Buffer.from(JSON.stringify({ createdAt: 90, id: 'wi-0' }), 'utf8').toString('base64url')
    )
  })

  it('rejects malformed cursors', async () => {
    await expect(searchWorkItemsOp({ cursor: 'bad!!' })).rejects.toThrow('Invalid cursor')
  })

  it('loads optional work-item sections when requested', async () => {
    mockedFindWorkItemById.mockResolvedValue({
      id: 'wi-1',
      plugin_instance_id: null,
      session_key: 'telegram:1',
      source: 'telegram',
      source_ref: 'chat:1',
      status: 'NEW',
      title: 'hello',
      payload: null,
      created_at: 100,
      updated_at: 100,
    })
    mockedGetCostByWorkItems.mockResolvedValue([])
    mockedListJobsByWorkItem.mockResolvedValue([{ id: 'job-1' } as never])
    mockedListRunDispatchesByWorkItem.mockResolvedValue([{ id: 'dispatch-1' } as never])
    mockedListEffectOutboxByWorkItem.mockResolvedValue([{ id: 'effect-1' } as never])

    const result = await getWorkItemOp({
      workItemId: 'wi-1',
      includeRuns: true,
      includeDispatches: true,
      includeEffects: true,
    })

    expect(result.workItem.id).toBe('wi-1')
    expect(result.runs).toBeDefined()
    expect(result.dispatches).toBeDefined()
    expect(result.effects).toBeDefined()
  })
})
