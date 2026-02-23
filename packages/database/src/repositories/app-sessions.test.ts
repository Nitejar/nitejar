import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../db'
import {
  addAppSessionParticipants,
  createAppSession,
  findAppSessionByKeyAndOwner,
  listAppSessionParticipantAgents,
  listAppSessionsByOwner,
} from './app-sessions'

let testDir = ''
let db: ReturnType<typeof getDb>

function now(): number {
  return Math.floor(Date.now() / 1000)
}

async function createTestSchema(database: ReturnType<typeof getDb>): Promise<void> {
  await database.schema
    .createTable('users')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('email', 'text', (col) => col.notNull())
    .addColumn('email_verified', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('avatar_url', 'text')
    .addColumn('role', 'text', (col) => col.notNull().defaultTo('member'))
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('active'))
    .addColumn('created_at', 'text', (col) => col.notNull().defaultTo('now'))
    .addColumn('updated_at', 'text', (col) => col.notNull().defaultTo('now'))
    .execute()

  await database.schema
    .createTable('agents')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('handle', 'text', (col) => col.notNull())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('sprite_id', 'text')
    .addColumn('config', 'text')
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('idle'))
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(now()))
    .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(now()))
    .execute()

  await database.schema
    .createTable('app_sessions')
    .ifNotExists()
    .addColumn('session_key', 'text', (col) => col.primaryKey())
    .addColumn('owner_user_id', 'text', (col) => col.notNull())
    .addColumn('primary_agent_id', 'text', (col) => col.notNull())
    .addColumn('title', 'text')
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(now()))
    .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(now()))
    .addColumn('last_activity_at', 'integer', (col) => col.notNull().defaultTo(now()))
    .execute()

  await database.schema
    .createTable('app_session_participants')
    .ifNotExists()
    .addColumn('session_key', 'text', (col) => col.notNull())
    .addColumn('agent_id', 'text', (col) => col.notNull())
    .addColumn('added_by_user_id', 'text', (col) => col.notNull())
    .addColumn('added_at', 'integer', (col) => col.notNull().defaultTo(now()))
    .addPrimaryKeyConstraint('app_session_participants_pk', ['session_key', 'agent_id'])
    .execute()
}

async function seedBaseRows(): Promise<void> {
  await db
    .insertInto('users')
    .values([
      {
        id: 'user-1',
        name: 'User One',
        email: 'one@example.com',
        email_verified: 1,
        avatar_url: null,
        role: 'member',
        status: 'active',
        created_at: 'now',
        updated_at: 'now',
      },
      {
        id: 'user-2',
        name: 'User Two',
        email: 'two@example.com',
        email_verified: 1,
        avatar_url: null,
        role: 'member',
        status: 'active',
        created_at: 'now',
        updated_at: 'now',
      },
    ])
    .execute()

  await db
    .insertInto('agents')
    .values([
      {
        id: 'agent-1',
        handle: 'scout',
        name: 'Scout',
        sprite_id: null,
        config: null,
        status: 'idle',
        created_at: now(),
        updated_at: now(),
      },
      {
        id: 'agent-2',
        handle: 'researcher',
        name: 'Researcher',
        sprite_id: null,
        config: null,
        status: 'idle',
        created_at: now(),
        updated_at: now(),
      },
    ])
    .execute()
}

describe('app session repository', () => {
  beforeAll(async () => {
    await closeDb()
    testDir = mkdtempSync(join(tmpdir(), 'nitejar-app-sessions-'))
    process.env.DATABASE_URL = join(testDir, 'test.sqlite')
    db = getDb()
    await createTestSchema(db)
  })

  afterAll(async () => {
    await closeDb()
    delete process.env.DATABASE_URL
    if (testDir) rmSync(testDir, { recursive: true, force: true })
  })

  beforeEach(async () => {
    await db.deleteFrom('app_session_participants').execute()
    await db.deleteFrom('app_sessions').execute()
    await db.deleteFrom('agents').execute()
    await db.deleteFrom('users').execute()
    await seedBaseRows()
  })

  it('creates and lists sessions by owner', async () => {
    await createAppSession({
      session_key: 'app:user-1:abc',
      owner_user_id: 'user-1',
      primary_agent_id: 'agent-1',
      title: null,
    })
    await createAppSession({
      session_key: 'app:user-2:def',
      owner_user_id: 'user-2',
      primary_agent_id: 'agent-1',
      title: null,
    })

    const user1Sessions = await listAppSessionsByOwner('user-1')
    expect(user1Sessions).toHaveLength(1)
    expect(user1Sessions[0]?.session_key).toBe('app:user-1:abc')
  })

  it('enforces owner scoping on find by key', async () => {
    await createAppSession({
      session_key: 'app:user-1:abc',
      owner_user_id: 'user-1',
      primary_agent_id: 'agent-1',
      title: null,
    })

    const owned = await findAppSessionByKeyAndOwner('app:user-1:abc', 'user-1')
    const foreign = await findAppSessionByKeyAndOwner('app:user-1:abc', 'user-2')

    expect(owned?.owner_user_id).toBe('user-1')
    expect(foreign).toBeNull()
  })

  it('adds participants idempotently and returns participant agent rows', async () => {
    await createAppSession({
      session_key: 'app:user-1:abc',
      owner_user_id: 'user-1',
      primary_agent_id: 'agent-1',
      title: null,
    })

    await addAppSessionParticipants({
      sessionKey: 'app:user-1:abc',
      agentIds: ['agent-1', 'agent-2', 'agent-2'],
      addedByUserId: 'user-1',
    })

    const participants = await listAppSessionParticipantAgents('app:user-1:abc')
    expect(participants.map((p) => p.id)).toEqual(['agent-1', 'agent-2'])
  })
})
