import { getDb } from './db'

export interface IdempotencyResult {
  isDuplicate: boolean
  workItemId?: string
}

/**
 * Checks if an idempotency key has already been used.
 * Returns the associated work item ID if it has.
 */
export async function checkIdempotencyKey(key: string): Promise<IdempotencyResult> {
  const db = getDb()
  const result = await db
    .selectFrom('idempotency_keys')
    .select('work_item_id')
    .where('key', '=', key)
    .executeTakeFirst()

  if (result?.work_item_id) {
    return { isDuplicate: true, workItemId: result.work_item_id }
  }

  return { isDuplicate: false }
}

/**
 * Records an idempotency key after successful work item creation.
 */
export async function recordIdempotencyKey(key: string, workItemId: string): Promise<void> {
  const db = getDb()
  await db
    .insertInto('idempotency_keys')
    .values({
      key,
      work_item_id: workItemId,
      created_at: Math.floor(Date.now() / 1000),
    })
    .onConflict((oc) => oc.column('key').doNothing())
    .execute()
}
