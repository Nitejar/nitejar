import { type WorkItem, WorkItemStatus } from './work-item'
import { generateUuidV7 } from './uuid'

export interface CreateWorkItemInput {
  sessionKey: string
  source: 'github' | 'manual'
  sourceRef: string
  title: string
  payload: unknown
}

export interface ListWorkItemsOptions {
  limit?: number
  // Cursor is the last seen work item id (UUIDv7)
  cursor?: string
}

export interface WorkItemStore {
  create(input: CreateWorkItemInput): Promise<WorkItem>
  get(id: string): Promise<WorkItem | null>
  list(options?: ListWorkItemsOptions): Promise<WorkItem[]>
  update(id: string, updates: Partial<Pick<WorkItem, 'status' | 'payload'>>): Promise<WorkItem>
}

export class InMemoryWorkItemStore implements WorkItemStore {
  private items: Map<string, WorkItem> = new Map()

  create(input: CreateWorkItemInput): Promise<WorkItem> {
    const now = new Date()
    const workItem: WorkItem = {
      id: generateUuidV7(now),
      sessionKey: input.sessionKey,
      source: input.source,
      sourceRef: input.sourceRef,
      status: WorkItemStatus.NEW,
      title: input.title,
      createdAt: now,
      updatedAt: now,
      payload: input.payload,
    }

    this.items.set(workItem.id, workItem)
    return Promise.resolve(workItem)
  }

  get(id: string): Promise<WorkItem | null> {
    return Promise.resolve(this.items.get(id) ?? null)
  }

  list(options?: ListWorkItemsOptions): Promise<WorkItem[]> {
    const { limit, cursor } = options ?? {}

    // Return newest first (UUIDv7 is time-sortable)
    let items = Array.from(this.items.values()).sort((a, b) => b.id.localeCompare(a.id))

    if (cursor) {
      items = items.filter((item) => item.id < cursor)
    }

    if (typeof limit === 'number') {
      return Promise.resolve(items.slice(0, Math.max(0, limit)))
    }
    return Promise.resolve(items)
  }

  update(id: string, updates: Partial<Pick<WorkItem, 'status' | 'payload'>>): Promise<WorkItem> {
    const existing = this.items.get(id)
    if (!existing) {
      return Promise.reject(new Error(`WorkItem not found: ${id}`))
    }

    const updated: WorkItem = {
      ...existing,
      ...updates,
      updatedAt: new Date(),
    }

    this.items.set(id, updated)
    return Promise.resolve(updated)
  }

  // TODO: Add persistence layer (database, file, etc.)
  // TODO: Add filtering (status, source, etc.) to list()
}
