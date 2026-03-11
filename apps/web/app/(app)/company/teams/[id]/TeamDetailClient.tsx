'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ChevronRight,
  Users,
  Target,
  Bot,
  UserCircle,
  Ticket,
  Activity,
  DollarSign,
  BarChart3,
  Pencil,
} from 'lucide-react'
import { trpc, type RouterOutputs } from '@/lib/trpc'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { RelativeTime } from '../../../components/RelativeTime'
import { SkeletonTeamDetail } from '@/app/(app)/work/skeletons'
import { toast } from 'sonner'
import {
  type GoalStatus,
  type TicketStatus,
  ALL_GOAL_STATUSES,
  ALL_TICKET_STATUSES,
  InlineStatusPicker,
  statusLabel,
} from '../../../work/shared'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TeamDetail = RouterOutputs['company']['getTeamDetail']

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const goalHealthDotColor: Record<string, string> = {
  blocked: 'bg-rose-400',
  at_risk: 'bg-amber-400',
  active: 'bg-emerald-400',
  draft: 'bg-zinc-500',
  done: 'bg-sky-400',
}

const ticketStatusDotColor: Record<string, string> = {
  inbox: 'bg-zinc-400',
  ready: 'bg-sky-400',
  in_progress: 'bg-emerald-400',
  blocked: 'bg-rose-400',
  done: 'bg-zinc-500',
  canceled: 'bg-zinc-600',
}

const heartbeatBadgeStyles: Record<string, string> = {
  fresh: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300',
  quiet: 'border-amber-400/30 bg-amber-500/10 text-amber-300',
  missing: 'border-rose-400/30 bg-rose-500/10 text-rose-300',
}

const kindBadgeStyles: Record<string, string> = {
  heartbeat: 'border-sky-400/30 bg-sky-500/10 text-sky-300',
  status: 'border-amber-400/30 bg-amber-500/10 text-amber-300',
  note: 'border-white/10 bg-white/5 text-white/60',
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

// ---------------------------------------------------------------------------
// Small reusable sub-components
// ---------------------------------------------------------------------------

function HealthDot({ health, size = 'sm' }: { health: string; size?: 'sm' | 'md' }) {
  const s = size === 'md' ? 'h-2.5 w-2.5' : 'h-2 w-2'
  const color = goalHealthDotColor[health] ?? 'bg-zinc-500'
  return <span className={cn('inline-block shrink-0 rounded-full', s, color)} />
}

function StatusDot({ status }: { status: string }) {
  const color = ticketStatusDotColor[status] ?? 'bg-zinc-500'
  return <span className={cn('inline-block h-2 w-2 shrink-0 rounded-full', color)} />
}

function HeartbeatBadge({ posture }: { posture: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[0.6rem] font-medium uppercase tracking-wide',
        heartbeatBadgeStyles[posture] ?? heartbeatBadgeStyles.missing
      )}
    >
      {posture}
    </span>
  )
}

function KindBadge({ kind }: { kind: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-1.5 py-0.5 text-[0.55rem] font-medium uppercase tracking-wide',
        kindBadgeStyles[kind] ?? kindBadgeStyles.note
      )}
    >
      {kind}
    </span>
  )
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 rounded-full bg-zinc-800">
        <div className="h-1.5 rounded-full bg-emerald-500/60" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[0.6rem] tabular-nums text-white/40">
        {done}/{total}
      </span>
    </div>
  )
}

function StatRow({
  label,
  value,
  tone,
}: {
  label: string
  value: number | string
  tone?: 'danger' | 'warning' | 'neutral'
}) {
  const textColor =
    tone === 'danger' ? 'text-rose-300' : tone === 'warning' ? 'text-amber-300' : 'text-white/80'
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs text-white/40">{label}</span>
      <span className={cn('text-xs font-medium tabular-nums', textColor)}>{value}</span>
    </div>
  )
}

function PersonAvatar({
  name,
  emoji,
  avatarUrl,
  isAgent,
}: {
  name: string
  emoji?: string | null
  avatarUrl?: string | null
  isAgent: boolean
}) {
  if (avatarUrl) {
    return <img src={avatarUrl} alt={name} className="h-7 w-7 rounded-full object-cover" />
  }
  if (emoji) {
    return (
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-800 text-sm">
        {emoji}
      </span>
    )
  }
  return (
    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-800">
      {isAgent ? (
        <Bot className="h-3.5 w-3.5 text-white/40" />
      ) : (
        <UserCircle className="h-3.5 w-3.5 text-white/40" />
      )}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Ticket grouping
// ---------------------------------------------------------------------------

const STATUS_ORDER = ['blocked', 'in_progress', 'ready', 'inbox'] as const

function groupTicketsByStatus(tickets: TeamDetail['tickets']) {
  const groups = new Map<string, typeof tickets>()
  for (const ticket of tickets) {
    const existing = groups.get(ticket.status) ?? []
    existing.push(ticket)
    groups.set(ticket.status, existing)
  }
  // Return in priority order
  const ordered: Array<{ status: string; tickets: typeof tickets }> = []
  for (const status of STATUS_ORDER) {
    const group = groups.get(status)
    if (group && group.length > 0) {
      ordered.push({ status, tickets: group })
    }
  }
  return ordered
}

// ---------------------------------------------------------------------------
// Inline editable team name
// ---------------------------------------------------------------------------

function EditableTeamName({ teamId, name }: { teamId: string; name: string }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(name)
  const ref = useRef<HTMLInputElement>(null)
  const utils = trpc.useUtils()

  const updateTeam = trpc.company.updateTeam.useMutation({
    onSuccess: () => {
      void utils.company.getTeamDetail.invalidate({ teamId })
      void utils.company.getOverview.invalidate()
      setEditing(false)
    },
    onError: () => {
      toast.error('Failed to rename team')
    },
  })

  useEffect(() => {
    if (editing) {
      ref.current?.focus()
      ref.current?.select()
    }
  }, [editing])

  useEffect(() => {
    setValue(name)
  }, [name])

  const commit = () => {
    const trimmed = value.trim()
    if (trimmed && trimmed !== name) {
      updateTeam.mutate({ id: teamId, name: trimmed })
    } else {
      setValue(name)
      setEditing(false)
    }
  }

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="group inline-flex items-center gap-2 text-left"
      >
        <h1 className="text-xl font-semibold tracking-tight text-white">{name}</h1>
        <Pencil className="h-3.5 w-3.5 text-white/15 opacity-0 transition-opacity group-hover:opacity-100" />
      </button>
    )
  }

  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') {
          setValue(name)
          setEditing(false)
        }
      }}
      onBlur={commit}
      className="h-8 border-0 bg-transparent p-0 text-xl font-semibold tracking-tight text-white outline-none"
    />
  )
}

// ---------------------------------------------------------------------------
// Inline editable charter
// ---------------------------------------------------------------------------

function EditableCharter({ teamId, charter }: { teamId: string; charter: string | null }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(charter ?? '')
  const ref = useRef<HTMLTextAreaElement>(null)
  const utils = trpc.useUtils()

  const updateTeam = trpc.company.updateTeam.useMutation({
    onSuccess: () => {
      void utils.company.getTeamDetail.invalidate({ teamId })
      void utils.company.getOverview.invalidate()
      setEditing(false)
    },
    onError: () => {
      toast.error('Failed to update team charter')
    },
  })

  useEffect(() => {
    if (editing) {
      ref.current?.focus()
      ref.current?.select()
    }
  }, [editing])

  useEffect(() => {
    setValue(charter ?? '')
  }, [charter, teamId])

  const commit = () => {
    const trimmed = value.trim()
    if (trimmed !== (charter ?? '')) {
      updateTeam.mutate({ id: teamId, charter: trimmed || null })
    } else {
      setEditing(false)
    }
  }

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="group mt-2 flex w-full max-w-2xl items-start gap-1.5 text-left"
      >
        {charter ? (
          <p className="text-sm italic text-white/35">{charter}</p>
        ) : (
          <p className="text-sm text-white/20">Add charter...</p>
        )}
        <Pencil className="mt-0.5 h-3 w-3 shrink-0 text-white/15 opacity-0 transition-opacity group-hover:opacity-100" />
      </button>
    )
  }

  return (
    <div className="mt-2 max-w-2xl">
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit()
          if (e.key === 'Escape') {
            setValue(charter ?? '')
            setEditing(false)
          }
        }}
        onBlur={commit}
        rows={3}
        className="w-full resize-none border border-zinc-700 bg-transparent px-2 py-1.5 text-sm leading-relaxed text-white/60 outline-none focus:border-zinc-500 placeholder:text-white/20"
        placeholder="Describe this team's purpose, responsibilities, and what success looks like..."
      />
      <div className="mt-1 flex items-center gap-2 text-[0.55rem] text-white/25">
        <span>Cmd+Enter to save</span>
        <span>Esc to cancel</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function TeamDetailClient({ teamId }: { teamId: string }) {
  const utils = trpc.useUtils()
  const { data, isLoading, error } = trpc.company.getTeamDetail.useQuery({ teamId })

  // Mutations for inline status changes
  const updateTicketMutation = trpc.work.updateTicket.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.company.getTeamDetail.invalidate({ teamId }),
        utils.work.listTickets.invalidate(),
        utils.work.listGoals.invalidate(),
      ])
    },
    onError: () => {
      toast.error('Failed to update ticket')
    },
  })

  const updateGoalMutation = trpc.work.updateGoal.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.company.getTeamDetail.invalidate({ teamId }),
        utils.work.listGoals.invalidate(),
      ])
    },
    onError: () => {
      toast.error('Failed to update goal')
    },
  })

  const handleTicketStatusChange = useCallback(
    (ticketId: string, status: string) => {
      updateTicketMutation.mutate({ ticketId, patch: { status: status as TicketStatus } })
    },
    [updateTicketMutation]
  )

  const handleGoalStatusChange = useCallback(
    (goalId: string, status: string) => {
      updateGoalMutation.mutate({ goalId, patch: { status: status as GoalStatus } })
    },
    [updateGoalMutation]
  )

  if (isLoading) {
    return <SkeletonTeamDetail />
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-4 text-xs text-destructive">
        <p className="font-medium">Failed to load team</p>
        <p className="mt-2">{error.message}</p>
      </div>
    )
  }

  if (!data) return null

  const {
    team,
    members,
    agents,
    portfolio,
    goals,
    tickets,
    recentUpdates,
    spend,
    heartbeatPosture: posture,
  } = data
  const ticketGroups = groupTicketsByStatus(tickets)

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-xs text-white/40">
        <Link href="/company" className="hover:text-white/70 transition-colors">
          Company
        </Link>
        {team.parentTeamName && (
          <>
            <ChevronRight className="h-3 w-3" />
            {team.parentTeamId ? (
              <Link
                href={`/company/teams/${team.parentTeamId}`}
                className="hover:text-white/70 transition-colors"
              >
                {team.parentTeamName}
              </Link>
            ) : (
              <span>{team.parentTeamName}</span>
            )}
          </>
        )}
        <ChevronRight className="h-3 w-3" />
        <span className="text-white/70">{team.name}</span>
      </nav>

      {/* Header */}
      <div>
        <div className="flex items-center gap-3">
          <EditableTeamName teamId={teamId} name={team.name} />
          <HeartbeatBadge posture={posture} />
        </div>
        <EditableCharter teamId={teamId} charter={team.charter} />
      </div>

      {/* Two-column layout */}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {/* ---------- Left / Main content ---------- */}
        <div className="space-y-8">
          {/* Members & Agents */}
          <section>
            <div className="mb-3 flex items-center gap-2">
              <Users className="h-4 w-4 text-white/30" />
              <span className="text-[0.65rem] uppercase tracking-[0.2em] text-white/40">
                Members &amp; Agents
              </span>
              <span className="ml-auto text-[0.6rem] tabular-nums text-white/30">
                {members.length + agents.length}
              </span>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 divide-y divide-zinc-800/60">
              {/* Members */}
              {members.map((member) => (
                <div key={`user-${member.id}`} className="flex items-center gap-3 px-4 py-2.5">
                  <PersonAvatar name={member.name} isAgent={false} avatarUrl={member.avatarUrl} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm text-white/85">{member.name}</span>
                      <span className="text-[0.55rem] uppercase tracking-wide text-white/30">
                        person
                      </span>
                    </div>
                    {member.role && (
                      <span className="text-[0.65rem] text-white/35">{member.role}</span>
                    )}
                  </div>
                </div>
              ))}

              {/* Agents */}
              {agents.map((agent) => (
                <div key={`agent-${agent.id}`} className="flex items-center gap-3 px-4 py-2.5">
                  <PersonAvatar
                    name={agent.name}
                    emoji={agent.emoji}
                    avatarUrl={agent.avatarUrl}
                    isAgent={true}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/agents/${agent.id}`}
                        className="truncate text-sm text-white/85 hover:text-white transition-colors"
                      >
                        {agent.name}
                      </Link>
                      <span className="text-[0.55rem] uppercase tracking-wide text-white/30">
                        agent
                      </span>
                      {agent.isPrimary && (
                        <span className="rounded bg-primary/15 px-1.5 py-px text-[0.5rem] font-medium text-primary">
                          Primary
                        </span>
                      )}
                    </div>
                    {agent.title && (
                      <span className="text-[0.65rem] text-white/35">{agent.title}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-[0.65rem] tabular-nums text-white/35">
                    <span>{agent.openTicketCount} open</span>
                    {agent.blockedTicketCount > 0 && (
                      <span className="text-rose-400">{agent.blockedTicketCount} blocked</span>
                    )}
                  </div>
                </div>
              ))}

              {members.length === 0 && agents.length === 0 && (
                <div className="px-4 py-6 text-center text-xs text-white/25">
                  This team is uncrewed. Assign agents from the Company page.
                </div>
              )}
            </div>
          </section>

          {/* Goals */}
          <section>
            <div className="mb-3 flex items-center gap-2">
              <Target className="h-4 w-4 text-white/30" />
              <span className="text-[0.65rem] uppercase tracking-[0.2em] text-white/40">Goals</span>
              <span className="text-[0.6rem] tabular-nums text-white/30">{goals.length}</span>
              <span className="ml-auto">
                <Link
                  href={`/goals?teamId=${teamId}`}
                  className="text-[0.6rem] text-white/30 hover:text-white/60 transition-colors"
                >
                  View all &rarr;
                </Link>
              </span>
            </div>
            {goals.length > 0 ? (
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 divide-y divide-zinc-800/60">
                {goals.map((goal) => (
                  <div key={goal.id} className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <InlineStatusPicker
                        currentStatus={goal.health}
                        statuses={ALL_GOAL_STATUSES}
                        onStatusChange={(s) => handleGoalStatusChange(goal.id, s)}
                        showLabel
                      />
                      <Link
                        href={`/goals/${goal.id}`}
                        className="flex-1 truncate text-sm text-white/85 hover:text-white transition-colors"
                      >
                        {goal.title}
                      </Link>
                      {goal.owner && (
                        <span className="text-[0.65rem] text-white/30 shrink-0">
                          {goal.owner.label}
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 pl-7">
                      <ProgressBar done={goal.ticketCounts.done} total={goal.ticketCounts.total} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-4 py-6 text-center text-xs text-white/25">
                No goals owned by this team yet.
              </div>
            )}
          </section>

          {/* Assigned Tickets */}
          <section>
            <div className="mb-3 flex items-center gap-2">
              <Ticket className="h-4 w-4 text-white/30" />
              <span className="text-[0.65rem] uppercase tracking-[0.2em] text-white/40">
                Assigned Tickets
              </span>
              <span className="text-[0.6rem] tabular-nums text-white/30">{tickets.length}</span>
              <span className="ml-auto">
                <Link
                  href={`/tickets?team=${teamId}`}
                  className="text-[0.6rem] text-white/30 hover:text-white/60 transition-colors"
                >
                  View all &rarr;
                </Link>
              </span>
            </div>
            {ticketGroups.length > 0 ? (
              <div className="space-y-4">
                {ticketGroups.map(({ status, tickets: groupTickets }) => (
                  <div key={status}>
                    <div className="mb-1.5 flex items-center gap-2">
                      <StatusDot status={status} />
                      <span className="text-[0.6rem] font-medium uppercase tracking-[0.15em] text-white/40">
                        {status.replace(/_/g, ' ')}
                      </span>
                      <span className="text-[0.55rem] tabular-nums text-white/25">
                        {groupTickets.length}
                      </span>
                    </div>
                    <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 divide-y divide-zinc-800/60">
                      {groupTickets.map((ticket) => (
                        <div key={ticket.id} className="flex items-center gap-3 px-4 py-2.5">
                          <InlineStatusPicker
                            currentStatus={ticket.status}
                            statuses={ALL_TICKET_STATUSES}
                            onStatusChange={(s) => handleTicketStatusChange(ticket.id, s)}
                          />
                          <div className="min-w-0 flex-1">
                            <Link
                              href={`/tickets/${ticket.id}`}
                              className="block truncate text-sm text-white/85 hover:text-white transition-colors"
                            >
                              {ticket.title}
                            </Link>
                            {ticket.goalTitle && (
                              <span className="text-[0.6rem] text-white/30">
                                {ticket.goalTitle}
                              </span>
                            )}
                          </div>
                          {ticket.assignee && (
                            <span className="text-[0.6rem] text-white/30 shrink-0">
                              {ticket.assignee.label}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-4 py-6 text-center text-xs text-white/25">
                No tickets assigned yet.
              </div>
            )}
          </section>
        </div>

        {/* ---------- Right / Sidebar ---------- */}
        <div className="space-y-6">
          {/* Portfolio stats */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-4 py-4">
            <div className="mb-3 flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-white/30" />
              <span className="text-[0.65rem] uppercase tracking-[0.2em] text-white/40">
                Portfolio
              </span>
            </div>
            <div className="space-y-0.5">
              <StatRow label="Active goals" value={portfolio.activeGoalCount} />
              <StatRow
                label="At risk"
                value={portfolio.atRiskGoalCount}
                tone={portfolio.atRiskGoalCount > 0 ? 'warning' : 'neutral'}
              />
              <StatRow
                label="Blocked"
                value={portfolio.blockedGoalCount}
                tone={portfolio.blockedGoalCount > 0 ? 'danger' : 'neutral'}
              />
              <StatRow
                label="Staffing gaps"
                value={portfolio.goalsNeedingStaffingCount}
                tone={portfolio.goalsNeedingStaffingCount > 0 ? 'warning' : 'neutral'}
              />
              <div className="my-2 border-t border-zinc-800" />
              <StatRow label="Queued tickets" value={portfolio.queuedTicketCount} />
              <StatRow
                label="Blocked tickets"
                value={portfolio.blockedTicketCount}
                tone={portfolio.blockedTicketCount > 0 ? 'danger' : 'neutral'}
              />
            </div>
          </div>

          {/* Spend */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-4 py-4">
            <div className="mb-3 flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-white/30" />
              <span className="text-[0.65rem] uppercase tracking-[0.2em] text-white/40">Spend</span>
            </div>
            <div className="space-y-0.5">
              <StatRow label="Last 7 days" value={formatUsd(spend.last7d)} />
              <StatRow label="Last 30 days" value={formatUsd(spend.last30d)} />
            </div>
          </div>

          {/* Recent Activity */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-4 py-4 overflow-hidden">
            <div className="mb-3 flex items-center gap-2">
              <Activity className="h-4 w-4 text-white/30" />
              <span className="text-[0.65rem] uppercase tracking-[0.2em] text-white/40">
                Recent Activity
              </span>
            </div>
            {recentUpdates.length > 0 ? (
              <ScrollArea className="h-[320px]">
                <div className="space-y-3">
                  {recentUpdates.map((update) => (
                    <div key={update.id} className="space-y-1">
                      <div className="flex items-center gap-2">
                        <KindBadge kind={update.kind} />
                        <span className="text-[0.6rem] text-white/25">
                          <RelativeTime timestamp={update.createdAt} />
                        </span>
                      </div>
                      <p className="text-xs leading-relaxed text-white/50 line-clamp-2">
                        {update.body}
                      </p>
                      {update.goalTitle && (
                        <span className="text-[0.55rem] text-white/25">{update.goalTitle}</span>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            ) : (
              <p className="text-xs text-white/25">No recent activity.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
