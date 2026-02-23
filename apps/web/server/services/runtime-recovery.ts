import { failZombieJobs } from '@nitejar/database'
import { forceTerminateActiveRuntime } from './runtime-control'

const DEFAULT_STALE_SECONDS = 180

export async function runStartupRecovery(): Promise<void> {
  const terminated = await forceTerminateActiveRuntime({
    scope: 'stale_only',
    reason: 'startup_recovery',
    actor: 'system:start',
    staleSeconds: DEFAULT_STALE_SECONDS,
    incrementEpoch: true,
  })
  const failedJobs = await failZombieJobs(0)

  if (failedJobs > 0 || terminated.abandonedDispatches > 0 || terminated.unknownEffects > 0) {
    console.log(
      `[RuntimeRecovery] zombie jobs=${failedJobs}, abandoned dispatches=${terminated.abandonedDispatches}, unknown effects=${terminated.unknownEffects}, epoch=${terminated.epoch}`
    )
  }
}

export async function runPeriodicRecovery(): Promise<void> {
  const terminated = await forceTerminateActiveRuntime({
    scope: 'stale_only',
    reason: 'periodic_recovery',
    actor: 'system:recovery',
    staleSeconds: DEFAULT_STALE_SECONDS,
    incrementEpoch: false,
  })

  if (terminated.abandonedDispatches > 0 || terminated.unknownEffects > 0) {
    console.log(
      `[RuntimeRecovery] periodic abandoned dispatches=${terminated.abandonedDispatches}, unknown effects=${terminated.unknownEffects}`
    )
  }
}
