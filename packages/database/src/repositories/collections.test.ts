import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { closeDb, getDb } from '../db'
import {
  approveCollectionSchemaReview,
  canAgentReadCollection,
  canAgentWriteCollection,
  findCollectionByName,
  getCollectionSchemaReviewById,
  insertCollectionRow,
  listCollectionPermissions,
  projectCollectionRow,
  queryCollectionRows,
  requestCollectionSchemaReview,
  searchCollectionRows,
  setCollectionPermission,
  upsertCollectionRow,
} from './collections'

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
    .createTable('users')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('email', 'text', (col) => col.notNull())
    .addColumn('email_verified', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('avatar_url', 'text')
    .addColumn('role', 'text', (col) => col.notNull().defaultTo('admin'))
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('active'))
    .addColumn('created_at', 'text', (col) => col.notNull())
    .addColumn('updated_at', 'text', (col) => col.notNull())
    .execute()

  await database.schema
    .createTable('collections')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('schema_json', 'text', (col) => col.notNull())
    .addColumn('schema_version', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('created_by_agent_id', 'text')
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('updated_at', 'integer', (col) => col.notNull())
    .addUniqueConstraint('collections_name_unique', ['name'])
    .execute()

  await database.schema
    .createTable('collection_rows')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('collection_id', 'text', (col) => col.notNull())
    .addColumn('data_json', 'text', (col) => col.notNull())
    .addColumn('content_json', 'text')
    .addColumn('search_text', 'text')
    .addColumn('created_by_agent_id', 'text')
    .addColumn('updated_by_agent_id', 'text')
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('updated_at', 'integer', (col) => col.notNull())
    .execute()

  await database.schema
    .createTable('collection_permissions')
    .ifNotExists()
    .addColumn('collection_id', 'text', (col) => col.notNull())
    .addColumn('agent_id', 'text', (col) => col.notNull())
    .addColumn('can_read', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('can_write', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('updated_at', 'integer', (col) => col.notNull())
    .addPrimaryKeyConstraint('collection_permissions_pk', ['collection_id', 'agent_id'])
    .execute()

  await database.schema
    .createTable('collection_schema_reviews')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('collection_id', 'text')
    .addColumn('collection_name', 'text', (col) => col.notNull())
    .addColumn('action', 'text', (col) => col.notNull())
    .addColumn('requested_by_agent_id', 'text', (col) => col.notNull())
    .addColumn('proposed_description', 'text')
    .addColumn('proposed_schema_json', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull())
    .addColumn('reviewed_by_user_id', 'text')
    .addColumn('review_notes', 'text')
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('updated_at', 'integer', (col) => col.notNull())
    .addColumn('reviewed_at', 'integer')
    .addColumn('applied_at', 'integer')
    .execute()
}

async function clearTables(database: ReturnType<typeof getDb>): Promise<void> {
  await database.deleteFrom('collection_rows').execute()
  await database.deleteFrom('collection_permissions').execute()
  await database.deleteFrom('collection_schema_reviews').execute()
  await database.deleteFrom('collections').execute()
  await database.deleteFrom('users').execute()
  await database.deleteFrom('agents').execute()
}

async function seedPrincipals(database: ReturnType<typeof getDb>): Promise<void> {
  const timestamp = Math.floor(Date.now() / 1000)
  await database
    .insertInto('agents')
    .values([
      {
        id: 'agent-1',
        handle: 'agent_one',
        name: 'Agent One',
        sprite_id: null,
        config: null,
        status: 'idle',
        created_at: timestamp,
        updated_at: timestamp,
      },
      {
        id: 'agent-2',
        handle: 'agent_two',
        name: 'Agent Two',
        sprite_id: null,
        config: null,
        status: 'idle',
        created_at: timestamp,
        updated_at: timestamp,
      },
    ])
    .execute()

  await database
    .insertInto('users')
    .values({
      id: 'user-1',
      name: 'Reviewer',
      email: 'reviewer@example.com',
      email_verified: 1,
      avatar_url: null,
      role: 'admin',
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .execute()
}

describe('collections repository', () => {
  beforeAll(async () => {
    await closeDb()
    testDir = mkdtempSync(join(tmpdir(), 'nitejar-db-collections-'))
    process.env.DATABASE_URL = join(testDir, 'test.sqlite')
    db = getDb()
    await createTestSchema(db)
  })

  afterAll(async () => {
    await closeDb()
    delete process.env.DATABASE_URL
    if (testDir) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  beforeEach(async () => {
    await clearTables(db)
    await seedPrincipals(db)
  })

  it('creates a pending schema review and applies it on approval', async () => {
    const requested = await requestCollectionSchemaReview({
      name: 'Content Log',
      description: 'Tracks content lifecycle',
      requestedByAgentId: 'agent-1',
      schema: {
        fields: [
          { name: 'topic', type: 'string', required: true },
          { name: 'status', type: 'enum', enumValues: ['draft', 'published'], required: true },
          { name: 'views_24h', type: 'number' },
          { name: 'script_body', type: 'longtext' },
        ],
      },
    })

    expect(requested.status).toBe('pending')
    expect(requested.review?.status).toBe('pending')
    expect(requested.review?.collection_name).toBe('content_log')

    const reviewId = requested.review!.id
    const fetched = await getCollectionSchemaReviewById(reviewId)
    expect(fetched?.id).toBe(reviewId)

    const approved = await approveCollectionSchemaReview({
      reviewId,
      reviewerUserId: 'user-1',
      notes: 'Looks good',
    })

    expect(approved.review.status).toBe('approved')
    expect(approved.collection.name).toBe('content_log')
    expect(approved.collection.schema.fields).toHaveLength(4)

    const collection = await findCollectionByName('content_log')
    expect(collection).not.toBeNull()

    const permissions = await listCollectionPermissions(collection!.id)
    expect(permissions).toHaveLength(1)
    expect(permissions[0]?.agent_id).toBe('agent-1')
    expect(permissions[0]?.can_write).toBe(true)
  })

  it('ignores stray enumValues on non-enum fields', async () => {
    const requested = await requestCollectionSchemaReview({
      name: 'hook_library',
      requestedByAgentId: 'agent-1',
      schema: {
        fields: [
          {
            name: 'hook_text',
            type: 'longtext',
            required: true,
            enumValues: ['placeholder'],
          },
          {
            name: 'pillar',
            type: 'string',
            enumValues: [],
          },
          {
            name: 'status',
            type: 'enum',
            enumValues: ['draft', 'published'],
          },
        ],
      },
    })

    expect(requested.status).toBe('pending')
    const fields = requested.review?.proposed_schema.fields ?? []
    expect(fields.find((field) => field.name === 'hook_text')?.enumValues).toBeUndefined()
    expect(fields.find((field) => field.name === 'pillar')?.enumValues).toBeUndefined()
    expect(fields.find((field) => field.name === 'status')?.enumValues).toEqual([
      'draft',
      'published',
    ])
  })

  it('supports insert/query/upsert/search with field routing and ACL', async () => {
    const requested = await requestCollectionSchemaReview({
      name: 'content_log',
      requestedByAgentId: 'agent-1',
      schema: {
        fields: [
          { name: 'topic', type: 'string', required: true },
          { name: 'status', type: 'enum', enumValues: ['draft', 'published'], required: true },
          { name: 'channel', type: 'enum', enumValues: ['tiktok', 'instagram'] },
          { name: 'views_24h', type: 'number' },
          { name: 'published_at', type: 'datetime' },
          { name: 'script_body', type: 'longtext' },
        ],
      },
    })

    const { collection } = await approveCollectionSchemaReview({
      reviewId: requested.review!.id,
      reviewerUserId: 'user-1',
    })

    expect(await canAgentReadCollection(collection.id, 'agent-1')).toBe(true)
    expect(await canAgentWriteCollection(collection.id, 'agent-1')).toBe(true)
    expect(await canAgentReadCollection(collection.id, 'agent-2')).toBe(false)

    await setCollectionPermission({
      collectionId: collection.id,
      agentId: 'agent-2',
      canRead: true,
      canWrite: false,
    })

    expect(await canAgentReadCollection(collection.id, 'agent-2')).toBe(true)
    expect(await canAgentWriteCollection(collection.id, 'agent-2')).toBe(false)

    const inserted = await insertCollectionRow({
      collectionId: collection.id,
      agentId: 'agent-1',
      data: {
        topic: 'Agent workflows',
        status: 'published',
        channel: 'tiktok',
        views_24h: 12000,
        published_at: '2026-02-20T10:00:00.000Z',
        script_body: 'Use receipts to prove every step.',
      },
    })

    expect(inserted.data.topic).toBe('Agent workflows')
    expect(inserted.content.script_body).toBe('Use receipts to prove every step.')

    const queried = await queryCollectionRows({
      collectionId: collection.id,
      filter: { status: 'published', views_24h: { gte: 10000 } },
      sort: { field: 'views_24h', direction: 'desc' },
      limit: 10,
    })

    expect(queried).toHaveLength(1)
    const projected = projectCollectionRow(queried[0]!, collection.schema)
    expect(projected.values.script_body).toBeUndefined()
    expect(projected.values.views_24h).toBe(12000)

    const upserted = await upsertCollectionRow({
      collectionId: collection.id,
      agentId: 'agent-1',
      match: { topic: 'Agent workflows' },
      data: { views_24h: 18000 },
    })

    expect(upserted.action).toBe('updated')
    expect(upserted.row.data.views_24h).toBe(18000)

    const search = await searchCollectionRows({
      collectionId: collection.id,
      search: 'receipts prove',
      filter: { status: 'published' },
      limit: 5,
    })

    expect(search).toHaveLength(1)
    expect(search[0]!.score).toBeGreaterThan(0)
  })
})
