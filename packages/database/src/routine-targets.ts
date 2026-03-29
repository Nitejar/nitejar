import type { Kysely } from 'kysely'
import { getDb } from './db'
import type { Database } from './types'
import {
  buildGoalAppSessionKey,
  buildRoutineAppSessionKey,
  buildTicketAppSessionKey,
  parseAppSessionKey,
} from './app-session-keys'

export type RoutineTargetSessionMode = 'resume' | 'fresh'

export type RoutineTarget =
  | {
      kind: 'plugin_conversation'
      pluginInstanceId: string
      sessionKey: string
    }
  | {
      kind: 'app_session'
      sessionKey: string
      sessionMode: RoutineTargetSessionMode
    }
  | {
      kind: 'app_ticket'
      ticketId: string
      sessionMode: RoutineTargetSessionMode
    }
  | {
      kind: 'app_goal'
      goalId: string
      sessionMode: RoutineTargetSessionMode
    }
  | {
      kind: 'app_routine'
      routineId: string
      sessionMode: RoutineTargetSessionMode
    }

export interface CompiledRoutineTarget {
  target: RoutineTarget
  targetSpecJson: string
  targetPluginInstanceId: string | null
  targetSessionKey: string
  targetResponseContext: string | null
}

export const ROUTINE_TARGET_FAMILY_SESSION_ID = '__family__'

function getExecutor(trx?: Kysely<Database>) {
  return trx ?? getDb()
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isSessionMode(value: unknown): value is RoutineTargetSessionMode {
  return value === 'resume' || value === 'fresh'
}

export function isRoutineTarget(value: unknown): value is RoutineTarget {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>
  switch (candidate.kind) {
    case 'plugin_conversation':
      return isNonEmptyString(candidate.pluginInstanceId) && isNonEmptyString(candidate.sessionKey)
    case 'app_session':
      return isNonEmptyString(candidate.sessionKey) && isSessionMode(candidate.sessionMode)
    case 'app_ticket':
      return isNonEmptyString(candidate.ticketId) && isSessionMode(candidate.sessionMode)
    case 'app_goal':
      return isNonEmptyString(candidate.goalId) && isSessionMode(candidate.sessionMode)
    case 'app_routine':
      return isNonEmptyString(candidate.routineId) && isSessionMode(candidate.sessionMode)
    default:
      return false
  }
}

export function parseRoutineTargetSpec(value: string | null | undefined): RoutineTarget | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as unknown
    return isRoutineTarget(parsed) ? parsed : null
  } catch {
    return null
  }
}

function compileTargetSessionKey(target: RoutineTarget): string {
  switch (target.kind) {
    case 'plugin_conversation':
      return target.sessionKey
    case 'app_session':
      return target.sessionKey
    case 'app_ticket':
      return buildTicketAppSessionKey(target.ticketId, ROUTINE_TARGET_FAMILY_SESSION_ID)
    case 'app_goal':
      return buildGoalAppSessionKey(target.goalId, ROUTINE_TARGET_FAMILY_SESSION_ID)
    case 'app_routine':
      return buildRoutineAppSessionKey(target.routineId, ROUTINE_TARGET_FAMILY_SESSION_ID)
  }
}

function serializeTarget(target: RoutineTarget): string {
  return JSON.stringify(target)
}

function normalizeResponseContextValue(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return JSON.stringify(value)
}

async function derivePluginConversationResponseContext(
  input: {
    pluginInstanceId: string
    sessionKey: string
  },
  trx?: Kysely<Database>
): Promise<string | null> {
  const db = getExecutor(trx)

  const latestDispatch = await db
    .selectFrom('run_dispatches')
    .select(['response_context'])
    .where('plugin_instance_id', '=', input.pluginInstanceId)
    .where('session_key', '=', input.sessionKey)
    .where('response_context', 'is not', null)
    .orderBy('created_at', 'desc')
    .limit(1)
    .executeTakeFirst()

  if (latestDispatch?.response_context) {
    return latestDispatch.response_context
  }

  const workItems = await db
    .selectFrom('work_items')
    .select(['payload'])
    .where('plugin_instance_id', '=', input.pluginInstanceId)
    .where('session_key', '=', input.sessionKey)
    .orderBy('created_at', 'desc')
    .limit(10)
    .execute()

  for (const row of workItems) {
    try {
      if (!row.payload) continue
      const payload = JSON.parse(row.payload) as Record<string, unknown>
      const responseContext = normalizeResponseContextValue(payload.responseContext)
      if (responseContext) {
        return responseContext
      }
    } catch {
      continue
    }
  }

  return null
}

async function hasPluginConversationReceipt(
  input: {
    pluginInstanceId: string
    sessionKey: string
  },
  trx?: Kysely<Database>
): Promise<boolean> {
  const db = getExecutor(trx)

  const dispatch = await db
    .selectFrom('run_dispatches')
    .select('id')
    .where('plugin_instance_id', '=', input.pluginInstanceId)
    .where('session_key', '=', input.sessionKey)
    .orderBy('created_at', 'desc')
    .limit(1)
    .executeTakeFirst()

  if (dispatch) return true

  const workItem = await db
    .selectFrom('work_items')
    .select('id')
    .where('plugin_instance_id', '=', input.pluginInstanceId)
    .where('session_key', '=', input.sessionKey)
    .orderBy('created_at', 'desc')
    .limit(1)
    .executeTakeFirst()

  return Boolean(workItem)
}

export async function validateAndCompileRoutineTarget(
  input: {
    agentId: string
    target: RoutineTarget
  },
  trx?: Kysely<Database>
): Promise<CompiledRoutineTarget> {
  const db = getExecutor(trx)

  switch (input.target.kind) {
    case 'plugin_conversation': {
      const assignment = await db
        .selectFrom('agent_plugin_instances')
        .select('plugin_instance_id')
        .where('agent_id', '=', input.agentId)
        .where('plugin_instance_id', '=', input.target.pluginInstanceId)
        .executeTakeFirst()
      if (!assignment) {
        throw new Error('Selected plugin conversation does not belong to this agent.')
      }

      const hasReceipt = await hasPluginConversationReceipt(
        {
          pluginInstanceId: input.target.pluginInstanceId,
          sessionKey: input.target.sessionKey,
        },
        trx
      )
      if (!hasReceipt) {
        throw new Error('Selected plugin conversation has no known receipts for this session.')
      }

      const responseContext = await derivePluginConversationResponseContext(
        {
          pluginInstanceId: input.target.pluginInstanceId,
          sessionKey: input.target.sessionKey,
        },
        trx
      )
      if (!responseContext) {
        throw new Error(
          'Selected plugin conversation is missing reply context in persisted receipts.'
        )
      }

      return {
        target: input.target,
        targetSpecJson: serializeTarget(input.target),
        targetPluginInstanceId: input.target.pluginInstanceId,
        targetSessionKey: input.target.sessionKey,
        targetResponseContext: responseContext,
      }
    }
    case 'app_session': {
      const session = await db
        .selectFrom('app_sessions')
        .select(['session_key'])
        .where('session_key', '=', input.target.sessionKey)
        .executeTakeFirst()
      if (!session) {
        throw new Error('Selected app session does not exist.')
      }

      const parsed = parseAppSessionKey(input.target.sessionKey)
      if (!parsed.isAppSession) {
        throw new Error('app_session targets must use a valid app session key.')
      }

      return {
        target: input.target,
        targetSpecJson: serializeTarget(input.target),
        targetPluginInstanceId: null,
        targetSessionKey: input.target.sessionKey,
        targetResponseContext: null,
      }
    }
    case 'app_ticket': {
      const ticket = await db
        .selectFrom('tickets')
        .select('id')
        .where('id', '=', input.target.ticketId)
        .executeTakeFirst()
      if (!ticket) {
        throw new Error('Selected ticket does not exist.')
      }

      return {
        target: input.target,
        targetSpecJson: serializeTarget(input.target),
        targetPluginInstanceId: null,
        targetSessionKey: compileTargetSessionKey(input.target),
        targetResponseContext: null,
      }
    }
    case 'app_goal': {
      const goal = await db
        .selectFrom('goals')
        .select('id')
        .where('id', '=', input.target.goalId)
        .executeTakeFirst()
      if (!goal) {
        throw new Error('Selected goal does not exist.')
      }

      return {
        target: input.target,
        targetSpecJson: serializeTarget(input.target),
        targetPluginInstanceId: null,
        targetSessionKey: compileTargetSessionKey(input.target),
        targetResponseContext: null,
      }
    }
    case 'app_routine': {
      const routine = await db
        .selectFrom('routines')
        .select('id')
        .where('id', '=', input.target.routineId)
        .executeTakeFirst()
      if (!routine) {
        throw new Error('Selected routine does not exist.')
      }

      return {
        target: input.target,
        targetSpecJson: serializeTarget(input.target),
        targetPluginInstanceId: null,
        targetSessionKey: compileTargetSessionKey(input.target),
        targetResponseContext: null,
      }
    }
  }
}

export function inferRoutineTargetFromLegacy(input: {
  targetSpecJson?: string | null
  targetPluginInstanceId?: string | null
  targetSessionKey: string
}): RoutineTarget | null {
  const fromSpec = parseRoutineTargetSpec(input.targetSpecJson)
  if (fromSpec) {
    return fromSpec
  }

  if (isNonEmptyString(input.targetPluginInstanceId)) {
    return {
      kind: 'plugin_conversation',
      pluginInstanceId: input.targetPluginInstanceId.trim(),
      sessionKey: input.targetSessionKey,
    }
  }

  const parsed = parseAppSessionKey(input.targetSessionKey)
  if (!parsed.isAppSession) {
    return null
  }

  if (parsed.contextKind === 'ticket' && !parsed.isLegacy) {
    return {
      kind: 'app_ticket',
      ticketId: parsed.contextId,
      sessionMode: 'fresh',
    }
  }

  if (parsed.contextKind === 'goal' && !parsed.isLegacy) {
    return {
      kind: 'app_goal',
      goalId: parsed.contextId,
      sessionMode: 'fresh',
    }
  }

  if (parsed.contextKind === 'routine' && !parsed.isLegacy) {
    return {
      kind: 'app_routine',
      routineId: parsed.contextId,
      sessionMode: 'fresh',
    }
  }

  return {
    kind: 'app_session',
    sessionKey: input.targetSessionKey,
    sessionMode: 'fresh',
  }
}
