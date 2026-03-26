'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  Bot,
  ChevronDown,
  ChevronRight,
  DollarSign,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Target,
  Ticket,
  Trash2,
  UserCircle,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { trpc, type RouterOutputs } from '@/lib/trpc'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { RelativeTime } from '../../../components/RelativeTime'
import { SkeletonTeamDetail } from '@/app/(app)/work/skeletons'
import {
  AvatarCircle,
  ALL_GOAL_STATUSES,
  ALL_TICKET_STATUSES,
  InlinePicker,
  InlineStatusPicker,
  type GoalStatus,
  type TicketStatus,
} from '../../../work/shared'
import { AgentAssignmentControl, LeadPicker, useClickOutside } from '../../team-management-controls'

type TeamDetail = RouterOutputs['company']['getTeamDetail']
type CompanyOverview = RouterOutputs['company']['getOverview']
type OrgTeam = CompanyOverview['organization'][number]
type OrgTeamRollup = CompanyOverview['teams'][number]
type OrgTeamNode = {
  team: OrgTeam
  children: OrgTeamNode[]
}

const ticketStatusDotColor: Record<string, string> = {
  inbox: 'bg-zinc-400',
  ready: 'bg-sky-400',
  in_progress: 'bg-emerald-400',
  blocked: 'bg-rose-400',
  done: 'bg-zinc-500',
  canceled: 'bg-zinc-600',
}

const kindBadgeStyles: Record<string, string> = {
  heartbeat: 'border-sky-400/30 bg-sky-500/10 text-sky-300',
  status: 'border-amber-400/30 bg-amber-500/10 text-amber-300',
  note: 'border-white/10 bg-white/5 text-white/60',
}

const STATUS_ORDER = ['blocked', 'in_progress', 'ready', 'inbox'] as const

function collectExpandableNodeIds<T extends { children: T[] }>(
  nodes: T[],
  getId: (node: T) => string
): Set<string> {
  const ids = new Set<string>()
  const walk = (entries: T[]) => {
    for (const entry of entries) {
      if (entry.children.length > 0) {
        ids.add(getId(entry))
        walk(entry.children)
      }
    }
  }
  walk(nodes)
  return ids
}

function buildOrgTeamTree(parentId: string, organization: OrgTeam[]): OrgTeamNode[] {
  const childrenByParent = new Map<string | null, OrgTeam[]>()
  for (const team of organization) {
    const list = childrenByParent.get(team.parentTeamId ?? null) ?? []
    list.push(team)
    childrenByParent.set(team.parentTeamId ?? null, list)
  }

  const buildNodes = (currentParentId: string): OrgTeamNode[] =>
    (childrenByParent.get(currentParentId) ?? []).map((team) => ({
      team,
      children: buildNodes(team.id),
    }))

  return buildNodes(parentId)
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function teamHealthTone(
  portfolio: TeamDetail['portfolio']
): 'blocked' | 'at risk' | 'healthy' | 'no goals' {
  if (portfolio.blockedGoalCount > 0) return 'blocked'
  if (portfolio.atRiskGoalCount > 0) return 'at risk'
  if (portfolio.activeGoalCount > 0) return 'healthy'
  return 'no goals'
}

function HealthDot({ tone }: { tone: string }) {
  const color =
    tone === 'blocked' || tone === 'red'
      ? 'bg-rose-400'
      : tone === 'at risk' || tone === 'amber'
        ? 'bg-amber-400'
        : tone === 'healthy' || tone === 'green'
          ? 'bg-emerald-400'
          : 'bg-zinc-500'
  return <span className={cn('inline-block h-2 w-2 shrink-0 rounded-full', color)} />
}

function StatusDot({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'inline-block h-2 w-2 shrink-0 rounded-full',
        ticketStatusDotColor[status] ?? 'bg-zinc-500'
      )}
    />
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

function overviewTeamHealth(team: OrgTeamRollup | undefined): string {
  if (!team || team.activeGoalCount === 0) return 'gray'
  if (team.blockedGoalCount > 0) return 'red'
  if (team.atRiskGoalCount > 0) return 'amber'
  return 'green'
}

function ChildTeamTreeRow({
  node,
  depth,
  expandedIds,
  onToggle,
  rollupByTeamId,
}: {
  node: OrgTeamNode
  depth: number
  expandedIds: Set<string>
  onToggle: (id: string) => void
  rollupByTeamId: Map<string, OrgTeamRollup>
}) {
  const pl = 16 + depth * 20
  const hasKids = node.children.length > 0
  const open = expandedIds.has(node.team.id)
  const rollup = rollupByTeamId.get(node.team.id)
  const summary = [
    rollup ? `${rollup.memberCount} people` : null,
    rollup ? `${rollup.agentCount} agents` : null,
    rollup && rollup.activeGoalCount > 0 ? `${rollup.activeGoalCount} active goals` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <>
      <div
        className="group flex items-center gap-2.5 border-t border-zinc-800/60 py-2 pr-4 transition first:border-t-0 hover:bg-white/[0.03]"
        style={{ paddingLeft: pl }}
      >
        {hasKids ? (
          <button
            type="button"
            onClick={() => onToggle(node.team.id)}
            className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-zinc-600 transition hover:text-zinc-300"
          >
            {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        ) : (
          <span className="inline-block h-4 w-4 shrink-0" />
        )}
        <HealthDot tone={overviewTeamHealth(rollup)} />
        <Link
          href={`/company/teams/${node.team.id}`}
          className="min-w-0 flex-1 truncate text-sm text-white/85 transition group-hover:text-white"
        >
          {node.team.name}
        </Link>
        {summary ? (
          <span className="shrink-0 truncate text-[0.65rem] text-white/25">{summary}</span>
        ) : null}
      </div>
      {hasKids && open
        ? node.children.map((child) => (
            <ChildTeamTreeRow
              key={child.team.id}
              node={child}
              depth={depth + 1}
              expandedIds={expandedIds}
              onToggle={onToggle}
              rollupByTeamId={rollupByTeamId}
            />
          ))
        : null}
    </>
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
    return <img src={avatarUrl} alt={name} className="h-8 w-8 rounded-full object-cover" />
  }
  if (emoji) {
    return (
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-900 text-sm">
        {emoji}
      </span>
    )
  }
  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-900">
      {isAgent ? (
        <Bot className="h-4 w-4 text-white/40" />
      ) : (
        <UserCircle className="h-4 w-4 text-white/40" />
      )}
    </span>
  )
}

function SectionHeader({
  title,
  summary,
  icon,
  action,
}: {
  title: string
  summary?: string
  icon?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex min-w-0 flex-1 items-center gap-2 text-left">
        {icon}
        <span className="text-[0.65rem] uppercase tracking-[0.2em] text-white/35">{title}</span>
        {summary ? <span className="truncate text-[0.65rem] text-white/25">{summary}</span> : null}
      </div>
      {action}
    </div>
  )
}

function EditableTeamName({
  teamId,
  name,
  onChanged,
}: {
  teamId: string
  name: string
  onChanged?: () => void | Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(name)
  const ref = useRef<HTMLInputElement>(null)

  const updateTeam = trpc.company.updateTeam.useMutation({
    onSuccess: async () => {
      await onChanged?.()
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
      return
    }
    setValue(name)
    setEditing(false)
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="group inline-flex items-center gap-2 text-left"
      >
        <h1 className="text-2xl font-semibold tracking-tight text-white">{name}</h1>
        <Pencil className="h-3.5 w-3.5 text-white/15 opacity-0 transition-opacity group-hover:opacity-100" />
      </button>
    )
  }

  return (
    <input
      ref={ref}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit()
        if (event.key === 'Escape') {
          setValue(name)
          setEditing(false)
        }
      }}
      onBlur={commit}
      className="h-9 border-0 bg-transparent p-0 text-2xl font-semibold tracking-tight text-white outline-none"
    />
  )
}

function EditableCharter({
  teamId,
  charter,
  onChanged,
}: {
  teamId: string
  charter: string | null
  onChanged?: () => void | Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(charter ?? '')
  const ref = useRef<HTMLTextAreaElement>(null)

  const updateTeam = trpc.company.updateTeam.useMutation({
    onSuccess: async () => {
      await onChanged?.()
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
  }, [charter])

  const commit = () => {
    const trimmed = value.trim()
    if (trimmed !== (charter ?? '')) {
      updateTeam.mutate({ id: teamId, charter: trimmed || null })
      return
    }
    setEditing(false)
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="group mt-2 flex max-w-3xl items-start gap-1.5 text-left"
      >
        {charter ? (
          <p className="text-sm leading-relaxed text-white/45">{charter}</p>
        ) : (
          <p className="text-sm text-white/20">Add a charter so the team has a clear mandate...</p>
        )}
        <Pencil className="mt-0.5 h-3 w-3 shrink-0 text-white/15 opacity-0 transition-opacity group-hover:opacity-100" />
      </button>
    )
  }

  return (
    <div className="mt-2 max-w-3xl">
      <textarea
        ref={ref}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) commit()
          if (event.key === 'Escape') {
            setValue(charter ?? '')
            setEditing(false)
          }
        }}
        onBlur={commit}
        rows={3}
        className="w-full resize-none border border-zinc-800 bg-zinc-950/70 px-3 py-2 text-sm leading-relaxed text-white/70 outline-none focus:border-zinc-600 placeholder:text-white/20"
        placeholder="Describe this team’s purpose, what it owns, and what good looks like."
      />
      <div className="mt-1 flex items-center gap-2 text-[0.55rem] text-white/25">
        <span>Cmd+Enter to save</span>
        <span>Esc to cancel</span>
      </div>
    </div>
  )
}

function ParentTeamPicker({
  teamId,
  currentParentId,
  currentParentName,
  forceOpenSignal,
  onChanged,
}: {
  teamId: string
  currentParentId: string | null
  currentParentName: string | null
  forceOpenSignal: number
  onChanged?: () => void | Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const utils = trpc.useUtils()

  useClickOutside(containerRef, open, () => {
    setOpen(false)
    setSearch('')
  })

  useEffect(() => {
    if (forceOpenSignal > 0) {
      setOpen(true)
    }
  }, [forceOpenSignal])

  useEffect(() => {
    if (open) searchRef.current?.focus()
  }, [open])

  const teamsQuery = trpc.org.listTeams.useQuery(undefined, { enabled: open })
  const moveTeam = trpc.company.moveTeam.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.company.getOverview.invalidate(), onChanged?.()])
      setOpen(false)
      setSearch('')
      toast.success('Reporting line updated')
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to move team')
    },
  })

  const candidates = useMemo(() => {
    const teams = teamsQuery.data ?? []
    return teams
      .filter((team) => team.id !== teamId)
      .filter((team) => !search || team.name.toLowerCase().includes(search.toLowerCase()))
  }, [teamsQuery.data, teamId, search])

  return (
    <div ref={containerRef} className="space-y-1">
      <div className="text-[0.6rem] uppercase tracking-[0.15em] text-white/35">Reports to</div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="group inline-flex h-6 items-center gap-1.5 text-left text-sm text-white/70"
      >
        <span>{currentParentName ?? 'Root team'}</span>
        <Pencil className="h-3 w-3 text-white/15 opacity-0 transition-opacity group-hover:opacity-100" />
      </button>
      {open ? (
        <div className="mt-1.5 border border-zinc-800 bg-zinc-950/70 p-1.5">
          <input
            ref={searchRef}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setOpen(false)
                setSearch('')
              }
            }}
            placeholder="Search teams..."
            className="w-full bg-transparent px-1.5 py-1 text-sm text-white outline-none placeholder:text-zinc-600"
          />
          <button
            type="button"
            onClick={() => moveTeam.mutate({ teamId, newParentTeamId: null })}
            className={cn(
              'flex w-full items-center gap-2 px-1.5 py-1.5 text-left text-sm transition',
              currentParentId === null
                ? 'text-white/40'
                : 'text-white/65 hover:bg-white/[0.04] hover:text-white/85'
            )}
          >
            <span className="flex-1">Root team</span>
          </button>
          <div className="max-h-52 overflow-y-auto">
            {candidates.length === 0 ? (
              <div className="px-1.5 py-2 text-xs text-zinc-600">
                {teamsQuery.isLoading ? 'Loading...' : 'No matches'}
              </div>
            ) : null}
            {candidates.map((team) => (
              <button
                key={team.id}
                type="button"
                onClick={() => moveTeam.mutate({ teamId, newParentTeamId: team.id })}
                className={cn(
                  'flex w-full items-center gap-2 px-1.5 py-1.5 text-left text-sm transition',
                  currentParentId === team.id
                    ? 'text-white/40'
                    : 'text-white/65 hover:bg-white/[0.04] hover:text-white/85'
                )}
              >
                <span className="min-w-0 flex-1 truncate">{team.name}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function MemberAssignmentControl({
  teamId,
  currentMemberIds,
  onChanged,
}: {
  teamId: string
  currentMemberIds: string[]
  onChanged?: () => void | Promise<void>
}) {
  const utils = trpc.useUtils()
  const usersQuery = trpc.company.listUsers.useQuery()
  const addMember = trpc.org.addTeamMember.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.company.getOverview.invalidate(), onChanged?.()])
      toast.success('Person added to team')
    },
    onError: () => {
      toast.error('Failed to add person to team')
    },
  })

  const items = useMemo(() => {
    const currentSet = new Set(currentMemberIds)
    return (usersQuery.data ?? [])
      .filter((user) => !currentSet.has(user.id))
      .map((user) => ({
        value: user.id,
        label: user.name,
        hint: user.email ?? undefined,
      }))
  }, [currentMemberIds, usersQuery.data])

  return (
    <InlinePicker
      value={null}
      items={items}
      placeholder="Add person"
      className="px-0 py-0 text-sm text-zinc-500 hover:bg-transparent hover:text-zinc-300"
      onValueChange={(userId) => addMember.mutate({ teamId, userId })}
    />
  )
}

function GoalComposer({
  onCreate,
  pending,
}: {
  onCreate: (input: { title: string; outcome: string }) => Promise<void>
  pending: boolean
}) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [outcome, setOutcome] = useState('')

  if (!open) {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 gap-1.5 text-xs"
        onClick={() => setOpen(true)}
      >
        <Plus className="h-3.5 w-3.5" />
        Goal
      </Button>
    )
  }

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault()
        const trimmedTitle = title.trim()
        const trimmedOutcome = outcome.trim()
        if (!trimmedTitle || !trimmedOutcome) {
          toast.error('Add a title and an outcome')
          return
        }
        await onCreate({ title: trimmedTitle, outcome: trimmedOutcome })
        setTitle('')
        setOutcome('')
        setOpen(false)
      }}
      className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3"
    >
      <div className="space-y-2">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Goal title"
          className="h-9 w-full border border-zinc-800 bg-transparent px-3 text-sm text-white outline-none placeholder:text-zinc-600"
        />
        <input
          value={outcome}
          onChange={(event) => setOutcome(event.target.value)}
          placeholder="Outcome / finish line"
          className="h-9 w-full border border-zinc-800 bg-transparent px-3 text-sm text-white outline-none placeholder:text-zinc-600"
        />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button type="submit" size="sm" className="h-7 text-xs" disabled={pending}>
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Create goal
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          onClick={() => {
            setOpen(false)
            setTitle('')
            setOutcome('')
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}

function TicketComposer({
  agents,
  goals,
  onCreate,
  pending,
}: {
  agents: TeamDetail['agents']
  goals: TeamDetail['goals']
  onCreate: (input: {
    title: string
    body: string | null
    goalId: string | null
    assigneeRef: string
  }) => Promise<void>
  pending: boolean
}) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [goalId, setGoalId] = useState('')
  const [assigneeRef, setAssigneeRef] = useState(agents[0]?.id ?? '')

  useEffect(() => {
    if (!assigneeRef && agents[0]?.id) {
      setAssigneeRef(agents[0].id)
    }
  }, [agents, assigneeRef])

  if (!open) {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 gap-1.5 text-xs"
        onClick={() => setOpen(true)}
        disabled={agents.length === 0}
      >
        <Plus className="h-3.5 w-3.5" />
        Ticket
      </Button>
    )
  }

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault()
        const trimmedTitle = title.trim()
        if (!trimmedTitle || !assigneeRef) {
          toast.error('Add a title and assign the ticket')
          return
        }
        await onCreate({
          title: trimmedTitle,
          body: body.trim() || null,
          goalId: goalId || null,
          assigneeRef,
        })
        setTitle('')
        setBody('')
        setGoalId('')
        setAssigneeRef(agents[0]?.id ?? '')
        setOpen(false)
      }}
      className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3"
    >
      <div className="space-y-2">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Ticket title"
          className="h-9 w-full border border-zinc-800 bg-transparent px-3 text-sm text-white outline-none placeholder:text-zinc-600"
        />
        <Textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={3}
          placeholder="Optional execution note"
          className="min-h-[72px] border-zinc-800 bg-transparent text-sm text-white placeholder:text-zinc-600"
        />
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="space-y-1 text-[0.6rem] uppercase tracking-[0.15em] text-white/35">
            <span>Assign to</span>
            <select
              value={assigneeRef}
              onChange={(event) => setAssigneeRef(event.target.value)}
              className="h-9 w-full border border-zinc-800 bg-zinc-950 px-3 text-sm text-white outline-none"
            >
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-[0.6rem] uppercase tracking-[0.15em] text-white/35">
            <span>Goal</span>
            <select
              value={goalId}
              onChange={(event) => setGoalId(event.target.value)}
              className="h-9 w-full border border-zinc-800 bg-zinc-950 px-3 text-sm text-white outline-none"
            >
              <option value="">No goal</option>
              {goals.map((goal) => (
                <option key={goal.id} value={goal.id}>
                  {goal.title}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button type="submit" size="sm" className="h-7 text-xs" disabled={pending}>
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Create ticket
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          onClick={() => {
            setOpen(false)
            setTitle('')
            setBody('')
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}

function ChildTeamComposer({
  onCreate,
  pending,
}: {
  onCreate: (input: { name: string; charter: string | null }) => Promise<void>
  pending: boolean
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-0 py-0 text-sm text-zinc-500 transition hover:text-zinc-300"
      >
        <Plus className="h-3 w-3" />
        <span>Child team</span>
      </button>
    )
  }

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault()
        const trimmedName = name.trim()
        if (!trimmedName) {
          toast.error('Give the child team a name')
          return
        }
        await onCreate({ name: trimmedName, charter: null })
        setName('')
        setOpen(false)
      }}
      className="flex items-center gap-2"
    >
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="New child team..."
        className="h-8 min-w-[220px] border-0 border-b border-zinc-800 bg-transparent px-0 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-zinc-600"
      />
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" className="h-7 text-xs" disabled={pending}>
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Add
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          onClick={() => {
            setOpen(false)
            setName('')
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}

function TeamUpdateComposer({
  onPost,
  pending,
}: {
  onPost: (body: string) => Promise<void>
  pending: boolean
}) {
  const [body, setBody] = useState('')

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
      <div className="mb-2 text-[0.65rem] uppercase tracking-[0.2em] text-white/35">
        Post update
      </div>
      <Textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={3}
        placeholder="Drop a checkpoint, handoff note, or management update..."
        className="min-h-[88px] border-zinc-800 bg-transparent text-sm text-white placeholder:text-zinc-600"
      />
      <div className="mt-3 flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          className="h-7 text-xs"
          disabled={!body.trim() || pending}
          onClick={async () => {
            const trimmed = body.trim()
            if (!trimmed) return
            await onPost(trimmed)
            setBody('')
          }}
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Post update
        </Button>
        {body ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => setBody('')}
          >
            Clear
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function groupTicketsByStatus(tickets: TeamDetail['tickets']) {
  const groups = new Map<string, typeof tickets>()
  for (const ticket of tickets) {
    const existing = groups.get(ticket.status) ?? []
    existing.push(ticket)
    groups.set(ticket.status, existing)
  }
  const ordered: Array<{ status: string; tickets: typeof tickets }> = []
  for (const status of STATUS_ORDER) {
    const group = groups.get(status)
    if (group && group.length > 0) {
      ordered.push({ status, tickets: group })
    }
  }
  return ordered
}

export function TeamDetailClient({ teamId }: { teamId: string }) {
  const router = useRouter()
  const utils = trpc.useUtils()
  const { data, isLoading, error } = trpc.company.getTeamDetail.useQuery({ teamId })
  const overviewQuery = trpc.company.getOverview.useQuery()
  const [activeTab, setActiveTab] = useState<'overview' | 'portfolio' | 'activity'>('overview')
  const [parentPickerSignal, setParentPickerSignal] = useState(0)
  const [expandedChildTeamIds, setExpandedChildTeamIds] = useState<Set<string>>(new Set())

  const childTeamTree = useMemo(
    () =>
      data && overviewQuery.data ? buildOrgTeamTree(teamId, overviewQuery.data.organization) : [],
    [data, overviewQuery.data, teamId]
  )
  const rollupByTeamId = useMemo(
    () => new Map((overviewQuery.data?.teams ?? []).map((entry) => [entry.id, entry])),
    [overviewQuery.data]
  )

  useEffect(() => {
    if (childTeamTree.length === 0) {
      setExpandedChildTeamIds(new Set())
      return
    }
    setExpandedChildTeamIds(collectExpandableNodeIds(childTeamTree, (node) => node.team.id))
  }, [childTeamTree])

  const refreshTeamDetail = useCallback(async () => {
    await Promise.all([
      utils.company.getTeamDetail.invalidate({ teamId }),
      utils.company.getOverview.invalidate(),
    ])
  }, [teamId, utils.company.getOverview, utils.company.getTeamDetail])

  const updateTicketMutation = trpc.work.updateTicket.useMutation({
    onSuccess: async () => {
      await Promise.all([
        refreshTeamDetail(),
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
      await Promise.all([refreshTeamDetail(), utils.work.listGoals.invalidate()])
    },
    onError: () => {
      toast.error('Failed to update goal')
    },
  })

  const removeMemberMutation = trpc.org.removeTeamMember.useMutation({
    onSuccess: async () => {
      await refreshTeamDetail()
      toast.success('Removed person from team')
    },
    onError: () => {
      toast.error('Failed to remove person from team')
    },
  })

  const removeAgentMutation = trpc.company.removeAgentFromTeam.useMutation({
    onSuccess: async () => {
      await refreshTeamDetail()
      toast.success('Removed agent from team')
    },
    onError: () => {
      toast.error('Failed to remove agent from team')
    },
  })

  const createChildTeamMutation = trpc.company.createTeam.useMutation({
    onSuccess: async () => {
      await refreshTeamDetail()
      toast.success('Child team created')
    },
    onError: () => {
      toast.error('Failed to create child team')
    },
  })

  const createGoalMutation = trpc.work.createGoal.useMutation({
    onSuccess: async () => {
      await Promise.all([refreshTeamDetail(), utils.work.listGoals.invalidate()])
      toast.success('Goal created')
    },
    onError: () => {
      toast.error('Failed to create goal')
    },
  })

  const createTicketMutation = trpc.work.createTicket.useMutation({
    onSuccess: async () => {
      await Promise.all([refreshTeamDetail(), utils.work.listTickets.invalidate()])
      toast.success('Ticket created')
    },
    onError: () => {
      toast.error('Failed to create ticket')
    },
  })

  const createUpdateMutation = trpc.work.postWorkUpdate.useMutation({
    onSuccess: async () => {
      await refreshTeamDetail()
      toast.success('Update posted')
    },
    onError: () => {
      toast.error('Failed to post update')
    },
  })

  const deleteTeamMutation = trpc.company.deleteTeam.useMutation({
    onSuccess: async () => {
      await utils.company.getOverview.invalidate()
      toast.success('Team deleted')
      router.push('/company')
    },
    onError: () => {
      toast.error('Failed to delete team')
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

  const { team, members, agents, childTeams, portfolio, goals, tickets, recentUpdates, spend } =
    data

  const healthTone = teamHealthTone(portfolio)
  const ticketGroups = groupTicketsByStatus(tickets)
  const crewSummary = `${members.length} people · ${agents.length} agents`
  const childTeamsSummary =
    childTeams.length > 0
      ? `${childTeams.length} direct report${childTeams.length === 1 ? '' : 's'}`
      : 'No direct reports'
  const goalsSummary =
    goals.length > 0
      ? `${portfolio.activeGoalCount} active · ${portfolio.blockedGoalCount} blocked`
      : 'No goals yet'
  const ticketsSummary =
    tickets.length > 0
      ? `${tickets.length} assigned · ${portfolio.blockedTicketCount} blocked`
      : 'No assigned tickets'
  const latestActivityAt = recentUpdates[0]?.createdAt ?? team.updatedAt

  return (
    <div className="mx-auto max-w-7xl">
      <nav className="flex items-center gap-1.5 text-xs text-white/40">
        <Link
          href="/company"
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 transition hover:bg-white/5 hover:text-white/75"
        >
          Company
        </Link>
        {team.parentTeamName ? (
          <>
            <ChevronRight className="h-3 w-3" />
            {team.parentTeamId ? (
              <Link
                href={`/company/teams/${team.parentTeamId}`}
                className="rounded-md px-2 py-1 transition hover:bg-white/5 hover:text-white/75"
              >
                {team.parentTeamName}
              </Link>
            ) : (
              <span>{team.parentTeamName}</span>
            )}
          </>
        ) : null}
        <ChevronRight className="h-3 w-3" />
        <span className="text-white/60">{team.name}</span>
      </nav>

      <div className="mt-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <EditableTeamName teamId={teamId} name={team.name} onChanged={refreshTeamDetail} />
          <EditableCharter teamId={teamId} charter={team.charter} onChanged={refreshTeamDetail} />
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Open actions for ${team.name}`}
            className="shrink-0 rounded p-1.5 text-zinc-500 transition hover:bg-white/[0.04] hover:text-white"
          >
            <MoreHorizontal className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={() => setParentPickerSignal((value) => value + 1)}>
              Change parent
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onClick={() => {
                const confirmed = window.confirm(
                  `Delete ${team.name}? Child teams will be reparented and this cannot be undone.`
                )
                if (!confirmed) return
                deleteTeamMutation.mutate({ id: teamId })
              }}
            >
              Delete team
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="mt-5 flex flex-wrap items-start gap-x-6 gap-y-4 border-y border-zinc-800/60 py-4">
        <LeadPicker
          teamId={teamId}
          currentLead={team.lead}
          onChanged={refreshTeamDetail}
          className="min-w-[220px]"
        />
        <ParentTeamPicker
          teamId={teamId}
          currentParentId={team.parentTeamId}
          currentParentName={team.parentTeamName}
          forceOpenSignal={parentPickerSignal}
          onChanged={refreshTeamDetail}
        />
        <div className="space-y-1">
          <div className="text-[0.6rem] uppercase tracking-[0.15em] text-white/35">Health</div>
          <div className="inline-flex h-6 items-center gap-2 text-sm text-white/70">
            <HealthDot tone={healthTone} />
            <span className="capitalize">{healthTone}</span>
          </div>
        </div>
        <div className="space-y-1">
          <div className="text-[0.6rem] uppercase tracking-[0.15em] text-white/35">Crew</div>
          <div className="flex h-6 items-center text-sm text-white/70">{crewSummary}</div>
        </div>
        <div className="space-y-1">
          <div className="text-[0.6rem] uppercase tracking-[0.15em] text-white/35">Updated</div>
          <div className="flex h-6 items-center text-sm text-white/70">
            <RelativeTime timestamp={latestActivityAt} />
          </div>
        </div>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as 'overview' | 'portfolio' | 'activity')}
        className="mt-5"
      >
        <TabsList variant="line" className="gap-0">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="portfolio">Portfolio</TabsTrigger>
          <TabsTrigger value="activity">
            Activity
            {recentUpdates.length > 0 ? (
              <span className="ml-1.5 text-[10px] tabular-nums text-white/30">
                {recentUpdates.length}
              </span>
            ) : null}
          </TabsTrigger>
        </TabsList>

        <div className="mt-5 flex flex-col gap-8 xl:flex-row">
          <div className="min-w-0 flex-1">
            <TabsContent value="overview" className="mt-0 space-y-8">
              <section className="space-y-3">
                <SectionHeader
                  title="Crew"
                  summary={crewSummary}
                  icon={<Users className="h-4 w-4 text-white/30" />}
                  action={
                    <div className="flex items-center gap-2">
                      <MemberAssignmentControl
                        teamId={teamId}
                        currentMemberIds={members.map((member) => member.id)}
                        onChanged={refreshTeamDetail}
                      />
                      <AgentAssignmentControl
                        teamId={teamId}
                        currentAgentIds={agents.map((agent) => agent.id)}
                        onChanged={refreshTeamDetail}
                      />
                    </div>
                  }
                />
                <div className="rounded-lg border border-zinc-800/70">
                  {members.map((member) => {
                    const isLead = team.lead?.kind === 'user' && team.lead.ref === member.id
                    return (
                      <div
                        key={`member-${member.id}`}
                        className="group flex items-center gap-3 border-b border-zinc-800/60 px-4 py-3 last:border-b-0"
                      >
                        <PersonAvatar
                          name={member.name}
                          avatarUrl={member.avatarUrl}
                          isAgent={false}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm text-white/85">{member.name}</span>
                            <span className="text-[0.55rem] uppercase tracking-wide text-white/25">
                              person
                            </span>
                            {isLead ? (
                              <span className="rounded-full border border-white/10 px-1.5 py-0.5 text-[0.55rem] uppercase tracking-wide text-white/40">
                                Lead
                              </span>
                            ) : null}
                          </div>
                          {member.role ? (
                            <div className="text-[0.65rem] text-white/30">{member.role}</div>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            if (isLead) {
                              toast.error('Set a new lead before removing this person.')
                              return
                            }
                            removeMemberMutation.mutate({ teamId, userId: member.id })
                          }}
                          className="rounded p-1 text-white/20 opacity-0 transition group-hover:opacity-100 hover:bg-white/5 hover:text-rose-300"
                          aria-label={`Remove ${member.name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )
                  })}

                  {agents.map((agent) => {
                    const isLead = team.lead?.kind === 'agent' && team.lead.ref === agent.id
                    return (
                      <div
                        key={`agent-${agent.id}`}
                        className="group flex items-center gap-3 border-b border-zinc-800/60 px-4 py-3 last:border-b-0"
                      >
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
                              className="truncate text-sm text-white/85 transition hover:text-white"
                            >
                              {agent.name}
                            </Link>
                            <span className="text-[0.55rem] uppercase tracking-wide text-white/25">
                              agent
                            </span>
                            {isLead ? (
                              <span className="rounded-full border border-white/10 px-1.5 py-0.5 text-[0.55rem] uppercase tracking-wide text-white/40">
                                Lead
                              </span>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.65rem] text-white/30">
                            {agent.title ? <span>{agent.title}</span> : null}
                            <span>{agent.openTicketCount} open</span>
                            {agent.blockedTicketCount > 0 ? (
                              <span className="text-rose-300">
                                {agent.blockedTicketCount} blocked
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            if (isLead) {
                              toast.error('Set a new lead before removing this agent.')
                              return
                            }
                            removeAgentMutation.mutate({ teamId, agentId: agent.id })
                          }}
                          className="rounded p-1 text-white/20 opacity-0 transition group-hover:opacity-100 hover:bg-white/5 hover:text-rose-300"
                          aria-label={`Remove ${agent.name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )
                  })}

                  {members.length === 0 && agents.length === 0 ? (
                    <div className="px-4 py-8 text-center text-sm text-white/25">
                      This team has no people or agents yet.
                    </div>
                  ) : null}
                </div>
              </section>

              <section className="space-y-3">
                <SectionHeader
                  title="Child teams"
                  summary={childTeamsSummary}
                  icon={<Users className="h-4 w-4 text-white/30" />}
                  action={
                    <ChildTeamComposer
                      pending={createChildTeamMutation.isPending}
                      onCreate={async ({ name, charter }) => {
                        await createChildTeamMutation.mutateAsync({
                          name,
                          charter: charter ?? undefined,
                          parentTeamId: teamId,
                        })
                      }}
                    />
                  }
                />
                {childTeamTree.length > 0 ? (
                  <div className="rounded-lg border border-zinc-800/70">
                    {childTeamTree.map((node) => (
                      <ChildTeamTreeRow
                        key={node.team.id}
                        node={node}
                        depth={0}
                        expandedIds={expandedChildTeamIds}
                        onToggle={(id) =>
                          setExpandedChildTeamIds((prev) => {
                            const next = new Set(prev)
                            if (next.has(id)) next.delete(id)
                            else next.add(id)
                            return next
                          })
                        }
                        rollupByTeamId={rollupByTeamId}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-zinc-800/70 px-4 py-8 text-center text-sm text-white/25">
                    No child teams yet.
                  </div>
                )}
              </section>
            </TabsContent>

            <TabsContent value="portfolio" className="mt-0 space-y-8">
              <section className="space-y-3">
                <SectionHeader
                  title="Goals"
                  summary={goalsSummary}
                  icon={<Target className="h-4 w-4 text-white/30" />}
                  action={
                    <div className="flex items-center gap-2">
                      <GoalComposer
                        pending={createGoalMutation.isPending}
                        onCreate={async ({ title, outcome }) => {
                          await createGoalMutation.mutateAsync({
                            title,
                            outcome,
                            teamId,
                          })
                        }}
                      />
                      <Link
                        href={`/goals?teamId=${teamId}`}
                        className="text-[0.65rem] text-white/30 transition hover:text-white/60"
                      >
                        View all
                      </Link>
                    </div>
                  }
                />
                {goals.length > 0 ? (
                  <div className="rounded-lg border border-zinc-800/70">
                    {goals.map((goal) => (
                      <div
                        key={goal.id}
                        className="border-b border-zinc-800/60 px-4 py-3 last:border-b-0"
                      >
                        <div className="flex items-center gap-2.5">
                          <InlineStatusPicker
                            currentStatus={goal.health}
                            statuses={ALL_GOAL_STATUSES}
                            onStatusChange={(status) => handleGoalStatusChange(goal.id, status)}
                            showLabel
                          />
                          <Link
                            href={`/goals/${goal.id}`}
                            className="min-w-0 flex-1 truncate text-sm text-white/85 transition hover:text-white"
                          >
                            {goal.title}
                          </Link>
                          {goal.owner ? (
                            <span className="truncate text-[0.65rem] text-white/30">
                              {goal.owner.label}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1.5 pl-7">
                          <ProgressBar
                            done={goal.ticketCounts.done}
                            total={goal.ticketCounts.total}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-zinc-800/70 px-4 py-8 text-center text-sm text-white/25">
                    No goals owned by this team yet.
                  </div>
                )}
              </section>

              <section className="space-y-3">
                <SectionHeader
                  title="Assigned tickets"
                  summary={ticketsSummary}
                  icon={<Ticket className="h-4 w-4 text-white/30" />}
                  action={
                    <div className="flex items-center gap-2">
                      <TicketComposer
                        agents={agents}
                        goals={goals}
                        pending={createTicketMutation.isPending}
                        onCreate={async ({ title, body, goalId, assigneeRef }) => {
                          await createTicketMutation.mutateAsync({
                            title,
                            body,
                            goalId,
                            assigneeKind: 'agent',
                            assigneeRef,
                            status: 'inbox',
                          })
                        }}
                      />
                      <Link
                        href={`/tickets?team=${teamId}`}
                        className="text-[0.65rem] text-white/30 transition hover:text-white/60"
                      >
                        View all
                      </Link>
                    </div>
                  }
                />
                {ticketGroups.length > 0 ? (
                  <div className="space-y-4">
                    {ticketGroups.map(({ status, tickets: groupedTickets }) => (
                      <div key={status}>
                        <div className="mb-1.5 flex items-center gap-2">
                          <StatusDot status={status} />
                          <span className="text-[0.6rem] font-medium uppercase tracking-[0.15em] text-white/40">
                            {status.replace(/_/g, ' ')}
                          </span>
                          <span className="text-[0.55rem] tabular-nums text-white/25">
                            {groupedTickets.length}
                          </span>
                        </div>
                        <div className="rounded-lg border border-zinc-800/70">
                          {groupedTickets.map((ticket) => (
                            <div
                              key={ticket.id}
                              className="flex items-center gap-3 border-b border-zinc-800/60 px-4 py-2.5 last:border-b-0"
                            >
                              <InlineStatusPicker
                                currentStatus={ticket.status}
                                statuses={ALL_TICKET_STATUSES}
                                onStatusChange={(status) =>
                                  handleTicketStatusChange(ticket.id, status)
                                }
                              />
                              <div className="min-w-0 flex-1">
                                <Link
                                  href={`/tickets/${ticket.id}`}
                                  className="block truncate text-sm text-white/85 transition hover:text-white"
                                >
                                  {ticket.title}
                                </Link>
                                {ticket.goalTitle ? (
                                  <span className="text-[0.6rem] text-white/30">
                                    {ticket.goalTitle}
                                  </span>
                                ) : null}
                              </div>
                              {ticket.assignee ? (
                                <span className="truncate text-[0.6rem] text-white/30">
                                  {ticket.assignee.label}
                                </span>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-zinc-800/70 px-4 py-8 text-center text-sm text-white/25">
                    {agents.length === 0
                      ? 'Assign an agent to this team before creating assigned tickets.'
                      : 'No tickets assigned yet.'}
                  </div>
                )}
              </section>
            </TabsContent>

            <TabsContent value="activity" className="mt-0 space-y-6">
              <TeamUpdateComposer
                pending={createUpdateMutation.isPending}
                onPost={async (body) => {
                  await createUpdateMutation.mutateAsync({ teamId, body, kind: 'note' })
                }}
              />

              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-white/30" />
                  <span className="text-[0.65rem] uppercase tracking-[0.2em] text-white/35">
                    Activity journal
                  </span>
                </div>
                {recentUpdates.length > 0 ? (
                  <div className="space-y-4 rounded-lg border border-zinc-800/70 p-4">
                    {recentUpdates.map((update) => (
                      <div
                        key={update.id}
                        className="space-y-2 border-b border-zinc-800/60 pb-4 last:border-b-0 last:pb-0"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <KindBadge kind={update.kind} />
                          <span className="text-[0.65rem] text-white/25">
                            <RelativeTime timestamp={update.createdAt} />
                          </span>
                          {update.ticketId && update.ticketTitle ? (
                            <Link
                              href={`/tickets/${update.ticketId}`}
                              className="text-[0.65rem] text-white/30 transition hover:text-white/60"
                            >
                              {update.ticketTitle}
                            </Link>
                          ) : null}
                          {update.goalId && update.goalTitle ? (
                            <Link
                              href={`/goals/${update.goalId}`}
                              className="text-[0.65rem] text-white/30 transition hover:text-white/60"
                            >
                              {update.goalTitle}
                            </Link>
                          ) : null}
                        </div>
                        <p className="whitespace-pre-wrap text-sm leading-relaxed text-white/55">
                          {update.body}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-zinc-800/70 px-4 py-10 text-center text-sm text-white/25">
                    No team activity yet. Post the first management update when this team shifts.
                  </div>
                )}
              </section>
            </TabsContent>
          </div>

          <aside className="w-full shrink-0 space-y-4 xl:w-[280px]">
            <div className="rounded-lg border border-zinc-800/70 bg-zinc-950/50 px-4 py-4">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-white/30" />
                <span className="text-[0.65rem] uppercase tracking-[0.2em] text-white/35">
                  Structure
                </span>
              </div>
              <div className="mt-3 space-y-2.5 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-white/35">Reports to</span>
                  {team.parentTeamId && team.parentTeamName ? (
                    <Link
                      href={`/company/teams/${team.parentTeamId}`}
                      className="truncate text-white/70 transition hover:text-white"
                    >
                      {team.parentTeamName}
                    </Link>
                  ) : (
                    <span className="text-white/25">Root team</span>
                  )}
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-white/35">Direct reports</span>
                  <span className="tabular-nums text-white/70">{childTeams.length}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-white/35">Crew</span>
                  <span className="tabular-nums text-white/70">{crewSummary}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-white/35">Lead</span>
                  {team.lead ? (
                    <span className="inline-flex min-w-0 items-center gap-1.5 text-white/70">
                      <AvatarCircle name={team.lead.label} className="h-4 w-4" />
                      <span className="truncate">{team.lead.label}</span>
                    </span>
                  ) : (
                    <span className="text-white/25">Unassigned</span>
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-zinc-800/70 bg-zinc-950/50 px-4 py-4">
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-white/30" />
                <span className="text-[0.65rem] uppercase tracking-[0.2em] text-white/35">
                  Spend
                </span>
              </div>
              <div className="mt-3 space-y-2.5 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-white/35">Last 7 days</span>
                  <span className="tabular-nums text-white/70">{formatUsd(spend.last7d)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-white/35">Last 30 days</span>
                  <span className="tabular-nums text-white/70">{formatUsd(spend.last30d)}</span>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </Tabs>
    </div>
  )
}
