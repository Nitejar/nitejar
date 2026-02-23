import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  SessionQueue,
  QueueManager,
  coalesceMessages,
  CollectModeHandler,
  DEFAULT_QUEUE_CONFIG,
  type QueueConfig,
  type QueuedMessage,
  type SessionQueueCallbacks,
} from './session-queue'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessage(overrides: Partial<QueuedMessage> = {}): QueuedMessage {
  return {
    workItemId: 'wi-1',
    pluginInstanceId: 'int-1',
    responseContext: { chatId: 123 },
    text: 'hello',
    senderName: 'Josh',
    timestamp: Date.now(),
    ...overrides,
  }
}

function makeCallbacks(overrides: Partial<SessionQueueCallbacks> = {}): SessionQueueCallbacks {
  return {
    startRun: overrides.startRun ?? vi.fn(() => Promise.resolve()),
    onQueued: overrides.onQueued ?? vi.fn(),
  }
}

const defaultConfig: QueueConfig = { ...DEFAULT_QUEUE_CONFIG, debounceMs: 100 }

// ---------------------------------------------------------------------------
// coalesceMessages
// ---------------------------------------------------------------------------

describe('coalesceMessages', () => {
  it('returns empty string for no messages', () => {
    expect(coalesceMessages([])).toBe('')
  })

  it('returns raw text for a single message', () => {
    const msg = makeMessage({ text: 'hello world' })
    expect(coalesceMessages([msg])).toBe('hello world')
  })

  it('formats multiple messages with header and timestamps', () => {
    const msgs = [
      makeMessage({ text: 'first', senderName: 'Alice', timestamp: 1000 }),
      makeMessage({ text: 'second', senderName: 'Bob', timestamp: 2000 }),
      makeMessage({ text: 'third', senderName: 'Alice', timestamp: 3000 }),
    ]
    const result = coalesceMessages(msgs)

    expect(result).toContain('[3 messages arrived while you were working]')
    expect(result).toContain('Alice] first')
    expect(result).toContain('Bob] second')
    expect(result).toContain('Alice] third')
  })
})

// ---------------------------------------------------------------------------
// CollectModeHandler
// ---------------------------------------------------------------------------

describe('CollectModeHandler', () => {
  it('always returns queue action', () => {
    const handler = new CollectModeHandler()
    const action = handler.onMessageDuringRun(makeMessage(), {
      sessionKey: 'test',
      startedAt: Date.now(),
    })
    expect(action).toEqual({ type: 'queue' })
  })
})

// ---------------------------------------------------------------------------
// SessionQueue
// ---------------------------------------------------------------------------

describe('SessionQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('single message → debounce → run starts', () => {
    const startRun = vi.fn(() => Promise.resolve())
    const callbacks = makeCallbacks({ startRun })
    const queue = new SessionQueue('s1', defaultConfig, callbacks)

    expect(queue.getState()).toBe('idle')

    queue.enqueue(makeMessage({ text: 'hi' }))
    expect(queue.getState()).toBe('debouncing')

    // Run hasn't started yet
    expect(startRun).not.toHaveBeenCalled()

    // Advance past debounce
    vi.advanceTimersByTime(defaultConfig.debounceMs + 10)

    expect(queue.getState()).toBe('running')
    expect(startRun).toHaveBeenCalledTimes(1)
    expect(startRun).toHaveBeenCalledWith('hi', expect.anything(), expect.any(Array))

    queue.destroy()
  })

  it('rapid messages during debounce are coalesced into one run', () => {
    const startRun = vi.fn(() => Promise.resolve())
    const callbacks = makeCallbacks({ startRun })
    const queue = new SessionQueue('s1', defaultConfig, callbacks)

    queue.enqueue(makeMessage({ text: 'msg1', senderName: 'A', timestamp: 1000 }))
    vi.advanceTimersByTime(50) // halfway through debounce
    queue.enqueue(makeMessage({ text: 'msg2', senderName: 'B', timestamp: 2000 }))
    vi.advanceTimersByTime(50) // timer was reset, still debouncing
    expect(startRun).not.toHaveBeenCalled()

    // Advance past the reset debounce
    vi.advanceTimersByTime(defaultConfig.debounceMs + 10)

    expect(startRun).toHaveBeenCalledTimes(1)
    const coalescedText = (startRun.mock.calls as unknown[][])[0]![0] as string
    expect(coalescedText).toContain('[2 messages arrived while you were working]')
    expect(coalescedText).toContain('msg1')
    expect(coalescedText).toContain('msg2')

    queue.destroy()
  })

  it('message during active run → queued, onQueued callback called', () => {
    const startRun = vi.fn(() => Promise.resolve())
    const onQueued = vi.fn()
    const callbacks = makeCallbacks({ startRun, onQueued })
    const queue = new SessionQueue('s1', defaultConfig, callbacks)

    // Start a run
    queue.enqueue(makeMessage({ text: 'first' }))
    vi.advanceTimersByTime(defaultConfig.debounceMs + 10)
    expect(queue.getState()).toBe('running')

    // New message during run
    const pendingMsg = makeMessage({ text: 'during run' })
    queue.enqueue(pendingMsg)

    expect(queue.getPendingQueueSize()).toBe(1)
    expect(onQueued).toHaveBeenCalledWith(pendingMsg)

    queue.destroy()
  })

  it('run completes with pending → follow-up run starts with coalesced text', () => {
    const startRun = vi.fn(() => Promise.resolve())
    const callbacks = makeCallbacks({ startRun })
    const queue = new SessionQueue('s1', defaultConfig, callbacks)

    // Start first run
    queue.enqueue(makeMessage({ text: 'original' }))
    vi.advanceTimersByTime(defaultConfig.debounceMs + 10)
    expect(startRun).toHaveBeenCalledTimes(1)

    // Queue messages during run
    queue.enqueue(makeMessage({ text: 'pending1', timestamp: 1000 }))
    queue.enqueue(makeMessage({ text: 'pending2', timestamp: 2000 }))
    expect(queue.getPendingQueueSize()).toBe(2)

    // Complete the run
    queue.onRunComplete()

    // Follow-up run should start
    expect(startRun).toHaveBeenCalledTimes(2)
    const followUpText = (startRun.mock.calls as unknown[][])[1]![0] as string
    expect(followUpText).toContain('[2 messages arrived while you were working]')
    expect(followUpText).toContain('pending1')
    expect(followUpText).toContain('pending2')
    expect(queue.getState()).toBe('running')
    expect(queue.getPendingQueueSize()).toBe(0)

    queue.destroy()
  })

  it('follow-up run receives the pending messages (not the original)', () => {
    const startRun = vi.fn(() => Promise.resolve())
    const callbacks = makeCallbacks({ startRun })
    const queue = new SessionQueue('s1', defaultConfig, callbacks)

    // Start first run
    queue.enqueue(makeMessage({ text: 'original', workItemId: 'wi-original' }))
    vi.advanceTimersByTime(defaultConfig.debounceMs + 10)
    expect(startRun).toHaveBeenCalledTimes(1)

    // The first run should receive the original message
    const firstMessages = (startRun.mock.calls as unknown[][])[0]![2] as QueuedMessage[]
    expect(firstMessages).toHaveLength(1)
    expect(firstMessages[0]!.workItemId).toBe('wi-original')

    // Queue messages during run
    queue.enqueue(makeMessage({ text: 'pending1', workItemId: 'wi-pending-1' }))
    queue.enqueue(makeMessage({ text: 'pending2', workItemId: 'wi-pending-2' }))

    // Complete the run — follow-up should receive the pending messages
    queue.onRunComplete()

    expect(startRun).toHaveBeenCalledTimes(2)
    const followUpMessages = (startRun.mock.calls as unknown[][])[1]![2] as QueuedMessage[]
    expect(followUpMessages).toHaveLength(2)
    expect(followUpMessages[0]!.workItemId).toBe('wi-pending-1')
    expect(followUpMessages[1]!.workItemId).toBe('wi-pending-2')

    queue.destroy()
  })

  it('run completes with nothing pending → session goes idle', () => {
    const startRun = vi.fn(() => Promise.resolve())
    const callbacks = makeCallbacks({ startRun })
    const queue = new SessionQueue('s1', defaultConfig, callbacks)

    // Start run
    queue.enqueue(makeMessage({ text: 'original' }))
    vi.advanceTimersByTime(defaultConfig.debounceMs + 10)
    expect(queue.getState()).toBe('running')

    // Complete with no pending
    queue.onRunComplete()
    expect(queue.getState()).toBe('idle')

    queue.destroy()
  })

  it('max queue cap — excess messages are dropped', () => {
    const config: QueueConfig = { ...defaultConfig, maxQueued: 2 }
    const onQueued = vi.fn()
    const callbacks = makeCallbacks({ onQueued })
    const queue = new SessionQueue('s1', config, callbacks)

    // Start a run
    queue.enqueue(makeMessage({ text: 'first' }))
    vi.advanceTimersByTime(defaultConfig.debounceMs + 10)

    // Queue up to max
    queue.enqueue(makeMessage({ text: 'p1' }))
    queue.enqueue(makeMessage({ text: 'p2' }))
    expect(queue.getPendingQueueSize()).toBe(2)

    // This one should be dropped
    queue.enqueue(makeMessage({ text: 'p3 - dropped' }))
    expect(queue.getPendingQueueSize()).toBe(2)

    // onQueued was only called for the first two
    expect(onQueued).toHaveBeenCalledTimes(2)

    queue.destroy()
  })

  it('destroy clears timers and resets state', () => {
    const startRun = vi.fn(() => Promise.resolve())
    const callbacks = makeCallbacks({ startRun })
    const queue = new SessionQueue('s1', defaultConfig, callbacks)

    queue.enqueue(makeMessage({ text: 'hello' }))
    expect(queue.getState()).toBe('debouncing')

    queue.destroy()
    expect(queue.getState()).toBe('idle')
    expect(queue.getDebounceBufferSize()).toBe(0)
    expect(queue.getPendingQueueSize()).toBe(0)

    // Timer should have been cleared — advancing shouldn't trigger run
    vi.advanceTimersByTime(defaultConfig.debounceMs + 100)
    expect(startRun).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// QueueManager
// ---------------------------------------------------------------------------

describe('QueueManager', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('creates session queue on first enqueue', () => {
    const manager = new QueueManager()
    const startRun = vi.fn(() => Promise.resolve())
    const callbacks = makeCallbacks({ startRun })

    expect(manager.getStatus('s1')).toBeNull()

    manager.enqueue('s1', makeMessage(), defaultConfig, callbacks)
    expect(manager.getStatus('s1')).toEqual({ state: 'debouncing', pending: 0 })

    manager.destroyAll()
  })

  it('isRunning returns correct status', () => {
    const manager = new QueueManager()
    const startRun = vi.fn(() => Promise.resolve())
    const callbacks = makeCallbacks({ startRun })

    expect(manager.isRunning('s1')).toBe(false)

    manager.enqueue('s1', makeMessage(), defaultConfig, callbacks)
    expect(manager.isRunning('s1')).toBe(false) // debouncing, not running

    vi.advanceTimersByTime(defaultConfig.debounceMs + 10)
    expect(manager.isRunning('s1')).toBe(true)

    manager.destroyAll()
  })

  it('onRunComplete cleans up idle sessions', () => {
    const manager = new QueueManager()
    const startRun = vi.fn(() => Promise.resolve())
    const callbacks = makeCallbacks({ startRun })

    manager.enqueue('s1', makeMessage(), defaultConfig, callbacks)
    vi.advanceTimersByTime(defaultConfig.debounceMs + 10)
    expect(manager.getStatus('s1')).not.toBeNull()

    manager.onRunComplete('s1')
    // Session should be cleaned up since no pending messages
    expect(manager.getStatus('s1')).toBeNull()

    manager.destroyAll()
  })

  it('destroySession removes a specific session', () => {
    const manager = new QueueManager()
    const startRun = vi.fn(() => Promise.resolve())
    const callbacks = makeCallbacks({ startRun })

    manager.enqueue('s1', makeMessage(), defaultConfig, callbacks)
    manager.enqueue('s2', makeMessage(), defaultConfig, callbacks)

    manager.destroySession('s1')
    expect(manager.getStatus('s1')).toBeNull()
    expect(manager.getStatus('s2')).not.toBeNull()

    manager.destroyAll()
  })
})
