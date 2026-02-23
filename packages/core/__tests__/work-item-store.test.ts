import { describe, it, expect, beforeEach } from 'vitest'
import { InMemoryWorkItemStore, WorkItemStatus } from '../src/index'

describe('InMemoryWorkItemStore', () => {
  let store: InMemoryWorkItemStore

  beforeEach(() => {
    store = new InMemoryWorkItemStore()
  })

  describe('create', () => {
    it('should create a work item with a unique id', async () => {
      const input = {
        sessionKey: 'owner/repo#issue:1',
        source: 'github' as const,
        sourceRef: 'owner/repo#issue:1#comment:123',
        title: 'Test work item',
        payload: { body: 'test' },
      }

      const workItem = await store.create(input)

      expect(workItem.id).toBeDefined()
      expect(workItem.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
      expect(workItem.sessionKey).toBe(input.sessionKey)
      expect(workItem.source).toBe(input.source)
      expect(workItem.sourceRef).toBe(input.sourceRef)
      expect(workItem.status).toBe(WorkItemStatus.NEW)
      expect(workItem.title).toBe(input.title)
      expect(workItem.payload).toEqual(input.payload)
      expect(workItem.createdAt).toBeInstanceOf(Date)
      expect(workItem.updatedAt).toBeInstanceOf(Date)
    })

    it('should create work items with unique ids', async () => {
      const input = {
        sessionKey: 'owner/repo#issue:1',
        source: 'github' as const,
        sourceRef: 'owner/repo#issue:1#comment:123',
        title: 'Test',
        payload: null,
      }

      const item1 = await store.create(input)
      const item2 = await store.create(input)

      expect(item1.id).not.toBe(item2.id)
    })
  })

  describe('get', () => {
    it('should return the work item by id', async () => {
      const input = {
        sessionKey: 'owner/repo#issue:1',
        source: 'github' as const,
        sourceRef: 'owner/repo#issue:1#comment:123',
        title: 'Test',
        payload: null,
      }

      const created = await store.create(input)
      const retrieved = await store.get(created.id)

      expect(retrieved).toEqual(created)
    })

    it('should return null for non-existent id', async () => {
      const result = await store.get('non-existent-id')
      expect(result).toBeNull()
    })
  })

  describe('list', () => {
    it('should return empty array when no items', async () => {
      const items = await store.list()
      expect(items).toEqual([])
    })

    it('should return items sorted by id desc (newest first)', async () => {
      const input1 = {
        sessionKey: 'owner/repo#issue:1',
        source: 'github' as const,
        sourceRef: 'owner/repo#issue:1#comment:1',
        title: 'First',
        payload: null,
      }
      const input2 = {
        sessionKey: 'owner/repo#issue:2',
        source: 'github' as const,
        sourceRef: 'owner/repo#issue:2#comment:2',
        title: 'Second',
        payload: null,
      }

      const item1 = await store.create(input1)
      // Small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10))
      const item2 = await store.create(input2)

      const items = await store.list()

      expect(items).toHaveLength(2)
      expect(items[0]?.id).toBe(item2.id)
      expect(items[1]?.id).toBe(item1.id)
    })
  })

  describe('update', () => {
    it('should update status', async () => {
      const input = {
        sessionKey: 'owner/repo#issue:1',
        source: 'github' as const,
        sourceRef: 'owner/repo#issue:1#comment:123',
        title: 'Test',
        payload: null,
      }

      const created = await store.create(input)
      const updated = await store.update(created.id, { status: WorkItemStatus.RUNNING })

      expect(updated.status).toBe(WorkItemStatus.RUNNING)
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime())
    })

    it('should update payload', async () => {
      const input = {
        sessionKey: 'owner/repo#issue:1',
        source: 'github' as const,
        sourceRef: 'owner/repo#issue:1#comment:123',
        title: 'Test',
        payload: { initial: true },
      }

      const created = await store.create(input)
      const newPayload = { updated: true, result: 'success' }
      const updated = await store.update(created.id, { payload: newPayload })

      expect(updated.payload).toEqual(newPayload)
    })

    it('should throw error for non-existent id', async () => {
      await expect(store.update('non-existent', { status: WorkItemStatus.DONE })).rejects.toThrow(
        'WorkItem not found: non-existent'
      )
    })
  })
})
