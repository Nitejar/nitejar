import { z } from 'zod'
import {
  listAgents,
  getAgentIdsWithActiveJobs,
  getTotalSpend,
  getSpendByAgent,
  getSpendBySourceGlobal,
  listAllCostLimits,
  getAgentSpendInWindow,
  getOrgSpendInWindow,
  getFleetRunCount,
  getFleetAvgDuration,
  getFleetPendingCount,
  getFleetRosterMetrics,
  getFleetSparklineData,
  getFleetActiveOperations,
  getFleetZombieDispatches,
  listPluginInstances,
  listSkillAssignments,
} from '@nitejar/database'
import { protectedProcedure, router } from '../trpc'

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function periodToSinceUnix(period: 'today' | '7d' | '30d' | 'all'): number {
  const ts = now()
  switch (period) {
    case 'today':
      return ts - (ts % 86400) // midnight UTC
    case '7d':
      return ts - 7 * 86400
    case '30d':
      return ts - 30 * 86400
    case 'all':
      return 0
  }
}

function priorPeriodSinceUnix(period: 'today' | '7d' | '30d' | 'all'): {
  start: number
  end: number
} {
  const ts = now()
  switch (period) {
    case 'today': {
      const todayStart = ts - (ts % 86400)
      return { start: todayStart - 86400, end: todayStart }
    }
    case '7d':
      return { start: ts - 14 * 86400, end: ts - 7 * 86400 }
    case '30d':
      return { start: ts - 60 * 86400, end: ts - 30 * 86400 }
    case 'all':
      return { start: 0, end: 0 }
  }
}

export const commandCenterRouter = router({
  getOnboardingStatus: protectedProcedure.query(async () => {
    const [pluginInstances, skillAssignments, costLimits] = await Promise.all([
      listPluginInstances(),
      listSkillAssignments(),
      listAllCostLimits(),
    ])
    return {
      hasPluginInstances: pluginInstances.length > 0,
      hasSkillAssignments: skillAssignments.length > 0,
      hasCostLimits: costLimits.some((l) => l.enabled),
    }
  }),

  getFleetStatus: protectedProcedure
    .input(
      z.object({
        period: z.enum(['today', '7d', '30d', 'all']).default('7d'),
      })
    )
    .query(async ({ input }) => {
      const sinceUnix = periodToSinceUnix(input.period)
      const prior = priorPeriodSinceUnix(input.period)
      const sinceArg = sinceUnix > 0 ? sinceUnix : undefined

      const [agents, activeAgentIds, runsInPeriod, avgDuration, totalCost, pendingItems] =
        await Promise.all([
          listAgents(),
          getAgentIdsWithActiveJobs(),
          getFleetRunCount(sinceArg),
          getFleetAvgDuration(sinceArg),
          getTotalSpend(sinceArg),
          getFleetPendingCount(),
        ])

      const [
        rosterMetrics,
        sparklineData,
        activeOps,
        costByAgentRaw,
        costBySource,
        budgetLimits,
        zombieDispatches,
      ] = await Promise.all([
        getFleetRosterMetrics(sinceArg),
        getFleetSparklineData(),
        getFleetActiveOperations(),
        getSpendByAgent(sinceArg),
        getSpendBySourceGlobal(sinceArg),
        listAllCostLimits(),
        getFleetZombieDispatches(),
      ])

      // Build roster metrics map
      const metricsMap = new Map(rosterMetrics.map((r) => [r.agent_id, r]))

      // Build cost-by-agent map
      const costMap = new Map(costByAgentRaw.map((c) => [c.agent_id, c]))

      // Compute prior-period cost for cost spike detection
      let priorCostMap = new Map<string, number>()
      if (input.period !== 'all') {
        const priorCostByAgent = await getSpendByAgent(prior.start)
        // For prior period, we need costs only within prior window.
        // getSpendByAgent returns cumulative from sinceUnix, so we approximate
        // by getting the cost from prior.start (which includes current period too)
        // and subtracting the current period cost.
        const currentCostByAgent = await getSpendByAgent(sinceArg)
        const currentCostMapLocal = new Map(currentCostByAgent.map((c) => [c.agent_id, c.total]))
        priorCostMap = new Map(
          priorCostByAgent.map((c) => [
            c.agent_id,
            c.total - (currentCostMapLocal.get(c.agent_id) ?? 0),
          ])
        )
      }

      // Enrich costByAgent with agent names
      const agentNameMap = new Map(agents.map((a) => [a.id, a.name]))
      const costByAgent = costByAgentRaw.map((c) => ({
        agentId: c.agent_id,
        agentName: agentNameMap.get(c.agent_id) ?? 'Unknown',
        total: c.total,
        callCount: c.call_count,
      }))

      // Build roster
      const roster = agents.map((agent) => {
        const metrics = metricsMap.get(agent.id)
        const cost = costMap.get(agent.id)
        const isActive = activeAgentIds.has(agent.id)

        return {
          agentId: agent.id,
          name: agent.name,
          handle: agent.handle,
          config: agent.config,
          status: isActive ? ('busy' as const) : ('idle' as const),
          runCount: metrics?.run_count ?? 0,
          completedCount: metrics?.completed_count ?? 0,
          failedCount: metrics?.failed_count ?? 0,
          avgScore: metrics?.avg_score ?? null,
          cost: cost?.total ?? 0,
          lastActiveAt: metrics?.last_active_at ?? null,
        }
      })

      // Build budget alerts
      const budgetAlerts: Array<{
        limitId: string
        scope: string
        agentId: string | null
        agentName: string | null
        period: string
        limitUsd: number
        currentSpend: number
        softPct: number
        hardPct: number
      }> = []

      for (const limit of budgetLimits) {
        if (!limit.enabled) continue
        const periodStart = getPeriodStartForLimit(limit.period)
        let currentSpend = 0
        if (limit.scope === 'agent' && limit.agent_id) {
          currentSpend = await getAgentSpendInWindow(limit.agent_id, periodStart)
        } else if (limit.scope === 'org') {
          currentSpend = await getOrgSpendInWindow(periodStart)
        }
        const softThreshold = (limit.limit_usd * limit.soft_limit_pct) / 100
        if (currentSpend >= softThreshold) {
          budgetAlerts.push({
            limitId: limit.id,
            scope: limit.scope,
            agentId: limit.agent_id ?? null,
            agentName: limit.agent_name ?? null,
            period: limit.period,
            limitUsd: limit.limit_usd,
            currentSpend,
            softPct: limit.soft_limit_pct,
            hardPct: limit.hard_limit_pct,
          })
        }
      }

      // Build needs-attention signals
      const needsAttention: Array<{
        type: string
        severity: 'critical' | 'warning'
        message: string
        agentId?: string
        link: string
      }> = []

      // Budget alerts
      for (const alert of budgetAlerts) {
        const hardThreshold = (alert.limitUsd * alert.hardPct) / 100
        const isExceeded = alert.currentSpend >= hardThreshold
        const target = alert.scope === 'agent' ? (alert.agentName ?? 'Unknown agent') : 'Org-wide'
        needsAttention.push({
          type: isExceeded ? 'budget_exceeded' : 'budget_warning',
          severity: isExceeded ? 'critical' : 'warning',
          message: `${target}: ${isExceeded ? 'budget exceeded' : 'approaching budget limit'} (${alert.period}) — $${alert.currentSpend.toFixed(2)} of $${alert.limitUsd.toFixed(2)}`,
          agentId: alert.agentId ?? undefined,
          link: '/costs',
        })
      }

      // High failure rate (>30% with >=3 runs)
      for (const agent of roster) {
        if (agent.runCount >= 3 && agent.failedCount / agent.runCount > 0.3) {
          const pct = Math.round((agent.failedCount / agent.runCount) * 100)
          needsAttention.push({
            type: 'high_failure_rate',
            severity: 'critical',
            message: `${agent.name}: ${pct}% failure rate (${agent.failedCount}/${agent.runCount} runs)`,
            agentId: agent.agentId,
            link: `/admin/agents/${agent.agentId}`,
          })
        }
      }

      // Long-running dispatches (>10 min)
      const nowTs = now()
      for (const op of activeOps) {
        if (op.status === 'running' && op.started_at) {
          const elapsed = nowTs - op.started_at
          if (elapsed > 600) {
            const mins = Math.floor(elapsed / 60)
            needsAttention.push({
              type: 'long_running',
              severity: 'warning',
              message: `${op.agent_name}: dispatch running for ${mins}m — "${op.title}"`,
              agentId: op.agent_id,
              link: `/admin/work-items`,
            })
          }
        }
      }

      // Cost spikes (>2x prior period)
      if (input.period !== 'all') {
        for (const agent of roster) {
          const currentCost = agent.cost
          const priorCost = priorCostMap.get(agent.agentId) ?? 0
          if (priorCost > 0 && currentCost > priorCost * 2) {
            const multiplier = (currentCost / priorCost).toFixed(1)
            needsAttention.push({
              type: 'cost_spike',
              severity: 'warning',
              message: `${agent.name}: cost up ${multiplier}x vs prior period`,
              agentId: agent.agentId,
              link: `/admin/agents/${agent.agentId}`,
            })
          }
        }
      }

      // Zombie dispatches
      for (const z of zombieDispatches) {
        needsAttention.push({
          type: 'zombie_dispatch',
          severity: 'critical',
          message: `${z.agent_name}: stale dispatch with expired lease — "${z.title}"`,
          agentId: z.agent_id,
          link: `/admin/settings/runtime`,
        })
      }

      // Sort by severity: critical first
      needsAttention.sort((a, b) => {
        if (a.severity === 'critical' && b.severity !== 'critical') return -1
        if (b.severity === 'critical' && a.severity !== 'critical') return 1
        return 0
      })

      return {
        summary: {
          totalAgents: agents.length,
          activeNow: activeAgentIds.size,
          runsInPeriod: runsInPeriod.count,
          avgDurationSeconds: avgDuration.avg_duration ?? null,
          totalCost,
          pendingItems: pendingItems.count,
        },
        roster,
        sparklines: sparklineData.map((s) => ({
          agentId: s.agent_id,
          day: s.day,
          runCount: s.run_count,
        })),
        activeOperations: activeOps.map((op) => ({
          dispatchId: op.dispatch_id,
          agentId: op.agent_id,
          agentName: op.agent_name,
          agentConfig: op.agent_config,
          status: op.status,
          title: op.title,
          source: op.source,
          startedAt: op.started_at,
          createdAt: op.created_at,
        })),
        costByAgent,
        costBySource: costBySource.map((s) => ({
          source: s.source,
          total: s.total,
          callCount: s.call_count,
        })),
        budgetAlerts,
        needsAttention: needsAttention.slice(0, 10),
      }
    }),
})

function getPeriodStartForLimit(period: string): number {
  const ts = now()
  switch (period) {
    case 'hourly':
      return ts - 3600
    case 'daily':
      return ts - 86400
    case 'monthly':
      return ts - 30 * 86400
    default:
      return ts - 86400
  }
}
