import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'kysely'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { closeDb, getDb } from '../db'
import { appendMessage, markLastAssistantAsFinalResponse } from './messages'

let testDir = ''
let db: ReturnType<typeof getDb>

describe('markLastAssistantAsFinalResponse', () => {
  beforeAll(async () => {
    await closeDb()
    testDir = mkdtempSync(join(tmpdir(), 'nitejar-messages-'))
    process.env.DATABASE_URL = join(testDir, 'test.sqlite')
    db = getDb()

    await db.schema
      .createTable('messages')
      .ifNotExists()
      .addColumn('id', 'text', (col) => col.primaryKey())
      .addColumn('job_id', 'text', (col) => col.notNull())
      .addColumn('role', 'text', (col) => col.notNull())
      .addColumn('content', 'text')
      .addColumn('created_at', 'integer', (col) => col.notNull())
      .addColumn('embedding', 'blob')
      .execute()
  })

  beforeEach(async () => {
    await sql`delete from messages`.execute(db)
  })

  afterAll(async () => {
    await closeDb()
    rmSync(testDir, { recursive: true, force: true })
  })

  it('adds is_final_response flag to the last assistant message', async () => {
    const jobId = 'job-1'
    await appendMessage(jobId, 'system', { text: 'You are helpful.' })
    await appendMessage(jobId, 'user', { text: 'Hello' })
    await appendMessage(jobId, 'assistant', { text: 'Hi there!' })

    await markLastAssistantAsFinalResponse(jobId)

    const rows = await db
      .selectFrom('messages')
      .selectAll()
      .where('job_id', '=', jobId)
      .where('role', '=', 'assistant')
      .execute()

    expect(rows).toHaveLength(1)
    const content = JSON.parse(rows[0]!.content!) as Record<string, unknown>
    expect(content.text).toBe('Hi there!')
    expect(content.is_final_response).toBe(true)
  })

  it('targets only the last assistant message when multiple exist', async () => {
    const jobId = 'job-2'

    // Insert with explicit timestamps to guarantee ordering
    const id1 = 'msg-first'
    const id2 = 'msg-second'
    await db
      .insertInto('messages')
      .values({
        id: id1,
        job_id: jobId,
        role: 'assistant',
        content: JSON.stringify({ text: 'First response', tool_calls: [{ id: 't1' }] }),
        created_at: 1000,
      })
      .execute()
    await db
      .insertInto('messages')
      .values({
        id: id2,
        job_id: jobId,
        role: 'assistant',
        content: JSON.stringify({ text: 'Second response' }),
        created_at: 2000,
      })
      .execute()

    await markLastAssistantAsFinalResponse(jobId)

    const rows = await db
      .selectFrom('messages')
      .selectAll()
      .where('job_id', '=', jobId)
      .where('role', '=', 'assistant')
      .orderBy('created_at', 'asc')
      .execute()

    expect(rows).toHaveLength(2)
    const first = JSON.parse(rows[0]!.content!) as Record<string, unknown>
    const second = JSON.parse(rows[1]!.content!) as Record<string, unknown>
    expect(first.is_final_response).toBeUndefined()
    expect(second.is_final_response).toBe(true)
  })

  it('does not create a new message', async () => {
    const jobId = 'job-3'
    await appendMessage(jobId, 'user', { text: 'Hello' })
    await appendMessage(jobId, 'assistant', { text: 'Hi' })

    const beforeCount = await db
      .selectFrom('messages')
      .select((eb) => eb.fn.count<string>('id').as('count'))
      .where('job_id', '=', jobId)
      .executeTakeFirst()

    await markLastAssistantAsFinalResponse(jobId)

    const afterCount = await db
      .selectFrom('messages')
      .select((eb) => eb.fn.count<string>('id').as('count'))
      .where('job_id', '=', jobId)
      .executeTakeFirst()

    expect(afterCount!.count).toBe(beforeCount!.count)
  })

  it('is a no-op when no assistant messages exist', async () => {
    const jobId = 'job-4'
    await appendMessage(jobId, 'user', { text: 'Hello' })

    // Should not throw
    await markLastAssistantAsFinalResponse(jobId)

    const rows = await db.selectFrom('messages').selectAll().where('job_id', '=', jobId).execute()

    expect(rows).toHaveLength(1)
    expect(rows[0]!.role).toBe('user')
  })

  it('preserves existing content fields', async () => {
    const jobId = 'job-5'
    await appendMessage(jobId, 'assistant', {
      text: 'Here is the result',
      tool_calls: [{ id: 'tc-1', type: 'function', function: { name: 'bash', arguments: '{}' } }],
    })

    await markLastAssistantAsFinalResponse(jobId)

    const rows = await db
      .selectFrom('messages')
      .selectAll()
      .where('job_id', '=', jobId)
      .where('role', '=', 'assistant')
      .execute()

    const content = JSON.parse(rows[0]!.content!) as Record<string, unknown>
    expect(content.text).toBe('Here is the result')
    expect(content.tool_calls).toHaveLength(1)
    expect(content.is_final_response).toBe(true)
  })
})
