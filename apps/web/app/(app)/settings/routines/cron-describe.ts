const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/**
 * Convert common cron expressions to human-readable English.
 * Covers the patterns used most in routines; falls back to raw expression.
 */
export function describeCron(expr: string | null | undefined): string | null {
  if (!expr) return null
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return expr

  const minute = parts[0] ?? ''
  const hour = parts[1] ?? ''
  const dom = parts[2] ?? ''
  const month = parts[3] ?? ''
  const dow = parts[4] ?? ''

  // */N * * * * → "Every N minutes"
  if (hour === '*' && dom === '*' && month === '*' && dow === '*') {
    const match = minute.match(/^\*\/(\d+)$/)
    if (match) {
      const n = parseInt(match[1] ?? '0', 10)
      if (n === 1) return 'Every minute'
      return `Every ${n} minutes`
    }
    // Single minute: M * * * * → "Hourly at :MM"
    if (/^\d+$/.test(minute)) {
      return `Hourly at :${minute.padStart(2, '0')}`
    }
  }

  // M H * * * → "Daily at HH:MM"
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && dom === '*' && month === '*' && dow === '*') {
    return `Daily at ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
  }

  // M H * * D → "Mon at HH:MM" (single day-of-week)
  if (
    /^\d+$/.test(minute) &&
    /^\d+$/.test(hour) &&
    dom === '*' &&
    month === '*' &&
    /^\d$/.test(dow)
  ) {
    const day = DAYS[parseInt(dow, 10)]
    if (day) {
      return `${day} at ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
    }
  }

  return expr
}
