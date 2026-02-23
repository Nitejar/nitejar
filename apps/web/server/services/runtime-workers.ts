import { ensureSchedulerTicker } from './scheduler-ticker'
import {
  ensureRoutineSchedulerWorker,
  stopRoutineSchedulerWorker,
  isRoutineSchedulerWorkerBusy,
} from './routine-scheduler-worker'
import {
  ensureRoutineEventWorker,
  stopRoutineEventWorker,
  isRoutineEventWorkerBusy,
} from './routine-event-worker'
import {
  ensureRunDispatchWorker,
  stopRunDispatchWorker,
  isRunDispatchWorkerBusy,
} from './run-dispatch-worker'
import {
  ensureEffectOutboxWorker,
  stopEffectOutboxWorker,
  isEffectOutboxWorkerBusy,
} from './effect-outbox-worker'
import {
  ensurePassiveMemoryWorker,
  stopPassiveMemoryWorker,
  isPassiveMemoryWorkerBusy,
} from './passive-memory-worker'
import { ensureEvalWorker, stopEvalWorker, isEvalWorkerBusy } from './eval-worker'
import { runPeriodicRecovery, runStartupRecovery } from './runtime-recovery'

const STATE_KEY = '__nitejarRuntimeWorkers'
const RECOVERY_INTERVAL_MS = 60_000
const DEFAULT_DRAIN_MS = 25_000

type RuntimeState = {
  started: boolean
  shuttingDown: boolean
  recoveryTimer?: NodeJS.Timeout
  startupPromise?: Promise<void>
  signalHandlersRegistered: boolean
}

function getState(): RuntimeState {
  const globalState = globalThis as typeof globalThis & {
    [STATE_KEY]?: RuntimeState
  }

  const existing = globalState[STATE_KEY]
  if (existing) {
    return existing
  }

  const created: RuntimeState = {
    started: false,
    shuttingDown: false,
    signalHandlersRegistered: false,
  }
  globalState[STATE_KEY] = created
  return created
}

function registerSignalHandlers(): void {
  const state = getState()
  if (state.signalHandlersRegistered) return
  state.signalHandlersRegistered = true

  const shutdown = (signal: string) => {
    const current = getState()
    if (current.shuttingDown) return
    current.shuttingDown = true

    console.log(`[RuntimeWorkers] Received ${signal}; stopping new claims and draining...`)

    stopRunDispatchWorker()
    stopEffectOutboxWorker()
    stopPassiveMemoryWorker()
    stopRoutineWorkers()
    stopEvalWorker()

    if (current.recoveryTimer) {
      clearInterval(current.recoveryTimer)
      current.recoveryTimer = undefined
    }

    const drainMs = Number(process.env.SHUTDOWN_DRAIN_MS ?? DEFAULT_DRAIN_MS)
    const deadline = Date.now() + drainMs

    const pollDrain = () => {
      const runBusy = isRunDispatchWorkerBusy()
      const outboxBusy = isEffectOutboxWorkerBusy()
      const passiveMemoryBusy = isPassiveMemoryWorkerBusy()
      const routineBusy = isRoutineWorkersBusy()
      const evalBusy = isEvalWorkerBusy()
      if (!runBusy && !outboxBusy && !passiveMemoryBusy && !routineBusy && !evalBusy) {
        console.log('[RuntimeWorkers] In-flight runtime work drained; exiting process')
        process.exit(0)
      }

      if (Date.now() >= deadline) {
        console.log('[RuntimeWorkers] Drain timeout elapsed; exiting process')
        process.exit(0)
      }

      setTimeout(pollDrain, 250).unref()
    }

    void pollDrain()
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

export function ensureRoutineWorkers(): void {
  ensureRoutineSchedulerWorker()
  ensureRoutineEventWorker()
}

function stopRoutineWorkers(): void {
  stopRoutineSchedulerWorker()
  stopRoutineEventWorker()
}

function isRoutineWorkersBusy(): boolean {
  return isRoutineSchedulerWorkerBusy() || isRoutineEventWorkerBusy()
}

export async function ensureRuntimeWorkers(): Promise<void> {
  const state = getState()

  // Always call child workers so they can swap their tick/processFn for HMR
  ensureSchedulerTicker()
  ensureRoutineWorkers()
  ensureRunDispatchWorker()
  ensureEffectOutboxWorker()
  ensurePassiveMemoryWorker()
  ensureEvalWorker()

  if (state.started) return

  if (!state.startupPromise) {
    state.startupPromise = (async () => {
      await runStartupRecovery()

      state.recoveryTimer = setInterval(() => {
        void runPeriodicRecovery().catch((error) => {
          console.warn('[RuntimeWorkers] periodic recovery failed', error)
        })
      }, RECOVERY_INTERVAL_MS)

      if (typeof state.recoveryTimer.unref === 'function') {
        state.recoveryTimer.unref()
      }

      registerSignalHandlers()
      state.started = true
      console.log('[RuntimeWorkers] Started')
    })()
  }

  await state.startupPromise
}
