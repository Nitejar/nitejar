'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { trpc, type RouterOutputs } from '@/lib/trpc'
import { parseAgentIdentityConfig } from '@/lib/agent-config-client'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  IconLoader2,
  IconRocket,
  IconMessageCircle,
  IconArrowRight,
  IconCircleCheck,
  IconCircleDashed,
  IconX,
  IconSearch,
  IconInbox,
  IconTarget,
  IconTicket,
  IconRobot,
  IconCurrencyDollar,
  IconPlayerPlay,
  IconAlertTriangle,
  IconFilter,
  IconCheck,
  IconUserPlus,
} from '@tabler/icons-react'
import { RelativeTime } from './components/RelativeTime'
import { SkeletonFeedRow } from './work/skeletons'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  AvatarGroup,
  AvatarGroupCount,
} from '@/components/ui/avatar'
import {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { toast } from 'sonner'
import {
  InlineStatusPicker,
  AvatarCircle,
  ALL_GOAL_STATUSES,
  ALL_TICKET_STATUSES,
} from './work/shared'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FleetAgent = {
  agentId: string
  name: string
  handle: string
  config: string | null
  status: 'busy' | 'idle'
  runCount: number
  cost: number
  lastActiveAt: number | null
}

type SessionItem = {
  sessionKey: string
  displayTitle: string
  lastMessageAt: number
  participants: Array<{
    id: string
    name: string
    emoji: string | null
    avatarUrl: string | null
  }>
}

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
}

type FeedScope = 'mine' | 'all'

type FeedGroup = {
  key: AttentionItem['type']
  label: string
  icon: AttentionItem['type']
  items: AttentionItem[]
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
// Empty State — 0 agents
// ---------------------------------------------------------------------------

function EmptyState() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const createAgent = trpc.org.createAgent.useMutation({
    onError: () => {
      toast.error('Failed to create agent')
    },
  })
  const startOrResume = trpc.sessions.startOrResume.useMutation({
    onError: () => {
      toast.error('Failed to start session')
    },
  })

  function deriveHandle(agentName: string): string {
    return (
      agentName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 30) || 'agent'
    )
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || loading) return
    setLoading(true)
    setError(null)
    try {
      const handle = deriveHandle(name)
      const agent = await createAgent.mutateAsync({
        handle,
        name: name.trim(),
      })
      const session = await startOrResume.mutateAsync({ agentId: agent.id })
      router.push(`/sessions/${encodeURIComponent(session.sessionKey)}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create agent')
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-center justify-center px-4 py-16">
      <div className="mb-6 flex h-20 w-20 items-center justify-center border border-dashed border-zinc-800 bg-white/[0.02]">
        <IconRocket className="h-10 w-10 text-white/20" />
      </div>
      <h1 className="text-2xl font-semibold">Welcome to Nitejar</h1>
      <p className="mt-2 max-w-md text-center text-sm text-muted-foreground">
        Create your first agent to get started. Give it a name and a one-liner about what it does.
      </p>

      <form onSubmit={handleCreate} className="mt-8 w-full max-w-md space-y-4">
        <div>
          <Input
            placeholder="Agent name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-10 border-zinc-800 bg-white/5 text-sm placeholder:text-white/30"
            autoFocus
          />
          {name.trim() && (
            <p className="mt-1 text-[0.65rem] text-muted-foreground">
              Handle: @{deriveHandle(name)}
            </p>
          )}
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <button
          type="submit"
          disabled={!name.trim() || loading}
          className="flex w-full items-center justify-center gap-2 bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? (
            <IconLoader2 className="h-4 w-4 animate-spin" />
          ) : (
            <IconMessageCircle className="h-4 w-4" />
          )}
          Create & Start Chatting
        </button>
      </form>

      <div className="mt-6 flex flex-col items-center gap-2 text-xs text-muted-foreground">
        <Link href="/agents/builder" className="hover:text-foreground">
          Want more control? Use the agent builder &rarr;
        </Link>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// HomeSearch — cmdk-powered command palette
// ---------------------------------------------------------------------------

function HomeSearch({ agents, sessions }: { agents: FleetAgent[]; sessions: SessionItem[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState<string | null>(null)
  const startOrResume = trpc.sessions.startOrResume.useMutation({
    onError: () => {
      toast.error('Failed to start session')
    },
  })

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleStartSession = useCallback(
    async (agentId: string) => {
      if (loading) return
      setLoading(agentId)
      try {
        const result = await startOrResume.mutateAsync({ agentId })
        setOpen(false)
        router.push(`/sessions/${encodeURIComponent(result.sessionKey)}`)
      } catch {
        setLoading(null)
      }
    },
    [loading, startOrResume, router]
  )

  const handleGoToSession = useCallback(
    (sessionKey: string) => {
      setOpen(false)
      router.push(`/sessions/${encodeURIComponent(sessionKey)}`)
    },
    [router]
  )

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Search"
      description="Search sessions or start a new conversation"
    >
      <Command shouldFilter>
        <CommandInput placeholder="Search sessions or start a new one..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>

          <CommandGroup heading="Start New">
            {agents.map((agent) => {
              const config = parseAgentIdentityConfig(agent.config)
              const initials = agent.name
                .split(/[-_\s]/)
                .map((part) => part[0])
                .join('')
                .slice(0, 2)
                .toUpperCase()
              const isLoading = loading === agent.agentId
              return (
                <CommandItem
                  key={agent.agentId}
                  value={`new ${agent.name} ${agent.handle}`}
                  onSelect={() => handleStartSession(agent.agentId)}
                >
                  <div className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded border border-zinc-800 bg-gradient-to-br from-white/10 to-white/5">
                    {config.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={config.avatarUrl}
                        alt={agent.name}
                        className="h-full w-full object-cover"
                      />
                    ) : config.emoji ? (
                      <span className="text-[0.5rem] leading-none">{config.emoji}</span>
                    ) : (
                      <span className="text-[0.4rem] font-semibold text-white/60">{initials}</span>
                    )}
                  </div>
                  <span className="flex-1 truncate">Chat with {agent.name}</span>
                  {isLoading && <IconLoader2 className="h-3.5 w-3.5 animate-spin" />}
                </CommandItem>
              )
            })}
          </CommandGroup>

          {sessions.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Recent Sessions">
                {sessions.map((session) => (
                  <CommandItem
                    key={session.sessionKey}
                    value={`session ${session.displayTitle} ${session.participants.map((p) => p.name).join(' ')}`}
                    onSelect={() => handleGoToSession(session.sessionKey)}
                  >
                    <AvatarGroup>
                      {session.participants.slice(0, 2).map((p) => (
                        <Avatar key={p.id} size="sm">
                          {p.avatarUrl ? <AvatarImage src={p.avatarUrl} alt={p.name} /> : null}
                          <AvatarFallback>
                            {p.emoji || p.name.slice(0, 1).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                      ))}
                      {session.participants.length > 2 && (
                        <AvatarGroupCount>+{session.participants.length - 2}</AvatarGroupCount>
                      )}
                    </AvatarGroup>
                    <span className="flex-1 truncate">{session.displayTitle}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}

// ---------------------------------------------------------------------------
// Getting Started Banner (single-line, expandable, dismissible)
// ---------------------------------------------------------------------------

function GettingStartedBanner({ onDismiss }: { onDismiss: () => void }) {
  const { data } = trpc.commandCenter.getOnboardingStatus.useQuery()
  const [expanded, setExpanded] = useState(false)

  if (!data) return null

  const items = [
    { label: 'Connect a channel', done: data.hasPluginInstances, href: '/plugins' },
    { label: 'Add skills to your agents', done: data.hasSkillAssignments, href: '/skills' },
    { label: 'Set cost limits', done: data.hasCostLimits, href: '/costs' },
  ]

  const doneCount = items.filter((item) => item.done).length
  const allDone = doneCount === items.length
  if (allDone) return null

  return (
    <div className="flex flex-col gap-0">
      <div className="flex items-center gap-3 py-1">
        <button
          onClick={() => setExpanded(!expanded)}
          className="cursor-pointer text-xs text-white/50 transition hover:text-white/70"
        >
          Setup: {doneCount} of {items.length} steps complete
          <span className="ml-1 text-[0.6rem]">{expanded ? '\u25B4' : '\u25BE'}</span>
        </button>
        <button
          onClick={onDismiss}
          className="shrink-0 cursor-pointer rounded-md p-0.5 text-muted-foreground transition hover:bg-white/5 hover:text-foreground"
        >
          <IconX className="h-3 w-3" />
        </button>
      </div>
      {expanded && (
        <div className="flex flex-wrap items-center gap-3 pb-1">
          {items.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className="flex items-center gap-1.5 text-xs transition hover:text-foreground"
            >
              {item.done ? (
                <IconCircleCheck className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
              ) : (
                <IconCircleDashed className="h-3.5 w-3.5 shrink-0 text-white/30" />
              )}
              <span className={item.done ? 'text-muted-foreground line-through' : 'text-white/60'}>
                {item.label}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Attention feed item builder
// ---------------------------------------------------------------------------

function buildAttentionFeed(
  fleet: RouterOutputs['commandCenter']['getFleetStatus'],
  work: RouterOutputs['work']['getDashboard']
): AttentionItem[] {
  const items: AttentionItem[] = []
  const nowUnix = Math.floor(Date.now() / 1000)

  // 1. needsAttention from fleet (budget, failure rate, long-running, cost spike, zombie)
  for (const item of fleet.needsAttention) {
    const isBudget = item.type === 'budget_exceeded' || item.type === 'budget_warning'
    const isOperation = item.type === 'long_running'
    const isZombie = item.type === 'zombie_dispatch'

    let type: AttentionItem['type'] = 'agent'
    if (isBudget) type = 'budget'
    else if (isOperation || isZombie) type = 'operation'

    // Find matching budget alert for detail
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
      // agent-level issue (failure rate, cost spike)
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
        ticketCounts: {
          total: goal.ticketCounts.total,
          blocked: goal.ticketCounts.blocked,
          done: goal.ticketCounts.done,
        },
      },
      isOwned: false,
    })
  }

  // 3. direct in-app attention from ticket comments / delegation
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
    })
  }

  // 6. activeOperations running long (>5 min, not already in needsAttention)
  const alreadyFlagged = new Set(fleet.needsAttention.map((n) => n.agentId))
  for (const op of fleet.activeOperations) {
    if (op.status !== 'running' || !op.startedAt) continue
    const elapsed = nowUnix - op.startedAt
    if (elapsed <= 300) continue // only show >5min
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
    })
  }

  // 7. overloadedAgents
  for (const agent of work.overloadedAgents) {
    items.push({
      id: `agent:overloaded:${agent.ref}`,
      type: 'agent',
      severity: 'warning',
      title: agent.label,
      reason: `overloaded — ${agent.workload?.open_ticket_count ?? 0} open tickets, ${agent.workload?.blocked_ticket_count ?? 0} blocked`,
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
// Ownership check — determines if a feed item belongs to the current user
// ---------------------------------------------------------------------------

function isItemOwnedByUser(item: AttentionItem, userId: string, myTeamIds: Set<string>): boolean {
  const { detail } = item
  if (detail.kind === 'goal') {
    // Goals I own directly
    if (detail.owner?.kind === 'user' && detail.owner.ref === userId) return true
    // Goals owned by my teams
    if (detail.owner?.kind === 'team' && myTeamIds.has(detail.owner.ref)) return true
    return false
  }
  if (detail.kind === 'ticket') {
    if (detail.isUnclaimed) return false // unclaimed tickets are NOT "mine"
    if (!detail.assignee) return false
    if (detail.assignee.kind === 'user' && detail.assignee.ref === userId) return true
    if (detail.assignee.kind === 'team' && myTeamIds.has(detail.assignee.ref)) return true
    return false
  }
  // Budget, operations, agent alerts — org-wide, not user-scoped
  return false
}

// ---------------------------------------------------------------------------
// Group items by type for section rendering
// ---------------------------------------------------------------------------

const TYPE_GROUP_CONFIG: Record<
  AttentionItem['type'],
  { order: number; label: (count: number) => string }
> = {
  goal: { order: 0, label: (n) => `Goals at risk (${n})` },
  ticket: { order: 1, label: (n) => `Tickets needing attention (${n})` },
  agent: { order: 2, label: (n) => `Fleet alerts (${n})` },
  budget: { order: 3, label: (n) => `Budget alerts (${n})` },
  operation: { order: 4, label: (n) => `Running operations (${n})` },
}

function groupFeedItems(items: AttentionItem[]): FeedGroup[] {
  const groups = new Map<AttentionItem['type'], AttentionItem[]>()
  for (const item of items) {
    const existing = groups.get(item.type) ?? []
    existing.push(item)
    groups.set(item.type, existing)
  }
  return Array.from(groups.entries())
    .map(([type, groupItems]) => ({
      key: type,
      label: TYPE_GROUP_CONFIG[type].label(groupItems.length),
      icon: type,
      items: groupItems,
    }))
    .sort(
      (a, b) =>
        TYPE_GROUP_CONFIG[a.key].order - TYPE_GROUP_CONFIG[b.key].order
    )
}

// ---------------------------------------------------------------------------
// Type icon component
// ---------------------------------------------------------------------------

function TypeIcon({ type }: { type: AttentionItem['type'] }) {
  const cls = 'h-4 w-4 shrink-0 text-white/30'
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

function SeverityDot({ severity }: { severity: AttentionItem['severity'] }) {
  const color =
    severity === 'critical' ? 'bg-red-500' : severity === 'warning' ? 'bg-amber-500' : 'bg-white/20'
  return <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${color}`} />
}

// ---------------------------------------------------------------------------
// Status helpers — use shared primitives from work/shared.tsx
// ---------------------------------------------------------------------------

const GOAL_STATUSES = ALL_GOAL_STATUSES
const TICKET_STATUSES = ALL_TICKET_STATUSES

// FeedStatusPicker removed — using InlineStatusPicker from work/shared.tsx directly

// ---------------------------------------------------------------------------
// Inline assign picker for tickets
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Attention Feed Row wrapper — tracks popover open state so actions stay visible
// ---------------------------------------------------------------------------

function AttentionRowWithActions({
  item,
  isSelected,
  onClick,
  onDismiss,
  agents,
  updateGoalMutation,
  updateTicketMutation,
  claimTicketMutation,
}: {
  item: AttentionItem
  isSelected: boolean
  onClick: () => void
  onDismiss: () => void
  agents: FleetAgent[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateGoalMutation: { mutate: (...args: any[]) => void }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateTicketMutation: { mutate: (...args: any[]) => void }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  claimTicketMutation: { mutate: (...args: any[]) => void }
}) {
  const [openCount, setOpenCount] = useState(0)
  const track = useCallback((open: boolean) => {
    setOpenCount((c) => c + (open ? 1 : -1))
  }, [])

  const actions = (
    <>
      {item.detail.kind === 'goal' && (
        <InlineStatusPicker
          currentStatus={item.detail.status}
          statuses={GOAL_STATUSES}
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
            statuses={TICKET_STATUSES}
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
    </>
  )

  return (
    <AttentionRow
      item={item}
      isSelected={isSelected}
      onClick={onClick}
      onDismiss={onDismiss}
      actions={actions}
      actionsOpen={openCount > 0}
    />
  )
}

// ---------------------------------------------------------------------------
// Attention Feed Row
// ---------------------------------------------------------------------------

function AttentionRow({
  item,
  isSelected,
  onClick,
  onDismiss,
  actions,
  actionsOpen,
}: {
  item: AttentionItem
  isSelected: boolean
  onClick: () => void
  onDismiss: () => void
  actions?: React.ReactNode
  actionsOpen?: boolean
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      data-feed-id={item.id}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
      className={`group/row relative flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left transition ${
        isSelected
          ? 'bg-white/[0.08] border border-zinc-800'
          : 'hover:bg-white/[0.04] border border-transparent'
      }`}
    >
      <SeverityDot severity={item.severity} />
      <TypeIcon type={item.type} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium leading-tight">{item.title}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.reason}</p>
      </div>
      {/* Static metadata — always visible, never shifts */}
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
      {/* Hover actions — absolutely positioned overlay so they don't compress text */}
      <div
        className={`absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5 rounded bg-zinc-900/90 px-1 py-0.5 transition-opacity ${actionsOpen ? 'opacity-100' : 'opacity-0 pointer-events-none group-hover/row:opacity-100 group-hover/row:pointer-events-auto'}`}
      >
        {actions}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDismiss()
          }}
          className="inline-flex shrink-0 rounded p-0.5 text-zinc-600 hover:text-zinc-300"
          title="Dismiss"
        >
          <IconX className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Detail Panel
// ---------------------------------------------------------------------------

function DetailPanel({
  item,
  agents,
  onGoalStatusChange,
  onTicketStatusChange,
  onTicketAssign,
}: {
  item: AttentionItem
  agents: FleetAgent[]
  onGoalStatusChange: (goalId: string, status: string) => void
  onTicketStatusChange: (ticketId: string, status: string) => void
  onTicketAssign: (ticketId: string, agentId: string) => void
}) {
  const { detail } = item

  return (
    <div className="space-y-4 p-5">
      {/* Header */}
      <div className="space-y-1">
        <h3 className="text-base font-semibold leading-snug">{item.title}</h3>
        <p className="text-sm text-muted-foreground">{item.reason}</p>
      </div>

      {/* Type-specific content */}
      {detail.kind === 'goal' && (
        <GoalDetail detail={detail} onStatusChange={(s) => onGoalStatusChange(detail.goalId, s)} />
      )}
      {detail.kind === 'ticket' && (
        <TicketDetail
          detail={detail}
          agents={agents}
          onStatusChange={(s) => onTicketStatusChange(detail.ticketId, s)}
          onAssign={(agentId) => onTicketAssign(detail.ticketId, agentId)}
        />
      )}
      {detail.kind === 'budget' && <BudgetDetail detail={detail} />}
      {detail.kind === 'operation' && <OperationDetail detail={detail} />}
      {detail.kind === 'agent' && <AgentDetail detail={detail} />}

      {/* Open full page */}
      <div className="pt-2">
        <Link
          href={item.link}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-white/50 transition hover:text-white/80"
        >
          Open full page
          <IconArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  )
}

function GoalDetail({
  detail,
  onStatusChange,
}: {
  detail: Extract<AttentionDetail, { kind: 'goal' }>
  onStatusChange: (status: string) => void
}) {
  return (
    <div className="space-y-3">
      {detail.outcome && (
        <div>
          <p className="text-[0.6rem] uppercase tracking-[0.2em] text-muted-foreground">Outcome</p>
          <p className="mt-1 text-sm text-white/70">{detail.outcome}</p>
        </div>
      )}
      <div>
        <p className="text-[0.6rem] uppercase tracking-[0.2em] text-muted-foreground">Status</p>
        <div className="mt-1">
          <InlineStatusPicker
            currentStatus={detail.status}
            statuses={GOAL_STATUSES}
            onStatusChange={onStatusChange}
            showLabel
          />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <DetailStat label="Total tickets" value={detail.ticketCounts.total} />
        <DetailStat
          label="Blocked"
          value={detail.ticketCounts.blocked}
          warn={detail.ticketCounts.blocked > 0}
        />
        <DetailStat label="Done" value={detail.ticketCounts.done} />
      </div>
      {detail.owner && (
        <div>
          <p className="text-[0.6rem] uppercase tracking-[0.2em] text-muted-foreground">Owner</p>
          <p className="mt-1 text-sm text-white/70">{detail.owner.label}</p>
        </div>
      )}
    </div>
  )
}

function TicketDetail({
  detail,
  agents,
  onStatusChange,
  onAssign,
}: {
  detail: Extract<AttentionDetail, { kind: 'ticket' }>
  agents: FleetAgent[]
  onStatusChange: (status: string) => void
  onAssign: (agentId: string) => void
}) {
  return (
    <div className="space-y-3">
      {detail.attentionTitle ? (
        <div className="rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2">
          <p className="text-[0.6rem] uppercase tracking-[0.2em] text-amber-300/70">
            Needs your attention
          </p>
          <p className="mt-1 text-sm text-amber-100/85">{detail.attentionTitle}</p>
        </div>
      ) : null}
      {detail.body && (
        <div>
          <p className="text-[0.6rem] uppercase tracking-[0.2em] text-muted-foreground">
            Description
          </p>
          <p className="mt-1 line-clamp-4 text-sm text-white/70">{detail.body}</p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-[0.6rem] uppercase tracking-[0.2em] text-muted-foreground">Status</p>
          <div className="mt-1">
            <InlineStatusPicker
              currentStatus={detail.status}
              statuses={TICKET_STATUSES}
              onStatusChange={onStatusChange}
              showLabel
            />
          </div>
        </div>
        <div>
          <p className="text-[0.6rem] uppercase tracking-[0.2em] text-muted-foreground">Assignee</p>
          <div className="mt-1 flex items-center gap-1.5">
            {detail.assignee ? <AvatarCircle name={detail.assignee.label} /> : null}
            <span className="text-sm text-white/70">
              {detail.assignee ? detail.assignee.label : 'Unassigned'}
            </span>
            <FeedAssignPicker
              agents={agents}
              currentAssignee={detail.assignee}
              onAssign={onAssign}
            />
          </div>
        </div>
      </div>
      {detail.goalTitle && (
        <div>
          <p className="text-[0.6rem] uppercase tracking-[0.2em] text-muted-foreground">Goal</p>
          <p className="mt-1 text-sm text-white/70">{detail.goalTitle}</p>
        </div>
      )}
      {detail.blockedByCount > 0 && (
        <div className="flex items-center gap-1.5 text-sm text-amber-400">
          <IconAlertTriangle className="h-3.5 w-3.5" />
          Blocked by {detail.blockedByCount} ticket{detail.blockedByCount > 1 ? 's' : ''}
        </div>
      )}
    </div>
  )
}

function BudgetDetail({ detail }: { detail: Extract<AttentionDetail, { kind: 'budget' }> }) {
  const pct = detail.limitUsd > 0 ? (detail.currentSpend / detail.limitUsd) * 100 : 0
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <DetailStat label="Current spend" value={`$${detail.currentSpend.toFixed(2)}`} />
        <DetailStat label="Limit" value={`$${detail.limitUsd.toFixed(2)}`} />
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
          <span>{detail.period} budget</span>
          <span>{pct.toFixed(0)}%</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
            style={{ width: `${Math.min(pct, 100)}%` }}
          />
        </div>
      </div>
      {detail.agentName && (
        <div>
          <p className="text-[0.6rem] uppercase tracking-[0.2em] text-muted-foreground">Agent</p>
          <p className="mt-1 text-sm text-white/70">{detail.agentName}</p>
        </div>
      )}
    </div>
  )
}

function OperationDetail({ detail }: { detail: Extract<AttentionDetail, { kind: 'operation' }> }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-[0.6rem] uppercase tracking-[0.2em] text-muted-foreground">Agent</p>
          <p className="mt-1 text-sm text-white/70">{detail.agentName}</p>
        </div>
        <div>
          <p className="text-[0.6rem] uppercase tracking-[0.2em] text-muted-foreground">Elapsed</p>
          <p className="mt-1 text-sm text-white/70">{detail.elapsedMinutes}m</p>
        </div>
      </div>
      <div>
        <p className="text-[0.6rem] uppercase tracking-[0.2em] text-muted-foreground">Task</p>
        <p className="mt-1 text-sm text-white/70">{detail.title}</p>
      </div>
      <div>
        <p className="text-[0.6rem] uppercase tracking-[0.2em] text-muted-foreground">Source</p>
        <p className="mt-1 text-sm text-white/70">{detail.source}</p>
      </div>
    </div>
  )
}

function AgentDetail({ detail }: { detail: Extract<AttentionDetail, { kind: 'agent' }> }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <DetailStat
          label="Open tickets"
          value={detail.openTicketCount}
          warn={detail.openTicketCount >= 6}
        />
        <DetailStat
          label="Blocked"
          value={detail.blockedTicketCount}
          warn={detail.blockedTicketCount >= 2}
        />
      </div>
    </div>
  )
}

function DetailStat({
  label,
  value,
  warn,
}: {
  label: string
  value: string | number
  warn?: boolean
}) {
  return (
    <div className="border border-zinc-800 px-3 py-2">
      <p className="text-[0.6rem] uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${warn ? 'text-amber-400' : ''}`}>
        {value}
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inbox State — the main view for 1+ agents
// ---------------------------------------------------------------------------

type SeverityFilter = AttentionItem['severity'] | 'all'

function InboxState({
  fleet,
  work,
  agents,
  sessions,
  showGettingStarted,
}: {
  fleet: RouterOutputs['commandCenter']['getFleetStatus']
  work: RouterOutputs['work']['getDashboard']
  agents: FleetAgent[]
  sessions: SessionItem[]
  showGettingStarted: boolean
}) {
  const router = useRouter()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [scope, setScope] = useState<FeedScope>('mine')
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all')
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => new Set())
  const [gsDismissed, setGsDismissed] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem('nitejar-getting-started-dismissed') === '1'
  })

  const utils = trpc.useUtils()
  const updateGoalMutation = trpc.work.updateGoal.useMutation({
    onSuccess: () => {
      void utils.work.getDashboard.invalidate()
    },
    onError: () => {
      toast.error('Failed to update goal')
    },
  })
  const updateTicketMutation = trpc.work.updateTicket.useMutation({
    onSuccess: () => {
      void utils.work.getDashboard.invalidate()
    },
    onError: () => {
      toast.error('Failed to update ticket')
    },
  })
  const claimTicketMutation = trpc.work.claimTicket.useMutation({
    onSuccess: () => {
      void utils.work.getDashboard.invalidate()
    },
    onError: () => {
      toast.error('Failed to assign ticket')
    },
  })

  const handleDismiss = useCallback((id: string) => {
    setDismissedIds((prev) => {
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }, [])

  const currentUserId = work.currentUserId
  const myTeamIds = useMemo(() => new Set(work.myTeamIds), [work.myTeamIds])

  // Build full feed with ownership stamps
  const allFeed = useMemo(() => {
    const items = buildAttentionFeed(fleet, work)
    for (const item of items) {
      item.isOwned = item.isOwned || isItemOwnedByUser(item, currentUserId, myTeamIds)
    }
    return items
  }, [fleet, work, currentUserId, myTeamIds])

  // Filter dismissed items, then scope and severity
  const visibleFeed = useMemo(
    () => allFeed.filter((item) => !dismissedIds.has(item.id)),
    [allFeed, dismissedIds]
  )

  // Filter for "mine" scope
  const mineFeed = useMemo(() => visibleFeed.filter((item) => item.isOwned), [visibleFeed])
  const scopedFeed = scope === 'mine' ? mineFeed : visibleFeed

  // Apply severity filter
  const feed = useMemo(
    () =>
      severityFilter === 'all'
        ? scopedFeed
        : scopedFeed.filter((item) => item.severity === severityFilter),
    [scopedFeed, severityFilter]
  )

  // Group feed items by type
  const groups = useMemo(() => groupFeedItems(feed), [feed])

  // Auto-select first item when feed changes
  useEffect(() => {
    if (feed.length > 0 && (!selectedId || !feed.some((item) => item.id === selectedId))) {
      setSelectedId(feed[0]!.id)
    }
  }, [feed, selectedId])

  // j/k keyboard navigation through feed items, Enter to open, Escape to deselect
  const feedListRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      if (e.key === 'j' || e.key === 'k') {
        e.preventDefault()
        const currentIdx = feed.findIndex((item) => item.id === selectedId)
        let nextIdx: number
        if (e.key === 'j') {
          nextIdx = currentIdx < feed.length - 1 ? currentIdx + 1 : currentIdx
        } else {
          nextIdx = currentIdx > 0 ? currentIdx - 1 : 0
        }
        const next = feed[nextIdx]
        if (next) {
          setSelectedId(next.id)
          // Scroll the selected row into view
          const row = feedListRef.current?.querySelector(`[data-feed-id="${next.id}"]`)
          row?.scrollIntoView({ block: 'nearest' })
        }
      } else if (e.key === 'Escape') {
        setSelectedId(null)
      } else if (e.key === 'Enter' && selectedId) {
        e.preventDefault()
        const item = feed.find((i) => i.id === selectedId)
        if (item) {
          router.push(item.link)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [feed, selectedId, router])

  const selectedItem = feed.find((item) => item.id === selectedId) ?? null

  const hasActiveFilters = scope !== 'mine' || severityFilter !== 'all'
  const activeFilterCount = (scope !== 'mine' ? 1 : 0) + (severityFilter !== 'all' ? 1 : 0)

  function handleDismissGettingStarted() {
    localStorage.setItem('nitejar-getting-started-dismissed', '1')
    setGsDismissed(true)
  }

  return (
    <div className="-mx-2 -mt-2 -mb-4 flex min-h-0 flex-1 flex-col overflow-hidden sm:-mx-6 sm:-mt-4 sm:-mb-6">
      {/* Top bar */}
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-zinc-800 px-4">
        <h1 className="text-sm font-semibold text-zinc-200">Command Center</h1>

        <div className="flex items-center gap-2">
          <Link
            href="/inbox"
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-zinc-800 px-2 text-xs text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-200"
          >
            <IconInbox className="h-3.5 w-3.5" />
            Inbox
            {work.attentionSummary.unreadOpenCount > 0 ? (
              <span className="inline-flex min-w-[1rem] items-center justify-center rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-amber-300">
                {work.attentionSummary.unreadOpenCount > 99 ? '99+' : work.attentionSummary.unreadOpenCount}
              </span>
            ) : null}
          </Link>
          <Popover>
            <PopoverTrigger
              className={`inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-xs transition ${
                hasActiveFilters
                  ? 'border-white/20 bg-white/[0.06] text-white'
                  : 'border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-300'
              }`}
            >
              <IconFilter className="h-3 w-3" />
              Filter
              {activeFilterCount > 0 && (
                <span className="inline-flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-white/15 px-1 text-[9px] font-medium text-white">
                  {activeFilterCount}
                </span>
              )}
            </PopoverTrigger>
            <PopoverContent className="w-56 space-y-3 p-3" align="end">
              <div>
                <label className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                  Scope
                </label>
                <div className="mt-1.5 flex items-center border border-zinc-800 p-0.5">
                  {(['mine', 'all'] as const).map((value) => {
                    const isActive = scope === value
                    const count = value === 'mine' ? mineFeed.length : allFeed.length
                    return (
                      <button
                        key={value}
                        onClick={() => setScope(value)}
                        className={`flex flex-1 cursor-pointer items-center justify-center gap-1.5 px-2.5 py-1 text-xs font-medium transition ${
                          isActive
                            ? 'bg-white/[0.08] text-zinc-100'
                            : 'text-white/40 hover:text-white/60'
                        }`}
                      >
                        {value === 'mine' ? 'Mine' : 'All'}
                        <span
                          className={`tabular-nums ${isActive ? 'text-white/50' : 'text-white/20'}`}
                        >
                          {count}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
              <div>
                <label className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                  Severity
                </label>
                <div className="mt-1.5 flex items-center border border-zinc-800 p-0.5">
                  {(['all', 'critical', 'warning', 'info'] as const).map((value) => {
                    const isActive = severityFilter === value
                    return (
                      <button
                        key={value}
                        onClick={() => setSeverityFilter(value)}
                        className={`flex flex-1 cursor-pointer items-center justify-center px-1.5 py-1 text-[11px] font-medium capitalize transition ${
                          isActive
                            ? 'bg-white/[0.08] text-zinc-100'
                            : 'text-white/40 hover:text-white/60'
                        }`}
                      >
                        {value}
                      </button>
                    )
                  })}
                </div>
              </div>
            </PopoverContent>
          </Popover>

          <button
            onClick={() => {
              const event = new KeyboardEvent('keydown', {
                key: 'k',
                metaKey: true,
                bubbles: true,
              })
              document.dispatchEvent(event)
            }}
            className="flex h-7 cursor-pointer items-center gap-2 rounded-md border border-zinc-800 px-2 text-xs text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-300"
          >
            <IconSearch className="h-3 w-3" />
            <kbd className="hidden text-[0.55rem] font-medium sm:inline-block">⌘K</kbd>
          </button>
        </div>
      </div>

      {/* Breadcrumb context line */}
      {(scope !== 'mine' || severityFilter !== 'all') && (
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-zinc-800 px-4 py-1 text-xs text-zinc-500">
          <span
            className="cursor-pointer hover:text-white transition-colors"
            onClick={() => {
              setScope('mine')
              setSeverityFilter('all')
            }}
          >
            Command Center
          </span>
          {scope !== 'mine' && (
            <>
              <span className="text-zinc-600"> · </span>
              <span
                className="cursor-pointer hover:text-white transition-colors"
                onClick={() => setScope('mine')}
              >
                All items
              </span>
            </>
          )}
          {severityFilter !== 'all' && (
            <>
              <span className="text-zinc-600"> · </span>
              <span
                className="cursor-pointer hover:text-white transition-colors"
                onClick={() => setSeverityFilter('all')}
              >
                {severityFilter === 'critical'
                  ? 'Critical only'
                  : severityFilter === 'warning'
                    ? 'Warnings only'
                    : 'Info only'}
              </span>
            </>
          )}
        </div>
      )}

      {/* Getting started banner */}
      {showGettingStarted && !gsDismissed && (
        <div className="shrink-0 border-b border-zinc-800 px-4 py-1.5">
          <GettingStartedBanner onDismiss={handleDismissGettingStarted} />
        </div>
      )}

      {/* Main content: list-detail split */}
      {feed.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-4 py-16">
          <div className="flex flex-col items-center justify-center text-center animate-in fade-in duration-300">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/nitejar-plain.png"
              alt=""
              className="mb-4 h-16 w-16 opacity-20"
              aria-hidden="true"
            />
            <p className="text-sm font-medium text-white/60">All clear. The nightjar rests.</p>
            <p className="mt-1 text-xs text-white/35">
              Your fleet is on track. Nothing needs attention right now.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {/* Left: attention feed, grouped by type */}
          <div className="w-full border-r border-zinc-800 lg:w-[400px] xl:w-[440px]">
            <ScrollArea className="h-full">
              <div ref={feedListRef} className="py-2">
                {groups.map((group, groupIndex) => (
                  <div key={group.key} className={groupIndex > 0 ? 'mt-3' : ''}>
                    <div className="flex items-center gap-2 px-3 pb-1.5 pt-2">
                      <TypeIcon type={group.icon} />
                      <span className="text-[0.65rem] font-medium uppercase tracking-[0.15em] text-muted-foreground">
                        {group.label}
                      </span>
                    </div>
                    <div className="space-y-0.5">
                      {group.items.map((item) => (
                        <AttentionRowWithActions
                          key={item.id}
                          item={item}
                          isSelected={item.id === selectedId}
                          onClick={() => setSelectedId(item.id)}
                          onDismiss={() => handleDismiss(item.id)}
                          agents={agents}
                          updateGoalMutation={updateGoalMutation}
                          updateTicketMutation={updateTicketMutation}
                          claimTicketMutation={claimTicketMutation}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>

          {/* Right: detail panel */}
          <div className="hidden flex-1 lg:block">
            <ScrollArea className="h-full">
              {selectedItem ? (
                <div
                  key={selectedItem.id}
                  className="h-full animate-in fade-in slide-in-from-right-2 duration-200 ease-out"
                >
                  <DetailPanel
                    item={selectedItem}
                    agents={agents}
                    onGoalStatusChange={(goalId, status) =>
                      updateGoalMutation.mutate({
                        goalId,
                        patch: { status: status as (typeof GOAL_STATUSES)[number] },
                      })
                    }
                    onTicketStatusChange={(ticketId, status) =>
                      updateTicketMutation.mutate({
                        ticketId,
                        patch: { status: status as (typeof TICKET_STATUSES)[number] },
                      })
                    }
                    onTicketAssign={(ticketId, agentId) =>
                      claimTicketMutation.mutate({
                        ticketId,
                        assigneeKind: 'agent',
                        assigneeRef: agentId,
                      })
                    }
                  />
                </div>
              ) : (
                <div className="flex h-full items-center justify-center py-24 text-sm text-muted-foreground">
                  Select an item to see details
                </div>
              )}
            </ScrollArea>
          </div>
        </div>
      )}

      {/* Hidden search dialog */}
      <HomeSearch agents={agents} sessions={sessions} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// AdminHome — adaptive wrapper
// ---------------------------------------------------------------------------

export function AdminHome() {
  const fleetQuery = trpc.commandCenter.getFleetStatus.useQuery({ period: '7d' })
  const sessionsQuery = trpc.sessions.list.useQuery({ limit: 5 })
  const workQuery = trpc.work.getDashboard.useQuery(undefined, { refetchInterval: 30_000 })

  if (fleetQuery.isLoading || workQuery.isLoading) {
    return (
      <div className="-mx-2 -mt-2 -mb-4 py-4 sm:-mx-6 sm:-mt-4 sm:-mb-6">
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonFeedRow key={i} />
        ))}
      </div>
    )
  }

  const fleet = fleetQuery.data
  const work = workQuery.data
  if (!fleet || !work) return null

  const sessions: SessionItem[] = (sessionsQuery.data?.items ?? []).map((s) => ({
    sessionKey: s.sessionKey,
    displayTitle: s.displayTitle,
    lastMessageAt: s.lastMessageAt,
    participants: s.participants.map((p) => ({
      id: p.id,
      name: p.name,
      emoji: p.emoji,
      avatarUrl: p.avatarUrl,
    })),
  }))

  const { totalAgents } = fleet.summary

  // State 1: Empty (0 agents)
  if (totalAgents === 0) {
    return <EmptyState />
  }

  // State 2+: Inbox view (1+ agents)
  return (
    <InboxState
      fleet={fleet}
      work={work}
      agents={fleet.roster}
      sessions={sessions}
      showGettingStarted={totalAgents <= 3}
    />
  )
}
