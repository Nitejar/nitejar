import { createHash } from 'node:crypto'
import { getDb } from '../db'
import type { ModelCallPayload } from '../types'

type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | CanonicalJsonValue[]
  | { [key: string]: CanonicalJsonValue }

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function toCanonicalJsonValue(input: unknown): CanonicalJsonValue | undefined {
  if (input === null) return null
  if (typeof input === 'boolean') return input
  if (typeof input === 'string') return input
  if (typeof input === 'number') return Number.isFinite(input) ? input : null

  if (Array.isArray(input)) {
    const values: CanonicalJsonValue[] = []
    for (const entry of input) {
      const normalized = toCanonicalJsonValue(entry)
      values.push(normalized === undefined ? null : normalized)
    }
    return values
  }

  if (typeof input === 'object') {
    const record = input as Record<string, unknown>
    const result: Record<string, CanonicalJsonValue> = {}
    for (const key of Object.keys(record).sort()) {
      const normalized = toCanonicalJsonValue(record[key])
      if (normalized !== undefined) {
        result[key] = normalized
      }
    }
    return result
  }

  return undefined
}

export function canonicalizeJson(input: unknown): string {
  const normalized = toCanonicalJsonValue(input)
  return JSON.stringify(normalized === undefined ? null : normalized)
}

export function hashCanonicalJson(input: unknown): string {
  return createHash('sha256').update(canonicalizeJson(input)).digest('hex')
}

export interface StoredModelCallPayload {
  hash: string
  canonicalJson: string
  byteSize: number
}

export function buildStoredModelCallPayload(input: unknown): StoredModelCallPayload {
  const canonicalJson = canonicalizeJson(input)
  return {
    hash: createHash('sha256').update(canonicalJson).digest('hex'),
    canonicalJson,
    byteSize: Buffer.byteLength(canonicalJson, 'utf8'),
  }
}

export async function upsertModelCallPayload(input: {
  payload: unknown
  metadata?: unknown
}): Promise<ModelCallPayload> {
  const db = getDb()
  const payload = buildStoredModelCallPayload(input.payload)
  const metadataJson =
    input.metadata === undefined
      ? null
      : canonicalizeJson(input.metadata === null ? null : input.metadata)

  await db
    .insertInto('model_call_payloads')
    .values({
      hash: payload.hash,
      payload_json: payload.canonicalJson,
      metadata_json: metadataJson,
      byte_size: payload.byteSize,
      created_at: now(),
    })
    .onConflict((oc) => oc.column('hash').doNothing())
    .execute()

  return db
    .selectFrom('model_call_payloads')
    .selectAll()
    .where('hash', '=', payload.hash)
    .executeTakeFirstOrThrow()
}

export async function findModelCallPayloadByHash(hash: string): Promise<ModelCallPayload | null> {
  const db = getDb()
  const row = await db
    .selectFrom('model_call_payloads')
    .selectAll()
    .where('hash', '=', hash)
    .executeTakeFirst()
  return row ?? null
}

export async function listModelCallPayloadsByHashes(hashes: string[]): Promise<ModelCallPayload[]> {
  if (hashes.length === 0) return []
  const db = getDb()
  return db.selectFrom('model_call_payloads').selectAll().where('hash', 'in', hashes).execute()
}
