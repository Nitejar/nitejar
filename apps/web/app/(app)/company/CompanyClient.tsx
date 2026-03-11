'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Bot,
  ChevronRight,
  ExternalLink,
  Plus,
  Trash2,
  X,
  Pencil,
  Check,
  User,
} from 'lucide-react'
import { toast } from 'sonner'
import { trpc, type RouterOutputs } from '@/lib/trpc'
import { cn } from '@/lib/utils'
import { ScrollArea } from '@/components/ui/scroll-area'
import { AvatarCircle } from '../work/shared'
import { SkeletonCompanyTree, SkeletonDetailPanel } from '../work/skeletons'
import {
  useTreeSelection,
  useTreeExpand,
  useTreeDragDrop,
  useTreeInlineEdit,
  useTreeKeyboardNav,
  applyOptimisticReorder,
  type DropPosition,
} from '../work/tree-hooks'
import {
  TreeRootDropZone,
  TreeGroupEndDropZone,
  TreeToolbar,
  TreeBreadcrumb,
  TreeRow,
  InlineEditInput,
  TreeDetailLayout,
} from '../work/tree-components'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Close a dropdown when clicking outside its container ref */
function useClickOutside(
  ref: React.RefObject<HTMLElement | null>,
  active: boolean,
  onClose: () => void
) {
  useEffect(() => {
    if (!active) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [ref, active, onClose])
}

type CompanyOverview = RouterOutputs['company']['getOverview']
type OrgTeamRow = CompanyOverview['organization'][number]
type TeamRow = CompanyOverview['teams'][number]

type SelectedItem = string | null // team id or null

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deriveHealth(goals: Array<{ health: string }>): 'red' | 'amber' | 'green' | 'gray' {
  if (goals.length === 0) return 'gray'
  if (goals.some((g) => g.health === 'blocked')) return 'red'
  if (goals.some((g) => g.health === 'at_risk')) return 'amber'
  return 'green'
}

const healthDotColor: Record<string, string> = {
  red: 'bg-rose-400',
  amber: 'bg-amber-400',
  green: 'bg-emerald-400',
  gray: 'bg-zinc-500',
}

function HealthDot({ health, size = 'sm' }: { health: string; size?: 'sm' | 'md' }) {
  const s = size === 'md' ? 'h-2.5 w-2.5' : 'h-2 w-2'
  const color = healthDotColor[health] ?? 'bg-zinc-500'
  return <span className={cn('inline-block shrink-0 rounded-full', s, color)} />
}

function healthLabel(h: 'red' | 'amber' | 'green' | 'gray'): string {
  if (h === 'red') return 'blocked'
  if (h === 'amber') return 'at risk'
  if (h === 'green') return 'healthy'
  return 'no goals'
}

/** Collect all descendant team ids (inclusive) */
function collectDescendantIds(
  id: string,
  childrenByParent: Map<string | null, OrgTeamRow[]>
): Set<string> {
  const result = new Set<string>([id])
  const queue = [id]
  while (queue.length > 0) {
    const current = queue.pop()!
    for (const child of childrenByParent.get(current) ?? []) {
      result.add(child.id)
      queue.push(child.id)
    }
  }
  return result
}

/** Derive health for a team from its portfolio data goals */
function teamHealth(portfolio: TeamRow | undefined): 'red' | 'amber' | 'green' | 'gray' {
  if (!portfolio) return 'gray'
  if (portfolio.blockedGoalCount > 0) return 'red'
  if (portfolio.atRiskGoalCount > 0) return 'amber'
  if (portfolio.activeGoalCount > 0) return 'green'
  return 'gray'
}

/** Aggregate stats for a team and all its descendants */
function aggregateStats(
  teamId: string,
  childrenByParent: Map<string | null, OrgTeamRow[]>,
  portfolioById: Map<string, TeamRow>
): {
  childTeamCount: number
  goalCount: number
  agentCount: number
  staffingGapCount: number
  atRiskCount: number
  blockedCount: number
  health: 'red' | 'amber' | 'green' | 'gray'
} {
  const descendantIds = collectDescendantIds(teamId, childrenByParent)
  descendantIds.delete(teamId) // don't count self in child count

  let goalCount = 0
  let agentCount = 0
  let staffingGapCount = 0
  let atRiskCount = 0
  let blockedCount = 0
  const agentIds = new Set<string>()

  // Include self + descendants
  for (const id of [teamId, ...descendantIds]) {
    const p = portfolioById.get(id)
    if (p) {
      goalCount += p.activeGoalCount
      staffingGapCount += p.goalsNeedingStaffingCount
      atRiskCount += p.atRiskGoalCount
      blockedCount += p.blockedGoalCount
      for (const a of p.agents) agentIds.add(a.id)
    }
  }
  agentCount = agentIds.size

  const goals: Array<{ health: string }> = []
  for (const id of [teamId, ...descendantIds]) {
    const p = portfolioById.get(id)
    if (p) {
      for (const g of p.goals) goals.push(g)
    }
  }

  return {
    childTeamCount: descendantIds.size,
    goalCount,
    agentCount,
    staffingGapCount,
    atRiskCount,
    blockedCount,
    health: deriveHealth(goals),
  }
}

// ---------------------------------------------------------------------------
// Inline input for team creation (not editing — editing uses InlineEditInput)
// ---------------------------------------------------------------------------

function InlineCreateInput({
  placeholder,
  onCommit,
  onCancel,
}: {
  placeholder?: string
  onCommit: (value: string) => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState('')

  useEffect(() => {
    ref.current?.focus()
  }, [])

  const commit = () => {
    const trimmed = value.trim()
    if (trimmed) {
      onCommit(trimmed)
    } else {
      onCancel()
    }
  }

  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') onCancel()
        e.stopPropagation()
      }}
      onBlur={commit}
      placeholder={placeholder}
      className="block h-5 w-full border-0 bg-transparent p-0 text-sm leading-5 text-white outline-none placeholder:text-zinc-600"
    />
  )
}

// ---------------------------------------------------------------------------
// Health summary bar
// ---------------------------------------------------------------------------

function HealthSummaryBar({
  data,
  portfolioById,
  childrenByParent,
}: {
  data: CompanyOverview
  portfolioById: Map<string, TeamRow>
  childrenByParent: Map<string | null, OrgTeamRow[]>
}) {
  const totalTeams = data.organization.length

  const atRiskGoals = data.summary.at_risk_goal_count ?? 0
  const blockedGoals = data.summary.blocked_goal_count ?? 0
  const goalsAtRisk = atRiskGoals + blockedGoals

  // Staffing gaps from root-level teams (aggregated)
  const rootTeams = childrenByParent.get(null) ?? []
  const staffingGaps = rootTeams.reduce((sum, t) => {
    const agg = aggregateStats(t.id, childrenByParent, portfolioById)
    return sum + agg.staffingGapCount
  }, 0)

  const blockedLoad = data.goalsInProgress.filter((g) => g.health === 'blocked').length

  const stats: Array<{ label: string; value: number; tone?: 'red' | 'amber' | 'neutral' }> = [
    { label: 'Teams', value: totalTeams },
    {
      label: 'Goals at risk',
      value: goalsAtRisk,
      tone: goalsAtRisk > 0 ? 'red' : 'neutral',
    },
    {
      label: 'Staffing gaps',
      value: staffingGaps,
      tone: staffingGaps > 0 ? 'amber' : 'neutral',
    },
    { label: 'Blocked goals', value: blockedLoad, tone: blockedLoad > 0 ? 'red' : 'neutral' },
  ]

  return (
    <div className="flex items-center gap-6 border border-zinc-800 px-5 py-3">
      {stats.map((stat) => (
        <div key={stat.label} className="flex items-center gap-2">
          <span className="text-[0.6rem] uppercase tracking-[0.15em] text-white/40">
            {stat.label}
          </span>
          <span
            className={cn(
              'text-sm font-semibold tabular-nums',
              stat.tone === 'red'
                ? 'text-rose-400'
                : stat.tone === 'amber'
                  ? 'text-amber-400'
                  : 'text-white/80'
            )}
          >
            {stat.value}
          </span>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inline create row (click to reveal input)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Org tree row (unified — everything is a team)
// ---------------------------------------------------------------------------

function OrgTreeRow({
  team,
  depth,
  childrenByParent,
  portfolioById,
  expandedIds,
  onToggle,
  selectedId,
  onSelect,
  editingId,
  onStartEdit,
  commitEdit,
  cancelEdit,
  onDelete,
  draggedId,
  dragTargetId,
  dropPosition,
  startDrag,
  endDrag,
  getRowDragHandlers,
  getGroupEndDropHandlers,
}: {
  team: OrgTeamRow
  depth: number
  childrenByParent: Map<string | null, OrgTeamRow[]>
  portfolioById: Map<string, TeamRow>
  expandedIds: Set<string>
  onToggle: (id: string) => void
  selectedId: SelectedItem
  onSelect: (item: string) => void
  editingId: string | null
  onStartEdit: (id: string) => void
  commitEdit: (id: string, value: string) => void
  cancelEdit: () => void
  onDelete: (id: string, name: string) => void
  draggedId: string | null
  dragTargetId: string | null
  dropPosition: DropPosition
  startDrag: (id: string, event: React.DragEvent) => void
  endDrag: () => void
  getRowDragHandlers: (rowId: string) => {
    onDragOver: (event: React.DragEvent) => void
    onDragEnter: (event: React.DragEvent) => void
    onDragLeave: () => void
    onDrop: (event: React.DragEvent) => void
  } | undefined
  getGroupEndDropHandlers: (parentRowId: string) => {
    onDragOver: (event: React.DragEvent) => void
    onDragEnter: (event: React.DragEvent) => void
    onDragLeave: () => void
    onDrop: (event: React.DragEvent) => void
  } | undefined
}) {
  const childTeams = childrenByParent.get(team.id) ?? []
  const hasChildren = childTeams.length > 0
  const isExpanded = expandedIds.has(team.id)
  const isEditing = editingId === team.id

  const stats = useMemo(
    () => aggregateStats(team.id, childrenByParent, portfolioById),
    [team.id, childrenByParent, portfolioById]
  )

  // Compact metrics string
  const metrics: string[] = []
  if (stats.childTeamCount > 0)
    metrics.push(`${stats.childTeamCount} team${stats.childTeamCount !== 1 ? 's' : ''}`)
  if (stats.goalCount > 0)
    metrics.push(`${stats.goalCount} goal${stats.goalCount !== 1 ? 's' : ''}`)

  return (
    <>
      <TreeRow
        id={team.id}
        depth={depth}
        isSelected={selectedId === team.id}
        isExpanded={isExpanded}
        hasChildren={hasChildren}
        isDragging={draggedId === team.id}
        isDragTarget={dragTargetId === team.id}
        dropPosition={dragTargetId === team.id ? dropPosition : null}
        isEditing={isEditing}
        onToggle={() => onToggle(team.id)}
        onSelect={() => onSelect(team.id)}
        onDoubleClick={() => onStartEdit(team.id)}
        onDragStart={(e) => startDrag(team.id, e)}
        onDragEnd={endDrag}
        dragHandlers={getRowDragHandlers(team.id)}
      >
        <HealthDot health={stats.health} />

        {isEditing ? (
          <InlineEditInput
            id={team.id}
            defaultValue={team.name}
            onCommit={commitEdit}
            onCancel={cancelEdit}
            className={cn(
              'min-w-0 flex-1',
              depth === 0 ? 'font-semibold' : 'font-medium'
            )}
          />
        ) : (
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-sm',
              depth === 0 ? 'font-semibold text-zinc-200' : 'font-medium text-zinc-300'
            )}
          >
            {team.name}
          </span>
        )}

        {/* Metrics */}
        {!isEditing && metrics.length > 0 && (
          <span className="shrink-0 text-[10px] text-zinc-600 tabular-nums">
            {metrics.join(' · ')}
          </span>
        )}

        {/* Health label */}
        {!isEditing && stats.health !== 'gray' && stats.health !== 'green' && (
          <span className={cn('shrink-0 text-[10px]', stats.health === 'red' ? 'text-rose-400' : 'text-amber-400')}>
            {healthLabel(stats.health)}
          </span>
        )}

        {/* Lead */}
        {team.lead && !isEditing && <AvatarCircle name={team.lead.label} />}

        {/* Delete */}
        {!isEditing && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onDelete(team.id, team.name)
            }}
            className="inline-flex shrink-0 rounded p-0.5 text-zinc-600 opacity-0 transition-opacity group-hover:opacity-100 hover:text-red-400"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </TreeRow>

      {/* Children */}
      {isExpanded && (
        <>
          {childTeams.map((child) => (
            <OrgTreeRow
              key={child.id}
              team={child}
              depth={depth + 1}
              childrenByParent={childrenByParent}
              portfolioById={portfolioById}
              expandedIds={expandedIds}
              onToggle={onToggle}
              selectedId={selectedId}
              onSelect={onSelect}
              editingId={editingId}
              onStartEdit={onStartEdit}
              commitEdit={commitEdit}
              cancelEdit={cancelEdit}
              onDelete={onDelete}
              draggedId={draggedId}
              dragTargetId={dragTargetId}
              dropPosition={dropPosition}
              startDrag={startDrag}
              endDrag={endDrag}
              getRowDragHandlers={getRowDragHandlers}
              getGroupEndDropHandlers={getGroupEndDropHandlers}
            />
          ))}
          {/* Drop zone after group: "after this parent as sibling" */}
          <TreeGroupEndDropZone
            active={!!draggedId}
            depth={depth}
            handlers={getGroupEndDropHandlers(team.id)}
          />
        </>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Agent assignment combobox
// ---------------------------------------------------------------------------

function AgentAssignmentSection({
  teamId,
  currentAgentIds,
}: {
  teamId: string
  currentAgentIds: string[]
}) {
  const [showPicker, setShowPicker] = useState(false)
  const [search, setSearch] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const utils = trpc.useUtils()

  const closePicker = useCallback(() => {
    setShowPicker(false)
    setSearch('')
  }, [])

  useClickOutside(containerRef, showPicker, closePicker)

  const agentsQuery = trpc.company.listAgents.useQuery(undefined, {
    enabled: showPicker,
  })

  const addAgent = trpc.company.addAgentToTeam.useMutation({
    onSuccess: () => {
      void utils.company.getOverview.invalidate()
      setShowPicker(false)
      setSearch('')
    },
    onError: () => {
      toast.error('Failed to add agent to team')
    },
  })

  useEffect(() => {
    if (showPicker) searchRef.current?.focus()
  }, [showPicker])

  const available = useMemo(() => {
    const all = agentsQuery.data ?? []
    const currentSet = new Set(currentAgentIds)
    return all
      .filter((a) => !currentSet.has(a.id))
      .filter(
        (a) =>
          !search ||
          a.name.toLowerCase().includes(search.toLowerCase()) ||
          a.handle?.toLowerCase().includes(search.toLowerCase())
      )
  }, [agentsQuery.data, currentAgentIds, search])

  return (
    <div ref={containerRef}>
      {!showPicker ? (
        <button
          onClick={() => setShowPicker(true)}
          className="flex items-center gap-1.5 px-2 py-1 text-sm text-zinc-600 hover:text-zinc-400 transition"
        >
          <Plus className="h-3 w-3" />
          <span>Add agent</span>
        </button>
      ) : (
        <div className="mt-1 border border-zinc-800 p-1.5">
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setShowPicker(false)
                setSearch('')
              }
            }}
            placeholder="Search agents..."
            className="w-full bg-transparent px-1.5 py-1 text-sm text-white outline-none placeholder:text-zinc-600"
          />
          <div className="max-h-40 overflow-y-auto">
            {available.length === 0 && (
              <div className="px-1.5 py-2 text-xs text-zinc-600">
                {agentsQuery.isLoading ? 'Loading...' : 'No agents available'}
              </div>
            )}
            {available.map((agent) => (
              <button
                key={agent.id}
                onClick={() => addAgent.mutate({ agentId: agent.id, teamId })}
                className="flex w-full items-center gap-2 px-1.5 py-1.5 text-left text-sm text-white/65 hover:bg-white/[0.04] hover:text-white/85 transition"
              >
                {agent.emoji ? (
                  <span className="text-xs">{agent.emoji}</span>
                ) : (
                  <Bot className="h-3 w-3 text-white/30" />
                )}
                <span className="truncate">{agent.name}</span>
                {agent.handle && (
                  <span className="text-[0.55rem] text-white/30">@{agent.handle}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Editable charter (click to edit, textarea)
// ---------------------------------------------------------------------------

function EditableCharter({ teamId, charter }: { teamId: string; charter: string | null }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(charter ?? '')
  const ref = useRef<HTMLTextAreaElement>(null)
  const utils = trpc.useUtils()

  const updateTeam = trpc.company.updateTeam.useMutation({
    onSuccess: () => {
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

  // Reset value when selection changes
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
        className="group mt-1 flex w-full items-start gap-1.5 text-left"
      >
        {charter ? (
          <p className="text-xs leading-relaxed text-white/30">{charter}</p>
        ) : (
          <p className="text-xs text-white/20">Add charter...</p>
        )}
        <Pencil className="mt-0.5 h-3 w-3 shrink-0 text-white/15 opacity-0 transition-opacity group-hover:opacity-100" />
      </button>
    )
  }

  return (
    <div className="mt-1">
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
        className="w-full resize-none border border-zinc-700 bg-transparent px-2 py-1.5 text-xs leading-relaxed text-white/60 outline-none focus:border-zinc-500 placeholder:text-white/20"
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
// Lead picker (click current lead to change)
// ---------------------------------------------------------------------------

function LeadPicker({
  teamId,
  currentLead,
}: {
  teamId: string
  currentLead: {
    kind: string
    ref: string
    label: string
    emoji?: string | null
    avatarUrl?: string | null
  } | null
}) {
  const [picking, setPicking] = useState(false)
  const [search, setSearch] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const utils = trpc.useUtils()

  const closePicker = useCallback(() => {
    setPicking(false)
    setSearch('')
  }, [])

  useClickOutside(containerRef, picking, closePicker)

  const agentsQuery = trpc.company.listAgents.useQuery(undefined, { enabled: picking })
  const usersQuery = trpc.company.listUsers.useQuery(undefined, { enabled: picking })

  const setLead = trpc.company.setTeamLead.useMutation({
    onSuccess: () => {
      void utils.company.getOverview.invalidate()
      setPicking(false)
      setSearch('')
    },
    onError: () => {
      toast.error('Failed to set team lead')
    },
  })

  useEffect(() => {
    if (picking) searchRef.current?.focus()
  }, [picking])

  const candidates = useMemo(() => {
    const items: Array<{
      kind: 'agent' | 'user'
      ref: string
      label: string
      emoji?: string | null
      avatarUrl?: string | null
    }> = []
    for (const agent of agentsQuery.data ?? []) {
      items.push({ kind: 'agent', ref: agent.id, label: agent.name, emoji: agent.emoji })
    }
    for (const user of usersQuery.data ?? []) {
      items.push({ kind: 'user', ref: user.id, label: user.name, avatarUrl: user.avatarUrl })
    }
    if (!search) return items
    const q = search.toLowerCase()
    return items.filter((i) => i.label.toLowerCase().includes(q))
  }, [agentsQuery.data, usersQuery.data, search])

  const leadDisplay = currentLead ? (
    <div className="flex items-center gap-1.5 text-sm text-white/70">
      {currentLead.emoji ? (
        <span>{currentLead.emoji}</span>
      ) : currentLead.avatarUrl ? (
        <img src={currentLead.avatarUrl} alt="" className="h-4 w-4 rounded-full" />
      ) : (
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/10 text-[0.55rem] text-white/50">
          {currentLead.label.charAt(0)}
        </span>
      )}
      <span>{currentLead.label}</span>
      {currentLead.kind === 'agent' && <Bot className="h-3 w-3 text-white/25" />}
      {currentLead.kind === 'user' && <User className="h-3 w-3 text-white/25" />}
    </div>
  ) : (
    <span className="text-sm text-white/20">Set lead...</span>
  )

  return (
    <div ref={containerRef} className="mt-2">
      <div className="flex items-center gap-2">
        <div className="text-[0.6rem] uppercase tracking-[0.15em] text-white/35">Lead</div>
        <button onClick={() => setPicking(!picking)} className="group flex items-center gap-1.5">
          {leadDisplay}
          <Pencil className="h-3 w-3 shrink-0 text-white/15 opacity-0 transition-opacity group-hover:opacity-100" />
        </button>
      </div>

      {picking && (
        <div className="mt-1.5 border border-zinc-800 p-1.5">
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setPicking(false)
                setSearch('')
              }
            }}
            placeholder="Search agents & users..."
            className="w-full bg-transparent px-1.5 py-1 text-sm text-white outline-none placeholder:text-zinc-600"
          />
          <div className="max-h-48 overflow-y-auto">
            {candidates.length === 0 && (
              <div className="px-1.5 py-2 text-xs text-zinc-600">
                {agentsQuery.isLoading || usersQuery.isLoading ? 'Loading...' : 'No matches'}
              </div>
            )}
            {candidates.map((candidate) => {
              const isCurrentLead =
                currentLead?.kind === candidate.kind && currentLead?.ref === candidate.ref
              return (
                <button
                  key={`${candidate.kind}-${candidate.ref}`}
                  onClick={() => {
                    if (isCurrentLead) return
                    setLead.mutate({ teamId, leadKind: candidate.kind, leadRef: candidate.ref })
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 px-1.5 py-1.5 text-left text-sm transition',
                    isCurrentLead
                      ? 'text-white/40'
                      : 'text-white/65 hover:bg-white/[0.04] hover:text-white/85'
                  )}
                >
                  {candidate.emoji ? (
                    <span className="text-xs">{candidate.emoji}</span>
                  ) : candidate.avatarUrl ? (
                    <img src={candidate.avatarUrl} alt="" className="h-4 w-4 rounded-full" />
                  ) : candidate.kind === 'agent' ? (
                    <Bot className="h-3 w-3 text-white/30" />
                  ) : (
                    <User className="h-3 w-3 text-white/30" />
                  )}
                  <span className="flex-1 truncate">{candidate.label}</span>
                  <span className="text-[0.55rem] text-white/25">
                    {candidate.kind === 'agent' ? 'Agent' : 'User'}
                  </span>
                  {isCurrentLead && <Check className="h-3 w-3 text-white/30" />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Detail panel
// ---------------------------------------------------------------------------

function DetailPanel({
  selected,
  portfolioById,
  organizationById,
  childrenByParent,
  onSelect,
}: {
  selected: SelectedItem
  portfolioById: Map<string, TeamRow>
  organizationById: Map<string, OrgTeamRow>
  childrenByParent: Map<string | null, OrgTeamRow[]>
  onSelect: (item: SelectedItem) => void
}) {
  const utils = trpc.useUtils()

  const removeAgent = trpc.company.removeAgentFromTeam.useMutation({
    onSuccess: () => {
      void utils.company.getOverview.invalidate()
    },
    onError: () => {
      toast.error('Failed to remove agent from team')
    },
  })

  if (!selected) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-white/25">
        Select a team to see details
      </div>
    )
  }

  const teamOrg = organizationById.get(selected)
  if (!teamOrg) return null

  const portfolio = portfolioById.get(selected)
  const childTeams = childrenByParent.get(selected) ?? []
  const stats = aggregateStats(selected, childrenByParent, portfolioById)

  // Health breakdown from portfolio goals
  const activeCount = portfolio
    ? portfolio.activeGoalCount - portfolio.atRiskGoalCount - portfolio.blockedGoalCount
    : 0
  const atRiskCount = portfolio?.atRiskGoalCount ?? 0
  const blockedCount = portfolio?.blockedGoalCount ?? 0

  // Agents from portfolio data
  const agents = portfolio?.agents ?? []

  return (
    <ScrollArea className="h-full">
      <div className="space-y-5 p-4">
        {/* Heading */}
        <div>
          <div className="flex items-center gap-2">
            <HealthDot health={stats.health} size="md" />
            <h2 className="text-base font-semibold text-white">{teamOrg.name}</h2>
          </div>
          <EditableCharter teamId={selected} charter={teamOrg.charter} />
          <LeadPicker teamId={selected} currentLead={teamOrg.lead} />
        </div>

        {/* Key stats */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-[0.6rem] uppercase tracking-[0.15em] text-white/35">Goals</div>
            <div className="mt-0.5 text-lg font-semibold tabular-nums text-white">
              {stats.goalCount}
            </div>
          </div>
          <div>
            <div className="text-[0.6rem] uppercase tracking-[0.15em] text-white/35">
              Child teams
            </div>
            <div className="mt-0.5 text-lg font-semibold tabular-nums text-white">
              {stats.childTeamCount}
            </div>
          </div>
          <div>
            <div className="text-[0.6rem] uppercase tracking-[0.15em] text-white/35">Agents</div>
            <div className="mt-0.5 text-lg font-semibold tabular-nums text-white">
              {stats.agentCount}
            </div>
          </div>
          <div>
            <div className="text-[0.6rem] uppercase tracking-[0.15em] text-white/35">
              Staffing gaps
            </div>
            <div
              className={cn(
                'mt-0.5 text-lg font-semibold tabular-nums',
                stats.staffingGapCount > 0 ? 'text-amber-400' : 'text-white'
              )}
            >
              {stats.staffingGapCount}
            </div>
          </div>
        </div>

        {/* Health breakdown (only if portfolio data exists) */}
        {portfolio && (
          <div>
            <div className="text-[0.6rem] uppercase tracking-[0.15em] text-white/35">Health</div>
            <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs">
              {activeCount > 0 && (
                <span className="flex items-center gap-1 text-emerald-400">
                  <HealthDot health="green" /> {activeCount} active
                </span>
              )}
              {atRiskCount > 0 && (
                <span className="flex items-center gap-1 text-amber-400">
                  <HealthDot health="amber" /> {atRiskCount} at risk
                </span>
              )}
              {blockedCount > 0 && (
                <span className="flex items-center gap-1 text-rose-400">
                  <HealthDot health="red" /> {blockedCount} blocked
                </span>
              )}
              {activeCount === 0 && atRiskCount === 0 && blockedCount === 0 && (
                <span className="text-white/30">No active goals</span>
              )}
            </div>
          </div>
        )}

        {/* View work links */}
        <div className="space-y-1.5">
          <Link
            href={`/goals?teamId=${selected}`}
            className="flex items-center gap-1.5 text-sm text-white/55 hover:text-white/80 transition-colors"
          >
            View goals <ExternalLink className="h-3 w-3" />
          </Link>
          <Link
            href={`/tickets?team=${selected}`}
            className="flex items-center gap-1.5 text-sm text-white/55 hover:text-white/80 transition-colors"
          >
            View tickets <ExternalLink className="h-3 w-3" />
          </Link>
          <Link
            href={`/company/teams/${selected}`}
            className="flex items-center gap-1.5 text-sm text-white/55 hover:text-white/80 transition-colors"
          >
            Full team detail <ExternalLink className="h-3 w-3" />
          </Link>
        </div>

        {/* Child teams */}
        {childTeams.length > 0 && (
          <div>
            <div className="mb-1.5 text-[0.6rem] uppercase tracking-[0.15em] text-white/35">
              Child teams
            </div>
            <div className="space-y-1">
              {childTeams.map((child) => {
                const childHealth = teamHealth(portfolioById.get(child.id))
                return (
                  <button
                    key={child.id}
                    onClick={() => onSelect(child.id)}
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm text-white/65 hover:bg-white/[0.04] hover:text-white/85 transition"
                  >
                    <HealthDot health={childHealth} />
                    <span className="flex-1 truncate">{child.name}</span>
                    <ChevronRight className="h-3 w-3 text-white/20" />
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Agents with remove + add */}
        <div>
          <div className="mb-1.5 text-[0.6rem] uppercase tracking-[0.15em] text-white/35">
            Agents
          </div>
          <div className="space-y-1">
            {agents.map((agent) => (
              <div
                key={agent.id}
                className="group flex items-center gap-2 px-2 py-1.5 text-sm text-white/65 hover:bg-white/[0.04] transition"
              >
                <Link
                  href={`/agents/${agent.id}`}
                  className="flex min-w-0 flex-1 items-center gap-2 transition-colors hover:text-white/85"
                >
                  {agent.emoji ? (
                    <span className="text-xs">{agent.emoji}</span>
                  ) : (
                    <Bot className="h-3 w-3 text-white/30" />
                  )}
                  <span className="truncate">{agent.name}</span>
                  {agent.isPrimary && (
                    <span className="rounded bg-primary/15 px-1 py-px text-[0.5rem] font-medium text-primary">
                      Primary
                    </span>
                  )}
                </Link>
                <button
                  onClick={() => removeAgent.mutate({ agentId: agent.id, teamId: selected })}
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto hover:bg-white/10"
                  title="Remove from team"
                >
                  <X className="h-3 w-3 text-white/30 hover:text-rose-400" />
                </button>
              </div>
            ))}
            {agents.length === 0 && (
              <div className="px-2 py-1 text-xs text-white/25">No agents assigned</div>
            )}
          </div>
          <AgentAssignmentSection teamId={selected} currentAgentIds={agents.map((a) => a.id)} />
        </div>

        {/* Members */}
        {portfolio && portfolio.members.length > 0 && (
          <div>
            <div className="mb-1.5 text-[0.6rem] uppercase tracking-[0.15em] text-white/35">
              Members
            </div>
            <div className="space-y-1">
              {portfolio.members.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center gap-2 px-2 py-1.5 text-sm text-white/65"
                >
                  {member.avatarUrl ? (
                    <img src={member.avatarUrl} alt="" className="h-4 w-4 rounded-full" />
                  ) : (
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-zinc-800 text-[0.5rem] text-white/40">
                      {member.name.charAt(0)}
                    </span>
                  )}
                  <span className="truncate">{member.name}</span>
                  {member.role && (
                    <span className="text-[0.55rem] text-white/30">{member.role}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CompanyClient() {
  const utils = trpc.useUtils()
  const overviewQuery = trpc.company.getOverview.useQuery(undefined, {
    refetchInterval: 15_000,
  })

  // Shared tree hooks
  const { selectedId: selected, setSelectedId: setSelected, clearSelection } = useTreeSelection<string>()
  const { expandedIds: expanded, setExpandedIds: setExpanded, toggle: handleToggle } = useTreeExpand()

  const [search, setSearch] = useState('')
  const [creatingRootTeam, setCreatingRootTeam] = useState(false)

  // Mutations
  const moveTeam = trpc.company.moveTeam.useMutation({
    onMutate: async ({ teamId, newParentTeamId, sortOrder }) => {
      await utils.company.getOverview.cancel()
      const previous = utils.company.getOverview.getData()
      if (previous) {
        utils.company.getOverview.setData(undefined, {
          ...previous,
          organization: applyOptimisticReorder(
            previous.organization,
            teamId,
            newParentTeamId,
            sortOrder ?? null,
            (t) => t.id,
            (t) => t.parentTeamId ?? null,
            (t) => t.sortOrder,
            (t, pid) => ({ ...t, parentTeamId: pid }),
            (t, so) => ({ ...t, sortOrder: so }),
          ),
        })
      }
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) {
        utils.company.getOverview.setData(undefined, ctx.previous)
      }
      toast.error('Failed to move team')
    },
    onSettled: () => {
      void utils.company.getOverview.invalidate()
    },
  })
  const renameMutation = trpc.company.updateTeam.useMutation({
    onSuccess: () => {
      void utils.company.getOverview.invalidate()
    },
    onError: () => {
      toast.error('Failed to rename team')
    },
  })
  const deleteTeamMut = trpc.company.deleteTeam.useMutation({
    onSuccess: () => {
      toast.success('Team deleted')
      void utils.company.getOverview.invalidate()
      setSelected(null)
    },
    onError: () => {
      toast.error('Failed to delete team')
    },
  })
  const createRootTeam = trpc.company.createTeam.useMutation({
    onSuccess: () => {
      void utils.company.getOverview.invalidate()
      setCreatingRootTeam(false)
    },
    onError: () => {
      toast.error('Failed to create team')
    },
  })

  const data = overviewQuery.data
  const organizationData = useMemo(() => data?.organization ?? [], [data?.organization])
  const teamData = useMemo(() => data?.teams ?? [], [data?.teams])

  // Build tree structures
  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, OrgTeamRow[]>()
    for (const team of organizationData) {
      const key = team.parentTeamId ?? null
      const group = map.get(key) ?? []
      group.push(team)
      map.set(key, group)
    }
    return map
  }, [organizationData])

  const organizationById = useMemo(
    () => new Map(organizationData.map((t) => [t.id, t])),
    [organizationData]
  )

  const portfolioById = useMemo(() => new Map(teamData.map((t) => [t.id, t])), [teamData])

  // Build descendant map for drag/drop hook (Map<string, Set<string>>)
  const descendantMap = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const team of organizationData) {
      const descendants = collectDescendantIds(team.id, childrenByParent)
      descendants.delete(team.id) // hook expects descendants only, not self
      map.set(team.id, descendants)
    }
    return map
  }, [organizationData, childrenByParent])

  // Inline editing via shared hook
  const { editingId, startEdit, cancelEdit, commitEdit } = useTreeInlineEdit({
    onCommit: (teamId, name) => {
      renameMutation.mutate({ id: teamId, name })
    },
  })

  // Helpers for positional drag-drop
  const getSiblingOrder = useCallback(
    (parentId: string | null) => {
      return (childrenByParent.get(parentId) ?? []).map((t) => ({
        id: t.id,
        sortOrder: t.sortOrder,
      }))
    },
    [childrenByParent]
  )

  const getParentId = useCallback(
    (teamId: string) => {
      const team = organizationById.get(teamId)
      return team?.parentTeamId ?? null
    },
    [organizationById]
  )

  // Drag/drop via shared hook
  const handleDrop = useCallback(
    (draggedTeamId: string, targetParentId: string | null, sortOrder: number | null) => {
      moveTeam.mutate({
        teamId: draggedTeamId,
        newParentTeamId: targetParentId,
        sortOrder: sortOrder ?? undefined,
      })
    },
    [moveTeam]
  )

  const {
    draggedId: draggingId,
    dragTargetId,
    rootDropOver,
    dropPosition,
    startDrag,
    endDrag,
    getRowDragHandlers,
    getGroupEndDropHandlers,
    getRootDropHandlers,
  } = useTreeDragDrop({
    descendantMap,
    onDrop: handleDrop,
    toastErrorMessage: 'Cannot move team there',
    getSiblingOrder,
    getParentId,
    isExpandedWithChildren: (id: string) => {
      const hasKids = (childrenByParent.get(id)?.length ?? 0) > 0
      return hasKids && expanded.has(id)
    },
  })

  // Search filtering: keep matching teams + their ancestors so the tree stays connected
  const filteredChildrenByParent = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return childrenByParent

    // Find all teams whose name matches
    const matchIds = new Set<string>()
    for (const team of organizationData) {
      if (team.name.toLowerCase().includes(q)) {
        matchIds.add(team.id)
      }
    }

    // Walk ancestors so the tree stays connected
    const visibleIds = new Set<string>(matchIds)
    const byId = new Map(organizationData.map((t) => [t.id, t]))
    for (const id of matchIds) {
      let cur = byId.get(id)
      while (cur?.parentTeamId) {
        if (visibleIds.has(cur.parentTeamId)) break
        visibleIds.add(cur.parentTeamId)
        cur = byId.get(cur.parentTeamId)
      }
    }

    const map = new Map<string | null, OrgTeamRow[]>()
    for (const team of organizationData) {
      if (!visibleIds.has(team.id)) continue
      const key = team.parentTeamId ?? null
      const group = map.get(key) ?? []
      group.push(team)
      map.set(key, group)
    }
    return map
  }, [search, childrenByParent, organizationData])

  // Auto-expand on first load: expand all nodes
  useMemo(() => {
    if (organizationData.length > 0 && expanded.size === 0) {
      setExpanded(new Set(organizationData.map((r) => r.id)))
    }
    // Only run on initial data load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationData.length])

  // Build flat team ID list for keyboard nav (DFS order matching rendered tree)
  const flatTeamIds = useMemo(() => {
    const ids: string[] = []
    function walk(parentId: string | null) {
      const children = filteredChildrenByParent.get(parentId) ?? []
      for (const child of children) {
        ids.push(child.id)
        if (expanded.has(child.id)) {
          walk(child.id)
        }
      }
    }
    walk(null)
    return ids
  }, [filteredChildrenByParent, expanded])

  // Keyboard navigation
  useTreeKeyboardNav({
    flatIds: flatTeamIds,
    selectedId: selected,
    onSelect: setSelected,
    onClear: clearSelection,
    onStartEdit: startEdit,
    onCreate: () => setCreatingRootTeam(true),
  })

  const handleDelete = useCallback(
    (id: string, name: string) => {
      const children = childrenByParent.get(id) ?? []
      const msg =
        children.length > 0
          ? `Delete "${name}"? Its ${children.length} sub-team${children.length !== 1 ? 's' : ''} will move up one level.`
          : `Delete "${name}"?`
      if (!window.confirm(msg)) return
      deleteTeamMut.mutate({ id })
    },
    [deleteTeamMut, childrenByParent]
  )

  // Loading state
  if (overviewQuery.isLoading || !data) {
    return (
      <div className="flex min-h-0 flex-1">
        <div className="flex-1">
          <SkeletonCompanyTree />
        </div>
        <div className="hidden w-[400px] border-l border-zinc-800 lg:block">
          <SkeletonDetailPanel />
        </div>
      </div>
    )
  }

  // Empty state
  if (organizationData.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/nitejar-plain.png"
          alt=""
          className="mb-4 h-14 w-14 opacity-20"
          aria-hidden="true"
        />
        <h3 className="text-lg font-medium text-white/70">No teams yet</h3>
        <p className="mt-2 max-w-md text-sm text-white/40">
          Your fleet works better in formation. Start with the first team.
        </p>
        {creatingRootTeam ? (
          <div className="mt-4 w-64 border border-zinc-800 px-3 py-2">
            <InlineCreateInput
              placeholder="Team name..."
              onCommit={(name) => createRootTeam.mutate({ name })}
              onCancel={() => setCreatingRootTeam(false)}
            />
          </div>
        ) : (
          <button
            onClick={() => setCreatingRootTeam(true)}
            className="mt-4 flex items-center gap-1.5 text-sm text-zinc-500 transition-colors hover:text-white"
          >
            <Plus className="h-3.5 w-3.5" /> New team
          </button>
        )}
      </div>
    )
  }

  const rootTeams = filteredChildrenByParent.get(null) ?? []

  function renderTree() {
    return (
      <div className="pb-32">
        {/* Root drop zone */}
        <TreeRootDropZone
          active={!!draggingId}
          isOver={rootDropOver}
          handlers={getRootDropHandlers()}
        />
        <div className="space-y-0.5 p-2">
          {rootTeams.map((team) => (
            <OrgTreeRow
              key={team.id}
              team={team}
              depth={0}
              childrenByParent={filteredChildrenByParent}
              portfolioById={portfolioById}
              expandedIds={expanded}
              onToggle={handleToggle}
              selectedId={selected}
              onSelect={setSelected}
              editingId={editingId}
              onStartEdit={startEdit}
              commitEdit={commitEdit}
              cancelEdit={cancelEdit}
              onDelete={handleDelete}
              draggedId={draggingId}
              dragTargetId={dragTargetId}
              dropPosition={dropPosition}
              startDrag={startDrag}
              endDrag={endDrag}
              getRowDragHandlers={getRowDragHandlers}
              getGroupEndDropHandlers={getGroupEndDropHandlers}
            />
          ))}

          {/* Root-level "New team..." */}
          {!draggingId && !search && (
            <>
              {creatingRootTeam ? (
                <div
                  className="flex items-center gap-2 px-2 py-1"
                  style={{ paddingLeft: '36px' }}
                >
                  <Plus className="h-3 w-3 text-zinc-600" />
                  <InlineCreateInput
                    placeholder="Team name..."
                    onCommit={(name) => createRootTeam.mutate({ name })}
                    onCancel={() => setCreatingRootTeam(false)}
                  />
                </div>
              ) : (
                <button
                  onClick={() => setCreatingRootTeam(true)}
                  className="flex w-full items-center gap-2 px-2 py-1 text-left text-sm text-zinc-600 transition hover:text-zinc-400"
                  style={{ paddingLeft: '36px' }}
                >
                  <Plus className="h-3 w-3" />
                  <span>New team...</span>
                </button>
              )}
            </>
          )}

          {/* No results for search */}
          {search && rootTeams.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-zinc-500">
              No teams matching &ldquo;{search}&rdquo;
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <TreeToolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search teams..."
        onCreateClick={() => setCreatingRootTeam(true)}
      />

      {/* Breadcrumb context line */}
      <TreeBreadcrumb
        root="Company"
        segments={search ? [{ label: 'Filtered', onClear: () => setSearch('') }] : []}
        trailingContent={
          <span className="tabular-nums text-zinc-600">
            {organizationData.length} team{organizationData.length !== 1 ? 's' : ''}
          </span>
        }
      />

      {/* Health legend + summary bar */}
      <div className="space-y-3 px-4 pt-3">
        <div className="flex items-center gap-3 text-[0.65rem] text-white/35">
          <span className="flex items-center gap-1.5">
            <HealthDot health="green" /> Healthy
          </span>
          <span className="flex items-center gap-1.5">
            <HealthDot health="amber" /> At risk
          </span>
          <span className="flex items-center gap-1.5">
            <HealthDot health="red" /> Blocked
          </span>
          <span className="flex items-center gap-1.5">
            <HealthDot health="gray" /> No goals
          </span>
        </div>

        <HealthSummaryBar
          data={data}
          portfolioById={portfolioById}
          childrenByParent={childrenByParent}
        />
      </div>

      {/* Main content: tree + detail panel */}
      <div className="min-h-0 flex-1">
        <TreeDetailLayout
          tree={renderTree()}
          detail={
            selected ? (
              <DetailPanel
                selected={selected}
                portfolioById={portfolioById}
                organizationById={organizationById}
                childrenByParent={childrenByParent}
                onSelect={setSelected}
              />
            ) : null
          }
          detailWidth="400px"
        />
      </div>
    </div>
  )
}
