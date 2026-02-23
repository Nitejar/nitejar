import { TRPCError } from '@trpc/server'
import { extractMentions } from '@nitejar/agent/mention-parser'
import { parseAgentConfig } from '@nitejar/agent/config'
import { generateUuidV7 } from '@nitejar/core'
import {
  addAppSessionParticipants,
  createAppSession,
  findAgentById,
  findAppSessionByKeyAndOwner,
  getDb,
  listAgents,
  listAppSessionParticipantAgents,
  listAppSessionsByOwner,
} from '@nitejar/database'
import { z } from 'zod'
import { enqueueAppSessionMessage } from '../services/app-session-enqueue'
import { protectedProcedure, router } from '../trpc'

const MAX_SESSION_LIST = 50
const DEFAULT_TIMELINE_LIMIT = 30
const MAX_TIMELINE_LIMIT = 50

type WorkItemPayload = {
  body?: string
  senderName?: string
  senderUserId?: string
  sessionKey?: string
  targetAgentIds?: string[]
  clientMessageId?: string
}

type TimelineReplyStatus = 'queued' | 'running' | 'completed' | 'failed'
type TimelineTurnStatus = 'queued' | 'running' | 'completed' | 'failed'

type DispatchStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'abandoned'
  | 'cancelled'
  | 'merged'

function requireUserId(session: unknown): string {
  const userId =
    session &&
    typeof session === 'object' &&
    'user' in session &&
    session.user &&
    typeof session.user === 'object' &&
    'id' in session.user &&
    typeof session.user.id === 'string'
      ? session.user.id
      : null
  if (!userId) {
    throw new TRPCError({ code: 'UNAUTHORIZED' })
  }
  return userId
}

function getUserName(session: unknown): string {
  const name =
    session &&
    typeof session === 'object' &&
    'user' in session &&
    session.user &&
    typeof session.user === 'object' &&
    'name' in session.user &&
    typeof session.user.name === 'string'
      ? session.user.name
      : null
  return (name && name.trim()) || 'User'
}

function parseJsonObject(value: string | null): Record<string, unknown> | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

function parseWorkItemPayload(value: string | null): WorkItemPayload {
  const parsed = parseJsonObject(value)
  if (!parsed) return {}
  const targetAgentIdsRaw = parsed.targetAgentIds
  const targetAgentIds =
    Array.isArray(targetAgentIdsRaw) && targetAgentIdsRaw.every((id) => typeof id === 'string')
      ? targetAgentIdsRaw
      : undefined
  return {
    body: typeof parsed.body === 'string' ? parsed.body : undefined,
    senderName: typeof parsed.senderName === 'string' ? parsed.senderName : undefined,
    senderUserId: typeof parsed.senderUserId === 'string' ? parsed.senderUserId : undefined,
    sessionKey: typeof parsed.sessionKey === 'string' ? parsed.sessionKey : undefined,
    targetAgentIds,
    clientMessageId:
      typeof parsed.clientMessageId === 'string' ? parsed.clientMessageId : undefined,
  }
}

function extractAssistantText(value: string | null): string | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as unknown
    if (typeof parsed === 'string') return parsed.trim() || null
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const parsedRecord = parsed as Record<string, unknown>
      const maybeText =
        typeof parsedRecord.text === 'string'
          ? parsedRecord.text
          : typeof parsedRecord.content === 'string'
            ? parsedRecord.content
            : null
      return maybeText?.trim() || null
    }
    return value.trim() || null
  } catch {
    return value.trim() || null
  }
}

function truncateText(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, maxChars - 1)}…`
}

function laneAgentIdFromQueueKey(queueKey: string): string | null {
  const parts = queueKey.split(':').filter(Boolean)
  return parts.length > 0 ? (parts[parts.length - 1] ?? null) : null
}

function mapJobStatusToReplyStatus(status: string): TimelineReplyStatus {
  if (status === 'RUNNING' || status === 'PAUSED') return 'running'
  if (status === 'PENDING') return 'queued'
  if (status === 'COMPLETED') return 'completed'
  return 'failed'
}

function mapDispatchStatusToReplyStatus(status: DispatchStatus): TimelineReplyStatus {
  if (status === 'running' || status === 'paused') return 'running'
  if (status === 'queued') return 'queued'
  if (status === 'completed') return 'completed'
  return 'failed'
}

type EnqueueAgent = { id: string; handle: string; name: string }

async function resolveSessionTargets(input: {
  sessionKey: string
  primaryAgentId: string
  message: string
}): Promise<EnqueueAgent[]> {
  const participants = await listAppSessionParticipantAgents(input.sessionKey)
  const byHandle = new Map(participants.map((agent) => [agent.handle.toLowerCase(), agent]))
  const knownHandles = participants.map((agent) => agent.handle)
  const mentionedHandles = extractMentions(input.message, knownHandles)
  if (mentionedHandles.length > 0) {
    return mentionedHandles.flatMap((handle) => {
      const agent = byHandle.get(handle)
      if (!agent) return []
      return [{ id: agent.id, handle: agent.handle, name: agent.name }]
    })
  }

  const primary = participants.find((agent) => agent.id === input.primaryAgentId)
  if (primary) {
    return [{ id: primary.id, handle: primary.handle, name: primary.name }]
  }

  const fallbackPrimary = await findAgentById(input.primaryAgentId)
  if (!fallbackPrimary) return []
  return [
    {
      id: fallbackPrimary.id,
      handle: fallbackPrimary.handle,
      name: fallbackPrimary.name,
    },
  ]
}

function computeFailedTurnStatus(input: {
  jobStatuses: string[]
  dispatchStatuses: DispatchStatus[]
}): boolean {
  const hasCompletedJob = input.jobStatuses.includes('COMPLETED')
  const hasActiveJob = input.jobStatuses.some((status) =>
    ['PENDING', 'RUNNING', 'PAUSED'].includes(status)
  )
  const hasActiveDispatch = input.dispatchStatuses.some((status) =>
    ['queued', 'running', 'paused'].includes(status)
  )
  const hasFailedJob = input.jobStatuses.some((status) => ['FAILED', 'CANCELLED'].includes(status))
  const hasFailedDispatch = input.dispatchStatuses.some((status) =>
    ['failed', 'cancelled', 'abandoned'].includes(status)
  )

  return (
    !hasCompletedJob && !hasActiveJob && !hasActiveDispatch && (hasFailedJob || hasFailedDispatch)
  )
}

const TWENTY_FOUR_HOURS = 24 * 60 * 60

export const sessionsRouter = router({
  startOrResume: protectedProcedure
    .input(z.object({ agentId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const userId = requireUserId(ctx.session)
      const agent = await findAgentById(input.agentId)
      if (!agent) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found.' })
      }

      const db = getDb()
      const cutoff = Math.floor(Date.now() / 1000) - TWENTY_FOUR_HOURS
      const recent = await db
        .selectFrom('app_sessions')
        .select(['session_key'])
        .where('owner_user_id', '=', userId)
        .where('primary_agent_id', '=', input.agentId)
        .where('created_at', '>=', cutoff)
        .orderBy('created_at', 'desc')
        .limit(1)
        .executeTakeFirst()

      if (recent) {
        return { sessionKey: recent.session_key }
      }

      const sessionKey = `app:${userId}:${generateUuidV7()}`
      await createAppSession({
        session_key: sessionKey,
        owner_user_id: userId,
        primary_agent_id: input.agentId,
        title: null,
      })
      await addAppSessionParticipants({
        sessionKey,
        agentIds: [input.agentId],
        addedByUserId: userId,
      })
      return { sessionKey }
    }),

  list: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(MAX_SESSION_LIST).default(MAX_SESSION_LIST),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const db = getDb()
      const userId = requireUserId(ctx.session)
      const sessions = await listAppSessionsByOwner(userId, {
        limit: input?.limit ?? MAX_SESSION_LIST,
      })

      const items = await Promise.all(
        sessions.map(async (session) => {
          const participants = await listAppSessionParticipantAgents(session.session_key)
          const participantViews = participants.map((agent) => {
            const config = parseAgentConfig(agent.config)
            return {
              id: agent.id,
              handle: agent.handle,
              name: agent.name,
              title: config.title ?? null,
              emoji: config.emoji ?? null,
              avatarUrl: config.avatarUrl ?? null,
            }
          })

          const firstWorkItem = await db
            .selectFrom('work_items')
            .select(['id', 'payload', 'title'])
            .where('session_key', '=', session.session_key)
            .where('source', '=', 'app_chat')
            .orderBy('created_at', 'asc')
            .limit(1)
            .executeTakeFirst()

          const displayTitle = session.title?.trim()
            ? session.title
            : truncateText(
                parseWorkItemPayload(firstWorkItem?.payload ?? null).body ??
                  firstWorkItem?.title ??
                  'New session',
                60
              )

          const lastWorkItem = await db
            .selectFrom('work_items')
            .select(['id', 'payload', 'title', 'created_at'])
            .where('session_key', '=', session.session_key)
            .where('source', '=', 'app_chat')
            .orderBy('created_at', 'desc')
            .orderBy('id', 'desc')
            .limit(1)
            .executeTakeFirst()

          let preview = 'No messages yet'
          let lastMessageAt = session.last_activity_at
          if (lastWorkItem) {
            lastMessageAt = lastWorkItem.created_at
            const latestAssistant = await db
              .selectFrom('messages')
              .innerJoin('jobs', 'jobs.id', 'messages.job_id')
              .innerJoin('agents', 'agents.id', 'jobs.agent_id')
              .select(['messages.content', 'messages.created_at', 'agents.name'])
              .where('jobs.work_item_id', '=', lastWorkItem.id)
              .where('messages.role', '=', 'assistant')
              .orderBy('messages.created_at', 'desc')
              .limit(1)
              .executeTakeFirst()

            if (latestAssistant) {
              const assistantText = extractAssistantText(latestAssistant.content) ?? '(no text)'
              preview = truncateText(`${latestAssistant.name}: ${assistantText}`, 80)
              lastMessageAt = latestAssistant.created_at
            } else {
              const userBody = parseWorkItemPayload(lastWorkItem.payload).body ?? lastWorkItem.title
              preview = truncateText(`You: ${userBody}`, 80)
            }
          }

          return {
            sessionKey: session.session_key,
            title: session.title,
            displayTitle,
            preview,
            primaryAgentId: session.primary_agent_id,
            createdAt: session.created_at,
            updatedAt: session.updated_at,
            lastActivityAt: session.last_activity_at,
            lastMessageAt,
            participants: participantViews,
          }
        })
      )

      return { items }
    }),

  listAgents: protectedProcedure.query(async () => {
    const agents = await listAgents()
    return agents.map((agent) => {
      const config = parseAgentConfig(agent.config)
      return {
        id: agent.id,
        handle: agent.handle,
        name: agent.name,
        title: config.title ?? null,
        emoji: config.emoji ?? null,
        avatarUrl: config.avatarUrl ?? null,
      }
    })
  }),

  create: protectedProcedure
    .input(
      z.object({
        title: z.string().trim().max(200).nullable().optional(),
        primaryAgentId: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = requireUserId(ctx.session)
      const agent = await findAgentById(input.primaryAgentId)
      if (!agent) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Primary agent not found.' })
      }

      const sessionKey = `app:${userId}:${generateUuidV7()}`
      const session = await createAppSession({
        session_key: sessionKey,
        owner_user_id: userId,
        primary_agent_id: input.primaryAgentId,
        title: input.title?.trim() || null,
      })

      await addAppSessionParticipants({
        sessionKey,
        agentIds: [input.primaryAgentId],
        addedByUserId: userId,
      })

      return {
        sessionKey: session.session_key,
        primaryAgentId: session.primary_agent_id,
      }
    }),

  get: protectedProcedure
    .input(z.object({ sessionKey: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const userId = requireUserId(ctx.session)
      const session = await findAppSessionByKeyAndOwner(input.sessionKey, userId)
      if (!session) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Session not found.' })
      }

      const participants = await listAppSessionParticipantAgents(session.session_key)
      return {
        sessionKey: session.session_key,
        title: session.title,
        primaryAgentId: session.primary_agent_id,
        createdAt: session.created_at,
        lastActivityAt: session.last_activity_at,
        participants: participants.map((agent) => {
          const config = parseAgentConfig(agent.config)
          return {
            id: agent.id,
            handle: agent.handle,
            name: agent.name,
            title: config.title ?? null,
            emoji: config.emoji ?? null,
            avatarUrl: config.avatarUrl ?? null,
          }
        }),
      }
    }),

  timeline: protectedProcedure
    .input(
      z.object({
        sessionKey: z.string().min(1),
        limit: z.number().int().min(1).max(MAX_TIMELINE_LIMIT).default(DEFAULT_TIMELINE_LIMIT),
        cursor: z
          .object({
            createdAt: z.number().int(),
            id: z.string(),
          })
          .nullish(),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = getDb()
      const userId = requireUserId(ctx.session)
      const session = await findAppSessionByKeyAndOwner(input.sessionKey, userId)
      if (!session) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Session not found.' })
      }

      let query = db
        .selectFrom('work_items')
        .select([
          'id',
          'session_key',
          'source',
          'source_ref',
          'title',
          'payload',
          'status',
          'created_at',
        ])
        .where('session_key', '=', input.sessionKey)
        .where('source', '=', 'app_chat')

      if (input.cursor) {
        query = query.where((eb) =>
          eb.or([
            eb('created_at', '<', input.cursor!.createdAt),
            eb.and([
              eb('created_at', '=', input.cursor!.createdAt),
              eb('id', '<', input.cursor!.id),
            ]),
          ])
        )
      }

      const rows = await query
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .limit(input.limit + 1)
        .execute()

      const hasMore = rows.length > input.limit
      const workItems = hasMore ? rows.slice(0, input.limit) : rows
      const next = workItems[workItems.length - 1]
      const nextCursor =
        hasMore && next
          ? {
              createdAt: next.created_at,
              id: next.id,
            }
          : null

      const workItemIds = workItems.map((item) => item.id)
      if (workItemIds.length === 0) {
        const activeDispatch = await db
          .selectFrom('run_dispatches')
          .select('id')
          .where('session_key', '=', input.sessionKey)
          .where('status', 'in', ['queued', 'running', 'paused'])
          .limit(1)
          .executeTakeFirst()
        return {
          turns: [] as Array<{
            workItemId: string
            createdAt: number
            userMessage: string
            senderName: string | null
            status: TimelineTurnStatus
            canRetry: boolean
            agentReplies: Array<{
              jobId: string | null
              agentId: string
              agentHandle: string
              agentName: string
              status: TimelineReplyStatus
              message: string | null
              runLink: string
            }>
          }>,
          nextCursor,
          hasActiveDispatch: !!activeDispatch,
        }
      }

      const [jobs, assistantMessages, dispatches, queueMessages, participants] = await Promise.all([
        db
          .selectFrom('jobs')
          .select(['id', 'work_item_id', 'agent_id', 'status', 'created_at', 'final_response'])
          .where('work_item_id', 'in', workItemIds)
          .orderBy('created_at', 'asc')
          .execute(),
        db
          .selectFrom('messages')
          .innerJoin('jobs', 'jobs.id', 'messages.job_id')
          .select([
            'messages.id',
            'messages.job_id',
            'messages.content',
            'messages.created_at',
            'jobs.work_item_id',
          ])
          .where('jobs.work_item_id', 'in', workItemIds)
          .where('messages.role', '=', 'assistant')
          .orderBy('messages.created_at', 'asc')
          .execute(),
        db
          .selectFrom('run_dispatches')
          .select(['id', 'work_item_id', 'agent_id', 'status', 'created_at'])
          .where('work_item_id', 'in', workItemIds)
          .orderBy('created_at', 'asc')
          .execute(),
        db
          .selectFrom('queue_messages')
          .select(['work_item_id', 'queue_key', 'status'])
          .where('work_item_id', 'in', workItemIds)
          .execute(),
        listAppSessionParticipantAgents(input.sessionKey),
      ])

      const participantById = new Map(
        participants.map((agent) => [
          agent.id,
          {
            id: agent.id,
            handle: agent.handle,
            name: agent.name,
          },
        ])
      )

      const jobsByWorkItem = new Map<string, typeof jobs>()
      for (const job of jobs) {
        const list = jobsByWorkItem.get(job.work_item_id) ?? []
        list.push(job)
        jobsByWorkItem.set(job.work_item_id, list)
      }

      const latestAssistantByJob = new Map<string, { text: string | null; createdAt: number }>()
      for (const message of assistantMessages) {
        const text = extractAssistantText(message.content)
        latestAssistantByJob.set(message.job_id, { text, createdAt: message.created_at })
      }

      const dispatchByWorkItemAgent = new Map<string, DispatchStatus>()
      for (const dispatch of dispatches) {
        dispatchByWorkItemAgent.set(
          `${dispatch.work_item_id}:${dispatch.agent_id}`,
          dispatch.status as DispatchStatus
        )
      }

      const queueByWorkItemAgent = new Map<string, string>()
      for (const message of queueMessages) {
        const agentId = laneAgentIdFromQueueKey(message.queue_key)
        if (!agentId) continue
        queueByWorkItemAgent.set(`${message.work_item_id}:${agentId}`, message.status)
      }

      const turns = workItems.map((item) => {
        const payload = parseWorkItemPayload(item.payload)
        const jobsForItem = jobsByWorkItem.get(item.id) ?? []
        const jobsByAgent = new Map<string, (typeof jobs)[number]>()
        for (const job of jobsForItem) {
          jobsByAgent.set(job.agent_id, job)
        }

        const targetAgentIds = new Set<string>(payload.targetAgentIds ?? [])
        for (const job of jobsForItem) {
          targetAgentIds.add(job.agent_id)
        }

        const agentReplies: Array<{
          jobId: string | null
          agentId: string
          agentHandle: string
          agentName: string
          status: TimelineReplyStatus
          message: string | null
          runLink: string
        }> = []

        for (const targetAgentId of targetAgentIds) {
          const participant = participantById.get(targetAgentId)
          const job = jobsByAgent.get(targetAgentId)
          const runLink = `/admin/work-items/${item.id}`
          if (job) {
            const assistant = latestAssistantByJob.get(job.id)
            const message =
              assistant?.text ?? (job.final_response ? job.final_response.trim() : null)
            agentReplies.push({
              jobId: job.id,
              agentId: targetAgentId,
              agentHandle: participant?.handle ?? targetAgentId,
              agentName: participant?.name ?? participant?.handle ?? targetAgentId,
              status: mapJobStatusToReplyStatus(job.status),
              message: message && message.length > 0 ? message : null,
              runLink,
            })
            continue
          }

          const dispatchStatus = dispatchByWorkItemAgent.get(`${item.id}:${targetAgentId}`)
          const queueStatus = queueByWorkItemAgent.get(`${item.id}:${targetAgentId}`)
          const status = dispatchStatus
            ? mapDispatchStatusToReplyStatus(dispatchStatus)
            : queueStatus === 'pending' || queueStatus === 'included'
              ? 'queued'
              : 'queued'

          agentReplies.push({
            jobId: null,
            agentId: targetAgentId,
            agentHandle: participant?.handle ?? targetAgentId,
            agentName: participant?.name ?? participant?.handle ?? targetAgentId,
            status,
            message: null,
            runLink,
          })
        }

        const hasRunningReply = agentReplies.some((reply) => reply.status === 'running')
        const hasQueuedReply = agentReplies.some((reply) => reply.status === 'queued')
        const hasCompletedReply = agentReplies.some((reply) => reply.status === 'completed')
        const status: TimelineTurnStatus = hasRunningReply
          ? 'running'
          : hasQueuedReply
            ? 'queued'
            : hasCompletedReply
              ? 'completed'
              : 'failed'

        return {
          workItemId: item.id,
          createdAt: item.created_at,
          userMessage: payload.body ?? item.title,
          senderName: payload.senderName ?? null,
          status,
          canRetry: false,
          agentReplies,
          runLink: `/admin/work-items/${item.id}`,
        }
      })

      const latestFailedTurn = turns.find((turn) => turn.status === 'failed')
      if (latestFailedTurn) {
        latestFailedTurn.canRetry = true
      }

      const hasActiveDispatch = dispatches.some((dispatch) =>
        ['queued', 'running', 'paused'].includes(dispatch.status)
      )

      return { turns, nextCursor, hasActiveDispatch }
    }),

  sendMessage: protectedProcedure
    .input(
      z.object({
        sessionKey: z.string().min(1),
        message: z.string().trim().min(1).max(20_000),
        clientMessageId: z.string().trim().max(256).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = requireUserId(ctx.session)
      const senderName = getUserName(ctx.session)
      const session = await findAppSessionByKeyAndOwner(input.sessionKey, userId)
      if (!session) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Session not found.' })
      }

      const targets = await resolveSessionTargets({
        sessionKey: session.session_key,
        primaryAgentId: session.primary_agent_id,
        message: input.message,
      })

      if (targets.length === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'No valid participant target found for this message.',
        })
      }

      const result = await enqueueAppSessionMessage({
        sessionKey: session.session_key,
        userId,
        senderName,
        message: input.message,
        targetAgents: targets,
        clientMessageId: input.clientMessageId,
      })

      return {
        ok: true,
        sessionKey: session.session_key,
        workItemId: result.workItemId,
        targetAgentIds: result.targetAgentIds,
      }
    }),

  addParticipants: protectedProcedure
    .input(
      z.object({
        sessionKey: z.string().min(1),
        agentIds: z.array(z.string().min(1)).min(1).max(50),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = requireUserId(ctx.session)
      const session = await findAppSessionByKeyAndOwner(input.sessionKey, userId)
      if (!session) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Session not found.' })
      }

      const uniqueIds = [...new Set(input.agentIds)]
      const foundAgents = await Promise.all(uniqueIds.map((id) => findAgentById(id)))
      const missing = uniqueIds.filter((_, index) => !foundAgents[index])
      if (missing.length > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Unknown agent IDs: ${missing.join(', ')}`,
        })
      }

      await addAppSessionParticipants({
        sessionKey: input.sessionKey,
        agentIds: uniqueIds,
        addedByUserId: userId,
      })
      const participants = await listAppSessionParticipantAgents(input.sessionKey)
      return {
        ok: true,
        participants: participants.map((agent) => {
          const config = parseAgentConfig(agent.config)
          return {
            id: agent.id,
            handle: agent.handle,
            name: agent.name,
            title: config.title ?? null,
            emoji: config.emoji ?? null,
            avatarUrl: config.avatarUrl ?? null,
          }
        }),
      }
    }),

  retryMessage: protectedProcedure
    .input(z.object({ sessionKey: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb()
      const userId = requireUserId(ctx.session)
      const senderName = getUserName(ctx.session)
      const session = await findAppSessionByKeyAndOwner(input.sessionKey, userId)
      if (!session) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Session not found.' })
      }

      const candidateWorkItems = await db
        .selectFrom('work_items')
        .select(['id', 'payload', 'title', 'created_at'])
        .where('session_key', '=', input.sessionKey)
        .where('source', '=', 'app_chat')
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .limit(100)
        .execute()

      let latestFailed: (typeof candidateWorkItems)[number] | null = null
      for (const workItem of candidateWorkItems) {
        const jobs = await db
          .selectFrom('jobs')
          .select(['status'])
          .where('work_item_id', '=', workItem.id)
          .execute()
        const dispatches = await db
          .selectFrom('run_dispatches')
          .select(['status'])
          .where('work_item_id', '=', workItem.id)
          .execute()

        const isFailed = computeFailedTurnStatus({
          jobStatuses: jobs.map((job) => job.status),
          dispatchStatuses: dispatches.map((dispatch) => dispatch.status as DispatchStatus),
        })
        if (isFailed) {
          latestFailed = workItem
          break
        }
      }

      if (!latestFailed) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'No failed message is eligible for retry in this session.',
        })
      }

      const payload = parseWorkItemPayload(latestFailed.payload)
      const message = payload.body ?? latestFailed.title
      const participantAgents = await listAppSessionParticipantAgents(input.sessionKey)
      const participantById = new Map(participantAgents.map((agent) => [agent.id, agent]))
      const targetAgentIds = (payload.targetAgentIds ?? []).filter((id) => participantById.has(id))

      const targets =
        targetAgentIds.length > 0
          ? targetAgentIds.flatMap((id) => {
              const agent = participantById.get(id)
              if (!agent) return []
              return [{ id: agent.id, handle: agent.handle, name: agent.name }]
            })
          : await resolveSessionTargets({
              sessionKey: input.sessionKey,
              primaryAgentId: session.primary_agent_id,
              message,
            })

      if (targets.length === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Retry failed because no valid participant target could be resolved.',
        })
      }

      const result = await enqueueAppSessionMessage({
        sessionKey: input.sessionKey,
        userId,
        senderName,
        message,
        targetAgents: targets,
        clientMessageId: payload.clientMessageId,
      })

      return {
        ok: true,
        retriedFromWorkItemId: latestFailed.id,
        workItemId: result.workItemId,
        targetAgentIds: result.targetAgentIds,
      }
    }),
})
