'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Bot,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  GitBranch,
  MoreHorizontal,
  Network,
  Plus,
  Pencil,
  Shield,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { trpc, type RouterOutputs } from '@/lib/trpc'
import { cn } from '@/lib/utils'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { AvatarCircle } from '../work/shared'
import { SkeletonCompanyTree, SkeletonDetailPanel } from '../work/skeletons'
import { CompanyOrgChart } from './CompanyOrgChart'
import { RolesView } from './RolesView'
import {
  useTreeSelection,
  useAutoSelectFirst,
  useTreeExpand,
  useTreeDragDrop,
  useTreeInlineEdit,
  useTreeKeyboardNav,
  useIsDesktop,
  applyOptimisticReorder,
  type DropPosition,
} from '../work/tree-hooks'
import {
  TreeRootDropZone,
  TreeGroupEndDropZone,
  TreeToolbar,
  TreeRow,
  InlineEditInput,
  TreeDetailLayout,
} from '../work/tree-components'
import { AgentAssignmentControl, LeadPicker } from './team-management-controls'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  draggedId: string | null
  dragTargetId: string | null
  dropPosition: DropPosition
  startDrag: (id: string, event: React.DragEvent) => void
  endDrag: () => void
  getRowDragHandlers: (rowId: string) =>
    | {
        onDragOver: (event: React.DragEvent) => void
        onDragEnter: (event: React.DragEvent) => void
        onDragLeave: () => void
        onDrop: (event: React.DragEvent) => void
      }
    | undefined
  getGroupEndDropHandlers: (parentRowId: string) =>
    | {
        onDragOver: (event: React.DragEvent) => void
        onDragEnter: (event: React.DragEvent) => void
        onDragLeave: () => void
        onDrop: (event: React.DragEvent) => void
      }
    | undefined
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
        secondaryContent={
          !isEditing ? (
            <>
              {metrics.length > 0 && (
                <span className="text-[10px] text-zinc-600 tabular-nums">
                  {metrics.join(' · ')}
                </span>
              )}
              {stats.health !== 'gray' && stats.health !== 'green' && (
                <span
                  className={cn(
                    'text-[10px]',
                    stats.health === 'red' ? 'text-rose-400' : 'text-amber-400'
                  )}
                >
                  {healthLabel(stats.health)}
                </span>
              )}
              {team.lead && <AvatarCircle name={team.lead.label} />}
            </>
          ) : undefined
        }
      >
        <HealthDot health={stats.health} />

        {isEditing ? (
          <InlineEditInput
            id={team.id}
            defaultValue={team.name}
            onCommit={commitEdit}
            onCancel={cancelEdit}
            className={cn('min-w-0 flex-1', depth === 0 ? 'font-semibold' : 'font-medium')}
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
// Editable charter (inline contentEditable to avoid sidebar layout shift)
// ---------------------------------------------------------------------------

function EditableCharter({ teamId, charter }: { teamId: string; charter: string | null }) {
  const [focused, setFocused] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const saved = useRef(charter ?? '')
  const utils = trpc.useUtils()

  const updateTeam = trpc.company.updateTeam.useMutation({
    onSuccess: () => {
      void utils.company.getOverview.invalidate()
    },
    onError: () => {
      toast.error('Failed to update team charter')
    },
  })

  useEffect(() => {
    const nextValue = charter ?? ''
    if (!ref.current || document.activeElement === ref.current) return
    if (ref.current.innerText !== nextValue) {
      ref.current.textContent = nextValue
    }
    saved.current = nextValue
  }, [charter, teamId])

  useEffect(() => {
    if (ref.current && !ref.current.textContent && charter) {
      ref.current.textContent = charter
    }
  }, [charter])

  const commit = useCallback(async () => {
    const nextValue = ref.current?.innerText.replace(/\r\n/g, '\n').trim() ?? ''
    if (nextValue === saved.current) return
    try {
      await updateTeam.mutateAsync({ id: teamId, charter: nextValue || null })
      saved.current = nextValue
    } catch {
      if (ref.current) {
        ref.current.textContent = saved.current
      }
    }
  }, [teamId, updateTeam])

  return (
    <div className="group relative mt-1">
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-label="Team description"
        aria-multiline="true"
        data-placeholder="Describe this team's purpose, responsibilities, and what success looks like..."
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false)
          void commit()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            ref.current?.blur()
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            if (ref.current) {
              ref.current.textContent = saved.current
            }
            ref.current?.blur()
          }
        }}
        className={cn(
          'min-h-[2.5rem] w-full cursor-text whitespace-pre-wrap text-xs leading-relaxed outline-none transition',
          'empty:before:text-white/20 empty:before:content-[attr(data-placeholder)]',
          focused || updateTeam.isPending ? 'text-white/60' : 'text-white/30'
        )}
      />
      <Pencil
        className={cn(
          'pointer-events-none absolute right-0 top-0 h-3 w-3 text-white/15 transition-opacity',
          focused ? 'opacity-0' : 'opacity-0 group-hover:opacity-100'
        )}
      />
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
  onClose,
  onDelete,
}: {
  selected: SelectedItem
  portfolioById: Map<string, TeamRow>
  organizationById: Map<string, OrgTeamRow>
  childrenByParent: Map<string | null, OrgTeamRow[]>
  onSelect: (item: SelectedItem) => void
  onClose?: () => void
  onDelete: (id: string, name: string) => void
}) {
  const utils = trpc.useUtils()
  const [propertiesOpen, setPropertiesOpen] = useState(true)
  const [portfolioOpen, setPortfolioOpen] = useState(true)
  const [childTeamsOpen, setChildTeamsOpen] = useState(true)
  const [agentsOpen, setAgentsOpen] = useState(true)
  const [membersOpen, setMembersOpen] = useState(true)

  const removeAgent = trpc.company.removeAgentFromTeam.useMutation({
    onSuccess: () => {
      void utils.company.getOverview.invalidate()
    },
    onError: () => {
      toast.error('Failed to remove agent from team')
    },
  })

  useEffect(() => {
    setPropertiesOpen(true)
    setPortfolioOpen(true)
    setChildTeamsOpen(true)
    setAgentsOpen(true)
    setMembersOpen(true)
  }, [selected])

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
  const parentTeam = teamOrg.parentTeamId
    ? (organizationById.get(teamOrg.parentTeamId) ?? null)
    : null
  const stats = aggregateStats(selected, childrenByParent, portfolioById)

  // Health breakdown from portfolio goals
  const atRiskCount = portfolio?.atRiskGoalCount ?? 0
  const blockedCount = portfolio?.blockedGoalCount ?? 0

  // Agents from portfolio data
  const agents = portfolio?.agents ?? []
  const members = portfolio?.members ?? []
  const propertiesSummary = parentTeam
    ? `${healthLabel(stats.health)} · reports to ${parentTeam.name}`
    : `${healthLabel(stats.health)} · root team`
  const portfolioSummary = portfolio
    ? [
        `${portfolio.activeGoalCount} goals`,
        portfolio.queuedTicketCount > 0 ? `${portfolio.queuedTicketCount} tickets` : null,
        blockedCount > 0 ? `${blockedCount} blocked` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : 'No active work'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-zinc-800 px-4">
        <div className="flex items-center gap-2 min-w-0">
          <HealthDot health={stats.health} size="md" />
          <Link
            href={`/company/teams/${selected}`}
            className="truncate text-sm font-semibold text-zinc-100 hover:text-white transition"
          >
            {teamOrg.name}
          </Link>
          <Link
            href={`/company/teams/${selected}`}
            className="shrink-0 rounded p-0.5 text-zinc-600 hover:text-white transition"
          >
            <ChevronRight className="h-3 w-3" />
          </Link>
        </div>
        <div className="flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={`Open actions for ${teamOrg.name}`}
              className="shrink-0 rounded p-1 text-zinc-500 transition hover:bg-white/[0.04] hover:text-white"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem
                variant="destructive"
                onClick={() => onDelete(selected, teamOrg.name)}
              >
                Delete team
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded p-1 text-zinc-500 hover:text-white transition"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-5 p-4">
          <div>
            <EditableCharter teamId={selected} charter={teamOrg.charter} />
            <LeadPicker teamId={selected} currentLead={teamOrg.lead} />
          </div>

          <section>
            <button
              type="button"
              onClick={() => setPropertiesOpen((value) => !value)}
              className="group flex w-full items-center gap-2 text-left"
            >
              <span className="text-[0.65rem] uppercase tracking-[0.2em] text-white/35">
                Properties
              </span>
              <span className="text-xs text-white/25">{propertiesSummary}</span>
              <ChevronDown
                className={cn(
                  'ml-auto h-3 w-3 shrink-0 text-white/25 transition-transform',
                  propertiesOpen && 'rotate-180'
                )}
              />
            </button>
            {propertiesOpen ? (
              <div className="mt-3 grid grid-cols-[84px_1fr] gap-y-2.5 text-sm">
                <span className="text-white/30">Health</span>
                <span className="inline-flex items-center gap-2 text-white/65">
                  <HealthDot health={stats.health} />
                  <span className="capitalize">{healthLabel(stats.health)}</span>
                </span>

                <span className="text-white/30">Reports to</span>
                {parentTeam ? (
                  <button
                    type="button"
                    onClick={() => onSelect(parentTeam.id)}
                    className="inline-flex items-center gap-1.5 text-left text-white/65 transition hover:text-white/85"
                  >
                    <span className="truncate">{parentTeam.name}</span>
                    <ChevronRight className="h-3 w-3 text-white/20" />
                  </button>
                ) : (
                  <span className="text-white/25">Root team</span>
                )}
              </div>
            ) : null}
          </section>

          <section>
            <button
              type="button"
              onClick={() => setPortfolioOpen((value) => !value)}
              className="group flex w-full items-center gap-2 text-left"
            >
              <span className="text-[0.65rem] uppercase tracking-[0.2em] text-white/35">
                Portfolio
              </span>
              <span className="text-xs text-white/25">{portfolioSummary}</span>
              <ChevronDown
                className={cn(
                  'ml-auto h-3 w-3 shrink-0 text-white/25 transition-transform',
                  portfolioOpen && 'rotate-180'
                )}
              />
            </button>
            {portfolioOpen ? (
              <div className="mt-3 space-y-1">
                <Link
                  href={`/goals?teamId=${selected}`}
                  className="group flex items-start justify-between gap-3 rounded-md px-2 py-1.5 transition hover:bg-white/[0.04]"
                >
                  <div className="min-w-0">
                    <div className="text-sm text-white/70 transition group-hover:text-white/90">
                      Goals
                    </div>
                    <div className="text-[0.65rem] text-white/35">
                      {portfolio
                        ? [
                            `${portfolio.activeGoalCount} active`,
                            atRiskCount > 0 ? `${atRiskCount} at risk` : null,
                            blockedCount > 0 ? `${blockedCount} blocked` : null,
                          ]
                            .filter(Boolean)
                            .join(' · ') || 'No active goals'
                        : 'No active goals'}
                    </div>
                  </div>
                  <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-white/20 transition group-hover:text-white/45" />
                </Link>

                <Link
                  href={`/tickets?team=${selected}`}
                  className="group flex items-start justify-between gap-3 rounded-md px-2 py-1.5 transition hover:bg-white/[0.04]"
                >
                  <div className="min-w-0">
                    <div className="text-sm text-white/70 transition group-hover:text-white/90">
                      Tickets
                    </div>
                    <div className="text-[0.65rem] text-white/35">
                      {portfolio
                        ? [
                            `${portfolio.queuedTicketCount} queued`,
                            portfolio.blockedTicketCount > 0
                              ? `${portfolio.blockedTicketCount} blocked`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(' · ') || 'No active tickets'
                        : 'No active tickets'}
                    </div>
                  </div>
                  <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-white/20 transition group-hover:text-white/45" />
                </Link>

                {stats.staffingGapCount > 0 ? (
                  <div className="rounded-md px-2 py-1.5 text-[0.65rem] text-amber-300/85">
                    {stats.staffingGapCount} staffing gap{stats.staffingGapCount === 1 ? '' : 's'}{' '}
                    in the current portfolio
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>

          {childTeams.length > 0 && (
            <section>
              <button
                type="button"
                onClick={() => setChildTeamsOpen((value) => !value)}
                className="group flex w-full items-center gap-2 text-left"
              >
                <span className="text-[0.65rem] uppercase tracking-[0.2em] text-white/35">
                  Child teams
                </span>
                <span className="text-xs text-white/25">{childTeams.length} reporting here</span>
                <ChevronDown
                  className={cn(
                    'ml-auto h-3 w-3 shrink-0 text-white/25 transition-transform',
                    childTeamsOpen && 'rotate-180'
                  )}
                />
              </button>
              {childTeamsOpen ? (
                <div className="mt-3 space-y-1">
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
              ) : null}
            </section>
          )}

          <section>
            <button
              type="button"
              onClick={() => setAgentsOpen((value) => !value)}
              className="group flex w-full items-center gap-2 text-left"
            >
              <span className="text-[0.65rem] uppercase tracking-[0.2em] text-white/35">
                Agents
              </span>
              <span className="text-xs text-white/25">
                {agents.length > 0 ? `${agents.length} assigned` : 'No agents assigned'}
              </span>
              <ChevronDown
                className={cn(
                  'ml-auto h-3 w-3 shrink-0 text-white/25 transition-transform',
                  agentsOpen && 'rotate-180'
                )}
              />
            </button>
            {agentsOpen ? (
              <div className="mt-3 space-y-1">
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
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate">{agent.name}</span>
                        </div>
                        {agent.title ? (
                          <div className="truncate text-[0.6rem] text-white/30">{agent.title}</div>
                        ) : null}
                      </div>
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
                <AgentAssignmentControl
                  teamId={selected}
                  currentAgentIds={agents.map((a) => a.id)}
                />
              </div>
            ) : null}
          </section>

          {portfolio && members.length > 0 && (
            <section>
              <button
                type="button"
                onClick={() => setMembersOpen((value) => !value)}
                className="group flex w-full items-center gap-2 text-left"
              >
                <span className="text-[0.65rem] uppercase tracking-[0.2em] text-white/35">
                  Members
                </span>
                <span className="text-xs text-white/25">{members.length} people</span>
                <ChevronDown
                  className={cn(
                    'ml-auto h-3 w-3 shrink-0 text-white/25 transition-transform',
                    membersOpen && 'rotate-180'
                  )}
                />
              </button>
              {membersOpen ? (
                <div className="mt-3 space-y-1">
                  {members.map((member) => (
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
              ) : null}
            </section>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CompanyClient() {
  const router = useRouter()
  const pathname = usePathname()
  const utils = trpc.useUtils()
  const overviewQuery = trpc.company.getOverview.useQuery(undefined, {
    refetchInterval: 15_000,
  })

  // Shared tree hooks
  const {
    selectedId: selected,
    setSelectedId: setSelected,
    clearSelection,
  } = useTreeSelection<string>()
  const isDesktop = useIsDesktop()

  // On mobile, clicking a row navigates to the detail page instead of opening the side panel
  const handleSelect = useCallback(
    (id: string) => {
      if (isDesktop) {
        setSelected(id)
      } else {
        router.push(`/company/teams/${id}`)
      }
    },
    [isDesktop, setSelected, router]
  )
  const {
    expandedIds: expanded,
    setExpandedIds: setExpanded,
    toggle: handleToggle,
  } = useTreeExpand()

  const [search, setSearch] = useState('')
  const [creatingRootTeam, setCreatingRootTeam] = useState(false)

  const activeViewId = useMemo<'structure' | 'org_chart' | 'roles'>(() => {
    if (pathname === '/company/roles') return 'roles'
    if (pathname === '/company/org-chart') return 'org_chart'
    return 'structure'
  }, [pathname])

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
            (t, so) => ({ ...t, sortOrder: so })
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

  // Build tree structures — sort each group so optimistic sortOrder changes
  // are immediately reflected (backend returns pre-sorted, but optimistic
  // updates only mutate sortOrder values without reordering the array).
  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, OrgTeamRow[]>()
    for (const team of organizationData) {
      const key = team.parentTeamId ?? null
      const group = map.get(key) ?? []
      group.push(team)
      map.set(key, group)
    }
    for (const group of map.values()) {
      group.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    }
    return map
  }, [organizationData])

  const organizationById = useMemo(
    () => new Map(organizationData.map((t) => [t.id, t])),
    [organizationData]
  )

  const portfolioById = useMemo(() => new Map(teamData.map((t) => [t.id, t])), [teamData])
  const statsByTeamId = useMemo(
    () =>
      new Map(
        organizationData.map((team) => [
          team.id,
          aggregateStats(team.id, childrenByParent, portfolioById),
        ])
      ),
    [childrenByParent, organizationData, portfolioById]
  )

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

  useAutoSelectFirst(flatTeamIds[0], selected, setSelected)

  // Keyboard navigation
  useTreeKeyboardNav({
    flatIds: flatTeamIds,
    selectedId: selected,
    onSelect: handleSelect,
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

  // Compute health distribution across root teams
  const healthCounts = useMemo(() => {
    const counts = { green: 0, amber: 0, red: 0, gray: 0 }
    for (const team of organizationData) {
      if (team.parentTeamId) continue // root teams only
      const stats = statsByTeamId.get(team.id)
      if (!stats) continue
      counts[stats.health]++
    }
    return counts
  }, [organizationData, statsByTeamId])

  const totalGoals = useMemo(() => {
    let count = 0
    for (const t of teamData) count += t.activeGoalCount
    return count
  }, [teamData])

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
        {/* Compact health summary */}
        <div className="flex items-center gap-4 border-b border-zinc-800/40 px-4 py-2 text-xs text-zinc-500">
          <span className="tabular-nums">{organizationData.length} teams</span>
          <span className="tabular-nums">{totalGoals} goals</span>
          <span className="mx-1 h-3 w-px bg-zinc-800" />
          {healthCounts.green > 0 && (
            <span className="flex items-center gap-1 tabular-nums">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
              {healthCounts.green}
            </span>
          )}
          {healthCounts.amber > 0 && (
            <span className="flex items-center gap-1 tabular-nums">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
              {healthCounts.amber}
            </span>
          )}
          {healthCounts.red > 0 && (
            <span className="flex items-center gap-1 tabular-nums">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-rose-400" />
              {healthCounts.red}
            </span>
          )}
          {healthCounts.gray > 0 && (
            <span className="flex items-center gap-1 tabular-nums">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-zinc-500" />
              {healthCounts.gray}
            </span>
          )}
        </div>

        {/* Root drop zone */}
        <TreeRootDropZone
          active={!!draggingId}
          isOver={rootDropOver}
          handlers={getRootDropHandlers()}
        />
        <div>
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
              onSelect={handleSelect}
              editingId={editingId}
              onStartEdit={startEdit}
              commitEdit={commitEdit}
              cancelEdit={cancelEdit}
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
                <div className="flex items-center gap-2 px-2 py-1" style={{ paddingLeft: '36px' }}>
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

  function renderOrgChart() {
    return (
      <div className="h-full min-h-0">
        <CompanyOrgChart
          rootTeams={rootTeams}
          organizationById={organizationById}
          childrenByParent={filteredChildrenByParent}
          portfolioById={portfolioById}
          statsByTeamId={statsByTeamId}
          selectedId={selected}
          onSelect={handleSelect}
          onClearSelection={clearSelection}
        />
      </div>
    )
  }

  function renderRoles() {
    return <RolesView search={search} />
  }

  const toolbarHeader = (
    <TreeToolbar
      title="Company"
      views={[
        { id: 'structure', name: 'Structure', icon: GitBranch, href: '/company/structure' },
        { id: 'org_chart', name: 'Org chart', icon: Network, href: '/company/org-chart' },
        { id: 'roles', name: 'Roles', icon: Shield, href: '/company/roles' },
      ]}
      activeViewId={activeViewId}
      viewStyle="pills"
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder={activeViewId === 'roles' ? 'Search roles...' : 'Search teams...'}
      onCreateClick={activeViewId === 'roles' ? undefined : () => setCreatingRootTeam(true)}
    />
  )

  return (
    <div className="flex h-full flex-col">
      <TreeDetailLayout
        header={toolbarHeader}
        tree={
          activeViewId === 'org_chart'
            ? renderOrgChart()
            : activeViewId === 'roles'
              ? renderRoles()
              : renderTree()
        }
        treeScrollable={activeViewId === 'structure'}
        detail={
          activeViewId === 'structure' && selected ? (
            <DetailPanel
              selected={selected}
              portfolioById={portfolioById}
              organizationById={organizationById}
              childrenByParent={childrenByParent}
              onSelect={setSelected}
              onClose={clearSelection}
              onDelete={handleDelete}
            />
          ) : null
        }
      />
    </div>
  )
}
