import {
  createRoutineRun,
  enqueueRoutineRun,
  listDueRoutines,
  setRoutineEnabled,
  updateRoutine,
  type Routine,
} from '@nitejar/database'
import { logSchemaMismatchOnce } from './schema-mismatch'
import { computeNextCronRunAt, getMinimumRoutineRecurrenceSeconds } from './routines/cron'
import { evaluateRoutineRule, getAlwaysTrueRuleForProbe, parseRoutineRule } from './routines/rules'
import { runConditionProbe } from './routines/probes'

const WORKER_STATE_KEY = '__nitejarRoutineSchedulerWorker'
const TICK_MS = 30_000
const MAX_DUE_PER_TICK = 100
const MAX_CATCHUP_JITTER_SECONDS = 120

const ONE_SHOT_KINDS = new Set(['oneshot'])

type WorkerState = {
  started: boolean
  running: boolean
  draining: boolean
  timer?: NodeJS.Timeout
  processFn?: () => Promise<void>
}

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function getState(): WorkerState {
  const globalState = globalThis as typeof globalThis & {
    [WORKER_STATE_KEY]?: WorkerState
  }

  const existing = globalState[WORKER_STATE_KEY]
  if (existing) return existing

  const created: WorkerState = {
    started: false,
    running: false,
    draining: false,
  }
  globalState[WORKER_STATE_KEY] = created
  return created
}

function parseRuleJson(ruleJson: string): unknown {
  try {
    return JSON.parse(ruleJson)
  } catch {
    return null
  }
}

function computeCatchupRunAt(routine: Routine, nowTs: number): number {
  const dueAt = routine.next_run_at ?? nowTs
  if (dueAt >= nowTs) {
    return nowTs
  }

  const jitter = Math.floor(Math.random() * (MAX_CATCHUP_JITTER_SECONDS + 1))
  return nowTs + jitter
}

function defaultNextConditionEvaluation(nowTs: number): number {
  return nowTs + getMinimumRoutineRecurrenceSeconds()
}

async function recordDecisionOnly(input: {
  routine: Routine
  triggerOrigin: 'cron' | 'condition' | 'oneshot'
  decision: 'skipped' | 'error'
  decisionReason: string
  envelopeJson?: string | null
  evaluatedAt: number
}): Promise<void> {
  await createRoutineRun({
    routine_id: input.routine.id,
    trigger_origin: input.triggerOrigin,
    trigger_ref: null,
    envelope_json: input.envelopeJson ?? null,
    decision: input.decision,
    decision_reason: input.decisionReason,
    scheduled_item_id: null,
    work_item_id: null,
    evaluated_at: input.evaluatedAt,
  })
}

async function evaluateCronRoutine(routine: Routine, nowTs: number): Promise<void> {
  if (!routine.cron_expr || !routine.timezone) {
    await recordDecisionOnly({
      routine,
      triggerOrigin: 'cron',
      decision: 'error',
      decisionReason: 'Cron routine is missing cron_expr or timezone.',
      evaluatedAt: nowTs,
    })

    await updateRoutine(routine.id, {
      last_evaluated_at: nowTs,
      last_status: 'error',
      next_run_at: nowTs + getMinimumRoutineRecurrenceSeconds(),
    })
    return
  }

  const runAt = computeCatchupRunAt(routine, nowTs)
  await enqueueRoutineRun({
    routine,
    triggerOrigin: 'cron',
    triggerRef: `cron:${routine.id}:${routine.next_run_at ?? nowTs}`,
    runAt,
  })

  const nextRunAt = computeNextCronRunAt(routine.cron_expr, routine.timezone, {
    fromEpochSeconds: Math.max(nowTs, routine.next_run_at ?? nowTs),
  })

  await updateRoutine(routine.id, {
    next_run_at: nextRunAt,
    last_evaluated_at: nowTs,
    last_fired_at: nowTs,
    last_status: 'enqueued',
  })
}

async function evaluateConditionRoutine(routine: Routine, nowTs: number): Promise<void> {
  if (!routine.condition_probe) {
    await recordDecisionOnly({
      routine,
      triggerOrigin: 'condition',
      decision: 'error',
      decisionReason: 'Condition routine is missing condition_probe.',
      evaluatedAt: nowTs,
    })

    await updateRoutine(routine.id, {
      last_evaluated_at: nowTs,
      last_status: 'error',
      next_run_at: defaultNextConditionEvaluation(nowTs),
    })
    return
  }

  const probeOutput = await runConditionProbe(routine.condition_probe, routine.condition_config)
  const parsedRule = routine.rule_json
    ? parseRoutineRule(parseRuleJson(routine.rule_json), 'probe')
    : getAlwaysTrueRuleForProbe()
  const shouldEnqueue = evaluateRoutineRule(parsedRule, probeOutput)

  if (shouldEnqueue) {
    const runAt = computeCatchupRunAt(routine, nowTs)
    await enqueueRoutineRun({
      routine,
      triggerOrigin: 'condition',
      triggerRef: `condition:${routine.condition_probe}:${nowTs}`,
      envelopeJson: JSON.stringify(probeOutput),
      runAt,
    })
  } else {
    await recordDecisionOnly({
      routine,
      triggerOrigin: 'condition',
      decision: 'skipped',
      decisionReason: 'Rule evaluated to false for deterministic probe output.',
      envelopeJson: JSON.stringify(probeOutput),
      evaluatedAt: nowTs,
    })
  }

  const nextRunAt =
    routine.cron_expr && routine.timezone
      ? computeNextCronRunAt(routine.cron_expr, routine.timezone, {
          fromEpochSeconds: Math.max(nowTs, routine.next_run_at ?? nowTs),
        })
      : defaultNextConditionEvaluation(nowTs)

  await updateRoutine(routine.id, {
    next_run_at: nextRunAt,
    last_evaluated_at: nowTs,
    last_fired_at: shouldEnqueue ? nowTs : routine.last_fired_at,
    last_status: shouldEnqueue ? 'enqueued' : 'skipped',
  })
}

async function evaluateOneShotRoutine(routine: Routine, nowTs: number): Promise<void> {
  const runAt = computeCatchupRunAt(routine, nowTs)

  await enqueueRoutineRun({
    routine,
    triggerOrigin: 'oneshot',
    triggerRef: `oneshot:${routine.id}`,
    runAt,
  })

  await updateRoutine(routine.id, {
    next_run_at: null,
    last_evaluated_at: nowTs,
    last_fired_at: nowTs,
    last_status: 'enqueued',
  })

  await setRoutineEnabled(routine.id, false)
}

async function processDueRoutine(routine: Routine): Promise<void> {
  const nowTs = now()

  try {
    if (ONE_SHOT_KINDS.has(routine.trigger_kind)) {
      await evaluateOneShotRoutine(routine, nowTs)
      return
    }

    if (routine.trigger_kind === 'condition') {
      await evaluateConditionRoutine(routine, nowTs)
      return
    }

    if (routine.trigger_kind === 'cron') {
      await evaluateCronRoutine(routine, nowTs)
      return
    }

    await recordDecisionOnly({
      routine,
      triggerOrigin: 'cron',
      decision: 'error',
      decisionReason: `Unsupported trigger kind in scheduler worker: ${routine.trigger_kind}`,
      evaluatedAt: nowTs,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    await recordDecisionOnly({
      routine,
      triggerOrigin: routine.trigger_kind === 'condition' ? 'condition' : 'cron',
      decision: 'error',
      decisionReason: message,
      evaluatedAt: nowTs,
    })

    await updateRoutine(routine.id, {
      last_evaluated_at: nowTs,
      last_status: 'error',
      next_run_at:
        routine.trigger_kind === 'cron' || routine.trigger_kind === 'condition'
          ? nowTs + getMinimumRoutineRecurrenceSeconds()
          : routine.next_run_at,
    })

    console.warn('[RoutineSchedulerWorker] routine evaluation failed', {
      routineId: routine.id,
      triggerKind: routine.trigger_kind,
      error: message,
    })
  }
}

async function processTick(): Promise<void> {
  const due = await listDueRoutines(now(), { limit: MAX_DUE_PER_TICK })
  if (due.length === 0) {
    return
  }

  for (const routine of due) {
    await processDueRoutine(routine)
  }
}

export function ensureRoutineSchedulerWorker(): void {
  const state = getState()
  state.processFn = processTick

  if (state.started) return
  state.started = true

  const tick = async () => {
    if (state.running || state.draining) return
    state.running = true
    try {
      await state.processFn!()
    } catch (error) {
      if (logSchemaMismatchOnce(error, 'RoutineSchedulerWorker')) {
        stopRoutineSchedulerWorker()
        return
      }
      console.warn('[RoutineSchedulerWorker] Tick failed', error)
    } finally {
      state.running = false
    }
  }

  void tick()
  state.timer = setInterval(() => {
    void tick()
  }, TICK_MS)

  if (typeof state.timer.unref === 'function') {
    state.timer.unref()
  }

  console.log('[RoutineSchedulerWorker] Started')
}

export function stopRoutineSchedulerWorker(): void {
  const state = getState()
  state.draining = true
  if (state.timer) {
    clearInterval(state.timer)
    state.timer = undefined
  }
}

export function isRoutineSchedulerWorkerBusy(): boolean {
  return getState().running
}
