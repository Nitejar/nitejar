import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import {
  createRoutine,
  enqueueRoutineRun,
  findRoutineById,
  getDb,
  listRoutineRunsByRoutine,
  listRoutines,
  setRoutineEnabled,
  updateRoutine,
  archiveRoutine,
  getPluginInstancesForAgent,
} from '@nitejar/database'
import { protectedProcedure, router } from '../trpc'
import { getMinimumRoutineRecurrenceSeconds, validateCronSchedule } from '../services/routines/cron'
import { getAlwaysTrueRuleForEnvelope, parseRoutineRule } from '../services/routines/rules'

const triggerKindSchema = z.enum(['cron', 'event', 'condition', 'oneshot'])
const createdByKindSchema = z.enum(['admin', 'agent', 'system'])

const createUpdateInputSchema = z.object({
  name: z.string().trim().min(1),
  agentId: z.string().trim().min(1),
  triggerKind: triggerKindSchema,
  cronExpr: z.string().trim().optional(),
  timezone: z.string().trim().optional(),
  ruleJson: z.unknown(),
  conditionProbe: z.string().trim().optional(),
  conditionConfig: z.unknown().optional(),
  targetPluginInstanceId: z.string().trim().min(1),
  targetSessionKey: z.string().trim().min(1),
  targetResponseContext: z.unknown().optional(),
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

function normalizeTargetResponseContext(value: unknown): string | null {
  if (value === undefined || value === null || value === '') {
    return null
  }

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
    targetResponseContext: parseOptionalJsonString(row.target_response_context),
  }
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
      const agents = agentIds.length
        ? await db
            .selectFrom('agents')
            .select(['id', 'name', 'handle'])
            .where('id', 'in', agentIds)
            .execute()
        : []
      const agentMap = new Map(agents.map((agent) => [agent.id, agent]))

      return rows.map((row) => {
        const normalized = normalizeRoutineRow(row)!
        const agent = agentMap.get(row.agent_id)
        return {
          ...normalized,
          agentName: agent?.name ?? null,
          agentHandle: agent?.handle ?? null,
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
      target_plugin_instance_id: input.targetPluginInstanceId,
      target_session_key: input.targetSessionKey,
      target_response_context: normalizeTargetResponseContext(input.targetResponseContext),
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
      const enabled = input.patch.enabled ?? existing.enabled === 1
      const cronExpr = input.patch.cronExpr ?? existing.cron_expr ?? undefined
      const timezone = input.patch.timezone ?? existing.timezone ?? undefined

      const nextRunAt = resolveNextRunAt({
        triggerKind,
        enabled,
        cronExpr,
        timezone,
      })

      const updated = await updateRoutine(input.routineId, {
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
        target_plugin_instance_id:
          input.patch.targetPluginInstanceId ?? existing.target_plugin_instance_id,
        target_session_key: input.patch.targetSessionKey ?? existing.target_session_key,
        target_response_context:
          input.patch.targetResponseContext !== undefined
            ? normalizeTargetResponseContext(input.patch.targetResponseContext)
            : existing.target_response_context,
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
    .query(async ({ input }) => {
      const pluginInstances = await getPluginInstancesForAgent(input.agentId)
      const db = getDb()

      const targets = await Promise.all(
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
            // Legacy response keys for existing clients.
            integrationName: pluginInstance.name,
            integrationType: pluginInstance.type,
            sessions: [...deduped.entries()].map(([sessionKey, info]) => ({
              sessionKey,
              lastSeenAt: info.lastSeenAt,
              title: info.title,
            })),
          }
        })
      )

      return targets
    }),
})

export type RoutinesRouter = typeof routinesRouter
