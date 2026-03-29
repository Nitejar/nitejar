import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import {
  createRoutine,
  enqueueRoutineRun,
  findRoutineById,
  getDb,
  getRoutineTarget,
  listRoutineRunsByRoutine,
  listRoutines,
  setRoutineEnabled,
  updateRoutine,
  archiveRoutine,
  getPluginInstancesForAgent,
  parseAppSessionKey,
  validateAndCompileRoutineTarget,
} from '@nitejar/database'
import { protectedProcedure, router } from '../trpc'
import { getMinimumRoutineRecurrenceSeconds, validateCronSchedule } from '../services/routines/cron'
import { getAlwaysTrueRuleForEnvelope, parseRoutineRule } from '../services/routines/rules'

const triggerKindSchema = z.enum(['cron', 'event', 'condition', 'oneshot'])
const createdByKindSchema = z.enum(['admin', 'agent', 'system'])
const GOAL_HEARTBEAT_SESSION_KEY_RE = /^work:goal:(.+):heartbeat$/
const routineTargetSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('plugin_conversation'),
    pluginInstanceId: z.string().trim().min(1),
    sessionKey: z.string().trim().min(1),
  }),
  z.object({
    kind: z.literal('app_session'),
    sessionKey: z.string().trim().min(1),
    sessionMode: z.enum(['resume', 'fresh']),
  }),
  z.object({
    kind: z.literal('app_ticket'),
    ticketId: z.string().trim().min(1),
    sessionMode: z.enum(['resume', 'fresh']),
  }),
  z.object({
    kind: z.literal('app_goal'),
    goalId: z.string().trim().min(1),
    sessionMode: z.enum(['resume', 'fresh']),
  }),
  z.object({
    kind: z.literal('app_routine'),
    routineId: z.string().trim().min(1),
    sessionMode: z.enum(['resume', 'fresh']),
  }),
])

const createUpdateInputSchema = z.object({
  name: z.string().trim().min(1),
  agentId: z.string().trim().min(1),
  triggerKind: triggerKindSchema,
  cronExpr: z.string().trim().optional(),
  timezone: z.string().trim().optional(),
  ruleJson: z.unknown(),
  conditionProbe: z.string().trim().optional(),
  conditionConfig: z.unknown().optional(),
  target: routineTargetSchema,
  actionPrompt: z.string().trim().min(1),
  enabled: z.boolean().default(true),
  description: z.string().trim().optional(),
})

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function parseOptionalJsonString(value: string | null): unknown {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function resolveRuleJson(input: {
  triggerKind: z.infer<typeof triggerKindSchema>
  ruleJson: unknown
}): string {
  if (input.triggerKind === 'condition') {
    const parsed = parseRoutineRule(input.ruleJson, 'probe')
    return JSON.stringify(parsed)
  }

  if (input.triggerKind === 'event') {
    const parsed = parseRoutineRule(input.ruleJson, 'envelope')
    return JSON.stringify(parsed)
  }

  const fallback = getAlwaysTrueRuleForEnvelope()
  const parsed = parseRoutineRule(input.ruleJson ?? fallback, 'envelope')
  return JSON.stringify(parsed)
}

function resolveNextRunAt(input: {
  triggerKind: z.infer<typeof triggerKindSchema>
  enabled: boolean
  cronExpr?: string | null
  timezone?: string | null
}): number | null {
  if (!input.enabled) {
    return null
  }

  if (input.triggerKind === 'event') {
    return null
  }

  if (input.triggerKind === 'oneshot') {
    return now() + getMinimumRoutineRecurrenceSeconds()
  }

  const cronExpr = input.cronExpr?.trim()
  const timezone = input.timezone?.trim()
  if (!cronExpr || !timezone) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'cronExpr and timezone are required for cron and condition routines.',
    })
  }

  return validateCronSchedule(cronExpr, timezone)
}

function serializeConditionConfig(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    try {
      JSON.parse(trimmed)
      return trimmed
    } catch {
      return JSON.stringify(trimmed)
    }
  }

  return JSON.stringify(value)
}

function normalizeRoutineRow(row: Awaited<ReturnType<typeof findRoutineById>>) {
  if (!row) return null

  return {
    ...row,
    enabled: row.enabled === 1,
    ruleJson: parseOptionalJsonString(row.rule_json),
    conditionConfig: parseOptionalJsonString(row.condition_config),
    target: getRoutineTarget(row),
  }
}

function extractGoalHeartbeatId(sessionKey: string | null | undefined): string | null {
  if (!sessionKey) return null
  const match = sessionKey.match(GOAL_HEARTBEAT_SESSION_KEY_RE)
  return match?.[1] ?? null
}

function extractGoalIdFromRoutine(row: Awaited<ReturnType<typeof findRoutineById>>): string | null {
  if (!row) return null

  const target = getRoutineTarget(row)
  if (target?.kind === 'app_goal') {
    return target.goalId
  }
  if (target?.kind === 'app_session') {
    const parsed = parseAppSessionKey(target.sessionKey)
    if (parsed.isAppSession && parsed.contextKind === 'goal') {
      return parsed.contextId
    }
  }

  return extractGoalHeartbeatId(row.target_session_key)
}

export const routinesRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          agentId: z.string().optional(),
          includeArchived: z.boolean().default(false),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const rows = await listRoutines({
        agentId: input?.agentId,
        includeArchived: input?.includeArchived,
      })

      const db = getDb()
      const agentIds = [...new Set(rows.map((row) => row.agent_id))]
      const routineIds = rows.map((row) => row.id)
      const goalIds = [
        ...new Set(
          rows
            .map((row) => extractGoalIdFromRoutine(row))
            .filter((goalId): goalId is string => !!goalId)
        ),
      ]
      const agents = agentIds.length
        ? await db
            .selectFrom('agents')
            .select(['id', 'name', 'handle'])
            .where('id', 'in', agentIds)
            .execute()
        : []
      const goals = goalIds.length
        ? await db
            .selectFrom('goals')
            .select(['id', 'title', 'status'])
            .where('id', 'in', goalIds)
            .execute()
        : []
      const recentRuns = routineIds.length
        ? await db
            .selectFrom('routine_runs')
            .select(['routine_id', 'work_item_id', 'evaluated_at'])
            .where('routine_id', 'in', routineIds)
            .where('work_item_id', 'is not', null)
            .orderBy('evaluated_at', 'desc')
            .execute()
        : []
      const agentMap = new Map(agents.map((agent) => [agent.id, agent]))
      const goalMap = new Map(goals.map((goal) => [goal.id, goal]))
      const latestRunByRoutine = new Map<
        string,
        {
          workItemId: string
          evaluatedAt: number
        }
      >()
      for (const run of recentRuns) {
        if (latestRunByRoutine.has(run.routine_id) || !run.work_item_id) continue
        latestRunByRoutine.set(run.routine_id, {
          workItemId: run.work_item_id,
          evaluatedAt: run.evaluated_at,
        })
      }

      return rows.map((row) => {
        const normalized = normalizeRoutineRow(row)!
        const agent = agentMap.get(row.agent_id)
        const linkedGoalId = extractGoalIdFromRoutine(row)
        const linkedGoal = linkedGoalId ? goalMap.get(linkedGoalId) : null
        const latestRun = latestRunByRoutine.get(row.id) ?? null
        return {
          ...normalized,
          agentName: agent?.name ?? null,
          agentHandle: agent?.handle ?? null,
          linkedGoal:
            linkedGoalId !== null
              ? {
                  id: linkedGoalId,
                  title: linkedGoal?.title ?? null,
                  status: linkedGoal?.status ?? null,
                  exists: linkedGoal ? true : false,
                }
              : null,
          lastActivity:
            latestRun !== null
              ? {
                  workItemId: latestRun.workItemId,
                  evaluatedAt: latestRun.evaluatedAt,
                }
              : null,
        }
      })
    }),

  get: protectedProcedure.input(z.object({ routineId: z.string() })).query(async ({ input }) => {
    const routine = await findRoutineById(input.routineId)
    if (!routine) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Routine not found' })
    }

    return normalizeRoutineRow(routine)
  }),

  create: protectedProcedure.input(createUpdateInputSchema).mutation(async ({ input, ctx }) => {
    const compiledTarget = await validateAndCompileRoutineTarget({
      agentId: input.agentId,
      target: input.target,
    })
    const nextRunAt = resolveNextRunAt({
      triggerKind: input.triggerKind,
      enabled: input.enabled,
      cronExpr: input.cronExpr,
      timezone: input.timezone,
    })

    const routine = await createRoutine({
      agent_id: input.agentId,
      name: input.name,
      description: input.description ?? null,
      enabled: input.enabled ? 1 : 0,
      trigger_kind: input.triggerKind,
      cron_expr: input.cronExpr ?? null,
      timezone: input.timezone ?? null,
      rule_json: resolveRuleJson({
        triggerKind: input.triggerKind,
        ruleJson: input.ruleJson,
      }),
      condition_probe: input.conditionProbe ?? null,
      condition_config: serializeConditionConfig(input.conditionConfig),
      target_plugin_instance_id: compiledTarget.targetPluginInstanceId,
      target_session_key: compiledTarget.targetSessionKey,
      target_response_context: compiledTarget.targetResponseContext,
      target_spec_json: compiledTarget.targetSpecJson,
      action_prompt: input.actionPrompt,
      next_run_at: nextRunAt,
      last_evaluated_at: null,
      last_fired_at: null,
      last_status: null,
      created_by_kind: createdByKindSchema.parse('admin'),
      created_by_ref: ctx.session.user.id,
      archived_at: null,
    })

    return normalizeRoutineRow(routine)
  }),

  update: protectedProcedure
    .input(
      z.object({
        routineId: z.string(),
        patch: createUpdateInputSchema.partial().extend({
          ruleJson: z.unknown().optional(),
        }),
      })
    )
    .mutation(async ({ input }) => {
      const existing = await findRoutineById(input.routineId)
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Routine not found' })
      }

      const triggerKind = triggerKindSchema.parse(input.patch.triggerKind ?? existing.trigger_kind)
      const agentId = input.patch.agentId ?? existing.agent_id
      const enabled = input.patch.enabled ?? existing.enabled === 1
      const cronExpr = input.patch.cronExpr ?? existing.cron_expr ?? undefined
      const timezone = input.patch.timezone ?? existing.timezone ?? undefined
      const target = input.patch.target ?? getRoutineTarget(existing)
      if (!target) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Routine target is invalid and must be repaired before updating.',
        })
      }
      const compiledTarget = await validateAndCompileRoutineTarget({
        agentId,
        target,
      })

      const nextRunAt = resolveNextRunAt({
        triggerKind,
        enabled,
        cronExpr,
        timezone,
      })

      const updated = await updateRoutine(input.routineId, {
        agent_id: agentId,
        name: input.patch.name ?? existing.name,
        description: input.patch.description ?? existing.description,
        enabled: enabled ? 1 : 0,
        trigger_kind: triggerKind,
        cron_expr: cronExpr ?? null,
        timezone: timezone ?? null,
        rule_json:
          input.patch.ruleJson !== undefined
            ? resolveRuleJson({
                triggerKind,
                ruleJson: input.patch.ruleJson,
              })
            : existing.rule_json,
        condition_probe: input.patch.conditionProbe ?? existing.condition_probe,
        condition_config:
          input.patch.conditionConfig !== undefined
            ? serializeConditionConfig(input.patch.conditionConfig)
            : existing.condition_config,
        target_plugin_instance_id: compiledTarget.targetPluginInstanceId,
        target_session_key: compiledTarget.targetSessionKey,
        target_response_context: compiledTarget.targetResponseContext,
        target_spec_json: compiledTarget.targetSpecJson,
        action_prompt: input.patch.actionPrompt ?? existing.action_prompt,
        next_run_at: nextRunAt,
      })

      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Routine not found' })
      }

      return normalizeRoutineRow(updated)
    }),

  setEnabled: protectedProcedure
    .input(
      z.object({
        routineId: z.string(),
        enabled: z.boolean(),
      })
    )
    .mutation(async ({ input }) => {
      const existing = await findRoutineById(input.routineId)
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Routine not found' })
      }

      const updated = await setRoutineEnabled(input.routineId, input.enabled)
      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Routine not found' })
      }

      if (input.enabled) {
        const nextRunAt = resolveNextRunAt({
          triggerKind: existing.trigger_kind as z.infer<typeof triggerKindSchema>,
          enabled: true,
          cronExpr: existing.cron_expr ?? undefined,
          timezone: existing.timezone ?? undefined,
        })
        await updateRoutine(input.routineId, { next_run_at: nextRunAt })
      } else {
        await updateRoutine(input.routineId, { next_run_at: null })
      }

      const row = await findRoutineById(input.routineId)
      return normalizeRoutineRow(row)
    }),

  archive: protectedProcedure
    .input(z.object({ routineId: z.string() }))
    .mutation(async ({ input }) => {
      const archived = await archiveRoutine(input.routineId)
      if (!archived) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Routine not found' })
      }
      return normalizeRoutineRow(archived)
    }),

  runNow: protectedProcedure
    .input(z.object({ routineId: z.string() }))
    .mutation(async ({ input }) => {
      const routine = await findRoutineById(input.routineId)
      if (!routine) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Routine not found' })
      }
      if (routine.archived_at) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Routine is archived.' })
      }

      const { run, scheduledItem } = await enqueueRoutineRun({
        routine,
        triggerOrigin: 'manual',
        triggerRef: `manual:${now()}`,
        runAt: now(),
      })

      await updateRoutine(routine.id, {
        last_evaluated_at: now(),
        last_status: 'enqueued',
      })

      return {
        routineRunId: run.id,
        scheduledItemId: scheduledItem.id,
      }
    }),

  listRuns: protectedProcedure
    .input(
      z.object({
        routineId: z.string(),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      const runs = await listRoutineRunsByRoutine(input.routineId, {
        limit: input.limit,
        offset: input.offset,
      })

      return runs.map((run) => ({
        ...run,
        envelopeJson: parseOptionalJsonString(run.envelope_json),
      }))
    }),

  listTargets: protectedProcedure
    .input(z.object({ agentId: z.string() }))
    .query(async ({ input, ctx }) => {
      const pluginInstances = await getPluginInstancesForAgent(input.agentId)
      const db = getDb()
      const userId = ctx.session.user.id

      const pluginConversations = await Promise.all(
        pluginInstances.map(async (pluginInstance) => {
          const sessions = await db
            .selectFrom('work_items')
            .select(['session_key', 'title', 'created_at'])
            .where('plugin_instance_id', '=', pluginInstance.id)
            .orderBy('created_at', 'desc')
            .limit(30)
            .execute()

          const deduped = new Map<string, { lastSeenAt: number; title: string | null }>()
          for (const session of sessions) {
            if (!deduped.has(session.session_key)) {
              deduped.set(session.session_key, {
                lastSeenAt: session.created_at,
                title: session.title ?? null,
              })
            }
          }

          return {
            pluginInstanceId: pluginInstance.id,
            pluginInstanceName: pluginInstance.name,
            pluginInstanceType: pluginInstance.type,
            sessions: [...deduped.entries()].map(([sessionKey, info]) => ({
              sessionKey,
              lastSeenAt: info.lastSeenAt,
              title: info.title,
            })),
          }
        })
      )

      const appSessions = await db
        .selectFrom('app_sessions')
        .selectAll()
        .where('owner_user_id', '=', userId)
        .orderBy('last_activity_at', 'desc')
        .orderBy('created_at', 'desc')
        .limit(50)
        .execute()

      const latestTicketSessionById = new Map<string, (typeof appSessions)[number]>()
      const latestGoalSessionById = new Map<string, (typeof appSessions)[number]>()
      const latestRoutineSessionById = new Map<string, (typeof appSessions)[number]>()

      const appSessionItems = appSessions.map((session) => {
        const parsed = parseAppSessionKey(session.session_key)
        if (parsed.isAppSession && parsed.contextKind === 'ticket') {
          if (!latestTicketSessionById.has(parsed.contextId)) {
            latestTicketSessionById.set(parsed.contextId, session)
          }
        }
        if (parsed.isAppSession && parsed.contextKind === 'goal') {
          if (!latestGoalSessionById.has(parsed.contextId)) {
            latestGoalSessionById.set(parsed.contextId, session)
          }
        }
        if (parsed.isAppSession && parsed.contextKind === 'routine') {
          if (!latestRoutineSessionById.has(parsed.contextId)) {
            latestRoutineSessionById.set(parsed.contextId, session)
          }
        }

        return {
          sessionKey: session.session_key,
          title: session.title,
          lastActivityAt: session.last_activity_at,
          contextKind: parsed.isAppSession ? parsed.contextKind : null,
          contextId: parsed.isAppSession ? parsed.contextId : null,
        }
      })

      const ticketIds = [...latestTicketSessionById.keys()]
      const goalIds = [...latestGoalSessionById.keys()]
      const routineIds = [...latestRoutineSessionById.keys()]

      const [tickets, goals, routines] = await Promise.all([
        ticketIds.length
          ? db
              .selectFrom('tickets')
              .select(['id', 'title', 'status'])
              .where('id', 'in', ticketIds)
              .execute()
          : Promise.resolve([]),
        goalIds.length
          ? db
              .selectFrom('goals')
              .select(['id', 'title', 'status'])
              .where('id', 'in', goalIds)
              .execute()
          : Promise.resolve([]),
        routineIds.length
          ? db
              .selectFrom('routines')
              .select(['id', 'name', 'agent_id'])
              .where('id', 'in', routineIds)
              .execute()
          : Promise.resolve([]),
      ])

      return {
        pluginConversations,
        appSessions: appSessionItems,
        tickets: tickets.map((ticket) => ({
          id: ticket.id,
          title: ticket.title,
          status: ticket.status,
          lastSessionKey: latestTicketSessionById.get(ticket.id)?.session_key ?? null,
          lastActivityAt: latestTicketSessionById.get(ticket.id)?.last_activity_at ?? null,
        })),
        goals: goals.map((goal) => ({
          id: goal.id,
          title: goal.title,
          status: goal.status,
          lastSessionKey: latestGoalSessionById.get(goal.id)?.session_key ?? null,
          lastActivityAt: latestGoalSessionById.get(goal.id)?.last_activity_at ?? null,
        })),
        routines: routines.map((routine) => ({
          id: routine.id,
          name: routine.name,
          agentId: routine.agent_id,
          lastSessionKey: latestRoutineSessionById.get(routine.id)?.session_key ?? null,
          lastActivityAt: latestRoutineSessionById.get(routine.id)?.last_activity_at ?? null,
        })),
      }
    }),
})

export type RoutinesRouter = typeof routinesRouter
