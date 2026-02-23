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
