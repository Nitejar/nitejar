import type Anthropic from '@anthropic-ai/sdk'
import {
  canAgentReadCollection,
  canAgentAdminWriteCollection,
  canAgentAdminWriteCollectionResource,
  canAgentWriteCollection,
  approveCollectionSchemaReview,
  countCollectionRows,
  defineCollection,
  findCollectionByName,
  getCollectionRowById,
  insertCollectionRow,
  projectCollectionRow,
  queryCollectionRows,
  listCollectionSchemaReviews,
  searchCollectionRows,
  rejectCollectionSchemaReview,
  updateCollectionPermission,
  getCollectionSchemaReviewById,
  updateCollectionSchema,
  type CollectionFilter,
  type CollectionSortSpec,
  upsertCollectionRow,
} from '@nitejar/database'
import type { ToolHandler } from '../types'

export const collectionDefinitions: Anthropic.Tool[] = [
  {
    name: 'define_collection',
    description:
      'Directly create or update a shared collection schema. Requires collection.admin.write.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'Collection name in snake_case, for example content_log.',
        },
        description: {
          type: 'string',
          description: 'Human-readable purpose of the collection.',
        },
        fields: {
          type: 'array',
          description:
            'Field definitions. Each item must include name and a field type. "enum" is just one possible type.',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              type: {
                type: 'string',
                description:
                  'Field type. Choose one of: string, number, boolean, datetime, enum, longtext. Only enum fields should include enumValues.',
                enum: ['string', 'number', 'boolean', 'datetime', 'enum', 'longtext'],
              },
              description: { type: 'string' },
              required: { type: 'boolean' },
              enumValues: {
                type: 'array',
                description: 'Required when type is "enum". Do not send for non-enum fields.',
                items: { type: 'string' },
              },
            },
            allOf: [
              {
                if: {
                  properties: {
                    type: { const: 'enum' },
                  },
                },
                then: {
                  required: ['enumValues'],
                },
                else: {
                  not: {
                    required: ['enumValues'],
                  },
                },
              },
            ],
            required: ['name', 'type'],
          },
        },
      },
      required: ['name', 'fields'],
    },
  },
  {
    name: 'collection_list_reviews',
    description:
      'List collection schema reviews, including pending requests that may need approval. Requires collection.admin.write.',
    input_schema: {
      type: 'object' as const,
      properties: {
        collection: { type: 'string', description: 'Optional collection name filter.' },
        status: {
          type: 'string',
          enum: ['pending', 'approved', 'rejected'],
          description: 'Optional review status filter.',
        },
        limit: {
          type: 'integer',
          description: 'Optional limit (default 20, max 100).',
        },
      },
    },
  },
  {
    name: 'collection_review_schema',
    description:
      'Approve or reject a pending collection schema review. Requires collection.admin.write.',
    input_schema: {
      type: 'object' as const,
      properties: {
        review_id: { type: 'string', description: 'Review ID.' },
        decision: {
          type: 'string',
          enum: ['approve', 'reject'],
          description: 'Approve or reject the pending review.',
        },
        notes: {
          type: 'string',
          description: 'Optional review notes.',
        },
      },
      required: ['review_id', 'decision'],
    },
  },
  {
    name: 'collection_update_permission',
    description:
      'Set or remove a collection ACL entry for an agent. Requires collection.admin.write.',
    input_schema: {
      type: 'object' as const,
      properties: {
        collection: { type: 'string', description: 'Collection name.' },
        agent_id: { type: 'string', description: 'Agent ID.' },
        access: {
          type: 'string',
          enum: ['none', 'read', 'readwrite'],
          description: 'ACL access level. Use none to remove the agent from the collection ACL.',
        },
      },
      required: ['collection', 'agent_id', 'access'],
    },
  },
  {
    name: 'collection_update_schema',
    description:
      'Directly update a collection schema and metadata. Requires collection.admin.write.',
    input_schema: {
      type: 'object' as const,
      properties: {
        collection: { type: 'string', description: 'Collection name.' },
        name: { type: 'string', description: 'Optional new collection name.' },
        description: {
          type: 'string',
          description: 'Optional new collection description.',
        },
        fields: {
          type: 'array',
          description: 'Full replacement field definitions for the collection schema.',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              type: {
                type: 'string',
                enum: ['string', 'number', 'boolean', 'datetime', 'enum', 'longtext'],
              },
              description: { type: 'string' },
              required: { type: 'boolean' },
              enumValues: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
      required: ['collection', 'fields'],
    },
  },
  {
    name: 'collection_describe',
    description:
      'Inspect collection schema and metadata. Use this before inserts/updates when field names or types are unknown.',
    input_schema: {
      type: 'object' as const,
      properties: {
        collection: { type: 'string', description: 'Collection name.' },
      },
      required: ['collection'],
    },
  },
  {
    name: 'collection_query',
    description:
      'Query rows by structured metadata filters/sort. This does not search longtext content.',
    input_schema: {
      type: 'object' as const,
      properties: {
        collection: { type: 'string', description: 'Collection name.' },
        filter: {
          description: 'Filter object, e.g. {"status":"published"} or {"views_24h":{"gte":1000}}.',
        },
        sort: {
          description:
            'Sort by field. Either {"field":"published_at","direction":"desc"} or {"published_at":"desc"}.',
        },
        limit: { type: 'integer', description: 'Max rows to return (default 20, max 100).' },
        include_content: {
          type: 'boolean',
          description: 'Include longtext fields in returned rows (default false).',
        },
      },
      required: ['collection'],
    },
  },
  {
    name: 'collection_search',
    description:
      'Full-text search across longtext content fields, optionally narrowed by metadata filters.',
    input_schema: {
      type: 'object' as const,
      properties: {
        collection: { type: 'string', description: 'Collection name.' },
        search: { type: 'string', description: 'Search query string.' },
        filter: {
          description: 'Optional metadata filter object applied after text matching.',
        },
        limit: { type: 'integer', description: 'Max rows to return (default 20, max 100).' },
        include_content: {
          type: 'boolean',
          description: 'Include longtext fields in returned rows (default true).',
        },
      },
      required: ['collection', 'search'],
    },
  },
  {
    name: 'collection_get',
    description: 'Fetch a single row by row ID from a collection.',
    input_schema: {
      type: 'object' as const,
      properties: {
        collection: { type: 'string', description: 'Collection name.' },
        row_id: { type: 'string', description: 'Row ID.' },
        include_content: {
          type: 'boolean',
          description: 'Include longtext fields in returned values (default true).',
        },
      },
      required: ['collection', 'row_id'],
    },
  },
  {
    name: 'collection_insert',
    description: 'Insert one row into a collection with schema validation.',
    input_schema: {
      type: 'object' as const,
      properties: {
        collection: { type: 'string', description: 'Collection name.' },
        data: {
          type: 'object',
          description: 'Row payload object keyed by field names.',
          additionalProperties: true,
        },
      },
      required: ['collection', 'data'],
    },
  },
  {
    name: 'collection_upsert',
    description:
      'Upsert one row by match object. If a row matches, update it; otherwise insert a new row.',
    input_schema: {
      type: 'object' as const,
      properties: {
        collection: { type: 'string', description: 'Collection name.' },
        match: {
          type: 'object',
          description: 'Match object used to locate an existing row.',
          additionalProperties: true,
        },
        data: {
          type: 'object',
          description: 'Patch/insert payload keyed by field names.',
          additionalProperties: true,
        },
      },
      required: ['collection', 'match', 'data'],
    },
  },
]

function asObject(input: unknown, fieldName: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(`${fieldName} must be an object.`)
  }
  return input as Record<string, unknown>
}

function parseCollectionName(input: unknown): string {
  const collection = typeof input === 'string' ? input.trim() : ''
  if (!collection) {
    throw new Error('collection is required.')
  }
  return collection
}

function parseLimit(input: unknown, fallback: number): number {
  const limit = typeof input === 'number' ? Math.floor(input) : fallback
  return Math.min(Math.max(limit, 1), 100)
}

function parseFilter(input: unknown): CollectionFilter | undefined {
  if (input === undefined || input === null) return undefined
  return asObject(input, 'filter') as CollectionFilter
}

function parseSort(input: unknown): CollectionSortSpec | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined

  const obj = input as Record<string, unknown>
  const field = typeof obj.field === 'string' ? obj.field.trim() : ''
  if (field) {
    const direction = obj.direction === 'asc' ? 'asc' : 'desc'
    return { field, direction }
  }

  const entries = Object.entries(obj)
  if (entries.length === 1) {
    const [entryField, entryDirection] = entries[0]!
    return {
      field: entryField,
      direction: entryDirection === 'asc' ? 'asc' : 'desc',
    }
  }

  throw new Error('sort must be {field, direction} or {fieldName: direction}.')
}

async function getCollectionForAccess(params: {
  collectionName: string
  agentId: string
  mode: 'read' | 'write'
}) {
  const collection = await findCollectionByName(params.collectionName)
  if (!collection) {
    throw new Error(`Collection ${params.collectionName} not found.`)
  }

  const allowed =
    params.mode === 'write'
      ? await canAgentWriteCollection(collection.id, params.agentId)
      : await canAgentReadCollection(collection.id, params.agentId)

  if (!allowed) {
    throw new Error(
      `You do not have ${params.mode} access to ${collection.name}. Ask a human to update permissions in Admin > Collections.`
    )
  }

  return collection
}

async function getAdminCollection(params: { collectionName: string; agentId: string }) {
  const collection = await findCollectionByName(params.collectionName)
  if (!collection) {
    throw new Error(`Collection ${params.collectionName} not found.`)
  }

  const allowed = await canAgentAdminWriteCollection(collection.id, params.agentId)
  if (!allowed) {
    throw new Error(
      `You do not have admin access to ${collection.name}. Ask a human to update permissions in Admin > Collections or grant the agent collection.admin.write.`
    )
  }

  return collection
}

async function requireCollectionAdminAccess(params: {
  agentId: string
  collectionId: string | null
  collectionName: string
}) {
  const allowed = await canAgentAdminWriteCollectionResource(params.agentId, params.collectionId)
  if (!allowed) {
    throw new Error(
      `You do not have admin access to ${params.collectionName}. Ask a human to update permissions in Admin > Collections or grant the agent collection.admin.write.`
    )
  }
}

export const defineCollectionTool: ToolHandler = async (input, context) => {
  if (!context.agentId) {
    return { success: false, error: 'Missing agent identity.' }
  }

  try {
    const name = typeof input.name === 'string' ? input.name.trim() : ''
    if (!name) {
      return { success: false, error: 'name is required.' }
    }

    const fields = input.fields
    if (!fields) {
      return { success: false, error: 'fields is required.' }
    }
    const schemaInput = Array.isArray(fields) ? fields : asObject(fields, 'fields')
    const description = typeof input.description === 'string' ? input.description : null
    const existing = await findCollectionByName(name)

    await requireCollectionAdminAccess({
      agentId: context.agentId,
      collectionId: existing?.id ?? null,
      collectionName: existing?.name ?? name,
    })

    const defined = await defineCollection({
      name,
      description,
      schema: schemaInput,
      agentId: context.agentId,
    })

    return {
      success: true,
      output:
        defined.status === 'noop'
          ? `Collection ${defined.collection.name} is already up to date.`
          : `${defined.action === 'create' ? 'Created' : 'Updated'} collection ${defined.collection.name} (schema v${defined.collection.schema_version}).`,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to define collection.',
    }
  }
}

export const collectionListReviewsTool: ToolHandler = async (input, context) => {
  if (!context.agentId) {
    return { success: false, error: 'Missing agent identity.' }
  }

  try {
    const collectionName = typeof input.collection === 'string' ? input.collection.trim() : ''
    const status =
      input.status === 'pending' || input.status === 'approved' || input.status === 'rejected'
        ? input.status
        : undefined
    const limit = typeof input.limit === 'number' ? input.limit : undefined

    const collection = collectionName ? await findCollectionByName(collectionName) : null
    if (collectionName && !collection) {
      throw new Error(`Collection ${collectionName} not found.`)
    }

    if (collection) {
      await requireCollectionAdminAccess({
        agentId: context.agentId,
        collectionId: collection.id,
        collectionName: collection.name,
      })
    } else {
      const allowed = await canAgentAdminWriteCollectionResource(context.agentId, null)
      if (!allowed) {
        return {
          success: false,
          error:
            'You do not have admin access to collections. Ask a human to update permissions in Admin > Collections or grant the agent collection.admin.write.',
        }
      }
    }

    const reviews = await listCollectionSchemaReviews({
      collectionId: collection?.id,
      status,
      limit,
    })

    return {
      success: true,
      output: JSON.stringify(
        {
          count: reviews.length,
          reviews,
        },
        null,
        2
      ),
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list collection reviews.',
    }
  }
}

export const collectionReviewSchemaTool: ToolHandler = async (input, context) => {
  if (!context.agentId) {
    return { success: false, error: 'Missing agent identity.' }
  }

  try {
    const reviewId = typeof input.review_id === 'string' ? input.review_id.trim() : ''
    const decision =
      input.decision === 'approve' ? 'approve' : input.decision === 'reject' ? 'reject' : null
    const notes = typeof input.notes === 'string' ? input.notes : null

    if (!reviewId) {
      return { success: false, error: 'review_id is required.' }
    }
    if (!decision) {
      return { success: false, error: 'decision must be approve or reject.' }
    }

    const review = await getCollectionSchemaReviewById(reviewId)
    if (!review) {
      return { success: false, error: `Review ${reviewId} not found.` }
    }

    await requireCollectionAdminAccess({
      agentId: context.agentId,
      collectionId: review.collection_id,
      collectionName: review.collection_name,
    })

    if (decision === 'approve') {
      const approved = await approveCollectionSchemaReview({
        reviewId,
        reviewerUserId: context.agentId,
        notes,
      })
      return {
        success: true,
        output: JSON.stringify(
          {
            status: approved.review.status,
            review: approved.review,
            collection: approved.collection,
          },
          null,
          2
        ),
      }
    }

    const rejected = await rejectCollectionSchemaReview({
      reviewId,
      reviewerUserId: context.agentId,
      notes,
    })
    return {
      success: true,
      output: JSON.stringify(
        {
          status: rejected.status,
          review: rejected,
          collection: null,
        },
        null,
        2
      ),
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to review collection schema.',
    }
  }
}

export const collectionUpdatePermissionTool: ToolHandler = async (input, context) => {
  if (!context.agentId) {
    return { success: false, error: 'Missing agent identity.' }
  }

  try {
    const collectionName = parseCollectionName(input.collection)
    const agentId = typeof input.agent_id === 'string' ? input.agent_id.trim() : ''
    if (!agentId) {
      return { success: false, error: 'agent_id is required.' }
    }
    const access =
      input.access === 'none' || input.access === 'read' || input.access === 'readwrite'
        ? input.access
        : null
    if (!access) {
      return { success: false, error: 'access must be none, read, or readwrite.' }
    }

    const collection = await getAdminCollection({
      collectionName,
      agentId: context.agentId,
    })

    const permission = await updateCollectionPermission({
      collectionId: collection.id,
      agentId,
      access,
    })

    return {
      success: true,
      output: JSON.stringify(
        {
          collection: collection.name,
          access,
          permission,
        },
        null,
        2
      ),
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update collection permission.',
    }
  }
}

export const collectionUpdateSchemaTool: ToolHandler = async (input, context) => {
  if (!context.agentId) {
    return { success: false, error: 'Missing agent identity.' }
  }

  try {
    const collectionName = parseCollectionName(input.collection)
    const fields = input.fields
    if (!Array.isArray(fields)) {
      return { success: false, error: 'fields must be an array.' }
    }

    const collection = await getAdminCollection({
      collectionName,
      agentId: context.agentId,
    })

    const updated = await updateCollectionSchema({
      collectionId: collection.id,
      name: typeof input.name === 'string' ? input.name.trim() || undefined : undefined,
      description:
        typeof input.description === 'string'
          ? input.description
          : input.description === null
            ? null
            : undefined,
      schema: { fields: fields as Array<Record<string, unknown>> },
    })

    return {
      success: true,
      output: JSON.stringify(
        {
          collection: updated,
        },
        null,
        2
      ),
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update collection schema.',
    }
  }
}

export const collectionQueryTool: ToolHandler = async (input, context) => {
  if (!context.agentId) {
    return { success: false, error: 'Missing agent identity.' }
  }

  try {
    const collectionName = parseCollectionName(input.collection)
    const collection = await getCollectionForAccess({
      collectionName,
      agentId: context.agentId,
      mode: 'read',
    })

    const rows = await queryCollectionRows({
      collectionId: collection.id,
      filter: parseFilter(input.filter),
      sort: parseSort(input.sort),
      limit: parseLimit(input.limit, 20),
    })

    const includeContent = input.include_content === true
    const projected = rows.map((row) =>
      projectCollectionRow(row, collection.schema, { includeContent })
    )

    return {
      success: true,
      output: JSON.stringify(
        {
          collection: collection.name,
          count: projected.length,
          rows: projected,
        },
        null,
        2
      ),
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to query collection.',
    }
  }
}

export const collectionDescribeTool: ToolHandler = async (input, context) => {
  if (!context.agentId) {
    return { success: false, error: 'Missing agent identity.' }
  }

  try {
    const collectionName = parseCollectionName(input.collection)
    const collection = await getCollectionForAccess({
      collectionName,
      agentId: context.agentId,
      mode: 'read',
    })

    const [rowCount, canWrite, canAdminWrite] = await Promise.all([
      countCollectionRows(collection.id),
      canAgentWriteCollection(collection.id, context.agentId),
      canAgentAdminWriteCollection(collection.id, context.agentId),
    ])

    return {
      success: true,
      output: JSON.stringify(
        {
          collection: collection.name,
          description: collection.description,
          schema_version: collection.schema_version,
          schema: collection.schema,
          row_count: rowCount,
          permissions: {
            can_read: true,
            can_content_write: canWrite,
            can_admin_write: canAdminWrite,
          },
        },
        null,
        2
      ),
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to describe collection.',
    }
  }
}

export const collectionSearchTool: ToolHandler = async (input, context) => {
  if (!context.agentId) {
    return { success: false, error: 'Missing agent identity.' }
  }

  try {
    const collectionName = parseCollectionName(input.collection)
    const search = typeof input.search === 'string' ? input.search.trim() : ''
    if (!search) {
      return { success: false, error: 'search is required.' }
    }

    const collection = await getCollectionForAccess({
      collectionName,
      agentId: context.agentId,
      mode: 'read',
    })

    const includeContent = input.include_content !== false
    const rows = await searchCollectionRows({
      collectionId: collection.id,
      search,
      filter: parseFilter(input.filter),
      limit: parseLimit(input.limit, 20),
    })

    const projected = rows.map((row) => ({
      ...projectCollectionRow(row, collection.schema, { includeContent }),
      score: row.score,
    }))

    return {
      success: true,
      output: JSON.stringify(
        {
          collection: collection.name,
          search,
          count: projected.length,
          rows: projected,
        },
        null,
        2
      ),
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to search collection.',
    }
  }
}

export const collectionGetTool: ToolHandler = async (input, context) => {
  if (!context.agentId) {
    return { success: false, error: 'Missing agent identity.' }
  }

  try {
    const collectionName = parseCollectionName(input.collection)
    const rowId = typeof input.row_id === 'string' ? input.row_id.trim() : ''
    if (!rowId) {
      return { success: false, error: 'row_id is required.' }
    }

    const collection = await getCollectionForAccess({
      collectionName,
      agentId: context.agentId,
      mode: 'read',
    })

    const row = await getCollectionRowById(collection.id, rowId)
    if (!row) {
      return { success: false, error: `Row ${rowId} not found in ${collection.name}.` }
    }

    const includeContent = input.include_content !== false

    return {
      success: true,
      output: JSON.stringify(
        {
          collection: collection.name,
          row: projectCollectionRow(row, collection.schema, { includeContent }),
        },
        null,
        2
      ),
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get collection row.',
    }
  }
}

export const collectionInsertTool: ToolHandler = async (input, context) => {
  if (!context.agentId) {
    return { success: false, error: 'Missing agent identity.' }
  }

  try {
    const collectionName = parseCollectionName(input.collection)
    const data = asObject(input.data, 'data')
    const collection = await getCollectionForAccess({
      collectionName,
      agentId: context.agentId,
      mode: 'write',
    })

    const row = await insertCollectionRow({
      collectionId: collection.id,
      data,
      agentId: context.agentId,
    })

    return {
      success: true,
      output: JSON.stringify(
        {
          collection: collection.name,
          row: projectCollectionRow(row, collection.schema, { includeContent: true }),
        },
        null,
        2
      ),
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to insert row.',
    }
  }
}

export const collectionUpsertTool: ToolHandler = async (input, context) => {
  if (!context.agentId) {
    return { success: false, error: 'Missing agent identity.' }
  }

  try {
    const collectionName = parseCollectionName(input.collection)
    const match = asObject(input.match, 'match')
    const data = asObject(input.data, 'data')

    if (Object.keys(match).length === 0) {
      return { success: false, error: 'match must include at least one field.' }
    }

    const collection = await getCollectionForAccess({
      collectionName,
      agentId: context.agentId,
      mode: 'write',
    })

    const result = await upsertCollectionRow({
      collectionId: collection.id,
      match,
      data,
      agentId: context.agentId,
    })

    return {
      success: true,
      output: JSON.stringify(
        {
          collection: collection.name,
          action: result.action,
          row: projectCollectionRow(result.row, collection.schema, { includeContent: true }),
        },
        null,
        2
      ),
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to upsert row.',
    }
  }
}
