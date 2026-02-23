/**
 * Application-layer hook dispatch utilities.
 *
 * The hook dispatcher singleton lives in @nitejar/plugin-runtime and is
 * initialized during bootPlugins(). This module provides convenience
 * wrappers that the webhook route, run-dispatch worker, and effect outbox
 * worker call to fire hooks at the correct points.
 *
 * Because the agent runner (packages/agent) must not depend on
 * plugin-runtime, runner hooks (3-7) are injected via a callback in
 * RunOptions. The `createHookDispatchCallback()` factory produces that
 * callback for use by the app layer.
 */

import {
  getHookDispatcher,
  getCrashGuard,
  type HookName,
  type HookReceipt,
} from '@nitejar/plugin-runtime'

export interface HookDispatchResult<TData> {
  data: TData
  blocked: boolean
  receipts: HookReceipt[]
}

/**
 * Safely dispatch a hook through the singleton dispatcher.
 * Returns the original data unchanged if the hook system is not initialized
 * or if an error occurs.
 */
export async function dispatchHook<TData>(
  hookName: HookName,
  context: { workItemId: string; jobId: string; agentId: string },
  data: TData
): Promise<HookDispatchResult<TData>> {
  const dispatcher = getHookDispatcher()
  if (!dispatcher) {
    return { data, blocked: false, receipts: [] }
  }

  try {
    const result = await dispatcher.dispatch(hookName, context, data)

    // Track crash guard successes/failures per plugin from receipts
    const crashGuard = getCrashGuard()
    if (crashGuard) {
      for (const receipt of result.receipts) {
        if (receipt.status === 'ok') {
          crashGuard.recordSuccess(receipt.pluginId)
        } else if (receipt.status === 'error' || receipt.status === 'timeout') {
          crashGuard.recordFailure(receipt.pluginId)
        }
      }
    }

    return result
  } catch (err) {
    console.warn(`[hook-dispatch] Hook "${hookName}" dispatch failed:`, err)
    return { data, blocked: false, receipts: [] }
  }
}

/**
 * Type for the hook dispatch callback injected into the agent runner.
 * This allows the runner to fire hooks without depending on plugin-runtime.
 */
export type RunnerHookDispatch = <TData>(
  hookName: string,
  context: { workItemId: string; jobId: string; agentId: string },
  data: TData
) => Promise<{ data: TData; blocked: boolean }>

/**
 * Create a hook dispatch callback suitable for injection into RunOptions.
 * The returned function is safe to call even if the hook system is down.
 */
export function createRunnerHookDispatch(): RunnerHookDispatch {
  return async <TData>(
    hookName: string,
    context: { workItemId: string; jobId: string; agentId: string },
    data: TData
  ): Promise<{ data: TData; blocked: boolean }> => {
    const result = await dispatchHook(hookName as HookName, context, data)
    return { data: result.data, blocked: result.blocked }
  }
}
