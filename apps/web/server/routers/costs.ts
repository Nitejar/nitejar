import { z } from 'zod'
import {
  getDb,
  getTotalSpend,
  getSpendByAgent,
  getTopExpensiveJobs,
  getSpendBySource,
  getSpendBySourceGlobal,
  getTopExpensiveJobsForAgent,
  getDailyTrend,
  listCostLimitsForAgent,
  listCostLimitsForTeam,
  listCostLimitsForOrg,
  listAllCostLimits,
  createCostLimit,
  updateCostLimit,
  deleteCostLimit,
} from '@nitejar/database'
import { protectedProcedure, router } from '../trpc'

function formatSourceLabel(source: string): string {
  if (source.startsWith('api:')) {
    return `API: ${source.slice(4)}`
  }
  return source
}

export const costsRouter = router({
  getSummary: protectedProcedure.query(async () => {
    const now = Math.floor(Date.now() / 1000)
    const todayStart = now - (now % 86400)
    const weekStart = now - ((new Date().getUTCDay() + 6) % 7) * 86400 - (now % 86400)
    const monthStart = now - (new Date().getUTCDate() - 1) * 86400 - (now % 86400)

    const [totalSpend, spendToday, spendThisWeek, spendThisMonth, byAgentRaw, topJobs] =
      await Promise.all([
        getTotalSpend(),
        getTotalSpend(todayStart),
        getTotalSpend(weekStart),
        getTotalSpend(monthStart),
        getSpendByAgent(),
        getTopExpensiveJobs(10),
      ])

    // Enrich byAgent with agent names
    const db = getDb()
    const agentIds = byAgentRaw.map((a) => a.agent_id)
    const agents =
      agentIds.length > 0
        ? await db.selectFrom('agents').select(['id', 'name']).where('id', 'in', agentIds).execute()
        : []

    const agentNameMap = new Map(agents.map((a) => [a.id, a.name]))
    const byAgent = byAgentRaw.map((a) => ({
      ...a,
      agent_name: agentNameMap.get(a.agent_id) ?? 'Unknown',
    }))

    return { totalSpend, spendToday, spendThisWeek, spendThisMonth, byAgent, topJobs }
  }),

  getAgentCosts: protectedProcedure
    .input(z.object({ agentId: z.string() }))
    .query(async ({ input }) => {
      const [bySource, topJobs, trend] = await Promise.all([
        getSpendBySource(input.agentId),
        getTopExpensiveJobsForAgent(input.agentId, 20),
        getDailyTrend(30, input.agentId),
      ])

      return {
        bySource: bySource.map((row) => ({ ...row, source: formatSourceLabel(row.source) })),
        topJobs,
        trend,
      }
    }),

  getTrend: protectedProcedure
    .input(
      z.object({
        days: z.number().optional().default(30),
        agentId: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      return getDailyTrend(input.days, input.agentId)
    }),

  getLimits: protectedProcedure
    .input(z.object({ agentId: z.string() }))
    .query(async ({ input }) => {
      return listCostLimitsForAgent(input.agentId)
    }),

  getTeamLimits: protectedProcedure
    .input(z.object({ teamId: z.string() }))
    .query(async ({ input }) => {
      return listCostLimitsForTeam(input.teamId)
    }),

  getOrgLimits: protectedProcedure.query(async () => {
    return listCostLimitsForOrg()
  }),

  setLimit: protectedProcedure
    .input(
      z.object({
        id: z.string().optional(),
        scope: z.enum(['org', 'team', 'agent']).optional().default('agent'),
        agentId: z.string().optional(),
        teamId: z.string().optional(),
        period: z.enum(['hourly', 'daily', 'monthly']),
        limitUsd: z.number().positive(),
        enabled: z.boolean().optional().default(true),
        softLimitPct: z.number().int().min(1).max(1000).optional().default(100),
        hardLimitPct: z.number().int().min(1).max(1000).optional().default(150),
      })
    )
    .mutation(async ({ input }) => {
      if (input.id) {
        return updateCostLimit(input.id, {
          period: input.period,
          limit_usd: input.limitUsd,
          enabled: input.enabled ? 1 : 0,
          soft_limit_pct: input.softLimitPct,
          hard_limit_pct: input.hardLimitPct,
        })
      }
      return createCostLimit({
        scope: input.scope,
        agent_id: input.scope === 'agent' ? (input.agentId ?? null) : null,
        team_id: input.scope === 'team' ? (input.teamId ?? null) : null,
        period: input.period,
        limit_usd: input.limitUsd,
        enabled: input.enabled ? 1 : 0,
        soft_limit_pct: input.softLimitPct,
        hard_limit_pct: input.hardLimitPct,
      })
    }),

  deleteLimit: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const success = await deleteCostLimit(input.id)
      return { success }
    }),

  getGlobalBySource: protectedProcedure.query(async () => {
    const rows = await getSpendBySourceGlobal()
    return rows.map((row) => ({ ...row, source: formatSourceLabel(row.source) }))
  }),

  getAllLimits: protectedProcedure.query(async () => {
    return listAllCostLimits()
  }),
})
