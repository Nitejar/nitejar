import { type WorkItem } from './work-item'
import { type CreateWorkItemInput, type ListWorkItemsOptions } from './work-item-store'

export interface Orchestrator {
  enqueueWorkItem(input: CreateWorkItemInput): Promise<WorkItem>
  getWorkItem(id: string): Promise<WorkItem | null>
  listWorkItems(options?: ListWorkItemsOptions): Promise<WorkItem[]>
}
