import { Kysely } from 'kysely'

function extractGoalId(sessionKey: string): string | null {
  const match = sessionKey.match(/^work:goal:(.+):heartbeat$/)
  return match?.[1] ?? null
}

export async function up(db: Kysely<unknown>): Promise<void> {
  const typedDb = db as Kysely<any>
  const routines = await typedDb
    .selectFrom('routines')
    .select(['id', 'target_session_key'])
    .where('target_session_key', 'like', 'work:goal:%:heartbeat')
    .where('archived_at', 'is', null)
    .execute()

  for (const routine of routines) {
    const goalId = extractGoalId(routine.target_session_key)
    if (!goalId) continue

    const goal = await typedDb
      .selectFrom('goals')
      .select(['owner_kind', 'owner_ref'])
      .where('id', '=', goalId)
      .executeTakeFirst()

    if (goal?.owner_kind === 'agent' && goal.owner_ref) {
      await typedDb
        .updateTable('routines')
        .set({ agent_id: goal.owner_ref })
        .where('id', '=', routine.id)
        .execute()

      await typedDb
        .updateTable('app_sessions')
        .set({ primary_agent_id: goal.owner_ref })
        .where('session_key', '=', routine.target_session_key)
        .execute()

      continue
    }

    await typedDb
      .updateTable('routines')
      .set({
        enabled: 0,
        next_run_at: null,
      })
      .where('id', '=', routine.id)
      .execute()
  }
}

export async function down(_db: Kysely<unknown>): Promise<void> {
  // This migration normalizes live routines to the current owner state and is not reversible.
}
