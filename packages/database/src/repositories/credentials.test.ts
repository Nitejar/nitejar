import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { closeDb, getDb } from '../db'
import {
  createCredential,
  deleteCredential,
  getCredentialById,
  getCredentialUsageSummary,
  getCredentialForAgentByAlias,
  isCredentialAliasAvailable,
  listCredentialAssignments,
  listCredentialsForAgent,
  setAgentCredentialAssignment,
  updateCredential,
} from './credentials'

let testDir = ''
let db: ReturnType<typeof getDb>

async function createTestSchema(database: ReturnType<typeof getDb>): Promise<void> {
  await database.schema
    .createTable('agents')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('handle', 'text', (col) => col.notNull())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('sprite_id', 'text')
    .addColumn('config', 'text')
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('idle'))
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('updated_at', 'integer', (col) => col.notNull())
    .execute()

  await database.schema
    .createTable('credentials')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('alias', 'text', (col) => col.notNull().unique())
    .addColumn('provider', 'text', (col) => col.notNull())
    .addColumn('auth_type', 'text', (col) => col.notNull())
    .addColumn('secret_encrypted', 'text', (col) => col.notNull())
    .addColumn('auth_key', 'text', (col) => col.notNull())
    .addColumn('auth_scheme', 'text')
    .addColumn('allowed_hosts', 'text', (col) => col.notNull())
    .addColumn('enabled', 'integer', (col) => col.notNull())
    .addColumn('allowed_in_header', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('allowed_in_query', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('allowed_in_body', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('updated_at', 'integer', (col) => col.notNull())
    .execute()

  await database.schema
    .createTable('agent_credentials')
    .ifNotExists()
    .addColumn('agent_id', 'text', (col) =>
      col.notNull().references('agents.id').onDelete('cascade')
    )
    .addColumn('credential_id', 'text', (col) =>
      col.notNull().references('credentials.id').onDelete('cascade')
    )
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addPrimaryKeyConstraint('agent_credentials_pk', ['agent_id', 'credential_id'])
    .execute()

  await database.schema
    .createTable('audit_logs')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('event_type', 'text', (col) => col.notNull())
    .addColumn('agent_id', 'text')
    .addColumn('github_repo_id', 'integer')
    .addColumn('capability', 'text')
    .addColumn('result', 'text')
    .addColumn('metadata', 'text')
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .execute()

  await database.schema
    .createTable('external_api_calls')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('job_id', 'text', (col) => col.notNull())
    .addColumn('agent_id', 'text', (col) => col.notNull())
    .addColumn('provider', 'text', (col) => col.notNull())
    .addColumn('operation', 'text', (col) => col.notNull())
    .addColumn('cost_usd', 'real')
    .addColumn('credits_used', 'real')
    .addColumn('duration_ms', 'integer')
    .addColumn('metadata', 'text')
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .execute()
}

async function seedAgent(agentId: string): Promise<void> {
  await db
    .insertInto('agents')
    .values({
      id: agentId,
      handle: 'agent',
      name: 'Agent',
      sprite_id: null,
      config: null,
      status: 'idle',
      created_at: 1,
      updated_at: 1,
    })
    .execute()
}

async function clearTables(): Promise<void> {
  await db.deleteFrom('external_api_calls').execute()
  await db.deleteFrom('audit_logs').execute()
  await db.deleteFrom('agent_credentials').execute()
  await db.deleteFrom('credentials').execute()
  await db.deleteFrom('agents').execute()
}

describe('credentials repository', () => {
  const originalDbUrl = process.env.DATABASE_URL
  const originalKey = process.env.ENCRYPTION_KEY

  beforeAll(async () => {
    await closeDb()
    testDir = mkdtempSync(join(tmpdir(), 'nitejar-credentials-'))
    process.env.DATABASE_URL = join(testDir, 'test.sqlite')
    process.env.ENCRYPTION_KEY = 'a'.repeat(64)
    db = getDb()
    await createTestSchema(db)
  })

  afterAll(async () => {
    await closeDb()
    if (originalDbUrl !== undefined) process.env.DATABASE_URL = originalDbUrl
    else delete process.env.DATABASE_URL
    if (originalKey !== undefined) process.env.ENCRYPTION_KEY = originalKey
    else delete process.env.ENCRYPTION_KEY
    if (testDir) rmSync(testDir, { recursive: true, force: true })
  })

  beforeEach(async () => {
    await clearTables()
    await seedAgent('agent-1')
  })

  it('encrypts secrets at rest and decrypts only for assigned agent lookup', async () => {
    const created = await createCredential({
      alias: 'instagram_graph_api',
      provider: 'instagram',
      secret: 'top-secret-token',
      authKey: 'Authorization',
      authScheme: 'Bearer',
      allowedHosts: ['graph.facebook.com'],
      enabled: true,
      allowedInHeader: true,
    })

    const row = await db
      .selectFrom('credentials')
      .select(['secret_encrypted'])
      .where('id', '=', created.id)
      .executeTakeFirstOrThrow()
    expect(row.secret_encrypted).not.toBe('top-secret-token')
    expect(row.secret_encrypted.startsWith('enc:')).toBe(true)

    const beforeAssignment = await getCredentialForAgentByAlias('agent-1', 'instagram_graph_api')
    expect(beforeAssignment).toBeNull()

    await setAgentCredentialAssignment({
      credentialId: created.id,
      agentId: 'agent-1',
      enabled: true,
    })

    const usable = await getCredentialForAgentByAlias('agent-1', 'instagram_graph_api')
    expect(usable?.secret).toBe('top-secret-token')
  })

  it('enforces alias uniqueness and keeps alias immutable through updates', async () => {
    const first = await createCredential({
      alias: 'shared_alias',
      provider: 'api-one',
      secret: 's1',
      authKey: 'Authorization',
      authScheme: 'Bearer',
      allowedHosts: ['api.one.com'],
      allowedInHeader: true,
    })

    await expect(
      createCredential({
        alias: 'shared_alias',
        provider: 'api-two',
        secret: 's2',
        authKey: 'access_token',
        authScheme: null,
        allowedHosts: ['api.two.com'],
        allowedInQuery: true,
      })
    ).rejects.toThrow()

    await updateCredential(first.id, {
      provider: 'api-one-updated',
      authKey: 'token',
      authScheme: null,
      allowedHosts: ['api.one.com', '*.api.one.com'],
      allowedInHeader: false,
      allowedInQuery: true,
    })

    const updated = await getCredentialById(first.id)
    expect(updated?.alias).toBe('shared_alias')
    expect(updated?.provider).toBe('api-one-updated')
    expect(updated?.allowedInQuery).toBe(true)

    expect(await isCredentialAliasAvailable('shared_alias')).toBe(false)
    expect(await isCredentialAliasAvailable('shared_alias', first.id)).toBe(true)
  })

  it('supports assignment toggle and cascades assignment rows on credential delete', async () => {
    const created = await createCredential({
      alias: 'delete_me',
      provider: 'provider',
      secret: 'abc',
      authKey: 'Authorization',
      authScheme: 'Bearer',
      allowedHosts: ['api.example.com'],
      allowedInHeader: true,
    })

    await setAgentCredentialAssignment({
      credentialId: created.id,
      agentId: 'agent-1',
      enabled: true,
    })

    let assigned = await listCredentialsForAgent('agent-1')
    expect(assigned).toHaveLength(1)

    await setAgentCredentialAssignment({
      credentialId: created.id,
      agentId: 'agent-1',
      enabled: false,
    })
    assigned = await listCredentialsForAgent('agent-1')
    expect(assigned).toHaveLength(0)

    await setAgentCredentialAssignment({
      credentialId: created.id,
      agentId: 'agent-1',
      enabled: true,
    })

    const deleted = await deleteCredential(created.id)
    expect(deleted).toBe(true)

    const assignments = await listCredentialAssignments(created.id)
    expect(assignments).toHaveLength(0)
  })

  it('aggregates usage summary from audit and external API call receipts', async () => {
    const created = await createCredential({
      alias: 'usage_alias',
      provider: 'provider',
      secret: 'abc',
      authKey: 'Authorization',
      authScheme: 'Bearer',
      allowedHosts: ['api.example.com'],
      allowedInHeader: true,
    })

    await db
      .insertInto('audit_logs')
      .values([
        {
          id: 'audit-1',
          event_type: 'CREDENTIAL_REQUEST_SUCCESS',
          agent_id: 'agent-1',
          github_repo_id: null,
          capability: 'credential_http_request',
          result: 'allowed',
          metadata: JSON.stringify({ credentialId: created.id }),
          created_at: 200,
        },
        {
          id: 'audit-2',
          event_type: 'CREDENTIAL_REQUEST_FAIL',
          agent_id: 'agent-1',
          github_repo_id: null,
          capability: 'credential_http_request',
          result: 'error',
          metadata: JSON.stringify({ credentialId: created.id }),
          created_at: 300,
        },
        {
          id: 'audit-3',
          event_type: 'CREDENTIAL_REQUEST_DENIED',
          agent_id: 'agent-1',
          github_repo_id: null,
          capability: 'credential_http_request',
          result: 'denied',
          metadata: JSON.stringify({ credentialId: created.id }),
          created_at: 400,
        },
      ])
      .execute()

    await db
      .insertInto('external_api_calls')
      .values([
        {
          id: 'ext-1',
          job_id: 'job-1',
          agent_id: 'agent-1',
          provider: 'provider',
          operation: 'secure_http_request',
          cost_usd: null,
          credits_used: null,
          duration_ms: 120,
          metadata: JSON.stringify({ credentialId: created.id }),
          created_at: 500,
        },
      ])
      .execute()

    const summary = await getCredentialUsageSummary(created.id)
    expect(summary.successCount).toBe(1)
    expect(summary.failCount).toBe(1)
    expect(summary.deniedCount).toBe(1)
    expect(summary.totalCalls).toBe(3)
    expect(summary.lastUsedAt).toBe(500)
    expect(summary.lastStatus).toBe('denied')
  })
})
