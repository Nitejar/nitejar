import { Kysely } from 'kysely'

type InferredRoutineTarget =
  | { kind: 'plugin_conversation'; pluginInstanceId: string; sessionKey: string }
  | { kind: 'app_session'; sessionKey: string; sessionMode: 'resume' | 'fresh' }
  | { kind: 'app_ticket'; ticketId: string; sessionMode: 'resume' | 'fresh' }
  | { kind: 'app_goal'; goalId: string; sessionMode: 'resume' | 'fresh' }
  | { kind: 'app_routine'; routineId: string; sessionMode: 'resume' | 'fresh' }

const TYPED_APP_SESSION_RE = /^app:(standalone|ticket|goal|routine):([^:]+):([^:]+)$/
const LEGACY_APP_SESSION_RE = /^app:([^:]+):([^:]+)$/

function inferTargetSpec(input: {
  pluginInstanceId: string | null
  sessionKey: string
}): string | null {
  const target = inferTarget(input)
  return target ? JSON.stringify(target) : null
}

function inferTarget(input: {
  pluginInstanceId: string | null
  sessionKey: string
}): InferredRoutineTarget | null {
  if (input.pluginInstanceId) {
    return {
      kind: 'plugin_conversation',
      pluginInstanceId: input.pluginInstanceId,
      sessionKey: input.sessionKey,
    }
  }

  const typedMatch = input.sessionKey.match(TYPED_APP_SESSION_RE)
  if (typedMatch) {
    const contextKind = typedMatch[1]
    const contextId = typedMatch[2]

    if (contextKind === 'ticket') {
      return { kind: 'app_ticket', ticketId: contextId, sessionMode: 'fresh' }
    }
    if (contextKind === 'goal') {
      return { kind: 'app_goal', goalId: contextId, sessionMode: 'fresh' }
    }
    if (contextKind === 'routine') {
      return { kind: 'app_routine', routineId: contextId, sessionMode: 'fresh' }
    }

    return {
      kind: 'app_session',
      sessionKey: input.sessionKey,
      sessionMode: 'fresh',
    }
  }

  if (input.sessionKey.match(LEGACY_APP_SESSION_RE)) {
    return {
      kind: 'app_session',
      sessionKey: input.sessionKey,
      sessionMode: 'fresh',
    }
  }

  return null
}

async function addColumnIfNotExists(
  columnName: string,
  addColumn: () => Promise<unknown>
): Promise<void> {
  try {
    await addColumn()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (
      message.includes(`duplicate column name: ${columnName}`) ||
      message.includes(`column "${columnName}" of relation`) ||
      message.includes('already exists')
    ) {
      return
    }
    throw error
  }
}

export async function up(db: Kysely<unknown>): Promise<void> {
  const typedDb = db as Kysely<any>

  await addColumnIfNotExists('target_spec_json', () =>
    typedDb.schema.alterTable('routines').addColumn('target_spec_json', 'text').execute()
  )
  await addColumnIfNotExists('target_spec_json', () =>
    typedDb.schema.alterTable('scheduled_items').addColumn('target_spec_json', 'text').execute()
  )

  const routines = await typedDb
    .selectFrom('routines')
    .select(['id', 'target_plugin_instance_id', 'target_session_key', 'target_spec_json'])
    .execute()

  const inferredByRoutineId = new Map<string, string>()
  for (const routine of routines) {
    const targetSpecJson =
      routine.target_spec_json ??
      inferTargetSpec({
        pluginInstanceId: routine.target_plugin_instance_id,
        sessionKey: routine.target_session_key,
      })

    if (!targetSpecJson) {
      continue
    }

    inferredByRoutineId.set(routine.id, targetSpecJson)

    if (!routine.target_spec_json) {
      await typedDb
        .updateTable('routines')
        .set({ target_spec_json: targetSpecJson })
        .where('id', '=', routine.id)
        .execute()
    }
  }

  const scheduledItems = await typedDb
    .selectFrom('scheduled_items')
    .select(['id', 'routine_id', 'plugin_instance_id', 'session_key', 'target_spec_json'])
    .execute()

  for (const item of scheduledItems) {
    const targetSpecJson =
      item.target_spec_json ??
      (item.routine_id ? inferredByRoutineId.get(item.routine_id) : null) ??
      inferTargetSpec({
        pluginInstanceId: item.plugin_instance_id,
        sessionKey: item.session_key,
      })

    if (!targetSpecJson || item.target_spec_json) {
      continue
    }

    await typedDb
      .updateTable('scheduled_items')
      .set({ target_spec_json: targetSpecJson })
      .where('id', '=', item.id)
      .execute()
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  const typedDb = db as Kysely<any>
  await typedDb.schema.alterTable('scheduled_items').dropColumn('target_spec_json').execute()
  await typedDb.schema.alterTable('routines').dropColumn('target_spec_json').execute()
}
