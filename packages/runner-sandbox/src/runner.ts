import { type WorkItem } from '@nitejar/core'

export interface RunResult {
  success: boolean
  output?: string
  error?: string
}

export interface Runner {
  execute(workItem: WorkItem): Promise<RunResult>
}

/**
 * A stub runner implementation that returns mock success.
 * Used for development and testing.
 */
export class StubRunner implements Runner {
  execute(workItem: WorkItem): Promise<RunResult> {
    // TODO: Implement Sprites integration (sprites.dev)
    // TODO: Add proper execution environment setup
    // TODO: Add timeout handling
    // TODO: Add resource limits

    return Promise.resolve({
      success: true,
      output: `Stub execution completed for work item: ${workItem.id}`,
    })
  }
}
