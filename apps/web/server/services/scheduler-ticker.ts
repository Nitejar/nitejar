import {
  getDb,
  listPendingScheduledItems,
  claimScheduledItem,
  confirmScheduledItemFired,
  releaseScheduledItem,
  recoverStaleFiringItems,
  createWorkItem,
  enqueueToLane,
  findAgentById,
  linkRoutineRunToWorkItemByScheduledItem,
  updateRoutine,
  setRoutineEnabled,
} from '@nitejar/database'
import { publishRoutineEnvelopeFromWorkItem } from './routines/publish'

const TICK_INTERVAL_MS = 30_000
const TICKER_STATE_KEY = '__nitejarSchedulerTicker'
/** Items stuck in 'firing' longer than this are reset to 'pending' */
const STALE_FIRING_SECONDS = 300

type TickerState = {
  started: boolean
  running: boolean
  timer?: NodeJS.Timeout
  /** Swappable reference so HMR picks up new code without restarting the interval */
  processFn?: () => Promise<void>
}

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function getTickerState(): TickerState {
  const globalWithState = globalThis as typeof globalThis & {
    [TICKER_STATE_KEY]?: TickerState
  }

  const existing = globalWithState[TICKER_STATE_KEY]
  if (existing) {
    return existing
  }

  const initialized: TickerState = { started: false, running: false }
  globalWithState[TICKER_STATE_KEY] = initialized
  return initialized
}

async function tick(): Promise<void> {
  // Recover any items stuck in 'firing' from a previous crash
  const recovered = await recoverStaleFiringItems(STALE_FIRING_SECONDS)
  if (recovered > 0) {
    console.log(`[SchedulerTicker] Recovered ${recovered} stale firing item(s)`)
  }

  const items = await listPendingScheduledItems(now())
  if (items.length === 0) return

  console.log(`[SchedulerTicker] Processing ${items.length} pending scheduled item(s)`)

  for (const item of items) {
    let ownedByUs = false
    try {
      // Atomic claim: pending → firing. Skip if another process already claimed it.
      const claimed = await claimScheduledItem(item.id)
      if (!claimed) {
        console.log(`[SchedulerTicker] Item ${item.id} already claimed, skipping`)
        continue
      }
      ownedByUs = true

      // Guard: skip if agent was deleted since the item was scheduled
      const agent = await findAgentById(item.agent_id)
      if (!agent) {
        console.warn(`[SchedulerTicker] Agent ${item.agent_id} not found, skipping item ${item.id}`)
        // Don't release — agent is gone, firing is a reasonable terminal state
        await confirmScheduledItemFired(item.id)
        continue
      }

      // Scheduler-specific queue_key — isolates from conversation lanes so mode='followup'
      // sticks (upsertQueueLaneOnMessage doesn't overwrite mode on existing lanes)
      const queueKey = `sched:${item.session_key}:${item.agent_id}`
      const arrivedAt = now()
      let createdWorkItemId: string | null = null

      // Single atomic transaction: work item + queue message + lane + fired status.
      // Either ALL writes commit or NONE do. No orphaned work items, no orphaned
      // queue messages, no window between enqueue and confirm where stale sweep
      // could recover an already-enqueued item back to pending.
      const db = getDb()
      await db.transaction().execute(async (trx) => {
        const workItem = await createWorkItem(
          {
            source: item.routine_id ? 'routine' : 'scheduler',
            source_ref: item.routine_id
              ? `routine:${item.routine_id}:scheduled:${item.id}`
              : `scheduled:${item.id}`,
            session_key: item.session_key,
            status: 'NEW',
            title: `Scheduled: ${item.type}`,
            payload: item.payload,
            plugin_instance_id: item.plugin_instance_id ?? undefined,
          },
          trx
        )
        createdWorkItemId = workItem.id

        await enqueueToLane(
          {
            queue_key: queueKey,
            work_item_id: workItem.id,
            plugin_instance_id: item.plugin_instance_id,
            response_context: item.response_context,
            text: item.payload,
            sender_name: null,
            arrived_at: arrivedAt,
            status: 'pending',
            dispatch_id: null,
            drop_reason: null,
          },
          {
            queueKey,
            sessionKey: item.session_key,
            agentId: item.agent_id,
            pluginInstanceId: item.plugin_instance_id,
            arrivedAt,
            debounceMs: 0,
            maxQueued: 1,
            mode: 'followup',
          },
          trx
        )

        const confirmed = await confirmScheduledItemFired(item.id, trx)
        if (!confirmed) {
          throw new Error(`Scheduled item ${item.id} was not in firing state during confirm`)
        }

        if (item.routine_run_id) {
          await linkRoutineRunToWorkItemByScheduledItem(item.id, workItem.id, trx)
        }

        if (item.routine_id) {
          await updateRoutine(
            item.routine_id,
            {
              last_fired_at: arrivedAt,
              last_status: 'fired',
            },
            trx
          )

          const routineRow = await trx
            .selectFrom('routines')
            .select(['trigger_kind'])
            .where('id', '=', item.routine_id)
            .executeTakeFirst()

          if (routineRow?.trigger_kind === 'oneshot') {
            await setRoutineEnabled(item.routine_id, false, trx)
            await updateRoutine(item.routine_id, { next_run_at: null }, trx)
          }
        }
      })

      if (createdWorkItemId) {
        await publishRoutineEnvelopeFromWorkItem(createdWorkItemId).catch((error) => {
          console.warn(
            '[SchedulerTicker] Failed to publish routine envelope for scheduled work item',
            {
              scheduledItemId: item.id,
              workItemId: createdWorkItemId,
              error: error instanceof Error ? error.message : String(error),
            }
          )
        })
      }

      console.log(`[SchedulerTicker] Enqueued scheduled item ${item.id} for agent ${item.agent_id}`)
    } catch (error) {
      console.error(`[SchedulerTicker] Failed to process scheduled item ${item.id}:`, error)
      if (ownedByUs) {
        // Transaction is all-or-nothing: either every write committed or none did.
        // Safe to release back to pending for retry on next tick.
        try {
          await releaseScheduledItem(item.id)
        } catch (releaseError) {
          console.error(
            `[SchedulerTicker] Failed to release item ${item.id}, will be recovered by stale sweep:`,
            releaseError
          )
        }
      }
    }
  }
}

export function ensureSchedulerTicker(): void {
  const state = getTickerState()

  // Always update the process function so HMR picks up new code
  state.processFn = tick

  if (state.started) return

  state.started = true
  console.log('[SchedulerTicker] Starting scheduler ticker')

  const runTick = async () => {
    if (state.running) return
    state.running = true
    try {
      await state.processFn!()
    } catch (error) {
      console.warn('[SchedulerTicker] Tick failed', error)
    } finally {
      state.running = false
    }
  }

  void runTick()
  state.timer = setInterval(() => {
    void runTick()
  }, TICK_INTERVAL_MS)

  if (typeof state.timer.unref === 'function') {
    state.timer.unref()
  }
}
