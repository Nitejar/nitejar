import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  CrashGuard,
  initCrashGuard,
  getCrashGuard,
  _resetCrashGuardForTest,
} from '../src/crash-guard'

// Mock @nitejar/database
const mockSetPluginEnabled = vi.fn().mockResolvedValue(null)
const mockCreatePluginEvent = vi.fn().mockResolvedValue(null)

vi.mock('@nitejar/database', () => ({
  setPluginEnabled: (...args: unknown[]): Promise<null> =>
    mockSetPluginEnabled(...args) as Promise<null>,
  createPluginEvent: (...args: unknown[]): Promise<null> =>
    mockCreatePluginEvent(...args) as Promise<null>,
}))

/** Flush fire-and-forget microtasks from CrashGuard's auto-disable flow */
async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('CrashGuard', () => {
  let guard: CrashGuard

  beforeEach(() => {
    vi.clearAllMocks()
    // Use a low threshold and short window for testing
    guard = new CrashGuard({ threshold: 3, windowMs: 5000 })
  })

  it('does not disable after failures below threshold', () => {
    guard.recordFailure('plugin-a')
    guard.recordFailure('plugin-a')
    expect(guard.isDisabled('plugin-a')).toBe(false)
    expect(mockSetPluginEnabled).not.toHaveBeenCalled()
  })

  it('auto-disables after reaching threshold', async () => {
    guard.recordFailure('plugin-a')
    guard.recordFailure('plugin-a')
    guard.recordFailure('plugin-a')

    expect(guard.isDisabled('plugin-a')).toBe(true)

    // The DB calls are fire-and-forget; flush microtasks to verify
    await flushMicrotasks()
    expect(mockSetPluginEnabled).toHaveBeenCalledWith('plugin-a', false)
    expect(mockCreatePluginEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        plugin_id: 'plugin-a',
        kind: 'auto_disable',
        status: 'error',
      })
    )
  })

  it('tracks plugins independently', () => {
    guard.recordFailure('plugin-a')
    guard.recordFailure('plugin-a')
    guard.recordFailure('plugin-a')
    guard.recordFailure('plugin-b')

    expect(guard.isDisabled('plugin-a')).toBe(true)
    expect(guard.isDisabled('plugin-b')).toBe(false)
  })

  it('clears failure buffer on success', () => {
    guard.recordFailure('plugin-a')
    guard.recordFailure('plugin-a')
    guard.recordSuccess('plugin-a')
    guard.recordFailure('plugin-a')

    // Only 1 failure after reset, not at threshold
    expect(guard.isDisabled('plugin-a')).toBe(false)
  })

  it('resets plugin state', () => {
    guard.recordFailure('plugin-a')
    guard.recordFailure('plugin-a')
    guard.recordFailure('plugin-a')
    expect(guard.isDisabled('plugin-a')).toBe(true)

    guard.resetPlugin('plugin-a')
    expect(guard.isDisabled('plugin-a')).toBe(false)
  })

  it('prunes old failures outside window', async () => {
    // Create a guard with a very short window
    const shortGuard = new CrashGuard({ threshold: 3, windowMs: 50 })

    shortGuard.recordFailure('plugin-a')
    shortGuard.recordFailure('plugin-a')

    // Wait for the window to expire
    await new Promise((resolve) => setTimeout(resolve, 60))

    shortGuard.recordFailure('plugin-a')

    // Only 1 failure in window (the other 2 were pruned)
    expect(shortGuard.isDisabled('plugin-a')).toBe(false)
  })
})

describe('CrashGuard singletons', () => {
  beforeEach(() => {
    _resetCrashGuardForTest()
    vi.clearAllMocks()
  })

  it('returns null before initialization', () => {
    expect(getCrashGuard()).toBeNull()
  })

  it('initializes and returns singleton', () => {
    const guard = initCrashGuard()
    expect(guard).toBeInstanceOf(CrashGuard)
    expect(getCrashGuard()).toBe(guard)
  })

  it('accepts custom parameters', () => {
    const guard = initCrashGuard({ threshold: 10, windowMs: 60000 })
    expect(guard).toBeInstanceOf(CrashGuard)
  })
})
