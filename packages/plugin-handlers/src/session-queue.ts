/**
 * Session Queue — serializes agent runs per conversation and coalesces
 * messages that arrive while a run is active.
 *
 * State machine per session:
 *   IDLE → DEBOUNCING → RUNNING → (check pending) → RUNNING | IDLE
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

import type { QueueConfig } from './types'
export type { QueueMode, QueueConfig } from './types'
export { DEFAULT_QUEUE_CONFIG } from './types'

export interface QueuedMessage {
  workItemId: string
  pluginInstanceId: string
  responseContext: unknown
  text: string
  senderName: string
  timestamp: number
}

/** Info passed to mode handlers about the currently-active run */
export interface ActiveRunInfo {
  sessionKey: string
  startedAt: number
}

/** Action returned by a mode handler to decide what to do with an incoming message */
export type QueueAction =
  | { type: 'queue' }
  | { type: 'followup' }
  | { type: 'steer'; cancel?: boolean }
  | { type: 'interrupt' }
  | { type: 'classify'; prompt: string; model?: string }

/** Strategy interface — each queue mode implements this */
export interface QueueModeHandler {
  onMessageDuringRun(message: QueuedMessage, activeRun: ActiveRunInfo): QueueAction
}

// ---------------------------------------------------------------------------
// Collect mode (V1 default)
// ---------------------------------------------------------------------------

export class CollectModeHandler implements QueueModeHandler {
  onMessageDuringRun(_message: QueuedMessage, _activeRun: ActiveRunInfo): QueueAction {
    return { type: 'queue' }
  }
}

// ---------------------------------------------------------------------------
// Coalescing
// ---------------------------------------------------------------------------

/**
 * Format multiple queued messages into a single user turn for the agent.
 */
export function coalesceMessages(messages: QueuedMessage[]): string {
  if (messages.length === 0) return ''
  if (messages.length === 1) return messages[0]!.text

  const header = `[${messages.length} messages arrived while you were working]\n`
  const lines = messages.map((m) => {
    const time = new Date(m.timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
    return `[${time} - ${m.senderName}] ${m.text}`
  })
  return header + '\n' + lines.join('\n')
}

// ---------------------------------------------------------------------------
// Callbacks the queue uses to interact with the outside world
// ---------------------------------------------------------------------------

export interface SessionQueueCallbacks {
  /** Start an agent run with the given coalesced text, response context, and source messages */
  startRun: (
    coalescedText: string,
    responseContext: unknown,
    messages: QueuedMessage[]
  ) => Promise<void>
  /** Called when a message is queued during a run (e.g. send typing indicator) */
  onQueued?: (message: QueuedMessage) => void
}

// ---------------------------------------------------------------------------
// SessionQueue — one per conversation
// ---------------------------------------------------------------------------

type SessionState = 'idle' | 'debouncing' | 'running'

export class SessionQueue {
  readonly sessionKey: string
  private state: SessionState = 'idle'
  private config: QueueConfig
  private modeHandler: QueueModeHandler
  private callbacks: SessionQueueCallbacks

  /** Messages collected during the debounce window */
  private debounceBuffer: QueuedMessage[] = []
  /** Messages that arrived while a run was in progress */
  private pendingQueue: QueuedMessage[] = []
  /** Debounce timer handle */
  private debounceTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    sessionKey: string,
    config: QueueConfig,
    callbacks: SessionQueueCallbacks,
    modeHandler?: QueueModeHandler
  ) {
    this.sessionKey = sessionKey
    this.config = config
    this.callbacks = callbacks
    this.modeHandler = modeHandler ?? new CollectModeHandler()
  }

  getState(): SessionState {
    return this.state
  }

  getDebounceBufferSize(): number {
    return this.debounceBuffer.length
  }

  getPendingQueueSize(): number {
    return this.pendingQueue.length
  }

  /**
   * Enqueue a new message. Behavior depends on current state.
   */
  enqueue(message: QueuedMessage): void {
    switch (this.state) {
      case 'idle':
        this.state = 'debouncing'
        this.debounceBuffer = [message]
        this.startDebounceTimer()
        break

      case 'debouncing':
        this.debounceBuffer.push(message)
        this.resetDebounceTimer()
        break

      case 'running': {
        const action = this.modeHandler.onMessageDuringRun(message, {
          sessionKey: this.sessionKey,
          startedAt: Date.now(),
        })

        if (action.type === 'queue' || action.type === 'followup') {
          if (this.pendingQueue.length < this.config.maxQueued) {
            this.pendingQueue.push(message)
            this.callbacks.onQueued?.(message)
          } else {
            console.warn(
              `[session-queue] Max queued messages (${this.config.maxQueued}) reached for ${this.sessionKey}, dropping message`
            )
          }
        }
        // Other action types (steer, interrupt, classify) are not handled in V1
        break
      }
    }
  }

  /**
   * Called when the current run completes. If there are pending messages,
   * starts a follow-up run; otherwise transitions to idle.
   */
  onRunComplete(): void {
    if (this.state !== 'running') return

    if (this.pendingQueue.length > 0) {
      const messages = this.pendingQueue
      this.pendingQueue = []
      const coalescedText = coalesceMessages(messages)
      const responseContext = messages[messages.length - 1]!.responseContext

      // Stay in running state for the follow-up
      this.callbacks.startRun(coalescedText, responseContext, messages).catch((err) => {
        console.error('[session-queue] Follow-up run failed:', err)
        this.state = 'idle'
      })
    } else {
      this.state = 'idle'
    }
  }

  /**
   * Clean up timers.
   */
  destroy(): void {
    this.clearDebounceTimer()
    this.debounceBuffer = []
    this.pendingQueue = []
    this.state = 'idle'
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private startDebounceTimer(): void {
    this.clearDebounceTimer()
    this.debounceTimer = setTimeout(() => {
      this.onDebounceExpired()
    }, this.config.debounceMs)
  }

  private resetDebounceTimer(): void {
    this.startDebounceTimer()
  }

  private clearDebounceTimer(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
  }

  private onDebounceExpired(): void {
    this.debounceTimer = null
    if (this.state !== 'debouncing') return

    const messages = this.debounceBuffer
    this.debounceBuffer = []
    this.state = 'running'

    const coalescedText = coalesceMessages(messages)
    const responseContext = messages[messages.length - 1]!.responseContext

    this.callbacks.startRun(coalescedText, responseContext, messages).catch((err) => {
      console.error('[session-queue] Run failed:', err)
      this.state = 'idle'
    })
  }
}

// ---------------------------------------------------------------------------
// QueueManager — singleton managing all session queues
// ---------------------------------------------------------------------------

export class QueueManager {
  private queues = new Map<string, SessionQueue>()

  /**
   * Enqueue a message for a session. Creates the session queue on first use.
   */
  enqueue(
    sessionKey: string,
    message: QueuedMessage,
    config: QueueConfig,
    callbacks: SessionQueueCallbacks
  ): void {
    let queue = this.queues.get(sessionKey)
    if (!queue) {
      queue = new SessionQueue(sessionKey, config, callbacks)
      this.queues.set(sessionKey, queue)
    }
    queue.enqueue(message)
  }

  /**
   * Signal that a run completed for the given session.
   */
  onRunComplete(sessionKey: string): void {
    const queue = this.queues.get(sessionKey)
    if (!queue) return
    queue.onRunComplete()

    // Clean up idle queues to avoid unbounded memory growth
    if (queue.getState() === 'idle') {
      queue.destroy()
      this.queues.delete(sessionKey)
    }
  }

  /**
   * Get the current state of a session queue (for debugging / admin).
   */
  getStatus(sessionKey: string): { state: string; pending: number } | null {
    const queue = this.queues.get(sessionKey)
    if (!queue) return null
    return {
      state: queue.getState(),
      pending: queue.getPendingQueueSize(),
    }
  }

  /**
   * Whether a session currently has an active run.
   */
  isRunning(sessionKey: string): boolean {
    const queue = this.queues.get(sessionKey)
    return queue?.getState() === 'running'
  }

  /**
   * Destroy a specific session queue.
   */
  destroySession(sessionKey: string): void {
    const queue = this.queues.get(sessionKey)
    if (queue) {
      queue.destroy()
      this.queues.delete(sessionKey)
    }
  }

  /**
   * Destroy all session queues (for shutdown).
   */
  destroyAll(): void {
    for (const queue of this.queues.values()) {
      queue.destroy()
    }
    this.queues.clear()
  }
}

/**
 * Singleton queue manager — survives Next.js HMR via globalThis.
 * Without this, every hot-reload creates a fresh QueueManager and
 * in-flight queue state (debounce timers, running status) is lost.
 */
const globalForQueue = globalThis as unknown as {
  __nitejar_queueManager: QueueManager | undefined
}

if (!globalForQueue.__nitejar_queueManager) {
  globalForQueue.__nitejar_queueManager = new QueueManager()
}

export const queueManager: QueueManager = globalForQueue.__nitejar_queueManager
