import { parseAgentConfig } from '@nitejar/agent/config'
import { getPolicyStatus } from '@nitejar/agent/network-policy'
import {
  getAgentIdsWithActiveJobs,
  getDb,
  getFleetRosterMetrics,
  getPerAgentEvalStats,
  getSpendByAgent,
  listAgentWorkloadRollups,
  listAgents,
} from '@nitejar/database'
import { AgentsTable } from './AgentsTable'

export type AgentStatus = 'idle' | 'busy' | 'offline'

export interface AgentData {
  id: string
  handle: string
  name: string
  status: AgentStatus
  spriteId: string | null
  roleName: string | null
  emoji: string | null
  avatarUrl: string | null
  policyStatus: {
    label: string
    type: 'unrestricted' | 'preset' | 'custom' | 'none'
  }
  primaryTeam: string | null
  teamNames: string[]
  openTicketCount: number
  blockedTicketCount: number
  inProgressTicketCount: number
  recentDoneTicketCount: number
  openGoalCount: number
  ownedGoalCount: number
  runCount: number
  failedCount: number
  lastActiveAt: number | null
  avgEvalScore: number | null
  totalEvals: number
  spend30dUsd: number
  overloaded: boolean
}

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function SummaryCard({
  label,
  value,
  detail,
}: {
  label: string
  value: string | number
  detail?: string
}) {
  return (
    <div className="px-4 py-3">
      <p className="text-[0.6rem] uppercase tracking-[0.25em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
      {detail ? <p className="mt-1 text-xs text-muted-foreground">{detail}</p> : null}
    </div>
  )
}

export async function AgentsClient() {
  const db = getDb()
  const spendSince = now() - 30 * 24 * 60 * 60
  const [
    agents,
    activeAgentIds,
    rosterMetrics,
    spendByAgent,
    evalStats,
    workloadRollups,
    teamRows,
    allTeams,
    roleRows,
  ] = await Promise.all([
    listAgents(),
    getAgentIdsWithActiveJobs(),
    getFleetRosterMetrics(spendSince),
    getSpendByAgent(spendSince),
    getPerAgentEvalStats(),
    listAgentWorkloadRollups(),
    db
      .selectFrom('agent_teams')
      .innerJoin('teams', 'teams.id', 'agent_teams.team_id')
      .select(['agent_teams.agent_id as agent_id', 'teams.name as team_name'])
      .orderBy('teams.name', 'asc')
      .execute(),
    db
      .selectFrom('teams')
      .select(['teams.id', 'teams.name'])
      .orderBy('teams.name', 'asc')
      .execute(),
    db
      .selectFrom('agent_role_assignments')
      .innerJoin('roles', 'roles.id', 'agent_role_assignments.role_id')
      .select(['agent_role_assignments.agent_id as agent_id', 'roles.name as role_name'])
      .execute(),
  ])

  const metricsMap = new Map(rosterMetrics.map((row) => [row.agent_id, row]))
  const spendMap = new Map(spendByAgent.map((row) => [row.agent_id, row]))
  const evalMap = new Map(evalStats.map((row) => [row.agent_id, row]))
  const workloadMap = new Map(workloadRollups.map((row) => [row.agent_id, row]))
  const teamMap = new Map<string, string[]>()
  for (const row of teamRows) {
    const current = teamMap.get(row.agent_id) ?? []
    current.push(row.team_name)
    teamMap.set(row.agent_id, current)
  }

  const roleMap = new Map<string, string>()
  for (const row of roleRows) {
    roleMap.set(row.agent_id, row.role_name)
  }

  const agentData: AgentData[] = agents.map((agent) => {
    const config = parseAgentConfig(agent.config)
    const dbStatus = agent.status as AgentStatus
    const effectiveStatus =
      dbStatus !== 'offline' && activeAgentIds.has(agent.id) ? 'busy' : dbStatus
    const metrics = metricsMap.get(agent.id)
    const spend = spendMap.get(agent.id)
    const evalSummary = evalMap.get(agent.id)
    const workload = workloadMap.get(agent.id)
    const teams = teamMap.get(agent.id) ?? []
    const primaryTeam = teams[0] ?? null
    const overloaded =
      (workload?.open_ticket_count ?? 0) >= 6 ||
      (workload?.blocked_ticket_count ?? 0) >= 2 ||
      (workload?.open_goal_count ?? 0) >= 4

    return {
      id: agent.id,
      handle: agent.handle,
      name: agent.name,
      status: effectiveStatus,
      spriteId: agent.sprite_id,
      roleName: roleMap.get(agent.id) ?? null,
      emoji: config.emoji ?? null,
      avatarUrl: config.avatarUrl ?? null,
      policyStatus: getPolicyStatus(config.networkPolicy),
      primaryTeam,
      teamNames: teams,
      openTicketCount: workload?.open_ticket_count ?? 0,
      blockedTicketCount: workload?.blocked_ticket_count ?? 0,
      inProgressTicketCount: workload?.in_progress_ticket_count ?? 0,
      recentDoneTicketCount: workload?.recent_done_ticket_count ?? 0,
      openGoalCount: workload?.open_goal_count ?? 0,
      ownedGoalCount: workload?.owned_goal_count ?? 0,
      runCount: metrics?.run_count ?? 0,
      failedCount: metrics?.failed_count ?? 0,
      lastActiveAt: metrics?.last_active_at ?? workload?.last_ticket_activity_at ?? null,
      avgEvalScore: evalSummary?.avg_score ?? null,
      totalEvals: evalSummary?.total_evals ?? 0,
      spend30dUsd: spend?.total ?? 0,
      overloaded,
    }
  })

  const busyCount = agentData.filter((agent) => agent.status === 'busy').length
  const overloadedCount = agentData.filter((agent) => agent.overloaded).length
  const activeWorkCount = agentData.reduce((sum, agent) => sum + agent.openTicketCount, 0)
  const spend30dTotal = agentData.reduce((sum, agent) => sum + agent.spend30dUsd, 0)

  return (
    <div className="space-y-6">
      <div className="grid divide-x divide-zinc-800 overflow-hidden border border-zinc-800 lg:grid-cols-4">
        <SummaryCard label="Agents" value={agentData.length} detail="Rostered in this fleet" />
        <SummaryCard label="Busy Now" value={busyCount} detail="Agents with active dispatches" />
        <SummaryCard
          label="Open Work"
          value={activeWorkCount}
          detail="Tickets assigned to agents"
        />
        <SummaryCard
          label="30d Spend"
          value={`$${spend30dTotal.toFixed(2)}`}
          detail={
            overloadedCount > 0
              ? `${overloadedCount} overloaded agents need intervention`
              : 'No overloaded agents right now'
          }
        />
      </div>

      <AgentsTable agents={agentData} teams={allTeams} />
    </div>
  )
}
