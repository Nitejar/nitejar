import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'kysely'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { closeDb, getDb } from '../db'
import {
  buildStoredModelCallPayload,
  hashCanonicalJson,
  upsertModelCallPayload,
} from './model-call-payloads'

let testDir = ''
let db: ReturnType<typeof getDb>

describe('model-call payload repository', () => {
  beforeAll(async () => {
    await closeDb()
    testDir = mkdtempSync(join(tmpdir(), 'nitejar-model-payloads-'))
    process.env.DATABASE_URL = join(testDir, 'test.sqlite')
    db = getDb()

    await db.schema
      .createTable('model_call_payloads')
      .ifNotExists()
      .addColumn('hash', 'text', (col) => col.primaryKey())
      .addColumn('payload_json', 'text', (col) => col.notNull())
      .addColumn('metadata_json', 'text')
      .addColumn('byte_size', 'integer', (col) => col.notNull())
      .addColumn('created_at', 'integer', (col) => col.notNull())
      .execute()
  })

  beforeEach(async () => {
    await sql`delete from model_call_payloads`.execute(db)
  })

  afterAll(async () => {
    await closeDb()
    delete process.env.DATABASE_URL
    if (testDir) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  it('produces stable hashes for semantically equivalent payloads', () => {
    const a = {
      model: 'm',
      messages: [
        { role: 'system', content: 'x' },
        { role: 'user', content: 'y' },
      ],
      options: { temperature: 0.1, max_tokens: 123 },
    }
    const b = {
      options: { max_tokens: 123, temperature: 0.1 },
      messages: [
        { content: 'x', role: 'system' },
        { content: 'y', role: 'user' },
      ],
      model: 'm',
    }

    expect(hashCanonicalJson(a)).toBe(hashCanonicalJson(b))
  })

  it('produces different hashes for different payloads', () => {
    const a = { messages: [{ role: 'user', content: 'hello' }] }
    const b = { messages: [{ role: 'user', content: 'goodbye' }] }
    expect(hashCanonicalJson(a)).not.toBe(hashCanonicalJson(b))
  })

  it('upserts duplicate payloads idempotently', async () => {
    const payload = { model: 'test', messages: [{ role: 'user', content: 'ping' }] }

    const first = await upsertModelCallPayload({ payload, metadata: { source: 'test' } })
    const second = await upsertModelCallPayload({
      payload: { messages: [{ content: 'ping', role: 'user' }], model: 'test' },
      metadata: { source: 'second-write' },
    })

    expect(first.hash).toBe(second.hash)

    const { count } = await db
      .selectFrom('model_call_payloads')
      .select((eb) => eb.fn.count<string>('hash').as('count'))
      .executeTakeFirstOrThrow()

    expect(Number(count)).toBe(1)
  })

  it('handles concurrent inserts for the same hash', async () => {
    const payload = {
      model: 'stress',
      messages: Array.from({ length: 12 }, (_, i) => ({ role: 'user', content: `m-${i}` })),
    }

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        upsertModelCallPayload({ payload, metadata: { source: 'concurrency-test' } })
      )
    )

    const hashes = new Set(results.map((row) => row.hash))
    expect(hashes.size).toBe(1)

    const { count } = await db
      .selectFrom('model_call_payloads')
      .select((eb) => eb.fn.count<string>('hash').as('count'))
      .executeTakeFirstOrThrow()
    expect(Number(count)).toBe(1)
  })

  it('stores large payloads with byte size metadata', async () => {
    const largePayload = {
      model: 'large-model',
      messages: [{ role: 'user', content: 'x'.repeat(75_000) }],
    }

    const built = buildStoredModelCallPayload(largePayload)
    const stored = await upsertModelCallPayload({ payload: largePayload })

    expect(stored.hash).toBe(built.hash)
    expect(stored.byte_size).toBeGreaterThan(70_000)
    expect(stored.byte_size).toBe(built.byteSize)
  })
})
