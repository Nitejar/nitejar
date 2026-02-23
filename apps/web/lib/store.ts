import { InMemoryWorkItemStore, type WorkItemStore } from '@nitejar/core'
import { PostgresWorkItemStore } from '@nitejar/database'

// Use globalThis to persist the store across Next.js HMR in development
const globalForStore = globalThis as unknown as {
  workItemStore: WorkItemStore | undefined
}

export function getWorkItemStore(): WorkItemStore {
  if (!globalForStore.workItemStore) {
    // Use PostgresWorkItemStore if POSTGRES_URL is set, otherwise use InMemoryWorkItemStore
    if (process.env.POSTGRES_URL) {
      globalForStore.workItemStore = new PostgresWorkItemStore()
    } else {
      globalForStore.workItemStore = new InMemoryWorkItemStore()
    }
  }
  return globalForStore.workItemStore
}
