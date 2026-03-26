'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ActorKind = 'user' | 'agent'
export type GoalStatus = 'draft' | 'active' | 'at_risk' | 'blocked' | 'done' | 'archived'
export type TicketStatus = 'inbox' | 'ready' | 'in_progress' | 'blocked' | 'done' | 'canceled'
export type SortField = 'updated_at' | 'created_at' | 'title' | 'status'
export type SortDirection = 'asc' | 'desc'
export type ItemType = 'goal' | 'ticket'

export type GoalListInput = {
  scope?: 'mine' | 'my_team' | 'all'
  statuses?: GoalStatus[]
  q?: string
  ownerKind?: ActorKind
  ownerRef?: string
  teamId?: string
  staleOnly?: boolean
  includeArchived?: boolean
  limit?: number
  sort?: { field: SortField; direction: SortDirection }
}

export type TicketListInput = {
  scope?: 'mine' | 'my_team' | 'unclaimed' | 'all'
  statuses?: TicketStatus[]
  q?: string
  goalId?: string | null
  assigneeKind?: ActorKind
  assigneeRef?: string
  staleOnly?: boolean
  includeArchived?: boolean
  limit?: number
  sort?: { field: SortField; direction: SortDirection }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const ALL_GOAL_STATUSES: GoalStatus[] = [
  'draft',
  'active',
  'at_risk',
  'blocked',
  'done',
  'archived',
]
export const ALL_TICKET_STATUSES: TicketStatus[] = [
  'inbox',
  'ready',
  'in_progress',
  'blocked',
  'done',
  'canceled',
]

export const OPEN_GOAL_STATUSES: GoalStatus[] = ['active', 'at_risk', 'blocked']
export const OPEN_TICKET_STATUSES: TicketStatus[] = ['inbox', 'ready', 'in_progress', 'blocked']

export const DEFAULT_SORT = {
  field: 'updated_at' as SortField,
  direction: 'desc' as SortDirection,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function statusColor(status: string): string {
  switch (status) {
    case 'in_progress':
    case 'active':
      return 'bg-blue-500'
    case 'blocked':
    case 'at_risk':
      return 'bg-red-500'
    case 'ready':
      return 'bg-zinc-400'
    case 'done':
      return 'bg-emerald-500'
    case 'inbox':
    case 'draft':
      return 'bg-zinc-600'
    case 'canceled':
    case 'archived':
      return 'bg-zinc-700'
    default:
      return 'bg-zinc-500'
  }
}

/** Border + bg tint for selected filter pills, keyed to status color. */
export function statusSelectedStyle(status: string): string {
  switch (status) {
    case 'in_progress':
    case 'active':
      return 'border-blue-500/40 bg-blue-500/15 text-blue-300'
    case 'blocked':
    case 'at_risk':
      return 'border-red-500/40 bg-red-500/15 text-red-300'
    case 'ready':
      return 'border-zinc-400/40 bg-zinc-400/15 text-zinc-300'
    case 'done':
      return 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
    case 'inbox':
    case 'draft':
      return 'border-zinc-500/40 bg-zinc-500/15 text-zinc-300'
    case 'canceled':
    case 'archived':
      return 'border-zinc-600/40 bg-zinc-600/15 text-zinc-400'
    default:
      return 'border-white/20 bg-white/10 text-white'
  }
}

export function healthColor(health: string): string {
  switch (health) {
    case 'healthy':
      return 'bg-emerald-500'
    case 'at_risk':
      return 'bg-amber-500'
    case 'blocked':
      return 'bg-red-500'
    default:
      return 'bg-zinc-500'
  }
}

export function statusLabel(status: string): string {
  return status.replace(/_/g, ' ')
}

export function isGoalStatus(value: unknown): value is GoalStatus {
  return ALL_GOAL_STATUSES.includes(value as GoalStatus)
}

export function isTicketStatus(value: unknown): value is TicketStatus {
  return ALL_TICKET_STATUSES.includes(value as TicketStatus)
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

export function StatusDot({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={cn('inline-block h-2 w-2 shrink-0 rounded-full', statusColor(status), className)}
    />
  )
}

export function HealthDot({ health, className }: { health: string; className?: string }) {
  return (
    <span
      className={cn('inline-block h-2 w-2 shrink-0 rounded-full', healthColor(health), className)}
    />
  )
}

export function InlineStatusPicker({
  currentStatus,
  statuses,
  onStatusChange,
  showLabel,
}: {
  currentStatus: string
  statuses: readonly string[]
  onStatusChange: (status: string) => void
  showLabel?: boolean
}) {
  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          'group/status inline-flex items-center gap-1.5 rounded p-0.5 transition hover:bg-white/10',
          showLabel && 'pr-1.5'
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <StatusDot status={currentStatus} />
        {showLabel && (
          <span className="text-xs text-zinc-300 capitalize">{statusLabel(currentStatus)}</span>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-36 p-1" align="start" onClick={(e) => e.stopPropagation()}>
        {statuses.map((s) => (
          <button
            key={s}
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onStatusChange(s)
            }}
            className={cn(
              'flex w-full items-center gap-2 rounded px-2 py-1 text-xs transition',
              s === currentStatus
                ? 'bg-white/10 text-white'
                : 'text-zinc-400 hover:bg-white/[0.06] hover:text-white'
            )}
          >
            <StatusDot status={s} className="h-1.5 w-1.5" />
            {statusLabel(s)}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

export function AvatarCircle({ name, className }: { name?: string | null; className?: string }) {
  const letter = name ? (name[0]?.toUpperCase() ?? '?') : '?'
  return (
    <span
      className={cn(
        'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-700 text-[10px] font-medium text-zinc-300',
        className
      )}
      title={name ?? undefined}
    >
      {letter}
    </span>
  )
}

export function ProgressRing({
  percent,
  health,
  size = 18,
  strokeWidth = 2.5,
}: {
  percent: number
  health: string
  size?: number
  strokeWidth?: number
}) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const filled = Math.max(0, Math.min(100, percent))
  const strokeDashoffset = circumference - (filled / 100) * circumference

  const ringColor =
    health === 'blocked'
      ? 'stroke-red-500'
      : health === 'at_risk'
        ? 'stroke-amber-500'
        : health === 'done'
          ? 'stroke-emerald-500'
          : filled > 0
            ? 'stroke-blue-500'
            : 'stroke-zinc-600'

  return (
    <svg
      width={size}
      height={size}
      className={cn(
        'shrink-0 -rotate-90',
        percent >= 100 && 'motion-safe:animate-[scalePulse_0.6s_ease-in-out]'
      )}
    >
      {/* Background track */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        className="text-zinc-800"
      />
      {/* Progress arc */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={strokeDashoffset}
        className={ringColor}
        style={{ transition: 'stroke-dashoffset 600ms ease-out' }}
      />
    </svg>
  )
}

export function formatMetricValue(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return value.toFixed(value % 1 === 0 ? 0 : 1)
}

export function TicketProgress({ done, total }: { done: number; total: number }) {
  if (total === 0) return null
  const pct = Math.round((done / total) * 100)
  const isComplete = done === total && total > 0
  return (
    <span className="inline-flex items-center gap-1.5 text-xs tabular-nums">
      <span
        className={cn(
          'relative h-1 w-10 overflow-hidden rounded-full',
          isComplete ? 'bg-emerald-900/40' : 'bg-zinc-800'
        )}
      >
        <span
          className={cn(
            'absolute inset-y-0 left-0 rounded-full transition-[width] duration-300 ease-out',
            isComplete ? 'bg-emerald-500' : 'bg-zinc-500'
          )}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className={isComplete ? 'text-emerald-400' : 'text-zinc-500'}>
        {done}/{total}
      </span>
    </span>
  )
}

export function InlineCreateRow({
  placeholder,
  indented,
  depth = 0,
  isPending,
  autoFocus,
  onSubmit,
  onCancel,
}: {
  placeholder: string
  indented?: boolean
  depth?: number
  isPending: boolean
  autoFocus?: boolean
  onSubmit: (title: string) => void
  onCancel?: () => void
}) {
  const [editing, setEditing] = useState(!!autoFocus)
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && value.trim()) {
      e.preventDefault()
      onSubmit(value.trim())
      setValue('')
      // Keep editing open for rapid entry
    } else if (e.key === 'Escape') {
      setValue('')
      setEditing(false)
      onCancel?.()
    }
  }

  function handleBlur() {
    if (!value.trim()) {
      setEditing(false)
      onCancel?.()
    }
  }

  // Compute left padding: base indented padding (pl-12 = 48px) + depth * 24px
  const paddingLeft = indented ? 48 + depth * 24 : 12 + depth * 24

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        style={{ paddingLeft }}
        className="flex h-9 w-full items-center gap-2 border-b border-zinc-800/40 pr-3 text-left text-sm text-zinc-500 transition hover:bg-white/[0.03] hover:text-zinc-400"
      >
        <Plus className="h-3 w-3 shrink-0" />
        <span>{placeholder}</span>
      </button>
    )
  }

  return (
    <div
      style={{ paddingLeft }}
      className="flex h-9 w-full items-center gap-2 border-b border-zinc-800/40 pr-3"
    >
      <Plus className="h-3 w-3 shrink-0 text-zinc-600" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        disabled={isPending}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-sm text-zinc-200 placeholder:text-zinc-600 outline-none"
      />
      {isPending && <span className="text-[10px] text-zinc-600">Saving...</span>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// InlinePicker — popover-based picker styled like InlineStatusPicker
// ---------------------------------------------------------------------------

export type InlinePickerItem = {
  value: string
  label: string
  hint?: string | null
  trailing?: ReactNode
}

/**
 * Tab definition for InlinePicker. When `tabs` is provided the dropdown
 * shows tab buttons above the options list and `items` is ignored in
 * favour of the active tab's items.
 */
export type InlinePickerTab = {
  key: string
  label: string
  items: InlinePickerItem[]
}

export function InlinePicker({
  value,
  items,
  tabs,
  placeholder = 'None',
  onValueChange,
  onClear,
  className,
}: {
  /** Currently selected value */
  value: string | null
  /** Flat list of options (ignored when `tabs` is provided) */
  items?: InlinePickerItem[]
  /** Optional tabbed groups of options (e.g. People / Agents) */
  tabs?: InlinePickerTab[]
  placeholder?: string
  onValueChange: (value: string) => void
  /** If provided, shows × to clear; called with no args */
  onClear?: () => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [activeTabKey, setActiveTabKey] = useState(() => tabs?.[0]?.key ?? '')
  const searchRef = useRef<HTMLInputElement>(null)

  // Focus the search input when opening
  useEffect(() => {
    if (open) {
      setSearch('')
      // Small delay so the popover renders first
      const timer = setTimeout(() => searchRef.current?.focus(), 50)
      return () => clearTimeout(timer)
    }
  }, [open])

  const activeItems = tabs ? (tabs.find((t) => t.key === activeTabKey)?.items ?? []) : (items ?? [])

  const filtered = search
    ? activeItems.filter((i) => i.label.toLowerCase().includes(search.toLowerCase()))
    : activeItems

  const selectedLabel = (tabs ? tabs.flatMap((t) => t.items) : (items ?? [])).find(
    (i) => i.value === value
  )?.label

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          'group/picker inline-flex items-center justify-start gap-1 rounded p-0.5 pr-1 text-left text-xs transition hover:bg-white/10',
          className
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <span
          className={cn('min-w-0 text-left', selectedLabel ? 'text-zinc-300' : 'text-zinc-500')}
        >
          {selectedLabel ?? placeholder}
        </span>
        <ChevronDown className="h-3 w-3 text-zinc-600 opacity-0 transition group-hover/picker:opacity-100" />
      </PopoverTrigger>
      <PopoverContent className="w-48 p-1" align="start" onClick={(e) => e.stopPropagation()}>
        {(tabs && tabs.length > 1) || (onClear && value) ? (
          <div className="mb-0.5 flex items-center gap-1 border-b border-zinc-800 px-1 pb-0.5">
            {tabs && tabs.length > 1 ? (
              <div className="flex flex-1 gap-1">
                {tabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveTabKey(tab.key)}
                    className={cn(
                      'rounded px-2 py-0.5 text-[10px] transition',
                      tab.key === activeTabKey
                        ? 'bg-white/10 text-white'
                        : 'text-white/35 hover:text-white/60'
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex-1" />
            )}
            {onClear && value ? (
              <button
                type="button"
                aria-label={`Clear ${placeholder}`}
                className="rounded px-1.5 py-0.5 text-[10px] text-zinc-500 transition hover:bg-white/10 hover:text-zinc-200"
                onClick={(e) => {
                  e.stopPropagation()
                  onClear()
                  setOpen(false)
                }}
              >
                Clear
              </button>
            ) : null}
          </div>
        ) : null}
        {/* Search */}
        <input
          ref={searchRef}
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search..."
          className="mb-0.5 w-full rounded bg-white/[0.04] px-2 py-1 text-xs text-zinc-300 placeholder:text-zinc-600 outline-none"
        />
        {/* Options */}
        <div className="max-h-48 overflow-y-auto">
          {filtered.length > 0 ? (
            filtered.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onValueChange(item.value)
                  setOpen(false)
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded px-2 py-1 text-xs transition',
                  item.value === value
                    ? 'bg-white/10 text-white'
                    : 'text-zinc-400 hover:bg-white/[0.06] hover:text-white'
                )}
              >
                <span className="min-w-0 flex-1 text-left">
                  <span className="block truncate">{item.label}</span>
                  {item.hint ? (
                    <span className="block truncate text-[10px] text-zinc-600">{item.hint}</span>
                  ) : null}
                </span>
                {item.trailing ? <span className="shrink-0">{item.trailing}</span> : null}
              </button>
            ))
          ) : (
            <p className="px-2 py-1 text-[10px] text-zinc-600">No results</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
