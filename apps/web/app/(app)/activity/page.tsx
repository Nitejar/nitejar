import Link from 'next/link'
import { listRecentActivity, type RecentActivityEntry } from '@nitejar/database'
import { parseAgentConfig } from '@nitejar/agent/config'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '../components/PageHeader'
import { formatCost } from '@/lib/utils'
import {
  formatArbiterDecisionLabel,
  getArbiterDecisionTone,
  parseArbiterControlReason,
} from '@/lib/arbiter-receipts'

export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusColor(status: string): string {
  switch (status) {
    case 'COMPLETED':
      return 'bg-emerald-400'
    case 'FAILED':
      return 'bg-red-400'
    case 'RUNNING':
      return 'bg-blue-400 animate-pulse'
    case 'PENDING':
      return 'bg-amber-400/70'
    default:
      return 'bg-white/20'
  }
}

function statusText(status: string): { label: string; className: string } {
  switch (status) {
    case 'COMPLETED':
      return { label: 'done', className: 'text-emerald-400' }
    case 'FAILED':
      return { label: 'failed', className: 'text-red-400' }
    case 'RUNNING':
      return { label: 'running', className: 'text-blue-400' }
    case 'PENDING':
      return { label: 'pending', className: 'text-amber-400' }
    case 'CANCELLED':
      return { label: 'cancelled', className: 'text-white/30' }
    default:
      return { label: status.toLowerCase(), className: 'text-muted-foreground' }
  }
}

const sourceIcons: Record<string, string> = {
  telegram: '\u2708',
  github: '\u2318',
  slack: '#',
  manual: '\u25B8',
  discord: '\u266B',
  agent_dm: '\u2709',
  app_chat: '\u263A',
  scheduler: '\u23F1',
  routine: '\u27F3',
  'builder-test': '\u2697',
}

const MAX_VISIBLE_AVATARS = 5

/** Try to build a GitHub URL from a source_ref like "owner/repo#issue:123" or "owner/repo#pr:42#check:99". */
function githubUrlFromSourceRef(sourceRef: string): string | null {
  const issueMatch = sourceRef.match(/^([^#]+)#issue:(\d+)/)
  if (issueMatch) return `https://github.com/${issueMatch[1]}/issues/${issueMatch[2]}`
  const prMatch = sourceRef.match(/^([^#]+)#pr:(\d+)/)
  if (prMatch) return `https://github.com/${prMatch[1]}/pull/${prMatch[2]}`
  return null
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

function formatDuration(startedAt: number | null, completedAt: number | null): string | null {
  if (!startedAt || !completedAt) return null
  const ms = (completedAt - startedAt) * 1000
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp * 1000
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) return `${hours}h ago`
  if (minutes > 0) return `${minutes}m ago`
  if (seconds > 10) return `${seconds}s ago`
  return 'now'
}

function getDayLabel(timestamp: number): string {
  const date = new Date(timestamp * 1000)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)

  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'

  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

// ---------------------------------------------------------------------------
// Grouped event types
// ---------------------------------------------------------------------------

interface AgentRun {
  jobId: string
  agentId: string
  agentName: string
  agentHandle: string
  emoji: string | null
  avatarUrl: string | null
  status: string
  createdAt: number
  startedAt: number | null
  completedAt: number | null
  triageSummary: string | null
  triageResources: string[] | null
  dispatchStatus: string | null
  dispatchControlState: string | null
  dispatchControlReason: string | null
  promptTokens: number
  completionTokens: number
  totalCost: number
  callCount: number
}

interface WorkItemEvent {
  workItemId: string
  title: string
  source: string
  sourceRef: string
  sessionKey: string
  pluginInstanceId: string | null
  eventTime: number // work item created_at
  queuePendingCount: number
  queueIncludedCount: number
  queueDroppedCount: number
  queueCancelledCount: number
  runs: AgentRun[]
  children: WorkItemEvent[] // agent-relay work items spawned from this one
}

function groupByWorkItem(entries: RecentActivityEntry[]): WorkItemEvent[] {
  const map = new Map<string, WorkItemEvent>()
  for (const entry of entries) {
    const config = parseAgentConfig(entry.agent_config)
    let resources: string[] | null = null
    if (entry.triage_resources) {
      try {
        const parsed = JSON.parse(entry.triage_resources) as string[]
        if (Array.isArray(parsed) && parsed.length > 0) resources = parsed
      } catch {
        /* ignore */
      }
    }

    const run: AgentRun = {
      jobId: entry.job_id,
      agentId: entry.agent_id,
      agentName: entry.agent_name,
      agentHandle: entry.agent_handle,
      emoji: config.emoji ?? null,
      avatarUrl: config.avatarUrl ?? null,
      status: entry.status,
      createdAt: entry.created_at,
      startedAt: entry.started_at,
      completedAt: entry.completed_at,
      triageSummary: entry.triage_summary,
      triageResources: resources,
      dispatchStatus: entry.dispatch_status,
      dispatchControlState: entry.dispatch_control_state,
      dispatchControlReason: entry.dispatch_control_reason,
      promptTokens: entry.prompt_tokens,
      completionTokens: entry.completion_tokens,
      totalCost: entry.total_cost,
      callCount: entry.call_count,
    }

    const existing = map.get(entry.work_item_id)
    if (existing) {
      existing.queuePendingCount = Math.max(existing.queuePendingCount, entry.queue_pending_count)
      existing.queueIncludedCount = Math.max(
        existing.queueIncludedCount,
        entry.queue_included_count
      )
      existing.queueDroppedCount = Math.max(existing.queueDroppedCount, entry.queue_dropped_count)
      existing.queueCancelledCount = Math.max(
        existing.queueCancelledCount,
        entry.queue_cancelled_count
      )
      existing.runs.push(run)
    } else {
      map.set(entry.work_item_id, {
        workItemId: entry.work_item_id,
        title: entry.title,
        source: entry.source,
        sourceRef: entry.source_ref,
        sessionKey: entry.session_key,
        pluginInstanceId: entry.plugin_instance_id,
        eventTime: entry.work_item_created_at,
        queuePendingCount: entry.queue_pending_count,
        queueIncludedCount: entry.queue_included_count,
        queueDroppedCount: entry.queue_dropped_count,
        queueCancelledCount: entry.queue_cancelled_count,
        runs: [run],
        children: [],
      })
    }
  }
  return [...map.values()]
}

/**
 * Nest agent-relay work items under the human-initiated work item that
 * spawned them. Agent-relay items are identified by source_ref starting
 * with "agent_relay:".
 *
 * Assignment: each relay attaches to the most recent non-relay work item
 * in the same session that was created before (or at the same time as)
 * the relay. This handles sessions with multiple human messages correctly.
 */
function nestAgentRelayEvents(events: WorkItemEvent[]): WorkItemEvent[] {
  const topLevel: WorkItemEvent[] = []
  const relayEvents: WorkItemEvent[] = []

  for (const event of events) {
    if (event.sourceRef.startsWith('agent_relay:')) {
      relayEvents.push(event)
    } else {
      topLevel.push(event)
    }
  }

  // Build per-session list of roots sorted by time (oldest first)
  const rootsBySession = new Map<string, WorkItemEvent[]>()
  for (const root of topLevel) {
    let list = rootsBySession.get(root.sessionKey)
    if (!list) {
      list = []
      rootsBySession.set(root.sessionKey, list)
    }
    list.push(root)
  }
  for (const list of rootsBySession.values()) {
    list.sort((a, b) => a.eventTime - b.eventTime)
  }

  // Assign each relay to the most recent root that precedes it
  for (const relay of relayEvents) {
    const roots = rootsBySession.get(relay.sessionKey)
    if (!roots || roots.length === 0) {
      topLevel.push(relay)
      continue
    }

    // Find the latest root created at or before this relay
    let parent: WorkItemEvent | null = null
    for (let i = roots.length - 1; i >= 0; i--) {
      const root = roots[i]
      if (!root) continue
      if (root.eventTime <= relay.eventTime) {
        parent = root
        break
      }
    }

    if (parent) {
      parent.children.push(relay)
    } else {
      // Relay is older than all roots — attach to earliest root
      const earliestRoot = roots[0]
      if (earliestRoot) {
        earliestRoot.children.push(relay)
      } else {
        topLevel.push(relay)
      }
    }
  }

  // Sort children by time (oldest first = conversation order)
  for (const event of topLevel) {
    if (event.children.length > 0) {
      event.children.sort((a, b) => a.eventTime - b.eventTime)
    }
  }

  return topLevel
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function AgentAvatar({
  emoji,
  avatarUrl,
  name,
  size = 'sm',
}: {
  emoji: string | null
  avatarUrl: string | null
  name: string
  size?: 'sm' | 'md'
}) {
  const initials = name
    .split(/[-_\s]/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  const sizeClass = size === 'md' ? 'h-7 w-7 text-sm' : 'h-5 w-5 text-[0.5rem]'

  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] font-medium text-white/60 ${sizeClass}`}
      title={name}
    >
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt={name} className="h-full w-full rounded-full object-cover" />
      ) : emoji ? (
        <span className={size === 'md' ? 'text-sm' : 'text-[0.6rem]'}>{emoji}</span>
      ) : (
        initials
      )}
    </div>
  )
}

function EventCard({ event }: { event: WorkItemEvent }) {
  // Collect all runs including children for status/cost rollup
  const allRuns =
    event.children.length > 0
      ? [...event.runs, ...event.children.flatMap((c) => c.runs)]
      : event.runs
  const overallStatus = deriveOverallStatus(allRuns)
  const { label: overallLabel, className: overallClass } = statusText(overallStatus)
  const totalCost = allRuns.reduce((s, r) => s + r.totalCost, 0)
  const sourceKey = event.source.toLowerCase()
  const sourceIcon = sourceIcons[sourceKey] ?? '\u00B7'
  const githubUrl = sourceKey === 'github' ? githubUrlFromSourceRef(event.sourceRef) : null
  const visibleRuns = event.runs.slice(0, MAX_VISIBLE_AVATARS)
  const overflowCount = event.runs.length - MAX_VISIBLE_AVATARS
  const queueTotal =
    event.queuePendingCount +
    event.queueIncludedCount +
    event.queueDroppedCount +
    event.queueCancelledCount

  const integrationHref = event.pluginInstanceId
    ? `/plugins/instances/${event.pluginInstanceId}`
    : null

  return (
    <div className="overflow-hidden rounded-lg border border-white/[0.06] bg-white/[0.015]">
      {/* Event header */}
      <div className="group relative flex items-center gap-2.5 px-3 py-2.5 transition-colors hover:bg-white/[0.03]">
        {/* Full-row link to work item (positioned behind everything) */}
        <Link
          href={`/work-items/${event.workItemId}`}
          className="absolute inset-0"
          aria-label={event.title}
        />

        {/* Col 1: status dot — centered in a fixed-width slot to align with run row dots */}
        <div className="relative flex w-5 shrink-0 items-center justify-center">
          <span
            className={`h-2 w-2 rounded-full ${statusColor(overallStatus)}`}
            title={overallStatus}
          />
        </div>

        {/* Col 2: source + github — fixed width to match run row identity column */}
        <div className="relative z-10 flex w-[6.5rem] shrink-0 items-center gap-1.5 overflow-hidden">
          {integrationHref ? (
            <a
              href={integrationHref}
              className="flex min-w-0 items-center gap-1 rounded bg-white/[0.07] px-1.5 py-0.5 text-[0.6rem] text-white/40 transition-colors hover:bg-white/[0.12] hover:text-white/60"
            >
              <span className="shrink-0">{sourceIcon}</span>
              <span className="truncate">{event.source}</span>
            </a>
          ) : (
            <span className="flex min-w-0 items-center gap-1 rounded bg-white/[0.07] px-1.5 py-0.5 text-[0.6rem] text-white/40">
              <span className="shrink-0">{sourceIcon}</span>
              <span className="truncate">{event.source}</span>
            </span>
          )}
          {githubUrl && (
            <a
              href={githubUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex shrink-0 items-center rounded bg-white/[0.05] px-1 py-0.5 text-[0.55rem] text-white/30 transition-colors hover:bg-white/[0.1] hover:text-white/60"
              title="Open on GitHub"
            >
              ↗
            </a>
          )}
        </div>

        {/* Col 3: title (flex) — aligns with triage in run rows */}
        <span className="relative min-w-0 flex-1 truncate text-[0.8rem] font-medium text-foreground/85 group-hover:text-foreground">
          {event.title}
        </span>

        {/* Right side: avatars, run count, cost, status, time */}
        <div className="relative flex shrink-0 -space-x-1.5">
          {visibleRuns.map((run) => (
            <AgentAvatar
              key={run.jobId}
              emoji={run.emoji}
              avatarUrl={run.avatarUrl}
              name={run.agentName}
            />
          ))}
          {overflowCount > 0 && (
            <div
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.08] text-[0.45rem] font-semibold text-white/50"
              title={`${overflowCount} more agent${overflowCount > 1 ? 's' : ''}`}
            >
              +{overflowCount}
            </div>
          )}
        </div>

        {allRuns.length > 1 && (
          <span className="relative shrink-0 text-[0.55rem] tabular-nums text-white/30">
            {allRuns.length} runs
          </span>
        )}

        {queueTotal > 0 && (
          <span className="relative hidden shrink-0 rounded bg-white/[0.05] px-1.5 py-0.5 text-[0.55rem] text-white/45 md:inline-flex">
            q:{event.queueIncludedCount} in · {event.queueDroppedCount} drop ·{' '}
            {event.queuePendingCount} pending
            {event.queueCancelledCount > 0 ? ` · ${event.queueCancelledCount} cancel` : ''}
          </span>
        )}

        {totalCost > 0 && (
          <span className="relative hidden shrink-0 font-mono text-[0.6rem] tabular-nums text-white/40 md:block">
            {formatCost(totalCost)}
          </span>
        )}

        <span className="relative w-12 shrink-0 text-right text-[0.6rem] tabular-nums text-white/30">
          {formatRelativeTime(event.eventTime)}
        </span>

        <span
          className={`relative hidden w-16 shrink-0 text-right text-[0.6rem] font-medium uppercase tracking-wide sm:block ${overallClass}`}
        >
          {overallLabel}
        </span>
      </div>

      {/* Agent run rows */}
      {event.runs.map((run) => (
        <RunRow key={run.jobId} run={run} workItemId={event.workItemId} />
      ))}

      {/* Nested agent-relay children — always visible, compact */}
      {event.children.map((child) => (
        <ChildEventRow key={child.workItemId} event={child} />
      ))}
    </div>
  )
}

/** Compact row for a nested agent-relay work item — always visible, aligned with RunRow grid */
function ChildEventRow({ event }: { event: WorkItemEvent }) {
  const overallStatus = deriveOverallStatus(event.runs)
  const { label: statusLabel, className: statusClass } = statusText(overallStatus)
  const totalCost = event.runs.reduce((s, r) => s + r.totalCost, 0)
  const visibleRuns = event.runs.slice(0, 3)
  const overflowCount = event.runs.length - 3

  return (
    <div className="group relative flex items-center gap-2.5 border-t border-white/[0.04] px-3 py-1 transition-colors hover:bg-white/[0.03]">
      <Link
        href={`/work-items/${event.workItemId}`}
        className="absolute inset-0"
        aria-label={event.title}
      />

      {/* Col 1: tree connector — same w-5 slot as status dot */}
      <div className="relative flex w-5 shrink-0 items-center justify-center">
        <span className="text-[0.55rem] text-white/30">↳</span>
      </div>

      {/* Col 2: status dot + agent avatars — same w-[6.5rem] as agent identity */}
      <div className="relative flex w-[6.5rem] shrink-0 items-center gap-1.5 overflow-hidden">
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusColor(overallStatus)}`}
          title={overallStatus}
        />
        <div className="flex shrink-0 -space-x-1.5">
          {visibleRuns.map((run) => (
            <AgentAvatar
              key={run.jobId}
              emoji={run.emoji}
              avatarUrl={run.avatarUrl}
              name={run.agentName}
            />
          ))}
          {overflowCount > 0 && (
            <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.08] text-[0.45rem] font-semibold text-white/50">
              +{overflowCount}
            </div>
          )}
        </div>
      </div>

      {/* Col 3: triage summary — same flex-1 slot as event title / triage */}
      <span className="relative min-w-0 flex-1 truncate text-[0.6rem] text-white/50">
        {event.runs[0]?.triageSummary || event.title}
      </span>

      {/* Right side: metrics — matches RunRow layout */}
      <div className="relative hidden shrink-0 items-center gap-3 font-mono text-[0.55rem] text-white/30 md:flex">
        {(() => {
          const tokens = event.runs.reduce(
            (acc, r) => ({
              prompt: acc.prompt + r.promptTokens,
              completion: acc.completion + r.completionTokens,
              calls: acc.calls + r.callCount,
            }),
            { prompt: 0, completion: 0, calls: 0 }
          )
          return tokens.calls > 0 ? (
            <span className="tabular-nums">
              {formatTokens(tokens.prompt)}/{formatTokens(tokens.completion)}
            </span>
          ) : null
        })()}
        {totalCost > 0 && (
          <span className="w-12 text-right tabular-nums text-white/40">
            {formatCost(totalCost)}
          </span>
        )}
        {(() => {
          const firstRun = event.runs[0]
          if (!firstRun) return null
          const duration = formatDuration(firstRun.startedAt, firstRun.completedAt)
          return duration ? <span className="w-10 text-right tabular-nums">{duration}</span> : null
        })()}
      </div>

      <span
        className={`relative hidden w-16 shrink-0 text-right text-[0.6rem] font-medium uppercase tracking-wide sm:block ${statusClass}`}
      >
        {statusLabel}
      </span>
    </div>
  )
}

function RunRow({ run, workItemId }: { run: AgentRun; workItemId: string }) {
  const duration = formatDuration(run.startedAt, run.completedAt)
  const { label: statusLabel, className: statusClass } = statusText(run.status)
  const arbiterReceipt = parseArbiterControlReason(run.dispatchControlReason)
  const arbiterTone = arbiterReceipt ? getArbiterDecisionTone(arbiterReceipt.decision) : null
  const arbiterClass =
    arbiterTone === 'critical'
      ? 'bg-orange-500/15 text-orange-300/80'
      : arbiterTone === 'defer'
        ? 'bg-sky-500/15 text-sky-300/80'
        : arbiterTone === 'ignore'
          ? 'bg-zinc-500/15 text-zinc-300/80'
          : 'bg-violet-500/15 text-violet-300/80'

  return (
    <div className="group flex items-center gap-2.5 border-t border-white/[0.04] px-3 py-1.5 transition-colors hover:bg-white/[0.02]">
      {/* Col 1: status dot — same fixed-width slot as event header */}
      <div className="flex w-5 shrink-0 items-center justify-center">
        <span
          className={`h-1.5 w-1.5 rounded-full ${statusColor(run.status)}`}
          title={run.status}
        />
      </div>

      {/* Col 2: agent identity — fixed width matching event header source column */}
      <Link
        href={`/agents/${run.agentId}`}
        className="flex w-[6.5rem] shrink-0 items-center gap-1.5 overflow-hidden transition-colors hover:text-white/80"
      >
        <AgentAvatar emoji={run.emoji} avatarUrl={run.avatarUrl} name={run.agentName} />
        <span className="min-w-0 flex-1 truncate text-[0.7rem] font-medium text-white/60 group-hover:text-white/70">
          {run.agentName}
        </span>
      </Link>

      {/* Col 3: triage summary (flex) — aligns with event title */}
      <Link href={`/work-items/${workItemId}`} className="min-w-0 flex-1 py-0.5">
        <div className="min-w-0">
          {run.triageSummary ? (
            <span className="block truncate text-[0.6rem] text-white/40">{run.triageSummary}</span>
          ) : (
            <span className="text-[0.6rem] text-white/20">&mdash;</span>
          )}

          <div className="mt-0.5 flex min-w-0 items-center gap-1 overflow-hidden">
            {run.triageResources?.map((r) => (
              <span
                key={r}
                className="inline-block rounded bg-white/[0.07] px-1 py-px text-[0.55rem] text-white/30"
              >
                {r}
              </span>
            ))}
            {arbiterReceipt && (
              <span className={`inline-block rounded px-1 py-px text-[0.55rem] ${arbiterClass}`}>
                {formatArbiterDecisionLabel(arbiterReceipt.decision)}
              </span>
            )}
            {arbiterReceipt?.reason && (
              <span className="truncate text-[0.55rem] text-white/35">{arbiterReceipt.reason}</span>
            )}
            {run.dispatchStatus && (
              <span className="inline-block rounded bg-white/[0.05] px-1 py-px text-[0.55rem] text-white/35">
                dispatch:{run.dispatchStatus.toLowerCase()}
              </span>
            )}
          </div>
        </div>
      </Link>

      {/* Metrics */}
      <div className="hidden shrink-0 items-center gap-3 font-mono text-[0.55rem] text-white/30 md:flex">
        {run.callCount > 0 && (
          <span className="tabular-nums">
            {formatTokens(run.promptTokens)}/{formatTokens(run.completionTokens)}
          </span>
        )}
        {run.totalCost > 0 && (
          <span className="w-12 text-right tabular-nums text-white/40">
            {formatCost(run.totalCost)}
          </span>
        )}
        {duration && <span className="w-10 text-right tabular-nums">{duration}</span>}
      </div>

      {/* Time + Status — swapped so time is last (matches event header) */}
      <span
        className={`hidden w-16 shrink-0 text-right text-[0.6rem] font-medium uppercase tracking-wide sm:block ${statusClass}`}
      >
        {statusLabel}
      </span>
    </div>
  )
}

function deriveOverallStatus(runs: AgentRun[]): string {
  if (runs.some((r) => r.status === 'RUNNING')) return 'RUNNING'
  if (runs.some((r) => r.status === 'PENDING')) return 'PENDING'
  if (runs.every((r) => r.status === 'COMPLETED')) return 'COMPLETED'
  if (runs.some((r) => r.status === 'FAILED')) return 'FAILED'
  return runs[0]?.status ?? 'COMPLETED'
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function ActivityPage() {
  const activity = await listRecentActivity(80)
  const events = nestAgentRelayEvents(groupByWorkItem(activity))

  // Group events by day (use the work item event time)
  const grouped = new Map<string, WorkItemEvent[]>()
  for (const event of events) {
    const label = getDayLabel(event.eventTime)
    const existing = grouped.get(label) ?? []
    existing.push(event)
    grouped.set(label, existing)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        category="Home"
        title="Activity"
        description="Recent events and agent responses across all plugin instances."
      />

      {activity.length === 0 ? (
        <Card className="border-dashed border-border/60 bg-card/60">
          <CardHeader>
            <CardTitle>No activity yet</CardTitle>
            <CardDescription>
              Once agents start processing work items, their actions will appear here.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="space-y-4">
          {[...grouped.entries()].map(([day, dayEvents]) => (
            <div key={day}>
              {/* Day header */}
              <div className="mb-1.5 flex items-center gap-3">
                <span className="text-[0.65rem] font-medium uppercase tracking-widest text-muted-foreground">
                  {day}
                </span>
                <div className="h-px flex-1 bg-white/[0.06]" />
                <span className="text-[0.6rem] tabular-nums text-white/30">
                  {dayEvents.length} event{dayEvents.length !== 1 ? 's' : ''}
                </span>
              </div>

              {/* Event cards */}
              <div className="space-y-2">
                {dayEvents.map((event) => (
                  <EventCard key={event.workItemId} event={event} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
