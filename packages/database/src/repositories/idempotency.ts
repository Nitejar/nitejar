import { getDb } from '../db'
import type { IdempotencyKey, NewIdempotencyKey } from '../types'

function now(): number {
  return Math.floor(Date.now() / 1000)
}

export async function findIdempotencyKey(key: string): Promise<IdempotencyKey | null> {
  const db = getDb()
  const result = await db
    .selectFrom('idempotency_keys')
    .selectAll()
    .where('key', '=', key)
    .executeTakeFirst()
  return result ?? null
}

export async function findIdempotencyKeyByAnyKey(keys: string[]): Promise<IdempotencyKey | null> {
  const normalizedKeys = [...new Set(keys.map((key) => key.trim()).filter((key) => key.length > 0))]
  if (normalizedKeys.length === 0) return null

  const db = getDb()
  const result = await db
    .selectFrom('idempotency_keys')
    .selectAll()
    .where('key', 'in', normalizedKeys)
    .orderBy('created_at', 'desc')
    .executeTakeFirst()

  return result ?? null
}

export async function createIdempotencyKey(
  data: Omit<NewIdempotencyKey, 'created_at'>
): Promise<IdempotencyKey> {
  const db = getDb()
  const timestamp = now()

  const result = await db
    .insertInto('idempotency_keys')
    .values({
      ...data,
      created_at: timestamp,
    })
    .returningAll()
    .executeTakeFirstOrThrow()

  return result
}

export async function createIdempotencyKeysIgnoreConflicts(
  keys: string[],
  workItemId: string
): Promise<void> {
  const normalizedKeys = [...new Set(keys.map((key) => key.trim()).filter((key) => key.length > 0))]
  if (normalizedKeys.length === 0) return

  const db = getDb()
  const createdAt = now()
  await db
    .insertInto('idempotency_keys')
    .values(
      normalizedKeys.map((key) => ({
        key,
        work_item_id: workItemId,
        created_at: createdAt,
      }))
    )
    .onConflict((oc) => oc.column('key').doNothing())
    .execute()
}
