'use client'

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  type ReactFlowInstance,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import { Bot } from 'lucide-react'
import type { RouterOutputs } from '@/lib/trpc'
import { cn } from '@/lib/utils'
import { AvatarCircle } from '../work/shared'

type CompanyOverview = RouterOutputs['company']['getOverview']
type OrgTeamRow = CompanyOverview['organization'][number]
type TeamRow = CompanyOverview['teams'][number]

interface TeamAggregateStats {
  childTeamCount: number
  goalCount: number
  agentCount: number
  staffingGapCount: number
  atRiskCount: number
  blockedCount: number
  health: 'red' | 'amber' | 'green' | 'gray'
}

interface TeamNodeData extends Record<string, unknown> {
  team: OrgTeamRow
  stats: TeamAggregateStats
  agents: TeamRow['agents']
  isSelected: boolean
}

const NODE_WIDTH = 300
const HORIZONTAL_GAP = 72
const VERTICAL_GAP = 132
const ROOT_GAP = 128

function healthTone(health: TeamAggregateStats['health']) {
  if (health === 'red') return 'text-rose-300'
  if (health === 'amber') return 'text-amber-300'
  if (health === 'green') return 'text-emerald-300'
  return 'text-white/28'
}

function healthCopy(health: TeamAggregateStats['health']) {
  if (health === 'red') return 'Blocked'
  if (health === 'amber') return 'At risk'
  if (health === 'green') return 'Healthy'
  return 'No active goals'
}

function OrgChartCardBody({
  team,
  stats,
  agents,
  isSelected,
}: {
  team: OrgTeamRow
  stats: TeamAggregateStats
  agents: TeamRow['agents']
  isSelected: boolean
}) {
  const lead = team.lead
  const leadTitle = lead?.kind === 'agent' ? (lead.title ?? null) : null
  const footerAgents =
    lead?.kind === 'agent' ? agents.filter((agent) => agent.id !== lead.ref) : agents
  const visibleAgents = footerAgents.slice(0, 3)
  const extraAgentCount = Math.max(footerAgents.length - visibleAgents.length, 0)

  return (
    <div
      className={cn(
        'flex w-[300px] flex-col rounded-[18px] border p-4 text-left shadow-[0_24px_80px_rgba(0,0,0,0.35)] transition',
        isSelected ? 'border-white/18 bg-white/[0.08]' : 'border-white/8 bg-zinc-950/92'
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'h-2.5 w-2.5 rounded-full',
                stats.health === 'red'
                  ? 'bg-rose-400'
                  : stats.health === 'amber'
                    ? 'bg-amber-400'
                    : stats.health === 'green'
                      ? 'bg-emerald-400'
                      : 'bg-zinc-500'
              )}
            />
            <p className="text-[10px] uppercase tracking-[0.18em] text-white/35">Team</p>
          </div>
          <p className={cn('text-[10px] uppercase tracking-[0.18em]', healthTone(stats.health))}>
            {healthCopy(stats.health)}
          </p>
        </div>
        <h3 className="mt-3 text-[2rem] leading-none font-semibold tracking-[-0.03em] text-white">
          {team.name}
        </h3>
      </div>

      <p className="mt-4 min-h-[3.25rem] text-[12px] leading-6 text-white/45">
        {team.charter ? (
          <span className="line-clamp-3">{team.charter}</span>
        ) : (
          <span className="text-white/22">No charter yet. Pick a lead and define the lane.</span>
        )}
      </p>

      <div className="mt-6 grid grid-cols-3 gap-2.5 text-[10px] text-white/35">
        <div className="rounded-[14px] border border-white/8 bg-white/[0.03] px-3 py-2.5">
          <p className="uppercase tracking-[0.18em]">Goals</p>
          <p className="mt-2 text-[2rem] leading-none font-semibold tracking-[-0.03em] text-white">
            {stats.goalCount}
          </p>
        </div>
        <div className="rounded-[14px] border border-white/8 bg-white/[0.03] px-3 py-2.5">
          <p className="uppercase tracking-[0.18em]">Agents</p>
          <p className="mt-2 text-[2rem] leading-none font-semibold tracking-[-0.03em] text-white">
            {stats.agentCount}
          </p>
        </div>
        <div className="rounded-[14px] border border-white/8 bg-white/[0.03] px-3 py-2.5">
          <p className="uppercase tracking-[0.18em]">Risk</p>
          <p
            className={cn(
              'mt-2 text-[2rem] leading-none font-semibold tracking-[-0.03em]',
              stats.blockedCount > 0
                ? 'text-rose-400'
                : stats.atRiskCount > 0
                  ? 'text-amber-400'
                  : 'text-white'
            )}
          >
            {stats.blockedCount + stats.atRiskCount}
          </p>
        </div>
      </div>

      <div className="mt-5 min-w-0">
        <p className="text-[10px] uppercase tracking-[0.18em] text-white/28">Lead</p>
        {lead ? (
          <div className="mt-1.5 flex min-w-0 items-center gap-2.5">
            {lead.emoji ? (
              <span className="text-base">{lead.emoji}</span>
            ) : lead.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={lead.avatarUrl} alt="" className="h-6 w-6 rounded-full" />
            ) : (
              <AvatarCircle name={lead.label} />
            )}
            <div className="min-w-0">
              <p className="truncate text-[15px] leading-5 font-medium text-white/85">
                {lead.label}
              </p>
              {leadTitle ? <p className="truncate text-[12px] text-white/35">{leadTitle}</p> : null}
            </div>
          </div>
        ) : (
          <p className="mt-2 text-[14px] text-white/24">Unassigned</p>
        )}
      </div>

      <div className="relative mt-4 min-h-7">
        {visibleAgents.length > 0 ? (
          <div className="flex items-center gap-1.5 overflow-hidden pr-18">
            {visibleAgents.map((agent) => (
              <span
                key={agent.id}
                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/8 bg-white/[0.03] px-2 py-1 text-[11px] text-white/48"
              >
                {agent.emoji ? (
                  <span>{agent.emoji}</span>
                ) : (
                  <Bot className="h-3 w-3 text-white/30" />
                )}
                <span className="max-w-[84px] truncate">{agent.name}</span>
              </span>
            ))}
          </div>
        ) : (
          <span className="text-[11px] text-white/22">No assigned agents</span>
        )}

        {extraAgentCount > 0 ? (
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pl-8">
            <div
              className={cn(
                'absolute inset-y-0 right-0 w-32 bg-gradient-to-r from-transparent',
                isSelected
                  ? 'via-[rgba(43,43,48,0.96)] to-[rgba(43,43,48,1)]'
                  : 'via-zinc-950/96 to-zinc-950'
              )}
            />
            <span
              className={cn(
                'relative inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium shadow-[0_8px_24px_rgba(0,0,0,0.26)]',
                isSelected
                  ? 'border-white/10 bg-[rgba(50,50,56,0.92)] text-white/72'
                  : 'border-white/8 bg-zinc-900/88 text-white/68'
              )}
            >
              +{extraAgentCount} more
            </span>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function OrgChartMeasureCard({
  teamId,
  children,
  onMeasure,
}: {
  teamId: string
  children: React.ReactNode
  onMeasure: (teamId: string, height: number) => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const node = ref.current
    if (!node) return

    const report = () => {
      const nextHeight = Math.ceil(node.getBoundingClientRect().height)
      if (nextHeight > 0) onMeasure(teamId, nextHeight)
    }

    report()

    const observer = new ResizeObserver(report)
    observer.observe(node)
    return () => observer.disconnect()
  }, [onMeasure, teamId])

  return (
    <div ref={ref} className="w-[300px]">
      {children}
    </div>
  )
}

function OrgChartTeamNode({ data }: NodeProps<Node<TeamNodeData, 'team'>>) {
  return (
    <div className="relative">
      <Handle
        type="target"
        position={Position.Top}
        className="!h-2.5 !w-2.5 !border-2 !border-zinc-950 !bg-zinc-700 !opacity-100"
      />

      <OrgChartCardBody
        team={data.team}
        stats={data.stats}
        agents={data.agents}
        isSelected={data.isSelected}
      />

      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-2.5 !w-2.5 !border-2 !border-zinc-950 !bg-zinc-700 !opacity-100"
      />
    </div>
  )
}

const teamNodeTypes = {
  team: memo(OrgChartTeamNode),
}

function FitViewOnLayout({ nodeCount, edgeCount }: { nodeCount: number; edgeCount: number }) {
  const { fitView } = useReactFlow()

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void fitView({
        duration: 250,
        maxZoom: 1.15,
        minZoom: 0.45,
        padding: 0.16,
      })
    })

    return () => cancelAnimationFrame(frame)
  }, [edgeCount, fitView, nodeCount])

  return null
}

function OrgChartCanvasInteractions() {
  const { fitBounds, fitView, getZoom, screenToFlowPosition, setCenter, zoomIn, zoomOut } =
    useReactFlow()
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const [zoomKeyPressed, setZoomKeyPressed] = useState(false)
  const [altPressed, setAltPressed] = useState(false)
  const [dragRect, setDragRect] = useState<{
    startClientX: number
    startClientY: number
    currentClientX: number
    currentClientY: number
    startX: number
    startY: number
    currentX: number
    currentY: number
    altKey: boolean
  } | null>(null)

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      const node = target as HTMLElement | null
      if (!node) return false
      return Boolean(node.closest('input, textarea, [contenteditable="true"]'))
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return

      if (event.code === 'KeyZ') {
        setZoomKeyPressed(true)
        setAltPressed(event.altKey)
        return
      }

      if (event.code === 'AltLeft' || event.code === 'AltRight') {
        setAltPressed(true)
        return
      }

      if (event.key === '+' || event.key === '=') {
        event.preventDefault()
        void zoomIn({ duration: 160 })
        return
      }

      if (event.key === '-' || event.key === '_') {
        event.preventDefault()
        void zoomOut({ duration: 160 })
        return
      }

      if (event.key === '0' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        void fitView({
          duration: 220,
          maxZoom: 1.15,
          minZoom: 0.45,
          padding: 0.16,
        })
      }
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'KeyZ') {
        setZoomKeyPressed(false)
        setDragRect(null)
        return
      }

      if (event.code === 'AltLeft' || event.code === 'AltRight') {
        setAltPressed(false)
      }
    }

    const handleBlur = () => {
      setDragRect(null)
      setZoomKeyPressed(false)
      setAltPressed(false)
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleBlur)
    }
  }, [fitView, zoomIn, zoomOut])

  useEffect(() => {
    if (!dragRect) return

    const handleMouseMove = (event: MouseEvent) => {
      const bounds = overlayRef.current?.getBoundingClientRect()
      setDragRect((current) =>
        current
          ? {
              ...current,
              currentClientX: event.clientX,
              currentClientY: event.clientY,
              currentX: bounds ? event.clientX - bounds.left : event.clientX,
              currentY: bounds ? event.clientY - bounds.top : event.clientY,
              altKey: event.altKey,
            }
          : null
      )
    }

    const handleMouseUp = (event: MouseEvent) => {
      setDragRect((current) => {
        if (!current) return null

        const width = Math.abs(event.clientX - current.startClientX)
        const height = Math.abs(event.clientY - current.startClientY)

        if (width < 8 || height < 8) {
          const center = screenToFlowPosition({ x: event.clientX, y: event.clientY })
          const currentZoom = getZoom()
          const nextZoom = current.altKey
            ? Math.max(0.35, currentZoom / 1.25)
            : Math.min(1.4, currentZoom * 1.25)
          void setCenter(center.x, center.y, { duration: 180, zoom: nextZoom })
          return null
        }

        const start = screenToFlowPosition({ x: current.startClientX, y: current.startClientY })
        const end = screenToFlowPosition({ x: event.clientX, y: event.clientY })
        void fitBounds(
          {
            x: Math.min(start.x, end.x),
            y: Math.min(start.y, end.y),
            width: Math.abs(end.x - start.x),
            height: Math.abs(end.y - start.y),
          },
          {
            duration: 220,
            padding: 0.08,
          }
        )
        return null
      })
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp, { once: true })
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [dragRect, fitBounds, getZoom, screenToFlowPosition, setCenter])

  const selectionBox = dragRect && (
    <div
      className="pointer-events-none absolute border border-white/35 bg-white/[0.06] shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
      style={{
        left: Math.min(dragRect.startX, dragRect.currentX),
        top: Math.min(dragRect.startY, dragRect.currentY),
        width: Math.abs(dragRect.currentX - dragRect.startX),
        height: Math.abs(dragRect.currentY - dragRect.startY),
      }}
    />
  )

  return (
    <div
      ref={overlayRef}
      className={cn(
        'absolute inset-0 z-20',
        zoomKeyPressed
          ? altPressed
            ? 'pointer-events-auto cursor-zoom-out'
            : 'pointer-events-auto cursor-zoom-in'
          : 'pointer-events-none'
      )}
      onMouseDown={(event) => {
        if (!zoomKeyPressed || event.button !== 0) return
        if (
          (event.target as HTMLElement | null)?.closest('.react-flow__controls, .react-flow__panel')
        ) {
          return
        }
        event.preventDefault()
        event.stopPropagation()
        const bounds = event.currentTarget.getBoundingClientRect()
        setDragRect({
          startClientX: event.clientX,
          startClientY: event.clientY,
          currentClientX: event.clientX,
          currentClientY: event.clientY,
          startX: event.clientX - bounds.left,
          startY: event.clientY - bounds.top,
          currentX: event.clientX - bounds.left,
          currentY: event.clientY - bounds.top,
          altKey: event.altKey,
        })
      }}
      onDoubleClick={(event) => {
        if (!zoomKeyPressed) return
        event.preventDefault()
        event.stopPropagation()
        const center = screenToFlowPosition({ x: event.clientX, y: event.clientY })
        void setCenter(center.x, center.y, {
          duration: 180,
          zoom: Math.min(1.4, getZoom() * (event.altKey ? 0.8 : 1.25)),
        })
      }}
    >
      {selectionBox}
    </div>
  )
}

function buildNodePositions(
  rootTeams: OrgTeamRow[],
  childrenByParent: Map<string | null, OrgTeamRow[]>,
  nodeHeights: Map<string, number>,
  depthById: Map<string, number>
) {
  const spanByTeamId = new Map<string, number>()

  function measure(teamId: string): number {
    const cached = spanByTeamId.get(teamId)
    if (cached) return cached

    const children = childrenByParent.get(teamId) ?? []
    if (children.length === 0) {
      spanByTeamId.set(teamId, NODE_WIDTH)
      return NODE_WIDTH
    }

    const childrenSpan =
      children.reduce((sum, child) => sum + measure(child.id), 0) +
      HORIZONTAL_GAP * Math.max(children.length - 1, 0)
    const span = Math.max(NODE_WIDTH, childrenSpan)

    spanByTeamId.set(teamId, span)
    return span
  }

  const rowHeights = new Map<number, number>()
  for (const [teamId, depth] of depthById) {
    const nextHeight = nodeHeights.get(teamId)
    if (!nextHeight) continue
    rowHeights.set(depth, Math.max(rowHeights.get(depth) ?? 0, nextHeight))
  }

  const depths = Array.from(new Set(depthById.values())).sort((a, b) => a - b)
  const rowOffsets = new Map<number, number>()
  let yCursor = 0
  for (const depth of depths) {
    rowOffsets.set(depth, yCursor)
    yCursor += (rowHeights.get(depth) ?? 0) + VERTICAL_GAP
  }

  const positions = new Map<string, { x: number; y: number }>()

  function place(team: OrgTeamRow, depth: number, leftEdge: number) {
    const span = measure(team.id)
    const children = childrenByParent.get(team.id) ?? []
    const x = leftEdge + (span - NODE_WIDTH) / 2
    const y = rowOffsets.get(depth) ?? 0

    positions.set(team.id, { x, y })

    if (children.length === 0) return

    const childrenSpan =
      children.reduce((sum, child) => sum + measure(child.id), 0) +
      HORIZONTAL_GAP * Math.max(children.length - 1, 0)

    let childLeft = leftEdge + (span - childrenSpan) / 2
    for (const child of children) {
      const childSpan = measure(child.id)
      place(child, depth + 1, childLeft)
      childLeft += childSpan + HORIZONTAL_GAP
    }
  }

  let cursor = 0
  for (const root of rootTeams) {
    const span = measure(root.id)
    place(root, 0, cursor)
    cursor += span + ROOT_GAP
  }

  return positions
}

function buildDepthMap(
  rootTeams: OrgTeamRow[],
  childrenByParent: Map<string | null, OrgTeamRow[]>
): Map<string, number> {
  const depthById = new Map<string, number>()

  function visit(team: OrgTeamRow, depth: number) {
    depthById.set(team.id, depth)
    for (const child of childrenByParent.get(team.id) ?? []) {
      visit(child, depth + 1)
    }
  }

  for (const root of rootTeams) {
    visit(root, 0)
  }

  return depthById
}

export function CompanyOrgChart({
  rootTeams,
  organizationById,
  childrenByParent,
  portfolioById,
  statsByTeamId,
  selectedId,
  onSelect,
  onClearSelection,
}: {
  rootTeams: OrgTeamRow[]
  organizationById: Map<string, OrgTeamRow>
  childrenByParent: Map<string | null, OrgTeamRow[]>
  portfolioById: Map<string, TeamRow>
  statsByTeamId: Map<string, TeamAggregateStats>
  selectedId: string | null
  onSelect: (id: string) => void
  onClearSelection: () => void
}) {
  const reactFlowRef = useRef<ReactFlowInstance<Node<TeamNodeData, 'team'>> | null>(null)
  const [nodeHeights, setNodeHeights] = useState<Map<string, number>>(new Map())
  const depthById = useMemo(
    () => buildDepthMap(rootTeams, childrenByParent),
    [childrenByParent, rootTeams]
  )
  const visibleTeamIds = useMemo(() => Array.from(depthById.keys()), [depthById])

  useEffect(() => {
    setNodeHeights((previous) => {
      const next = new Map<string, number>()
      for (const teamId of visibleTeamIds) {
        const height = previous.get(teamId)
        if (height) next.set(teamId, height)
      }
      return next
    })
  }, [visibleTeamIds])

  const handleMeasure = useCallback((teamId: string, height: number) => {
    setNodeHeights((previous) => {
      const current = previous.get(teamId)
      if (current === height) return previous
      const next = new Map(previous)
      next.set(teamId, height)
      return next
    })
  }, [])

  const hasFullMeasurement = visibleTeamIds.every((teamId) => nodeHeights.has(teamId))

  const positions = useMemo(
    () => buildNodePositions(rootTeams, childrenByParent, nodeHeights, depthById),
    [childrenByParent, depthById, nodeHeights, rootTeams]
  )

  const nodes = useMemo<Node<TeamNodeData, 'team'>[]>(
    () =>
      Array.from(positions.entries()).flatMap(([teamId, position]) => {
        const team = organizationById.get(teamId)
        const stats = statsByTeamId.get(teamId)
        if (!team || !stats) return []

        return [
          {
            id: team.id,
            type: 'team',
            position,
            sourcePosition: Position.Bottom,
            targetPosition: Position.Top,
            data: {
              team,
              stats,
              agents: portfolioById.get(team.id)?.agents ?? [],
              isSelected: selectedId === team.id,
            },
          },
        ]
      }),
    [organizationById, portfolioById, positions, selectedId, statsByTeamId]
  )

  const edges = useMemo<Edge[]>(
    () =>
      nodes.flatMap((node) =>
        (childrenByParent.get(node.id) ?? []).map((child) => ({
          id: `${node.id}-${child.id}`,
          source: node.id,
          target: child.id,
          type: 'smoothstep',
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: '#3f3f46',
            width: 18,
            height: 18,
          },
          style: {
            stroke: '#3f3f46',
            strokeWidth: 1.5,
          },
        }))
      ),
    [childrenByParent, nodes]
  )

  const handleNodeDoubleClick = useCallback(
    (_event: ReactMouseEvent, node: Node<TeamNodeData, 'team'>) => {
      onSelect(node.id)
      const position = positions.get(node.id)
      const instance = reactFlowRef.current
      if (!position || !instance) return

      const height = nodeHeights.get(node.id) ?? 320
      void instance.fitBounds(
        {
          x: position.x - 28,
          y: position.y - 28,
          width: NODE_WIDTH + 56,
          height: height + 56,
        },
        {
          duration: 220,
          padding: 0.14,
        }
      )
    },
    [nodeHeights, onSelect, positions]
  )

  if (nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-white/30">
        No teams match this chart view.
      </div>
    )
  }

  return (
    <div className="company-org-chart relative h-full min-h-0">
      <div className="pointer-events-none absolute left-0 top-0 -z-10 opacity-0">
        <div className="flex flex-col gap-6">
          {visibleTeamIds.map((teamId) => {
            const team = organizationById.get(teamId)
            const stats = statsByTeamId.get(teamId)
            if (!team || !stats) return null

            return (
              <OrgChartMeasureCard key={teamId} teamId={teamId} onMeasure={handleMeasure}>
                <OrgChartCardBody
                  team={team}
                  stats={stats}
                  agents={portfolioById.get(teamId)?.agents ?? []}
                  isSelected={selectedId === teamId}
                />
              </OrgChartMeasureCard>
            )
          })}
        </div>
      </div>

      {hasFullMeasurement ? (
        <ReactFlow
          onInit={(instance) => {
            reactFlowRef.current = instance
          }}
          nodes={nodes}
          edges={edges}
          nodeTypes={teamNodeTypes}
          onNodeClick={(_event, node) => onSelect(node.id)}
          onNodeDoubleClick={handleNodeDoubleClick}
          onPaneClick={onClearSelection}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnDrag={false}
          panOnScroll
          panActivationKeyCode="Space"
          zoomOnDoubleClick
          maxZoom={1.4}
          minZoom={0.35}
          colorMode="dark"
          fitView
          fitViewOptions={{ padding: 0.16, maxZoom: 1.15 }}
          proOptions={{ hideAttribution: true }}
          className="bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06),transparent_38%),linear-gradient(180deg,rgba(255,255,255,0.02),rgba(0,0,0,0))]"
        >
          <FitViewOnLayout nodeCount={nodes.length} edgeCount={edges.length} />
          <OrgChartCanvasInteractions />
          <Background gap={24} size={1} color="rgba(255,255,255,0.08)" />
          <Controls position="bottom-right" showInteractive={false} />

          <Panel position="top-right">
            <div className="rounded-full border border-white/10 bg-zinc-950/80 px-3 py-1.5 text-[11px] text-white/42 backdrop-blur">
              {nodes.length} visible team{nodes.length === 1 ? '' : 's'}
            </div>
          </Panel>
        </ReactFlow>
      ) : null}
    </div>
  )
}
