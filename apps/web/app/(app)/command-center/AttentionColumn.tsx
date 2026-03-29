'use client'

import { useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { trpc, type RouterOutputs } from '@/lib/trpc'
import { RelativeTime } from '@/app/(app)/components/RelativeTime'
import {
  InlineStatusPicker,
  AvatarCircle,
  ALL_GOAL_STATUSES,
  ALL_TICKET_STATUSES,
} from '@/app/(app)/work/shared'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { toast } from 'sonner'
import {
  IconTarget,
  IconTicket,
  IconRobot,
  IconCurrencyDollar,
  IconPlayerPlay,
  IconCheck,
  IconUserPlus,
  IconInbox,
} from '@tabler/icons-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FleetStatus = RouterOutputs['commandCenter']['getFleetStatus']
type WorkDashboard = RouterOutputs['work']['getDashboard']

type FleetAgent = FleetStatus['roster'][number]

type AttentionItem = {
  id: string
  type: 'goal' | 'ticket' | 'agent' | 'budget' | 'operation'
  severity: 'critical' | 'warning' | 'info'
  title: string
  reason: string
  timestamp: number | null
  link: string
  detail: AttentionDetail
  isOwned: boolean
  isInbox: boolean
}

type AttentionDetail =
  | {
      kind: 'goal'
      goalId: string
      outcome: string | null
      status: string
      health: string
      owner: { label: string; kind: string; ref: string } | null
      ticketCounts: { total: number; blocked: number; done: number }
    }
  | {
      kind: 'ticket'
      ticketId: string
      body: string | null
      status: string
      assignee: { label: string; kind: string; ref: string } | null
      goalTitle: string | null
      blockedByCount: number
      isUnclaimed: boolean
      attentionTitle: string | null
    }
  | {
      kind: 'agent'
      agentId: string
      agentName: string
      openTicketCount: number
      blockedTicketCount: number
    }
  | {
      kind: 'budget'
      agentId: string | null
      agentName: string | null
      scope: string
      currentSpend: number
      limitUsd: number
      period: string
    }
  | {
      kind: 'operation'
      dispatchId: string
      agentId: string
      agentName: string
      title: string
      source: string
      elapsedMinutes: number
    }

// ---------------------------------------------------------------------------
// Feed builder (ported from AdminHome)
// ---------------------------------------------------------------------------

function buildAttentionFeed(fleet: FleetStatus, work: WorkDashboard): AttentionItem[] {
  const items: AttentionItem[] = []
  const nowUnix = Math.floor(Date.now() / 1000)

  // 1. needsAttention from fleet
  for (const item of fleet.needsAttention) {
    const isBudget = item.type === 'budget_exceeded' || item.type === 'budget_warning'
    const isOperation = item.type === 'long_running'
    const isZombie = item.type === 'zombie_dispatch'

    let type: AttentionItem['type'] = 'agent'
    if (isBudget) type = 'budget'
    else if (isOperation || isZombie) type = 'operation'

    let detail: AttentionDetail
    if (isBudget) {
      const alert = fleet.budgetAlerts.find((a) =>
        item.agentId ? a.agentId === item.agentId : a.scope === 'org'
      )
      detail = {
        kind: 'budget',
        agentId: item.agentId ?? null,
        agentName: alert?.agentName ?? null,
        scope: alert?.scope ?? 'org',
        currentSpend: alert?.currentSpend ?? 0,
        limitUsd: alert?.limitUsd ?? 0,
        period: alert?.period ?? 'daily',
      }
    } else if (isOperation || isZombie) {
      const op = fleet.activeOperations.find((o) => item.agentId && o.agentId === item.agentId)
      detail = {
        kind: 'operation',
        dispatchId: op?.dispatchId ?? '',
        agentId: item.agentId ?? '',
        agentName: op?.agentName ?? 'Agent',
        title: op?.title ?? item.message,
        source: op?.source ?? 'unknown',
        elapsedMinutes: op?.startedAt ? Math.floor((nowUnix - op.startedAt) / 60) : 0,
      }
    } else {
      const agent = fleet.roster.find((a) => a.agentId === item.agentId)
      detail = {
        kind: 'agent',
        agentId: item.agentId ?? '',
        agentName: agent?.name ?? 'Agent',
        openTicketCount: 0,
        blockedTicketCount: 0,
      }
    }

    items.push({
      id: `fleet:${item.type}:${item.agentId ?? 'org'}`,
      type,
      severity: item.severity,
      title: item.message.split(':')[0] ?? item.message,
      reason: item.message.includes(':')
        ? item.message.split(':').slice(1).join(':').trim()
        : item.message,
      timestamp: null,
      link: item.link,
      detail,
      isOwned: false,
      isInbox: false,
    })
  }

  // 2. atRiskGoals
  for (const goal of work.atRiskGoals) {
    items.push({
      id: `goal:${goal.id}`,
      type: 'goal',
      severity: goal.health === 'blocked' ? 'critical' : 'warning',
      title: goal.title,
      reason: `${goal.health.replace(/_/g, ' ')} — ${goal.ticketCounts.blocked} blocked, ${goal.ticketCounts.done}/${goal.ticketCounts.total} done`,
      timestamp: goal.updatedAt,
      link: `/goals/${goal.id}`,
      detail: {
        kind: 'goal',
        goalId: goal.id,
        outcome: goal.outcome,
        status: goal.status,
        health: goal.health,
        owner: goal.owner,
        ticketCounts: goal.ticketCounts,
      },
      isOwned: false,
      isInbox: false,
    })
  }

  // 3. direct in-app attention (inbox items)
  for (const item of work.attentionItems) {
    const ticket = item.ticket
    items.push({
      id: `attention:${item.id}`,
      type: 'ticket',
      severity: 'warning',
      title: ticket?.title ?? item.title,
      reason: item.title,
      timestamp: item.created_at,
      link: ticket ? `/tickets/${ticket.id}` : '/tickets',
      detail: {
        kind: 'ticket',
        ticketId: ticket?.id ?? item.ticket_id ?? 'unknown',
        body: ticket?.body ?? item.body,
        status: ticket?.status ?? 'blocked',
        assignee: ticket?.assignee ?? null,
        goalTitle: ticket?.goal?.title ?? null,
        blockedByCount: ticket?.blockedByCount ?? 0,
        isUnclaimed: false,
        attentionTitle: item.title,
      },
      isOwned: true,
      isInbox: true,
    })
  }

  // 4. blockedTickets
  for (const ticket of work.blockedTickets) {
    const goalCtx = ticket.goal?.title ? `${ticket.goal.title} · ` : ''
    items.push({
      id: `ticket:blocked:${ticket.id}`,
      type: 'ticket',
      severity: 'critical',
      title: ticket.title,
      reason: `${goalCtx}blocked${ticket.blockedByCount > 0 ? ` by ${ticket.blockedByCount} ticket${ticket.blockedByCount > 1 ? 's' : ''}` : ''}`,
      timestamp: ticket.updatedAt,
      link: `/tickets/${ticket.id}`,
      detail: {
        kind: 'ticket',
        ticketId: ticket.id,
        body: ticket.body,
        status: ticket.status,
        assignee: ticket.assignee,
        goalTitle: ticket.goal?.title ?? null,
        blockedByCount: ticket.blockedByCount,
        isUnclaimed: false,
        attentionTitle: null,
      },
      isOwned: false,
      isInbox: false,
    })
  }

  // 5. unclaimedTickets
  for (const ticket of work.unclaimedTickets) {
    items.push({
      id: `ticket:unclaimed:${ticket.id}`,
      type: 'ticket',
      severity: 'warning',
      title: ticket.title,
      reason: 'unclaimed — needs an owner',
      timestamp: ticket.createdAt,
      link: `/tickets/${ticket.id}`,
      detail: {
        kind: 'ticket',
        ticketId: ticket.id,
        body: ticket.body,
        status: ticket.status,
        assignee: ticket.assignee,
        goalTitle: ticket.goal?.title ?? null,
        blockedByCount: ticket.blockedByCount,
        isUnclaimed: true,
        attentionTitle: null,
      },
      isOwned: false,
      isInbox: false,
    })
  }

  // 6. active operations running long (>5 min)
  const alreadyFlagged = new Set(fleet.needsAttention.map((n) => n.agentId))
  for (const op of fleet.activeOperations) {
    if (op.status !== 'running' || !op.startedAt) continue
    const elapsed = nowUnix - op.startedAt
    if (elapsed <= 300) continue
    if (alreadyFlagged.has(op.agentId)) continue

    items.push({
      id: `op:${op.dispatchId}`,
      type: 'operation',
      severity: 'info',
      title: op.agentName,
      reason: `running for ${Math.floor(elapsed / 60)}m — "${op.title}"`,
      timestamp: op.startedAt,
      link: '/work-items',
      detail: {
        kind: 'operation',
        dispatchId: op.dispatchId,
        agentId: op.agentId,
        agentName: op.agentName,
        title: op.title,
        source: op.source,
        elapsedMinutes: Math.floor(elapsed / 60),
      },
      isOwned: false,
      isInbox: false,
    })
  }

  // 7. overloadedAgents
  for (const agent of work.overloadedAgents) {
    items.push({
      id: `agent:overloaded:${agent.ref}`,
      type: 'agent',
      severity: 'warning',
      title: agent.label,
      reason: `overloaded — ${agent.workload?.open_ticket_count ?? 0} open, ${agent.workload?.blocked_ticket_count ?? 0} blocked`,
      timestamp: null,
      link: `/agents/${agent.ref}`,
      detail: {
        kind: 'agent',
        agentId: agent.ref,
        agentName: agent.label,
        openTicketCount: agent.workload?.open_ticket_count ?? 0,
        blockedTicketCount: agent.workload?.blocked_ticket_count ?? 0,
      },
      isOwned: false,
      isInbox: false,
    })
  }

  // Sort: critical > warning > info, then by recency
  const severityOrder = { critical: 0, warning: 1, info: 2 }
  items.sort((a, b) => {
    const sevDiff = severityOrder[a.severity] - severityOrder[b.severity]
    if (sevDiff !== 0) return sevDiff
    return (b.timestamp ?? 0) - (a.timestamp ?? 0)
  })

  return items
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SeverityDot({ severity }: { severity: AttentionItem['severity'] }) {
  const color =
    severity === 'critical' ? 'bg-red-500' : severity === 'warning' ? 'bg-amber-500' : 'bg-white/20'
  return <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${color}`} />
}

function TypeIcon({ type }: { type: AttentionItem['type'] }) {
  const cls = 'h-3.5 w-3.5 shrink-0 text-white/30'
  switch (type) {
    case 'goal':
      return <IconTarget className={cls} />
    case 'ticket':
      return <IconTicket className={cls} />
    case 'agent':
      return <IconRobot className={cls} />
    case 'budget':
      return <IconCurrencyDollar className={cls} />
    case 'operation':
      return <IconPlayerPlay className={cls} />
  }
}

function FeedAssignPicker({
  agents,
  currentAssignee,
  onAssign,
  onOpenChange,
}: {
  agents: FleetAgent[]
  currentAssignee: { label: string; kind: string; ref: string } | null
  onAssign: (agentId: string) => void
  onOpenChange?: (open: boolean) => void
}) {
  return (
    <Popover onOpenChange={onOpenChange}>
      <PopoverTrigger
        className="group/assign inline-flex items-center gap-1 rounded p-0.5 transition hover:bg-white/10"
        onClick={(e) => e.stopPropagation()}
        title="Assign to agent"
      >
        {currentAssignee ? (
          <AvatarCircle name={currentAssignee.label} />
        ) : (
          <IconUserPlus className="h-3.5 w-3.5 text-zinc-500 group-hover/assign:text-zinc-300" />
        )}
      </PopoverTrigger>
      <PopoverContent className="w-48 p-1" align="end" onClick={(e) => e.stopPropagation()}>
        <p className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
          Assign to agent
        </p>
        {agents.map((agent) => {
          const isCurrentAssignee =
            currentAssignee?.kind === 'agent' && currentAssignee.ref === agent.agentId
          return (
            <button
              key={agent.agentId}
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onAssign(agent.agentId)
              }}
              className={`flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs transition hover:bg-white/[0.06] hover:text-white ${
                isCurrentAssignee ? 'bg-white/10 text-white' : 'text-zinc-400'
              }`}
            >
              <AvatarCircle name={agent.name} className="h-4 w-4 text-[8px]" />
              <span className="truncate">{agent.name}</span>
              {isCurrentAssignee && (
                <IconCheck className="ml-auto h-3 w-3 shrink-0 text-white/50" />
              )}
            </button>
          )
        })}
        {agents.length === 0 && (
          <p className="px-2 py-1.5 text-xs text-zinc-500">No agents available</p>
        )}
      </PopoverContent>
    </Popover>
  )
}

function AttentionRow({
  item,
  agents,
  updateGoalMutation,
  updateTicketMutation,
  claimTicketMutation,
}: {
  item: AttentionItem
  agents: FleetAgent[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateGoalMutation: { mutate: (...args: any[]) => void }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateTicketMutation: { mutate: (...args: any[]) => void }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  claimTicketMutation: { mutate: (...args: any[]) => void }
}) {
  const router = useRouter()
  const [openCount, setOpenCount] = useState(0)
  const track = useCallback((open: boolean) => {
    setOpenCount((c) => c + (open ? 1 : -1))
  }, [])

  return (
    <div
      role="button"
      tabIndex={0}
      data-feed-id={item.id}
      onClick={() => router.push(item.link)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          router.push(item.link)
        }
      }}
      className="group/row relative flex w-full cursor-pointer items-center gap-2.5 rounded px-2.5 py-2 text-left transition hover:bg-white/[0.04]"
    >
      <SeverityDot severity={item.severity} />
      <TypeIcon type={item.type} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm leading-tight">{item.title}</p>
        <p className="mt-0.5 truncate text-[0.65rem] text-muted-foreground">{item.reason}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {item.isOwned && (
          <span className="shrink-0 rounded bg-white/[0.08] px-1 py-0.5 text-[0.55rem] font-medium leading-none text-white/50">
            You
          </span>
        )}
        {item.timestamp && (
          <RelativeTime
            timestamp={item.timestamp}
            className="shrink-0 text-[0.6rem] text-muted-foreground"
          />
        )}
      </div>
      {/* Hover actions */}
      <div
        className={`absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5 rounded bg-zinc-900/90 px-1 py-0.5 transition-opacity ${openCount > 0 ? 'opacity-100' : 'pointer-events-none opacity-0 group-hover/row:pointer-events-auto group-hover/row:opacity-100'}`}
      >
        {item.detail.kind === 'goal' && (
          <InlineStatusPicker
            currentStatus={item.detail.status}
            statuses={ALL_GOAL_STATUSES}
            onStatusChange={(s) =>
              updateGoalMutation.mutate({
                goalId: item.detail.kind === 'goal' ? item.detail.goalId : '',
                patch: { status: s },
              })
            }
            showLabel
          />
        )}
        {item.detail.kind === 'ticket' && (
          <>
            <InlineStatusPicker
              currentStatus={item.detail.status}
              statuses={ALL_TICKET_STATUSES}
              onStatusChange={(s) =>
                updateTicketMutation.mutate({
                  ticketId: item.detail.kind === 'ticket' ? item.detail.ticketId : '',
                  patch: { status: s },
                })
              }
              showLabel
            />
            <FeedAssignPicker
              agents={agents}
              currentAssignee={item.detail.kind === 'ticket' ? item.detail.assignee : null}
              onAssign={(agentId) =>
                claimTicketMutation.mutate({
                  ticketId: item.detail.kind === 'ticket' ? item.detail.ticketId : '',
                  assigneeKind: 'agent',
                  assigneeRef: agentId,
                })
              }
              onOpenChange={track}
            />
          </>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// AttentionColumn
// ---------------------------------------------------------------------------

export function AttentionColumn({ fleet, work }: { fleet: FleetStatus; work: WorkDashboard }) {
  const utils = trpc.useUtils()
  const [dismissedIds] = useState<Set<string>>(new Set())
  const [scope, setScope] = useState<'mine' | 'all'>('all')

  const updateGoalMutation = trpc.work.updateGoal.useMutation({
    onSuccess: () => utils.work.getDashboard.invalidate(),
    onError: () => toast.error('Failed to update goal'),
  })
  const updateTicketMutation = trpc.work.updateTicket.useMutation({
    onSuccess: () => utils.work.getDashboard.invalidate(),
    onError: () => toast.error('Failed to update ticket'),
  })
  const claimTicketMutation = trpc.work.claimTicket.useMutation({
    onSuccess: () => utils.work.getDashboard.invalidate(),
    onError: () => toast.error('Failed to assign ticket'),
  })

  const allItems = useMemo(() => buildAttentionFeed(fleet, work), [fleet, work])

  const myTeamIds = useMemo(() => new Set(work.myTeamIds), [work.myTeamIds])

  const filteredItems = useMemo(() => {
    let items = allItems.filter((item) => !dismissedIds.has(item.id))
    if (scope === 'mine') {
      items = items.filter((item) => {
        if (item.isOwned) return true
        const { detail } = item
        if (detail.kind === 'goal') {
          if (detail.owner?.kind === 'user' && detail.owner.ref === work.currentUserId) return true
          if (detail.owner?.kind === 'team' && myTeamIds.has(detail.owner.ref)) return true
          return false
        }
        if (detail.kind === 'ticket') {
          if (detail.isUnclaimed) return false
          if (!detail.assignee) return false
          if (detail.assignee.kind === 'user' && detail.assignee.ref === work.currentUserId)
            return true
          if (detail.assignee.kind === 'team' && myTeamIds.has(detail.assignee.ref)) return true
          return false
        }
        return false
      })
    }
    return items
  }, [allItems, dismissedIds, scope, work.currentUserId, myTeamIds])

  const inboxItems = filteredItems.filter((item) => item.isInbox)
  const fleetItems = filteredItems.filter((item) => !item.isInbox)

  const inboxCount = allItems.filter((i) => i.isInbox).length
  const mineCount = allItems.filter((item) => {
    if (item.isOwned) return true
    const { detail } = item
    if (detail.kind === 'goal') {
      if (detail.owner?.kind === 'user' && detail.owner.ref === work.currentUserId) return true
      if (detail.owner?.kind === 'team' && myTeamIds.has(detail.owner.ref)) return true
    }
    if (detail.kind === 'ticket' && !('isUnclaimed' in detail && detail.isUnclaimed)) {
      if (
        detail.kind === 'ticket' &&
        detail.assignee?.kind === 'user' &&
        detail.assignee.ref === work.currentUserId
      )
        return true
      if (
        detail.kind === 'ticket' &&
        detail.assignee?.kind === 'team' &&
        myTeamIds.has(detail.assignee.ref)
      )
        return true
    }
    return false
  }).length

  return (
    <div className="min-w-0">
      {/* Header */}
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[0.65rem] font-medium uppercase tracking-[0.15em] text-muted-foreground">
          Needs attention
          {filteredItems.length > 0 && (
            <span className="ml-1.5 tabular-nums text-white/40">{filteredItems.length}</span>
          )}
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setScope(scope === 'mine' ? 'all' : 'mine')}
            className={`rounded px-1.5 py-0.5 text-[0.6rem] transition ${
              scope === 'mine'
                ? 'bg-white/10 text-white'
                : 'text-muted-foreground hover:text-white/60'
            }`}
          >
            Mine{mineCount > 0 ? ` (${mineCount})` : ''}
          </button>
          <Link
            href="/inbox"
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.6rem] text-muted-foreground transition hover:text-white/60"
          >
            <IconInbox className="h-3 w-3" />
            {inboxCount > 0 && <span className="tabular-nums">{inboxCount}</span>}
          </Link>
        </div>
      </div>

      {filteredItems.length === 0 ? (
        <p className="py-8 text-center text-xs text-muted-foreground">Nothing needs attention</p>
      ) : (
        <div className="space-y-1">
          {/* Inbox section */}
          {inboxItems.length > 0 && (
            <div>
              <p className="px-2 py-1 text-[0.6rem] font-medium uppercase tracking-[0.15em] text-white/30">
                Inbox ({inboxItems.length})
              </p>
              {inboxItems.map((item) => (
                <AttentionRow
                  key={item.id}
                  item={item}
                  agents={fleet.roster}
                  updateGoalMutation={updateGoalMutation}
                  updateTicketMutation={updateTicketMutation}
                  claimTicketMutation={claimTicketMutation}
                />
              ))}
            </div>
          )}
          {/* Fleet alerts */}
          {fleetItems.length > 0 && (
            <div>
              {inboxItems.length > 0 && (
                <p className="mt-2 px-2 py-1 text-[0.6rem] font-medium uppercase tracking-[0.15em] text-white/30">
                  Fleet & work ({fleetItems.length})
                </p>
              )}
              {fleetItems.map((item) => (
                <AttentionRow
                  key={item.id}
                  item={item}
                  agents={fleet.roster}
                  updateGoalMutation={updateGoalMutation}
                  updateTicketMutation={updateTicketMutation}
                  claimTicketMutation={claimTicketMutation}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
