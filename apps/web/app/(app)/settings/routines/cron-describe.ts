const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

function formatTime(hour: string, minute: string): string {
  return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
}

function describeDayList(dow: string): string | null {
  if (dow === '1-5') return 'Weekdays'
  if (dow === '0,6' || dow === '6,0') return 'Weekends'

  const days = dow
    .split(',')
    .map((part) => part.trim())
    .filter((part) => /^\d$/.test(part))
    .map((part) => DAYS[Number.parseInt(part, 10)])
    .filter(Boolean)

  if (days.length === 0) return null
  if (days.length === 1) return days[0] ?? null
  return days.join(', ')
}

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

  // 0 */N * * * → "Every N hours"
  if (
    minute === '0' &&
    dom === '*' &&
    month === '*' &&
    dow === '*' &&
    (hour === '*' || /^\*\/\d+$/.test(hour))
  ) {
    if (hour === '*') return 'Every hour'
    const match = hour.match(/^\*\/(\d+)$/)
    if (match) {
      const n = parseInt(match[1] ?? '0', 10)
      if (n === 1) return 'Every hour'
      return `Every ${n} hours`
    }
  }

  // M H * * 1-5 or comma-delimited days → "Weekdays at HH:MM" / "Mon, Wed at HH:MM"
  if (
    /^\d+$/.test(minute) &&
    /^\d+$/.test(hour) &&
    dom === '*' &&
    month === '*' &&
    /^(?:\d(?:,\d)*|1-5|0,6|6,0)$/.test(dow)
  ) {
    const dayLabel = describeDayList(dow)
    if (dayLabel) {
      return `${dayLabel} at ${formatTime(hour, minute)}`
    }
  }

  // M H * * * → "Daily at HH:MM"
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && dom === '*' && month === '*' && dow === '*') {
    return `Daily at ${formatTime(hour, minute)}`
  }

  return expr
}
