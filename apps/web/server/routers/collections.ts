import { z } from 'zod'
import { getDb } from '@nitejar/database'
import {
  approveCollectionSchemaReview,
  countCollectionRows,
  findCollectionById,
  getCollectionSchemaReviewById,
  listCollectionsWithSummary,
  listCollectionPermissions,
  listCollectionSchemaReviews,
  projectCollectionRow,
  queryCollectionRows,
  rejectCollectionSchemaReview,
  setCollectionPermission,
  removeCollectionPermission,
  updateCollectionSchema,
} from '@nitejar/database'
import { protectedProcedure, router } from '../trpc'

const reviewStatusSchema = z.enum(['pending', 'approved', 'rejected'])

async function assertCanReviewCollectionRequest(params: {
  userId: string
  userRole: string | null | undefined
  requestedByAgentId: string
}): Promise<void> {
  if (params.userRole === 'superadmin' || params.userRole === 'admin') {
    return
  }

  const db = getDb()
  const membership = await db
    .selectFrom('team_members')
    .innerJoin('agent_teams', 'agent_teams.team_id', 'team_members.team_id')
    .select('team_members.user_id')
    .where('team_members.user_id', '=', params.userId)
    .where('agent_teams.agent_id', '=', params.requestedByAgentId)
    .executeTakeFirst()

  if (!membership) {
    throw new Error('You are not authorized to review this collection schema request.')
  }
}

function readSessionUserId(session: unknown): string | null {
  if (!session || typeof session !== 'object') return null
  const sessionRecord = session as Record<string, unknown>
  const user = sessionRecord.user
  if (!user || typeof user !== 'object') return null
  const userRecord = user as Record<string, unknown>
  const id = userRecord.id
  return typeof id === 'string' ? id : null
}

function readSessionUserRole(session: unknown): string | null {
  if (!session || typeof session !== 'object') return null
  const sessionRecord = session as Record<string, unknown>
  const user = sessionRecord.user
  if (!user || typeof user !== 'object') return null
  const userRecord = user as Record<string, unknown>
  const role = userRecord.role
  return typeof role === 'string' ? role : null
}

async function enrichPermissions(db: ReturnType<typeof getDb>, collectionId: string) {
  const agentRows = await db.selectFrom('agents').select(['id', 'name', 'handle']).execute()
  const agentById = new Map(agentRows.map((row) => [row.id, row]))

  const permissionRows = await db
    .selectFrom('collection_permissions')
    .selectAll()
    .where('collection_id', '=', collectionId)
    .execute()

  return permissionRows.map((permission) => {
    const agent = agentById.get(permission.agent_id)
    return {
      agentId: permission.agent_id,
      agentName: agent?.name ?? permission.agent_id,
      agentHandle: agent?.handle ?? permission.agent_id,
      canRead: permission.can_read === 1,
      canWrite: permission.can_write === 1,
    }
  })
}

export const collectionsRouter = router({
  listCollections: protectedProcedure.query(async () => {
    const db = getDb()
    const collections = await listCollectionsWithSummary()

    const agentRows = await db.selectFrom('agents').select(['id', 'name', 'handle']).execute()
    const agentById = new Map(agentRows.map((row) => [row.id, row]))

    const permissionRows = await db.selectFrom('collection_permissions').selectAll().execute()
    const permissionsByCollectionId = new Map<
      string,
      Array<{
        agentId: string
        agentName: string
        agentHandle: string
        canRead: boolean
        canWrite: boolean
      }>
    >()

    for (const permission of permissionRows) {
      const list = permissionsByCollectionId.get(permission.collection_id) ?? []
      const agent = agentById.get(permission.agent_id)
      list.push({
        agentId: permission.agent_id,
        agentName: agent?.name ?? permission.agent_id,
        agentHandle: agent?.handle ?? permission.agent_id,
        canRead: permission.can_read === 1,
        canWrite: permission.can_write === 1,
      })
      permissionsByCollectionId.set(permission.collection_id, list)
    }

    return collections.map((collection) => ({
      ...collection,
      permissions: permissionsByCollectionId.get(collection.id) ?? [],
    }))
  }),

  getById: protectedProcedure
    .input(z.object({ collectionId: z.string().trim().min(1) }))
    .query(async ({ input }) => {
      const db = getDb()
      const collection = await findCollectionById(input.collectionId)
      if (!collection) throw new Error('Collection not found.')

      const rowCount = await countCollectionRows(input.collectionId)
      const permissions = await enrichPermissions(db, input.collectionId)

      const pendingReviews = await listCollectionSchemaReviews({
        collectionId: input.collectionId,
        status: 'pending',
      })

      return {
        ...collection,
        rowCount,
        permissionCount: permissions.length,
        pendingReviewCount: pendingReviews.length,
        permissions,
      }
    }),

  listRows: protectedProcedure
    .input(
      z.object({
        collectionId: z.string().trim().min(1),
        limit: z.number().int().min(1).max(50).optional().default(20),
        offset: z.number().int().min(0).optional().default(0),
      })
    )
    .query(async ({ input }) => {
      const collection = await findCollectionById(input.collectionId)
      if (!collection) throw new Error('Collection not found.')
      const [rows, total] = await Promise.all([
        queryCollectionRows({
          collectionId: input.collectionId,
          limit: input.limit,
          offset: input.offset,
        }),
        countCollectionRows(input.collectionId),
      ])
      return {
        rows: rows.map((row) =>
          projectCollectionRow(row, collection.schema, { includeContent: false })
        ),
        total,
      }
    }),

  listSchemaReviews: protectedProcedure
    .input(
      z
        .object({
          status: reviewStatusSchema.optional(),
          collectionId: z.string().trim().min(1).optional(),
          limit: z.number().int().min(1).max(500).optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const db = getDb()
      const reviews = await listCollectionSchemaReviews({
        status: input?.status,
        collectionId: input?.collectionId,
        limit: input?.limit,
      })

      const requestedAgentIds = Array.from(
        new Set(reviews.map((review) => review.requested_by_agent_id))
      )
      const reviewedUserIds = Array.from(
        new Set(reviews.map((review) => review.reviewed_by_user_id).filter(Boolean) as string[])
      )

      const requesterRows =
        requestedAgentIds.length > 0
          ? await db
              .selectFrom('agents')
              .select(['id', 'name', 'handle'])
              .where('id', 'in', requestedAgentIds)
              .execute()
          : []

      const reviewerRows =
        reviewedUserIds.length > 0
          ? await db
              .selectFrom('users')
              .select(['id', 'name', 'email'])
              .where('id', 'in', reviewedUserIds)
              .execute()
          : []

      const requesterById = new Map(requesterRows.map((row) => [row.id, row]))
      const reviewerById = new Map(reviewerRows.map((row) => [row.id, row]))

      return reviews.map((review) => ({
        ...review,
        requester: requesterById.get(review.requested_by_agent_id)
          ? {
              id: review.requested_by_agent_id,
              name: requesterById.get(review.requested_by_agent_id)!.name,
              handle: requesterById.get(review.requested_by_agent_id)!.handle,
            }
          : {
              id: review.requested_by_agent_id,
              name: review.requested_by_agent_id,
              handle: review.requested_by_agent_id,
            },
        reviewer: review.reviewed_by_user_id
          ? {
              id: review.reviewed_by_user_id,
              name:
                reviewerById.get(review.reviewed_by_user_id)?.name ?? review.reviewed_by_user_id,
              email: reviewerById.get(review.reviewed_by_user_id)?.email ?? null,
            }
          : null,
      }))
    }),

  reviewSchemaRequest: protectedProcedure
    .input(
      z.object({
        reviewId: z.string().trim().min(1),
        decision: z.enum(['approve', 'reject']),
        notes: z.string().optional().nullable(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const review = await getCollectionSchemaReviewById(input.reviewId)
      if (!review) {
        throw new Error('Schema review request not found.')
      }

      const userId = readSessionUserId(ctx.session)
      if (!userId) {
        throw new Error('Missing user identity.')
      }

      await assertCanReviewCollectionRequest({
        userId,
        userRole: readSessionUserRole(ctx.session),
        requestedByAgentId: review.requested_by_agent_id,
      })

      if (input.decision === 'approve') {
        const approved = await approveCollectionSchemaReview({
          reviewId: input.reviewId,
          reviewerUserId: userId,
          notes: input.notes ?? null,
        })

        return {
          status: approved.review.status,
          review: approved.review,
          collection: approved.collection,
        }
      }

      const rejected = await rejectCollectionSchemaReview({
        reviewId: input.reviewId,
        reviewerUserId: userId,
        notes: input.notes ?? null,
      })

      return {
        status: rejected.status,
        review: rejected,
        collection: null,
      }
    }),

  setPermission: protectedProcedure
    .input(
      z.object({
        collectionId: z.string().trim().min(1),
        agentId: z.string().trim().min(1),
        canRead: z.boolean(),
        canWrite: z.boolean(),
      })
    )
    .mutation(async ({ input }) => {
      const permission = await setCollectionPermission({
        collectionId: input.collectionId,
        agentId: input.agentId,
        canRead: input.canRead,
        canWrite: input.canWrite,
      })

      return { permission }
    }),

  removePermission: protectedProcedure
    .input(
      z.object({
        collectionId: z.string().trim().min(1),
        agentId: z.string().trim().min(1),
      })
    )
    .mutation(async ({ input }) => {
      const removed = await removeCollectionPermission(input.collectionId, input.agentId)
      return { removed }
    }),

  updateSchema: protectedProcedure
    .input(
      z.object({
        collectionId: z.string().trim().min(1),
        name: z.string().trim().optional(),
        description: z.string().optional().nullable(),
        schema: z.unknown(),
      })
    )
    .mutation(async ({ input }) => {
      if (typeof input.schema !== 'object' || input.schema === null) {
        throw new Error('schema must be an object or field-definition array.')
      }

      const collection = await updateCollectionSchema({
        collectionId: input.collectionId,
        name: input.name,
        description: input.description ?? null,
        schema: input.schema as Record<string, unknown> | Array<Record<string, unknown>>,
      })

      const permissions = await listCollectionPermissions(collection.id)
      return { collection, permissions }
    }),
})
