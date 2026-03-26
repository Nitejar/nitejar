'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { IconChevronDown } from '@tabler/icons-react'

import { describeCron } from '@/app/(app)/settings/routines/cron-describe'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

const DEFAULT_HEARTBEAT_TIME = '09:00'
const DEFAULT_HEARTBEAT_CRON = '0 9 * * 1-5'
const DAY_OPTIONS = [
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday' },
  { value: '6', label: 'Saturday' },
  { value: '0', label: 'Sunday' },
] as const

const EVERYDAY_DAY_VALUES = DAY_OPTIONS.map((option) => option.value)
const WEEKDAY_DAY_VALUES = DAY_OPTIONS.slice(0, 5).map((option) => option.value)
const DEFAULT_INTERVAL_MINUTES = '15'
const DEFAULT_INTERVAL_HOURS = '1'

type HeartbeatScheduleMode =
  | 'weekdays'
  | 'daily'
  | 'selected_days'
  | 'interval_minutes'
  | 'interval_hours'
  | 'custom'

export type FriendlyHeartbeatSchedule = {
  mode: HeartbeatScheduleMode
  time: string
  daysOfWeek: string[]
  intervalValue: string
  customCronExpr: string
}

function sortDays(days: string[]): string[] {
  const order: Record<string, number> = Object.fromEntries(
    DAY_OPTIONS.map((option, index) => [option.value, index])
  )
  return [...new Set(days)]
    .filter((value) => value in order)
    .sort((left, right) => (order[left] ?? 0) - (order[right] ?? 0))
}

function parseDayExpression(expression: string): string[] | null {
  const trimmed = expression.trim()
  if (!trimmed) return null
  if (trimmed === '*') return [...EVERYDAY_DAY_VALUES]

  const values = new Set<string>()

  for (const segment of trimmed.split(',')) {
    const part = segment.trim()
    if (!part) continue

    const rangeMatch = part.match(/^([0-6])-([0-6])$/)
    if (rangeMatch) {
      const start = Number.parseInt(rangeMatch[1] ?? '', 10)
      const end = Number.parseInt(rangeMatch[2] ?? '', 10)
      if (end < start) return null
      for (let day = start; day <= end; day += 1) {
        values.add(String(day))
      }
      continue
    }

    if (/^[0-6]$/.test(part)) {
      values.add(part)
      continue
    }

    return null
  }

  return sortDays([...values])
}

function sameDays(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

function formatSelectedDays(days: string[]): string {
  const labels = sortDays(days)
    .map((value) => DAY_OPTIONS.find((option) => option.value === value)?.label.slice(0, 3))
    .filter(Boolean)

  if (labels.length === 0) return 'Pick days'
  if (labels.length <= 3) return labels.join(', ')
  return `${labels.slice(0, 3).join(', ')} +${labels.length - 3}`
}

function normalizeTime(value: string | null | undefined): string {
  const match = value?.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return DEFAULT_HEARTBEAT_TIME

  const hours = Number.parseInt(match[1] ?? '0', 10)
  const minutes = Number.parseInt(match[2] ?? '0', 10)

  if (!Number.isFinite(hours) || hours < 0 || hours > 23) return DEFAULT_HEARTBEAT_TIME
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 59) return DEFAULT_HEARTBEAT_TIME

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function splitTime(value: string): { hour: string; minute: string } {
  const normalized = normalizeTime(value)
  const [hour = '09', minute = '00'] = normalized.split(':')
  return { hour, minute }
}

export function parseFriendlyHeartbeatSchedule(
  cronExpr: string | null | undefined
): FriendlyHeartbeatSchedule {
  const normalized = cronExpr?.trim()
  if (!normalized) {
    return {
      mode: 'weekdays',
      time: DEFAULT_HEARTBEAT_TIME,
      daysOfWeek: [...WEEKDAY_DAY_VALUES],
      intervalValue: DEFAULT_INTERVAL_MINUTES,
      customCronExpr: DEFAULT_HEARTBEAT_CRON,
    }
  }

  const everyMinutes = normalized.match(/^\*\/(\d+) \* \* \* \*$/)
  if (everyMinutes) {
    return {
      mode: 'interval_minutes',
      time: DEFAULT_HEARTBEAT_TIME,
      daysOfWeek: [...EVERYDAY_DAY_VALUES],
      intervalValue: everyMinutes[1] ?? DEFAULT_INTERVAL_MINUTES,
      customCronExpr: normalized,
    }
  }

  if (normalized === '0 * * * *') {
    return {
      mode: 'interval_hours',
      time: DEFAULT_HEARTBEAT_TIME,
      daysOfWeek: [...EVERYDAY_DAY_VALUES],
      intervalValue: DEFAULT_INTERVAL_HOURS,
      customCronExpr: normalized,
    }
  }

  const everyHours = normalized.match(/^0 \*\/(\d+) \* \* \*$/)
  if (everyHours) {
    return {
      mode: 'interval_hours',
      time: DEFAULT_HEARTBEAT_TIME,
      daysOfWeek: [...EVERYDAY_DAY_VALUES],
      intervalValue: everyHours[1] ?? DEFAULT_INTERVAL_HOURS,
      customCronExpr: normalized,
    }
  }

  const weekdays = normalized.match(/^(\d{1,2}) (\d{1,2}) \* \* 1-5$/)
  if (weekdays) {
    return {
      mode: 'weekdays',
      time: normalizeTime(`${weekdays[2]}:${String(weekdays[1]).padStart(2, '0')}`),
      daysOfWeek: [...WEEKDAY_DAY_VALUES],
      intervalValue: DEFAULT_INTERVAL_MINUTES,
      customCronExpr: normalized,
    }
  }

  const daily = normalized.match(/^(\d{1,2}) (\d{1,2}) \* \* \*$/)
  if (daily) {
    return {
      mode: 'daily',
      time: normalizeTime(`${daily[2]}:${String(daily[1]).padStart(2, '0')}`),
      daysOfWeek: [...EVERYDAY_DAY_VALUES],
      intervalValue: DEFAULT_INTERVAL_MINUTES,
      customCronExpr: normalized,
    }
  }

  const selectedDays = normalized.match(/^(\d{1,2}) (\d{1,2}) \* \* ([0-6,-]+)$/)
  if (selectedDays) {
    const parsedDays = parseDayExpression(selectedDays[3] ?? '')
    if (parsedDays) {
      const mode = sameDays(parsedDays, sortDays(WEEKDAY_DAY_VALUES))
        ? 'weekdays'
        : sameDays(parsedDays, sortDays(EVERYDAY_DAY_VALUES))
          ? 'daily'
          : 'selected_days'

      return {
        mode,
        time: normalizeTime(`${selectedDays[2]}:${String(selectedDays[1]).padStart(2, '0')}`),
        daysOfWeek: parsedDays,
        intervalValue: DEFAULT_INTERVAL_MINUTES,
        customCronExpr: normalized,
      }
    }
  }

  return {
    mode: 'custom',
    time: DEFAULT_HEARTBEAT_TIME,
    daysOfWeek: [...WEEKDAY_DAY_VALUES],
    intervalValue: DEFAULT_INTERVAL_MINUTES,
    customCronExpr: normalized,
  }
}

function setScheduleMode(
  current: FriendlyHeartbeatSchedule,
  mode: Exclude<HeartbeatScheduleMode, 'custom'>
): FriendlyHeartbeatSchedule {
  if (mode === 'weekdays') {
    return {
      ...current,
      mode,
      daysOfWeek: [...WEEKDAY_DAY_VALUES],
    }
  }

  if (mode === 'daily') {
    return {
      ...current,
      mode,
      daysOfWeek: [...EVERYDAY_DAY_VALUES],
    }
  }

  if (mode === 'interval_minutes') {
    return {
      ...current,
      mode,
      intervalValue:
        current.intervalValue && Number.parseInt(current.intervalValue, 10) >= 5
          ? current.intervalValue
          : DEFAULT_INTERVAL_MINUTES,
    }
  }

  if (mode === 'interval_hours') {
    return {
      ...current,
      mode,
      intervalValue:
        current.intervalValue && Number.parseInt(current.intervalValue, 10) >= 1
          ? current.intervalValue
          : DEFAULT_INTERVAL_HOURS,
    }
  }

  return {
    ...current,
    mode,
    daysOfWeek:
      current.daysOfWeek.length > 0 &&
      !sameDays(sortDays(current.daysOfWeek), sortDays(EVERYDAY_DAY_VALUES))
        ? sortDays(current.daysOfWeek)
        : ['1'],
  }
}

export function buildHeartbeatCronExpr(schedule: FriendlyHeartbeatSchedule): string {
  const { hour, minute } = splitTime(schedule.time)
  const parsedInterval = Number.parseInt(schedule.intervalValue, 10)

  switch (schedule.mode) {
    case 'weekdays':
      return `${Number.parseInt(minute, 10)} ${Number.parseInt(hour, 10)} * * 1-5`
    case 'daily':
      return `${Number.parseInt(minute, 10)} ${Number.parseInt(hour, 10)} * * *`
    case 'selected_days': {
      const days = sortDays(schedule.daysOfWeek)
      return `${Number.parseInt(minute, 10)} ${Number.parseInt(hour, 10)} * * ${days.length > 0 ? days.join(',') : '1'}`
    }
    case 'interval_minutes': {
      const interval = Number.isFinite(parsedInterval) ? Math.max(5, parsedInterval) : 15
      return `*/${interval} * * * *`
    }
    case 'interval_hours': {
      const interval = Number.isFinite(parsedInterval) ? Math.max(1, parsedInterval) : 1
      return interval === 1 ? '0 * * * *' : `0 */${interval} * * *`
    }
    case 'custom':
      return schedule.customCronExpr.trim()
    default:
      return DEFAULT_HEARTBEAT_CRON
  }
}

export function describeHeartbeatSchedule(cronExpr: string | null | undefined): string {
  return describeCron(cronExpr) ?? cronExpr?.trim() ?? 'No schedule'
}

type HeartbeatScheduleEditorProps = {
  cronExpr: string
  onCronExprChange: (value: string) => void
  className?: string
}

export function HeartbeatScheduleEditor({
  cronExpr,
  onCronExprChange,
  className,
}: HeartbeatScheduleEditorProps) {
  const lastEmittedCronExprRef = useRef(cronExpr)
  const [advancedOpen, setAdvancedOpen] = useState(
    () => parseFriendlyHeartbeatSchedule(cronExpr).mode === 'custom'
  )
  const [draft, setDraft] = useState<FriendlyHeartbeatSchedule>(() =>
    parseFriendlyHeartbeatSchedule(cronExpr)
  )

  useEffect(() => {
    if (cronExpr === lastEmittedCronExprRef.current) return
    const parsed = parseFriendlyHeartbeatSchedule(cronExpr)
    setDraft(parsed)
    if (parsed.mode === 'custom') {
      setAdvancedOpen(true)
    }
  }, [cronExpr])

  const derivedCronExpr = useMemo(() => buildHeartbeatCronExpr(draft), [draft])
  const scheduleSummary = useMemo(
    () => describeHeartbeatSchedule(derivedCronExpr),
    [derivedCronExpr]
  )

  useEffect(() => {
    if (derivedCronExpr !== cronExpr) {
      lastEmittedCronExprRef.current = derivedCronExpr
      onCronExprChange(derivedCronExpr)
    }
  }, [cronExpr, derivedCronExpr, onCronExprChange])

  return (
    <div className={cn('space-y-2.5', className)}>
      <div className="rounded-md border border-white/8 bg-white/[0.03] px-2.5 py-2 text-[0.7rem] text-white/45">
        <p>{scheduleSummary}</p>
        {draft.mode === 'custom' ? (
          <p className="mt-1 text-[0.65rem] text-amber-200/70">Using advanced cron override</p>
        ) : null}
      </div>

      <div className="space-y-1">
        <p className="text-[0.65rem] uppercase tracking-[0.18em] text-white/35">Schedule</p>
        <div className="flex flex-wrap gap-1.5">
          {[
            { value: 'weekdays', label: 'Weekdays' },
            { value: 'daily', label: 'Every day' },
            { value: 'selected_days', label: 'Pick days' },
            { value: 'interval_minutes', label: 'Repeat every' },
          ].map((option) => {
            const active = draft.mode === option.value
            return (
              <Button
                key={option.value}
                type="button"
                variant="outline"
                size="sm"
                className={cn(
                  'h-7 border-white/10 bg-white/5 px-2.5 text-[0.7rem] text-white/60 hover:border-white/20 hover:bg-white/[0.08] hover:text-white/85',
                  active && 'border-white/25 bg-white/[0.11] text-white'
                )}
                onClick={() => {
                  setDraft((current) =>
                    setScheduleMode(
                      {
                        ...current,
                        mode: option.value as Exclude<HeartbeatScheduleMode, 'custom'>,
                      },
                      option.value as Exclude<HeartbeatScheduleMode, 'custom'>
                    )
                  )
                }}
              >
                {option.label}
              </Button>
            )
          })}
        </div>
      </div>

      {draft.mode === 'selected_days' ? (
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[0.65rem] uppercase tracking-[0.18em] text-white/35">Days</p>
            <span className="text-[0.65rem] text-white/35">
              {formatSelectedDays(draft.daysOfWeek)}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {DAY_OPTIONS.map((option) => {
              const active = draft.daysOfWeek.includes(option.value)
              return (
                <Button
                  key={option.value}
                  type="button"
                  variant="outline"
                  size="sm"
                  className={cn(
                    'h-7 min-w-11 border-white/10 bg-white/5 px-2 text-[0.68rem] text-white/55 hover:border-white/20 hover:bg-white/[0.08] hover:text-white/85',
                    active && 'border-white/25 bg-white/[0.11] text-white'
                  )}
                  onClick={() =>
                    setDraft((current) => {
                      const nextDays = current.daysOfWeek.includes(option.value)
                        ? current.daysOfWeek.filter((value) => value !== option.value)
                        : [...current.daysOfWeek, option.value]

                      return {
                        ...current,
                        mode: 'selected_days',
                        daysOfWeek: sortDays(nextDays.length > 0 ? nextDays : ['1']),
                      }
                    })
                  }
                >
                  {option.label.slice(0, 3)}
                </Button>
              )
            })}
          </div>
        </div>
      ) : null}

      {draft.mode === 'interval_minutes' || draft.mode === 'interval_hours' ? (
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[0.65rem] uppercase tracking-[0.18em] text-white/35">Repeat every</p>
            <span className="text-[0.65rem] text-white/35">
              {draft.mode === 'interval_minutes' ? 'Minute cadence' : 'Hour cadence'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={draft.mode === 'interval_minutes' ? 5 : 1}
              step={draft.mode === 'interval_minutes' ? 5 : 1}
              value={draft.intervalValue}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  intervalValue: event.target.value,
                }))
              }
              className="h-8 w-24 border-white/10 bg-white/5 text-xs text-white/80"
            />
            <div className="flex flex-wrap gap-1.5">
              {[
                { value: 'interval_minutes', label: 'Minutes' },
                { value: 'interval_hours', label: 'Hours' },
              ].map((option) => {
                const active = draft.mode === option.value
                return (
                  <Button
                    key={option.value}
                    type="button"
                    variant="outline"
                    size="sm"
                    className={cn(
                      'h-7 border-white/10 bg-white/5 px-2.5 text-[0.7rem] text-white/60 hover:border-white/20 hover:bg-white/[0.08] hover:text-white/85',
                      active && 'border-white/25 bg-white/[0.11] text-white'
                    )}
                    onClick={() =>
                      setDraft((current) =>
                        setScheduleMode(
                          {
                            ...current,
                            mode: option.value as Exclude<HeartbeatScheduleMode, 'custom'>,
                          },
                          option.value as Exclude<HeartbeatScheduleMode, 'custom'>
                        )
                      )
                    }
                  >
                    {option.label}
                  </Button>
                )
              })}
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(draft.mode === 'interval_minutes'
              ? ['5', '10', '15', '30']
              : ['1', '2', '4', '8']
            ).map((value) => (
              <Button
                key={value}
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  'h-6 px-1.5 text-[0.65rem] text-white/40 hover:text-white/80',
                  draft.intervalValue === value && 'text-white'
                )}
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    intervalValue: value,
                  }))
                }
              >
                {draft.mode === 'interval_minutes' ? `${value}m` : `${value}h`}
              </Button>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          <p className="text-[0.65rem] uppercase tracking-[0.18em] text-white/35">Time</p>
          <Input
            type="time"
            step={60}
            value={draft.time}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                time: normalizeTime(event.target.value),
              }))
            }
            className="h-8 border-white/10 bg-white/5 text-xs text-white/80"
          />
        </div>
      )}

      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger className="flex items-center gap-1 text-[0.7rem] text-white/40 transition hover:text-white/70">
          <IconChevronDown
            className={cn('h-3 w-3 transition', advancedOpen ? 'rotate-0' : '-rotate-90')}
          />
          Advanced cron
          {draft.mode === 'custom' ? (
            <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-1.5 py-0.5 text-[0.6rem] text-amber-200/80">
              active
            </span>
          ) : null}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 space-y-1.5 rounded-md border border-white/8 bg-white/[0.02] p-2.5">
            <Input
              value={draft.mode === 'custom' ? draft.customCronExpr : derivedCronExpr}
              onChange={(event) => {
                const value = event.target.value
                const parsed = parseFriendlyHeartbeatSchedule(value)
                setDraft({
                  ...parsed,
                  customCronExpr: value,
                })
              }}
              placeholder={DEFAULT_HEARTBEAT_CRON}
              className="h-8 border-white/10 bg-white/5 font-mono text-xs text-white/80"
            />
            <p className="text-[0.65rem] text-white/35">
              Escape hatch for unusual schedules. If this matches a normal heartbeat cadence, we’ll
              fold it back into the click-based editor automatically.
            </p>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
