import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeTool, type ToolContext } from './tools'
import * as Database from '@nitejar/database'

vi.mock('@nitejar/database', async () => {
  const actual = await vi.importActual<typeof Database>('@nitejar/database')
  return {
    ...actual,
    findCollectionByName: vi.fn(),
    canAgentReadCollection: vi.fn(),
    canAgentWriteCollection: vi.fn(),
    canAgentAdminWriteCollection: vi.fn(),
    canAgentAdminWriteCollectionResource: vi.fn(),
    countCollectionRows: vi.fn(),
    listCollectionSchemaReviews: vi.fn(),
    getCollectionSchemaReviewById: vi.fn(),
    approveCollectionSchemaReview: vi.fn(),
    rejectCollectionSchemaReview: vi.fn(),
    defineCollection: vi.fn(),
    updateCollectionPermission: vi.fn(),
    updateCollectionSchema: vi.fn(),
  }
})

const mockedFindCollectionByName = vi.mocked(Database.findCollectionByName)
const mockedCanAgentReadCollection = vi.mocked(Database.canAgentReadCollection)
const mockedCanAgentWriteCollection = vi.mocked(Database.canAgentWriteCollection)
const mockedCanAgentAdminWriteCollection = vi.mocked(Database.canAgentAdminWriteCollection)
const mockedCanAgentAdminWriteCollectionResource = vi.mocked(Database.canAgentAdminWriteCollectionResource)
const mockedCountCollectionRows = vi.mocked(Database.countCollectionRows)
const mockedListCollectionSchemaReviews = vi.mocked(Database.listCollectionSchemaReviews)
const mockedGetCollectionSchemaReviewById = vi.mocked(Database.getCollectionSchemaReviewById)
const mockedApproveCollectionSchemaReview = vi.mocked(Database.approveCollectionSchemaReview)
const mockedRejectCollectionSchemaReview = vi.mocked(Database.rejectCollectionSchemaReview)
const mockedDefineCollection = vi.mocked(Database.defineCollection)
const mockedUpdateCollectionPermission = vi.mocked(Database.updateCollectionPermission)
const mockedUpdateCollectionSchema = vi.mocked(Database.updateCollectionSchema)

const context: ToolContext = {
  agentId: 'agent-1',
  spriteName: 'nitejar-agent-1',
}

function makeCollection(name = 'content_log') {
  return {
    id: 'collection-1',
    name,
    description: 'Tracks content lifecycle',
    schema: {
      fields: [
        { name: 'title', type: 'string' as const, required: true, description: null },
        { name: 'notes', type: 'longtext' as const, required: false, description: null },
      ],
    },
    schema_version: 2,
    created_by_agent_id: 'agent-1',
    created_at: 1,
    updated_at: 2,
  }
}

function makeReview(status: 'pending' | 'approved' | 'rejected' = 'pending') {
  return {
    id: 'review-1',
    collection_id: 'collection-1',
    collection_name: 'content_log',
    action: 'update' as const,
    requested_by_agent_id: 'agent-1',
    proposed_description: 'Tracks content lifecycle',
    proposed_schema: {
      fields: [{ name: 'title', type: 'string' as const, required: true }],
    },
    status,
    reviewed_by_user_id: null,
    review_notes: null,
    created_at: 1,
    updated_at: 1,
    reviewed_at: null,
    applied_at: null,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('collection tools', () => {
  it('reports content/admin write flags on collection_describe for privileged agents', async () => {
    mockedFindCollectionByName.mockResolvedValue(makeCollection())
    mockedCanAgentReadCollection.mockResolvedValue(true)
    mockedCanAgentWriteCollection.mockResolvedValue(true)
    mockedCanAgentAdminWriteCollection.mockResolvedValue(true)
    mockedCountCollectionRows.mockResolvedValue(7)

    const result = await executeTool('collection_describe', { collection: 'content_log' }, context)

    expect(result.success).toBe(true)
    const payload = JSON.parse(result.output ?? '{}') as {
      permissions?: { can_read?: boolean; can_content_write?: boolean; can_admin_write?: boolean }
    }
    expect(payload.permissions).toMatchObject({
      can_read: true,
      can_content_write: true,
      can_admin_write: true,
    })
  })

  it('lists, approves, and rejects collection schema reviews', async () => {
    mockedCanAgentAdminWriteCollectionResource.mockResolvedValue(true)
    mockedListCollectionSchemaReviews.mockResolvedValue([makeReview('pending')])
    mockedGetCollectionSchemaReviewById.mockResolvedValue(makeReview('pending'))
    mockedApproveCollectionSchemaReview.mockResolvedValue({
      review: { ...makeReview('approved'), status: 'approved' },
      collection: makeCollection(),
    } as never)
    mockedRejectCollectionSchemaReview.mockResolvedValue({ ...makeReview('rejected'), status: 'rejected' } as never)

    const listResult = await executeTool('collection_list_reviews', {}, context)
    expect(listResult.success).toBe(true)
    expect(listResult.output).toContain('"count": 1')

    const approveResult = await executeTool(
      'collection_review_schema',
      { review_id: 'review-1', decision: 'approve', notes: 'ship it' },
      context
    )
    expect(approveResult.success).toBe(true)
    expect(mockedApproveCollectionSchemaReview).toHaveBeenCalledWith(
      expect.objectContaining({ reviewId: 'review-1', reviewerUserId: 'agent-1', notes: 'ship it' })
    )

    const rejectResult = await executeTool(
      'collection_review_schema',
      { review_id: 'review-1', decision: 'reject', notes: 'nope' },
      context
    )
    expect(rejectResult.success).toBe(true)
    expect(mockedRejectCollectionSchemaReview).toHaveBeenCalledWith(
      expect.objectContaining({ reviewId: 'review-1', reviewerUserId: 'agent-1', notes: 'nope' })
    )
  })

  it('defines, updates permissions, and updates collection schema for admins', async () => {
    mockedFindCollectionByName.mockResolvedValue(makeCollection())
    mockedCanAgentAdminWriteCollection.mockResolvedValue(true)
    mockedCanAgentAdminWriteCollectionResource.mockResolvedValue(true)
    mockedDefineCollection.mockResolvedValue({
      status: 'created',
      action: 'create',
      collection: makeCollection(),
    } as never)
    mockedUpdateCollectionPermission.mockResolvedValue({
      collection_id: 'collection-1',
      agent_id: 'agent-2',
      can_read: true,
      can_write: true,
      created_at: 1,
      updated_at: 2,
    })
    mockedUpdateCollectionSchema.mockResolvedValue({
      ...makeCollection(),
      schema_version: 3,
    } as never)

    const defineResult = await executeTool(
      'define_collection',
      {
        name: 'content_log',
        description: 'Tracks content lifecycle',
        fields: [{ name: 'title', type: 'string' }],
      },
      context
    )
    expect(defineResult.success).toBe(true)
    expect(mockedDefineCollection).toHaveBeenCalledWith({
      name: 'content_log',
      description: 'Tracks content lifecycle',
      schema: [{ name: 'title', type: 'string' }],
      agentId: 'agent-1',
    })

    const setResult = await executeTool(
      'collection_update_permission',
      {
        collection: 'content_log',
        agent_id: 'agent-2',
        access: 'readwrite',
      },
      context
    )
    expect(setResult.success).toBe(true)
    expect(mockedUpdateCollectionPermission).toHaveBeenCalledWith({
      collectionId: 'collection-1',
      agentId: 'agent-2',
      access: 'readwrite',
    })

    const removeResult = await executeTool(
      'collection_update_permission',
      {
        collection: 'content_log',
        agent_id: 'agent-2',
        access: 'none',
      },
      context
    )
    expect(removeResult.success).toBe(true)
    expect(mockedUpdateCollectionPermission).toHaveBeenLastCalledWith({
      collectionId: 'collection-1',
      agentId: 'agent-2',
      access: 'none',
    })

    const updateResult = await executeTool(
      'collection_update_schema',
      {
        collection: 'content_log',
        description: 'Updated description',
        fields: [{ name: 'title', type: 'string' }],
      },
      context
    )
    expect(updateResult.success).toBe(true)
    expect(mockedUpdateCollectionSchema).toHaveBeenCalledWith(
      expect.objectContaining({
        collectionId: 'collection-1',
        description: 'Updated description',
        schema: { fields: [{ name: 'title', type: 'string' }] },
      })
    )
  })
})
