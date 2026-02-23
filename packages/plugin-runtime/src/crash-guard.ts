import { setPluginEnabled, createPluginEvent } from '@nitejar/database'

// ---------------------------------------------------------------------------
// Configuration (from env or defaults)
// ---------------------------------------------------------------------------

function getCrashThreshold(): number {
  const raw = process.env.SLOPBOT_PLUGIN_CRASH_THRESHOLD
  const parsed = raw ? parseInt(raw, 10) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5
}

function getCrashWindowMs(): number {
  const raw = process.env.SLOPBOT_PLUGIN_CRASH_WINDOW_MS
  const parsed = raw ? parseInt(raw, 10) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 300_000 // 5 minutes
}

// ---------------------------------------------------------------------------
// CrashGuard — in-memory ring buffer per plugin
// ---------------------------------------------------------------------------

export class CrashGuard {
  private failures: Map<string, number[]> = new Map()
  private disabled: Set<string> = new Set()
  private threshold: number
  private windowMs: number

  constructor(options?: { threshold?: number; windowMs?: number }) {
    this.threshold = options?.threshold ?? getCrashThreshold()
    this.windowMs = options?.windowMs ?? getCrashWindowMs()
  }

  /**
   * Record a failure for a plugin.
   * Returns true if the plugin should be auto-disabled (threshold exceeded).
   */
  recordFailure(pluginId: string): boolean {
    if (this.disabled.has(pluginId)) {
      return true // Already disabled
    }

    const now = Date.now()
    let timestamps = this.failures.get(pluginId)
    if (!timestamps) {
      timestamps = []
      this.failures.set(pluginId, timestamps)
    }

    timestamps.push(now)

    // Prune entries older than the window
    const cutoff = now - this.windowMs
    const pruned = timestamps.filter((t) => t >= cutoff)
    this.failures.set(pluginId, pruned)

    if (pruned.length >= this.threshold) {
      this.disabled.add(pluginId)
      this.failures.delete(pluginId)

      // Auto-disable in DB and create receipt event (fire-and-forget)
      void this.autoDisablePlugin(pluginId, pruned.length).catch(() => {})

      return true
    }

    return false
  }

  /**
   * Record a successful execution, clearing the failure ring buffer.
   */
  recordSuccess(pluginId: string): void {
    this.failures.delete(pluginId)
  }

  /**
   * Check if a plugin is in crash-loop disabled state.
   */
  isDisabled(pluginId: string): boolean {
    return this.disabled.has(pluginId)
  }

  /**
   * Re-enable a plugin (called when operator manually re-enables).
   * Clears the disabled flag and failure buffer.
   */
  resetPlugin(pluginId: string): void {
    this.disabled.delete(pluginId)
    this.failures.delete(pluginId)
  }

  /**
   * Reset all state (for testing).
   */
  _resetForTest(): void {
    this.failures.clear()
    this.disabled.clear()
  }

  private async autoDisablePlugin(pluginId: string, failureCount: number): Promise<void> {
    console.warn(
      `[plugin-runtime] Auto-disabling plugin "${pluginId}" after ${failureCount} failures in ${this.windowMs}ms window`
    )

    try {
      await setPluginEnabled(pluginId, false)
    } catch {
      // Non-fatal
    }

    try {
      await createPluginEvent({
        plugin_id: pluginId,
        kind: 'auto_disable',
        status: 'error',
        detail_json: JSON.stringify({
          reason: 'crash_loop',
          failureCount,
          windowMs: this.windowMs,
          threshold: this.threshold,
        }),
      })
    } catch {
      // Non-fatal
    }
  }
}

// ---------------------------------------------------------------------------
// Module-level singleton
// ---------------------------------------------------------------------------

let _crashGuard: CrashGuard | null = null

/**
 * Initialize the crash guard singleton. Called during bootPlugins().
 */
export function initCrashGuard(options?: { threshold?: number; windowMs?: number }): CrashGuard {
  _crashGuard = new CrashGuard(options)
  return _crashGuard
}

/**
 * Get the module-level crash guard singleton.
 */
export function getCrashGuard(): CrashGuard | null {
  return _crashGuard
}

/**
 * Reset the crash guard singleton (for testing).
 */
export function _resetCrashGuardForTest(): void {
  _crashGuard = null
}
