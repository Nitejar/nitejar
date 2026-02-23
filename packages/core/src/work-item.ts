export enum WorkItemStatus {
  NEW = 'NEW',
  RUNNING = 'RUNNING',
  NEEDS_APPROVAL = 'NEEDS_APPROVAL',
  DONE = 'DONE',
  FAILED = 'FAILED',
  CANCELED = 'CANCELED',
}

export interface WorkItem {
  id: string
  sessionKey: string
  source: 'github' | 'manual'
  sourceRef: string
  status: WorkItemStatus
  title: string
  createdAt: Date
  updatedAt: Date
  payload: unknown
}
