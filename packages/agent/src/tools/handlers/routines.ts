import type Anthropic from '@anthropic-ai/sdk'
import parser from 'cron-parser'
import {
  archiveRoutine,
  assertAgentGrant,
  createRoutine,
  enqueueRoutineRun,
  findRoutineById,
  getRoutineTarget,
  listRoutines,
  type RoutineTarget,
  setRoutineEnabled,
  updateRoutine,
  validateAndCompileRoutineTarget,
} from '@nitejar/database'
import type { ToolHandler } from '../types'

const MIN_INTERVAL_SECONDS = 5 * 60

type TriggerKind = 'cron' | 'event' | 'condition' | 'oneshot'

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function ensureTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
  } catch {
    throw new Error(`Invalid timezone: ${timezone}`)
  }
}

function computeNextCron(cronExpr: string, timezone: string, from = now()): number {
  ensureTimezone(timezone)
  const interval = parser.parseExpression(cronExpr, {
    tz: timezone,
    currentDate: new Date(from * 1000),
  })
  return Math.floor(interval.next().getTime() / 1000)
}

function assertMinCronInterval(cronExpr: string, timezone: string): void {
  const interval = parser.parseExpression(cronExpr, {
    tz: timezone,
    currentDate: new Date(now() * 1000),
  })

  let prev = interval.next().getTime()
  for (let i = 0; i < 8; i += 1) {
    const current = interval.next().getTime()
    const diffSeconds = Math.floor((current - prev) / 1000)
    if (diffSeconds < MIN_INTERVAL_SECONDS) {
      throw new Error('Routine recurrence must be at least 5 minutes.')
    }
    prev = current
  }
}

function parseJsonInput(value: unknown, fallback: unknown): unknown {
  if (value === undefined || value === null) return fallback
  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      throw new Error('Expected valid JSON string.')
    }
  }
  return value
}

function parseTriggerKind(value: unknown): TriggerKind {
  if (value === 'cron' || value === 'event' || value === 'condition' || value === 'oneshot') {
    return value
  }
  throw new Error('trigger_kind must be one of: cron, event, condition, oneshot.')
}

function parseRoutineTargetInput(value: unknown): RoutineTarget {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as RoutineTarget
    } catch {
      throw new Error('target must be a valid object or JSON string.')
    }
  }
  return value as RoutineTarget
}

function resolveNextRunAt(input: {
  triggerKind: TriggerKind
  cronExpr?: string | null
  timezone?: string | null
  enabled: boolean
}): number | null {
  if (!input.enabled) {
    return null
  }

  if (input.triggerKind === 'event') {
    return null
  }

  if (input.triggerKind === 'oneshot') {
    return now() + MIN_INTERVAL_SECONDS
  }

  const cronExpr = input.cronExpr?.trim()
  const timezone = input.timezone?.trim()
  if (!cronExpr || !timezone) {
    throw new Error('cron_expr and timezone are required for cron/condition routines.')
  }

  assertMinCronInterval(cronExpr, timezone)
  return computeNextCron(cronExpr, timezone)
}

export const routineDefinitions: Anthropic.Tool[] = [
  {
    name: 'create_routine',
    description:
      'Create a proactive routine that can run on cron, event, condition probe, or one-shot trigger.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        trigger_kind: { type: 'string', enum: ['cron', 'event', 'condition', 'oneshot'] },
        cron_expr: { type: 'string' },
        timezone: { type: 'string' },
        rule_json: {
          description: 'JSON rule object or JSON string. Required for event/condition routines.',
        },
        condition_probe: { type: 'string' },
        condition_config: { description: 'Probe config object or JSON string.' },
        target: {
          description:
            'Typed target object. Use one of: {kind:"plugin_conversation",pluginInstanceId,sessionKey}, {kind:"app_session",sessionKey,sessionMode}, {kind:"app_ticket",ticketId,sessionMode}, {kind:"app_goal",goalId,sessionMode}, {kind:"app_routine",routineId,sessionMode}.',
        },
        action_prompt: { type: 'string' },
        enabled: { type: 'boolean' },
      },
      required: ['name', 'trigger_kind', 'target', 'action_prompt'],
    },
  },
  {
    name: 'list_routines',
    description: "List this agent's routines and current state.",
    input_schema: {
      type: 'object' as const,
      properties: {
        include_archived: { type: 'boolean' },
      },
    },
  },
  {
    name: 'get_routine',
    description: 'Get one routine with its live delivery target and response context.',
    input_schema: {
      type: 'object' as const,
      properties: {
        routine_id: { type: 'string' },
      },
      required: ['routine_id'],
    },
  },
  {
    name: 'update_routine',
    description: 'Update an existing routine.',
    input_schema: {
      type: 'object' as const,
      properties: {
        routine_id: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        trigger_kind: { type: 'string', enum: ['cron', 'event', 'condition', 'oneshot'] },
        cron_expr: { type: 'string' },
        timezone: { type: 'string' },
        rule_json: { description: 'JSON rule object or JSON string.' },
        condition_probe: { type: 'string' },
        condition_config: { description: 'Probe config object or JSON string.' },
        target: {
          description:
            'Typed target object. Use one of: {kind:"plugin_conversation",pluginInstanceId,sessionKey}, {kind:"app_session",sessionKey,sessionMode}, {kind:"app_ticket",ticketId,sessionMode}, {kind:"app_goal",goalId,sessionMode}, {kind:"app_routine",routineId,sessionMode}.',
        },
        action_prompt: { type: 'string' },
        enabled: { type: 'boolean' },
      },
      required: ['routine_id'],
    },
  },
  {
    name: 'pause_routine',
    description: 'Pause (disable) a routine.',
    input_schema: {
      type: 'object' as const,
      properties: {
        routine_id: { type: 'string' },
      },
      required: ['routine_id'],
    },
  },
  {
    name: 'delete_routine',
    description: 'Archive a routine.',
    input_schema: {
      type: 'object' as const,
      properties: {
        routine_id: { type: 'string' },
      },
      required: ['routine_id'],
    },
  },
  {
    name: 'run_routine_now',
    description: 'Manually enqueue a routine immediately.',
    input_schema: {
      type: 'object' as const,
      properties: {
        routine_id: { type: 'string' },
      },
      required: ['routine_id'],
    },
  },
]

async function assertRoutineManagementGrant(agentId: string): Promise<void> {
  const grantChecks = ['routine.self.manage', 'routine.manage'] as const

  for (const action of grantChecks) {
    try {
      await assertAgentGrant({
        agentId,
        action,
        resourceType: '*',
      })
      return
    } catch {
      continue
    }
  }

  throw new Error('Access denied: missing grant "routine.self.manage" or "routine.manage".')
}

export const createRoutineTool: ToolHandler = async (input, context) => {
  if (!context.agentId) {
    return { success: false, error: 'Missing agent identity.' }
  }

  try {
    await assertRoutineManagementGrant(context.agentId)

    const name = typeof input.name === 'string' ? input.name.trim() : ''
    if (!name) {
      return { success: false, error: 'name is required.' }
    }

    const triggerKind = parseTriggerKind(input.trigger_kind)
    const enabled = input.enabled !== false

    const actionPrompt = typeof input.action_prompt === 'string' ? input.action_prompt.trim() : ''
    const target = parseRoutineTargetInput(input.target)

    if (!actionPrompt) {
      return {
        success: false,
        error: 'target and action_prompt are required.',
      }
    }

    const cronExpr = typeof input.cron_expr === 'string' ? input.cron_expr.trim() : null
    const timezone = typeof input.timezone === 'string' ? input.timezone.trim() : null

    const nextRunAt = resolveNextRunAt({
      triggerKind,
      cronExpr,
      timezone,
      enabled,
    })

    const ruleInput = parseJsonInput(input.rule_json, {})
    const conditionConfigInput = parseJsonInput(input.condition_config, null)
    const compiledTarget = await validateAndCompileRoutineTarget({
      agentId: context.agentId,
      target,
    })

    const routine = await createRoutine({
      agent_id: context.agentId,
      name,
      description: typeof input.description === 'string' ? input.description.trim() || null : null,
      enabled: enabled ? 1 : 0,
      trigger_kind: triggerKind,
      cron_expr: cronExpr,
      timezone,
      rule_json: JSON.stringify(ruleInput),
      condition_probe:
        typeof input.condition_probe === 'string' ? input.condition_probe.trim() || null : null,
      condition_config: conditionConfigInput === null ? null : JSON.stringify(conditionConfigInput),
      target_plugin_instance_id: compiledTarget.targetPluginInstanceId,
      target_session_key: compiledTarget.targetSessionKey,
      target_response_context: compiledTarget.targetResponseContext,
      target_spec_json: compiledTarget.targetSpecJson,
      action_prompt: actionPrompt,
      next_run_at: nextRunAt,
      last_evaluated_at: null,
      last_fired_at: null,
      last_status: null,
      created_by_kind: 'agent',
      created_by_ref: context.agentId,
      archived_at: null,
    })

    return {
      success: true,
      output: `Created routine ${routine.id} (${routine.trigger_kind}).`,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create routine.',
    }
  }
}

export const listRoutinesTool: ToolHandler = async (input, context) => {
  if (!context.agentId) {
    return { success: false, error: 'Missing agent identity.' }
  }

  try {
    await assertRoutineManagementGrant(context.agentId)

    const includeArchived = input.include_archived === true
    const routines = await listRoutines({
      agentId: context.agentId,
      includeArchived,
    })

    if (routines.length === 0) {
      return { success: true, output: 'No routines found.' }
    }

    const lines = routines.map((routine) => {
      const status = routine.enabled === 1 ? 'enabled' : 'paused'
      const archived = routine.archived_at ? ' archived' : ''
      const nextRun = routine.next_run_at
        ? new Date(routine.next_run_at * 1000).toISOString()
        : 'n/a'
      return `- ${routine.id} [${routine.trigger_kind}] ${status}${archived} next=${nextRun} name="${routine.name}"`
    })

    return { success: true, output: lines.join('\n') }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list routines.',
    }
  }
}

export const getRoutineTool: ToolHandler = async (input, context) => {
  if (!context.agentId) {
    return { success: false, error: 'Missing agent identity.' }
  }

  try {
    const routineId = typeof input.routine_id === 'string' ? input.routine_id.trim() : ''
    if (!routineId) {
      return { success: false, error: 'routine_id is required.' }
    }

    await assertRoutineManagementGrant(context.agentId)

    const routine = await findRoutineById(routineId)
    if (!routine || routine.agent_id !== context.agentId) {
      return { success: false, error: `Routine ${routineId} not found.` }
    }

    const nextRun = routine.next_run_at ? new Date(routine.next_run_at * 1000).toISOString() : 'n/a'
    const lastFired = routine.last_fired_at
      ? new Date(routine.last_fired_at * 1000).toISOString()
      : 'n/a'
    const target = getRoutineTarget(routine)

    return {
      success: true,
      output: [
        `Routine ${routine.id}`,
        `name: ${routine.name}`,
        `trigger_kind: ${routine.trigger_kind}`,
        `enabled: ${routine.enabled === 1 ? 'true' : 'false'}`,
        `target: ${target ? JSON.stringify(target) : 'null'}`,
        `next_run_at: ${nextRun}`,
        `last_fired_at: ${lastFired}`,
        `last_status: ${routine.last_status ?? 'n/a'}`,
      ].join('\n'),
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch routine.',
    }
  }
}

export const updateRoutineTool: ToolHandler = async (input, context) => {
  if (!context.agentId) {
    return { success: false, error: 'Missing agent identity.' }
  }

  try {
    const routineId = typeof input.routine_id === 'string' ? input.routine_id.trim() : ''
    if (!routineId) {
      return { success: false, error: 'routine_id is required.' }
    }

    const existing = await findRoutineById(routineId)
    if (!existing || existing.agent_id !== context.agentId) {
      return { success: false, error: `Routine ${routineId} not found.` }
    }

    await assertRoutineManagementGrant(context.agentId)

    const triggerKind = input.trigger_kind
      ? parseTriggerKind(input.trigger_kind)
      : (existing.trigger_kind as TriggerKind)
    const enabled = typeof input.enabled === 'boolean' ? input.enabled : existing.enabled === 1

    const cronExpr =
      typeof input.cron_expr === 'string' ? input.cron_expr.trim() : (existing.cron_expr ?? null)
    const timezone =
      typeof input.timezone === 'string' ? input.timezone.trim() : (existing.timezone ?? null)

    const nextRunAt = resolveNextRunAt({
      triggerKind,
      cronExpr,
      timezone,
      enabled,
    })
    const target =
      input.target !== undefined
        ? parseRoutineTargetInput(input.target)
        : getRoutineTarget(existing)
    if (!target) {
      return {
        success: false,
        error: 'Routine target is invalid and must be repaired before updating.',
      }
    }
    const compiledTarget = await validateAndCompileRoutineTarget({
      agentId: context.agentId,
      target,
    })

    const updated = await updateRoutine(routineId, {
      name: typeof input.name === 'string' ? input.name.trim() || existing.name : existing.name,
      description:
        typeof input.description === 'string'
          ? input.description.trim() || null
          : existing.description,
      trigger_kind: triggerKind,
      cron_expr: cronExpr,
      timezone,
      rule_json: input.rule_json
        ? JSON.stringify(parseJsonInput(input.rule_json, {}))
        : existing.rule_json,
      condition_probe:
        typeof input.condition_probe === 'string'
          ? input.condition_probe.trim() || null
          : existing.condition_probe,
      condition_config: input.condition_config
        ? JSON.stringify(parseJsonInput(input.condition_config, null))
        : existing.condition_config,
      target_plugin_instance_id: compiledTarget.targetPluginInstanceId,
      target_session_key: compiledTarget.targetSessionKey,
      target_response_context: compiledTarget.targetResponseContext,
      target_spec_json: compiledTarget.targetSpecJson,
      action_prompt:
        typeof input.action_prompt === 'string'
          ? input.action_prompt.trim() || existing.action_prompt
          : existing.action_prompt,
      enabled: enabled ? 1 : 0,
      next_run_at: nextRunAt,
      archived_at: null,
    })

    if (!updated) {
      return { success: false, error: `Routine ${routineId} update failed.` }
    }

    return {
      success: true,
      output: `Updated routine ${routineId}.`,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update routine.',
    }
  }
}

export const pauseRoutineTool: ToolHandler = async (input, context) => {
  if (!context.agentId) {
    return { success: false, error: 'Missing agent identity.' }
  }

  try {
    const routineId = typeof input.routine_id === 'string' ? input.routine_id.trim() : ''
    if (!routineId) {
      return { success: false, error: 'routine_id is required.' }
    }

    const routine = await findRoutineById(routineId)
    if (!routine || routine.agent_id !== context.agentId) {
      return { success: false, error: `Routine ${routineId} not found.` }
    }

    await assertRoutineManagementGrant(context.agentId)

    await setRoutineEnabled(routineId, false)
    return { success: true, output: `Paused routine ${routineId}.` }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to pause routine.',
    }
  }
}

export const deleteRoutineTool: ToolHandler = async (input, context) => {
  if (!context.agentId) {
    return { success: false, error: 'Missing agent identity.' }
  }

  try {
    const routineId = typeof input.routine_id === 'string' ? input.routine_id.trim() : ''
    if (!routineId) {
      return { success: false, error: 'routine_id is required.' }
    }

    const routine = await findRoutineById(routineId)
    if (!routine || routine.agent_id !== context.agentId) {
      return { success: false, error: `Routine ${routineId} not found.` }
    }

    await assertRoutineManagementGrant(context.agentId)

    await archiveRoutine(routineId)
    return { success: true, output: `Archived routine ${routineId}.` }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to archive routine.',
    }
  }
}

export const runRoutineNowTool: ToolHandler = async (input, context) => {
  if (!context.agentId) {
    return { success: false, error: 'Missing agent identity.' }
  }

  try {
    const routineId = typeof input.routine_id === 'string' ? input.routine_id.trim() : ''
    if (!routineId) {
      return { success: false, error: 'routine_id is required.' }
    }

    const routine = await findRoutineById(routineId)
    if (!routine || routine.agent_id !== context.agentId) {
      return { success: false, error: `Routine ${routineId} not found.` }
    }

    await assertRoutineManagementGrant(context.agentId)

    const { scheduledItem } = await enqueueRoutineRun({
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
      success: true,
      output: `Routine ${routine.id} enqueued as scheduled item ${scheduledItem.id}.`,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to run routine now.',
    }
  }
}
