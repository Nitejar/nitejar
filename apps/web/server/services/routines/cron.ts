import parser from 'cron-parser'

const MIN_RECURRENCE_SECONDS = 5 * 60

export function getMinimumRoutineRecurrenceSeconds(): number {
  return MIN_RECURRENCE_SECONDS
}

export function assertValidTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
  } catch {
    throw new Error(`Invalid IANA timezone: ${timezone}`)
  }
}

export function computeNextCronRunAt(
  cronExpr: string,
  timezone: string,
  opts?: { fromEpochSeconds?: number }
): number {
  assertValidTimezone(timezone)
  const fromEpochSeconds = opts?.fromEpochSeconds ?? Math.floor(Date.now() / 1000)

  const interval = parser.parseExpression(cronExpr, {
    tz: timezone,
    currentDate: new Date(fromEpochSeconds * 1000),
  })

  const nextDate = interval.next().getTime()
  return Math.floor(nextDate / 1000)
}

function getObservedMinimumIntervalSeconds(
  cronExpr: string,
  timezone: string,
  opts?: { fromEpochSeconds?: number; samples?: number }
): number {
  const fromEpochSeconds = opts?.fromEpochSeconds ?? Math.floor(Date.now() / 1000)
  const sampleCount = Math.max(3, opts?.samples ?? 8)

  const interval = parser.parseExpression(cronExpr, {
    tz: timezone,
    currentDate: new Date(fromEpochSeconds * 1000),
  })

  let previous = interval.next().getTime()
  let minDiffSeconds = Number.POSITIVE_INFINITY

  for (let i = 0; i < sampleCount; i += 1) {
    const current = interval.next().getTime()
    const diff = Math.floor((current - previous) / 1000)
    if (diff < minDiffSeconds) {
      minDiffSeconds = diff
    }
    previous = current
  }

  return minDiffSeconds
}

export function assertMinimumCronInterval(cronExpr: string, timezone: string): void {
  const minObserved = getObservedMinimumIntervalSeconds(cronExpr, timezone)
  if (minObserved < MIN_RECURRENCE_SECONDS) {
    throw new Error('Cron schedule must not run more than once every 5 minutes.')
  }
}

export function validateCronSchedule(cronExpr: string, timezone: string): number {
  const normalized = cronExpr.trim()
  if (!normalized) {
    throw new Error('cronExpr is required.')
  }

  assertMinimumCronInterval(normalized, timezone)
  return computeNextCronRunAt(normalized, timezone)
}
