import { createPluginEvent } from '@nitejar/database'

// ---------------------------------------------------------------------------
// Hook Names
// ---------------------------------------------------------------------------

export type HookName =
  | 'work_item.pre_create'
  | 'work_item.post_create'
  | 'run.pre_prompt'
  | 'model.pre_call'
  | 'model.post_call'
  | 'tool.pre_exec'
  | 'tool.post_exec'
  | 'response.pre_deliver'
  | 'response.post_deliver'

export const HOOK_NAMES: readonly HookName[] = [
  'work_item.pre_create',
  'work_item.post_create',
  'run.pre_prompt',
  'model.pre_call',
  'model.post_call',
  'tool.pre_exec',
  'tool.post_exec',
  'response.pre_deliver',
  'response.post_deliver',
] as const

// ---------------------------------------------------------------------------
// Hook Context & Result
// ---------------------------------------------------------------------------

export interface HookContext<TData> {
  hookName: HookName
  pluginId: string
  workItemId: string
  jobId: string
  agentId: string
  data: TData
}

export interface HookResult<TData> {
  /** 'continue' proceeds, 'block' stops the chain */
  action: 'continue' | 'block'
  /** Optional mutations to the data payload (merged on top of input) */
  data?: Partial<TData>
}

export type HookHandler<TIn = unknown, TOut = TIn> = (
  context: HookContext<TIn>
) => Promise<HookResult<TOut>> | HookResult<TOut>

// ---------------------------------------------------------------------------
// Hook Receipt (audit trail per handler invocation)
// ---------------------------------------------------------------------------

export interface HookReceipt {
  pluginId: string
  hookName: HookName
  status: 'ok' | 'timeout' | 'error' | 'blocked' | 'budget_exceeded'
  durationMs: number
  error?: string
}

// ---------------------------------------------------------------------------
// Hook Registration
// ---------------------------------------------------------------------------

export interface HookRegistration {
  pluginId: string
  hookName: HookName
  handler: HookHandler<unknown, unknown>
  priority: number // higher = runs first
  failPolicy: 'fail_open' | 'fail_closed'
  timeoutMs: number // default 1500
}

// ---------------------------------------------------------------------------
// HookRegistry — manages handler registration per plugin
// ---------------------------------------------------------------------------

export class HookRegistry {
  private registrations: HookRegistration[] = []

  /** Register a hook handler. */
  register(reg: HookRegistration): void {
    this.registrations.push(reg)
  }

  /** Unregister ALL hooks for a given plugin. */
  unregister(pluginId: string): void {
    this.registrations = this.registrations.filter((r) => r.pluginId !== pluginId)
  }

  /** Get handlers for a specific hook, sorted by priority descending, then pluginId, then registration order. */
  getHandlers(hookName: HookName): HookRegistration[] {
    const matching = this.registrations.filter((r) => r.hookName === hookName)
    // Stable sort: priority descending, then pluginId ascending, then original order
    return matching.sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority
      return a.pluginId.localeCompare(b.pluginId)
    })
  }

  /** Check if any handlers are registered for a hook. */
  hasHandlers(hookName: HookName): boolean {
    return this.registrations.some((r) => r.hookName === hookName)
  }

  /** Reset the registry (for testing). */
  _resetForTest(): void {
    this.registrations = []
  }
}

// ---------------------------------------------------------------------------
// HookDispatcher — executes hooks with timeout and fail-open policy
// ---------------------------------------------------------------------------

const DEFAULT_HANDLER_TIMEOUT_MS = 1500
const DEFAULT_EVENT_BUDGET_MS = 8000

export class HookDispatcher {
  constructor(
    private registry: HookRegistry,
    private eventBudgetMs: number = DEFAULT_EVENT_BUDGET_MS
  ) {}

  /**
   * Dispatch a hook event to all registered handlers.
   *
   * 1. Gets handlers sorted by priority (descending).
   * 2. Runs each handler with per-handler timeout.
   * 3. Tracks cumulative budget.
   * 4. On timeout/error: emits receipt, continues if fail_open, stops if fail_closed.
   * 5. Merges mutations sequentially.
   * 6. Returns final data, blocked flag, and receipt array.
   */
  async dispatch<TData>(
    hookName: HookName,
    context: { workItemId: string; jobId: string; agentId: string },
    data: TData
  ): Promise<{ data: TData; blocked: boolean; receipts: HookReceipt[] }> {
    const handlers = this.registry.getHandlers(hookName)
    if (handlers.length === 0) {
      return { data, blocked: false, receipts: [] }
    }

    let currentData: TData = { ...data }
    let blocked = false
    const receipts: HookReceipt[] = []
    let cumulativeMs = 0

    for (const reg of handlers) {
      // Check cumulative budget
      if (cumulativeMs >= this.eventBudgetMs) {
        receipts.push({
          pluginId: reg.pluginId,
          hookName,
          status: 'budget_exceeded',
          durationMs: 0,
          error: `Event budget of ${this.eventBudgetMs}ms exceeded (cumulative: ${cumulativeMs}ms)`,
        })
        if (reg.failPolicy === 'fail_closed') {
          break
        }
        continue
      }

      const start = Date.now()
      const timeoutMs = reg.timeoutMs || DEFAULT_HANDLER_TIMEOUT_MS
      const remainingBudget = this.eventBudgetMs - cumulativeMs
      const effectiveTimeout = Math.min(timeoutMs, remainingBudget)

      try {
        const hookCtx: HookContext<TData> = {
          hookName,
          pluginId: reg.pluginId,
          workItemId: context.workItemId,
          jobId: context.jobId,
          agentId: context.agentId,
          data: currentData,
        }

        const result = await withTimeout(
          Promise.resolve(reg.handler(hookCtx as HookContext<unknown>)),
          effectiveTimeout
        )
        const durationMs = Date.now() - start
        cumulativeMs += durationMs

        // Merge mutations
        if (result.data) {
          currentData = { ...currentData, ...result.data } as typeof currentData
        }

        // Check for block action
        if (result.action === 'block') {
          blocked = true
          receipts.push({
            pluginId: reg.pluginId,
            hookName,
            status: 'blocked',
            durationMs,
          })
          break
        }

        receipts.push({
          pluginId: reg.pluginId,
          hookName,
          status: 'ok',
          durationMs,
        })
      } catch (err) {
        const durationMs = Date.now() - start
        cumulativeMs += durationMs
        const isTimeout = err instanceof TimeoutError
        const status = isTimeout ? 'timeout' : 'error'
        const errorMessage = err instanceof Error ? err.message : String(err)

        receipts.push({
          pluginId: reg.pluginId,
          hookName,
          status,
          durationMs,
          error: errorMessage,
        })

        if (reg.failPolicy === 'fail_closed') {
          break
        }
        // fail_open: continue to next handler
      }
    }

    // Fire-and-forget: write receipts to plugin_events
    void writeReceiptsToEvents(receipts).catch(() => {})

    return { data: currentData, blocked, receipts }
  }
}

// ---------------------------------------------------------------------------
// Timeout helper
// ---------------------------------------------------------------------------

class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Hook handler timed out after ${ms}ms`)
    this.name = 'TimeoutError'
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(ms)), ms)
    promise
      .then((val) => {
        clearTimeout(timer)
        resolve(val)
      })
      .catch((err) => {
        clearTimeout(timer)
        reject(err as Error)
      })
  })
}

// ---------------------------------------------------------------------------
// Receipt persistence (fire-and-forget)
// ---------------------------------------------------------------------------

async function writeReceiptsToEvents(receipts: HookReceipt[]): Promise<void> {
  for (const receipt of receipts) {
    try {
      await createPluginEvent({
        plugin_id: receipt.pluginId,
        kind: 'hook',
        status: receipt.status === 'ok' ? 'ok' : 'error',
        detail_json: JSON.stringify({
          hookName: receipt.hookName,
          status: receipt.status,
          durationMs: receipt.durationMs,
          error: receipt.error ?? null,
        }),
      })
    } catch {
      // Non-fatal
    }
  }
}

// ---------------------------------------------------------------------------
// Module-level singleton (initialized during bootPlugins)
// ---------------------------------------------------------------------------

let _hookRegistry: HookRegistry | null = null
let _hookDispatcher: HookDispatcher | null = null

/**
 * Initialize the hook system. Called once during bootPlugins().
 */
export function initHookSystem(eventBudgetMs?: number): {
  registry: HookRegistry
  dispatcher: HookDispatcher
} {
  _hookRegistry = new HookRegistry()
  _hookDispatcher = new HookDispatcher(_hookRegistry, eventBudgetMs)
  return { registry: _hookRegistry, dispatcher: _hookDispatcher }
}

/**
 * Get the module-level hook registry singleton.
 * Returns null if the hook system has not been initialized.
 */
export function getHookRegistry(): HookRegistry | null {
  return _hookRegistry
}

/**
 * Get the module-level hook dispatcher singleton.
 * Returns null if the hook system has not been initialized.
 */
export function getHookDispatcher(): HookDispatcher | null {
  return _hookDispatcher
}

/**
 * Reset the hook system singletons (for testing only).
 */
export function _resetHookSystemForTest(): void {
  _hookRegistry = null
  _hookDispatcher = null
}
