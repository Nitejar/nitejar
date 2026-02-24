import {
  claimNextRoutineEvent,
  createRoutineRun,
  enqueueRoutineRun,
  findRoutineRunByTrigger,
  listEnabledEventRoutines,
  markRoutineEventDone,
  markRoutineEventFailed,
  updateRoutine,
} from '@nitejar/database'
import { logSchemaMismatchOnce } from './schema-mismatch'
import { RoutineEnvelopeSchema } from './routines/envelope'
import {
  evaluateRoutineRule,
  getAlwaysTrueRuleForEnvelope,
  parseRoutineRule,
} from './routines/rules'

const WORKER_STATE_KEY = '__nitejarRoutineEventWorker'
const TICK_MS = 1_000
const LEASE_SECONDS = 120
const MAX_RETRY_ATTEMPTS = 5

const ROUTINE_EVENT_RECURSION_SOURCE = 'routine'

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
  if (existing) {
    return existing
  }

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

async function processClaimedEvent(): Promise<void> {
  const workerId = `routine-event-worker:${process.pid}`
  const queued = await claimNextRoutineEvent(workerId, { leaseSeconds: LEASE_SECONDS })
  if (!queued) {
    return
  }

  try {
    const envelopeUnknown: unknown = JSON.parse(queued.envelope_json)
    const envelope = RoutineEnvelopeSchema.parse(envelopeUnknown)
    const routines = await listEnabledEventRoutines()

    for (const routine of routines) {
      const triggerRef = envelope.eventId
      const existing = await findRoutineRunByTrigger(routine.id, 'event', triggerRef)
      if (existing) {
        continue
      }

      if (envelope.source === ROUTINE_EVENT_RECURSION_SOURCE) {
        await createRoutineRun({
          routine_id: routine.id,
          trigger_origin: 'event',
          trigger_ref: triggerRef,
          envelope_json: JSON.stringify(envelope),
          decision: 'skipped',
          decision_reason: 'Routine-triggered events are blocked to prevent recursive runs in V1.',
          scheduled_item_id: null,
          work_item_id: null,
          evaluated_at: now(),
        })

        await updateRoutine(routine.id, {
          last_evaluated_at: now(),
          last_status: 'skipped',
        })
        continue
      }

      const parsedRule = routine.rule_json
        ? parseRoutineRule(parseRuleJson(routine.rule_json), 'envelope')
        : getAlwaysTrueRuleForEnvelope()

      const matches = evaluateRoutineRule(parsedRule, envelope)
      if (matches) {
        await enqueueRoutineRun({
          routine,
          triggerOrigin: 'event',
          triggerRef,
          envelopeJson: JSON.stringify(envelope),
          runAt: now(),
        })

        await updateRoutine(routine.id, {
          last_evaluated_at: now(),
          last_fired_at: now(),
          last_status: 'enqueued',
        })
      } else {
        await createRoutineRun({
          routine_id: routine.id,
          trigger_origin: 'event',
          trigger_ref: triggerRef,
          envelope_json: JSON.stringify(envelope),
          decision: 'skipped',
          decision_reason: 'Event rule did not match envelope.',
          scheduled_item_id: null,
          work_item_id: null,
          evaluated_at: now(),
        })

        await updateRoutine(routine.id, {
          last_evaluated_at: now(),
          last_status: 'skipped',
        })
      }
    }

    await markRoutineEventDone(queued.id)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await markRoutineEventFailed(queued.id, message, {
      retryable: queued.attempt_count < MAX_RETRY_ATTEMPTS,
    })
    console.warn('[RoutineEventWorker] Failed processing queued event', {
      queueId: queued.id,
      eventKey: queued.event_key,
      error: message,
    })
  }
}

export function ensureRoutineEventWorker(): void {
  const state = getState()
  state.processFn = processClaimedEvent

  if (state.started) return
  state.started = true

  const tick = async () => {
    if (state.running || state.draining) return
    state.running = true
    try {
      await state.processFn!()
    } catch (error) {
      if (logSchemaMismatchOnce(error, 'RoutineEventWorker')) {
        stopRoutineEventWorker()
        return
      }
      console.warn('[RoutineEventWorker] Tick failed', error)
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

  console.log('[RoutineEventWorker] Started')
}

export function stopRoutineEventWorker(): void {
  const state = getState()
  state.draining = true
  if (state.timer) {
    clearInterval(state.timer)
    state.timer = undefined
  }
}

export function isRoutineEventWorkerBusy(): boolean {
  return getState().running
}
