import { TRPCError } from '@trpc/server'
import { extractMentions } from '@nitejar/agent/mention-parser'
import { parseAgentConfig } from '@nitejar/agent/config'
import {
  type AppSession,
  addAppSessionParticipants,
  claimTicket,
  createWorkUpdate,
  findGoalById,
  findAgentById,
  findAppSessionByKeyAndOwner,
  findTicketById,
  findTicketBySessionKey,
  getDb,
  listAppSessionsByOwnerAndKeys,
  listAppSessionsByOwnerAndPrefix,
  listAgents,
  listAppSessionParticipantAgents,
  listAppSessionsByOwner,
  listTicketLinksByTicket,
  parseAppSessionKey,
} from '@nitejar/database'
import { z } from 'zod'
import { enqueueAppSessionMessage } from '../services/app-session-enqueue'
import {
  createGoalAppSession,
  createRoutineAppSession,
  createStandaloneAppSession,
  createTicketAppSession,
} from '../services/app-session-context'
import { protectedProcedure, router } from '../trpc'

const MAX_SESSION_LIST = 50
const DEFAULT_TIMELINE_LIMIT = 30
const MAX_TIMELINE_LIMIT = 50
const DEFAULT_TICKET_EXECUTION_MESSAGE =
  'Execute the linked ticket now. Inspect live ticket state, goal context, recent receipts, and the current session before acting. Advance the work with at least one durable artifact, and leave the next concrete step in motion before you stop.'

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

function receiptOnlyReplyFallback(agentName: string): string {
  return `${agentName}: Run completed without a chat reply. Check the run for receipts.`
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

async function getSessionWorkContext(sessionKey: string): Promise<{
  linkedTicket: {
    id: string
    title: string
    status: string
    goalId: string | null
    goalTitle: string | null
    goalStatus: string | null
    goalOutcome: string | null
  } | null
}> {
  const ticket = await findTicketBySessionKey(sessionKey)
  if (!ticket) {
    return { linkedTicket: null }
  }

  const goal = ticket.goal_id ? await findGoalById(ticket.goal_id) : null

  return {
    linkedTicket: {
      id: ticket.id,
      title: ticket.title,
      status: ticket.status,
      goalId: goal?.id ?? null,
      goalTitle: goal?.title ?? null,
      goalStatus: goal?.status ?? null,
      goalOutcome: goal?.outcome ?? null,
    },
  }
}

async function ensureSessionParticipant(input: {
  sessionKey: string
  agentId: string
  userId: string
}): Promise<void> {
  const participants = await listAppSessionParticipantAgents(input.sessionKey)
  if (participants.some((participant) => participant.id === input.agentId)) {
    return
  }

  await addAppSessionParticipants({
    sessionKey: input.sessionKey,
    agentIds: [input.agentId],
    addedByUserId: input.userId,
  })
}

function buildTicketExecutionMessage(input: {
  title: string
  body: string | null
  message?: string
}) {
  const custom = input.message?.trim()
  if (custom) return custom

  const bodySnippet = input.body?.trim()
  if (!bodySnippet) {
    return `${DEFAULT_TICKET_EXECUTION_MESSAGE}\n\nTicket: ${input.title}`
  }

  return `${DEFAULT_TICKET_EXECUTION_MESSAGE}\n\nTicket: ${input.title}\nScope:\n${bodySnippet}`
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

function mapParticipantView(
  agent: Awaited<ReturnType<typeof listAppSessionParticipantAgents>>[number]
) {
  const config = parseAgentConfig(agent.config)
  return {
    id: agent.id,
    handle: agent.handle,
    name: agent.name,
    title: config.title ?? null,
    emoji: config.emoji ?? null,
    avatarUrl: config.avatarUrl ?? null,
  }
}

function describeSessionContext(
  sessionKey: string,
  linkedTicket: Awaited<ReturnType<typeof getSessionWorkContext>>['linkedTicket']
): {
  kind: 'standalone' | 'ticket' | 'goal' | 'routine' | 'legacy' | 'external'
  id: string | null
  label: string | null
  familyKey: string | null
} {
  const parsed = parseAppSessionKey(sessionKey)
  if (!parsed.isAppSession) {
    return { kind: 'external', id: null, label: null, familyKey: null }
  }
  if (parsed.isLegacy) {
    return { kind: 'legacy', id: parsed.ownerUserId, label: 'Legacy app session', familyKey: null }
  }
  if (parsed.contextKind === 'ticket') {
    return {
      kind: 'ticket',
      id: parsed.contextId,
      label: linkedTicket?.title ?? 'Ticket conversation',
      familyKey: parsed.familyKey,
    }
  }
  if (parsed.contextKind === 'goal') {
    return {
      kind: 'goal',
      id: parsed.contextId,
      label: 'Goal conversation',
      familyKey: parsed.familyKey,
    }
  }
  if (parsed.contextKind === 'routine') {
    return {
      kind: 'routine',
      id: parsed.contextId,
      label: 'Routine conversation',
      familyKey: parsed.familyKey,
    }
  }
  return {
    kind: 'standalone',
    id: parsed.contextId,
    label: 'Standalone conversation',
    familyKey: parsed.familyKey,
  }
}

async function buildSessionListItem(db: ReturnType<typeof getDb>, session: AppSession) {
  const participants = await listAppSessionParticipantAgents(session.session_key)
  const participantViews = participants.map(mapParticipantView)
  const linkedTicket = await getSessionWorkContext(session.session_key)

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

    const latestJob = await db
      .selectFrom('jobs')
      .innerJoin('agents', 'agents.id', 'jobs.agent_id')
      .select(['jobs.status', 'jobs.final_response', 'jobs.created_at', 'agents.name'])
      .where('jobs.work_item_id', '=', lastWorkItem.id)
      .orderBy('jobs.created_at', 'desc')
      .limit(1)
      .executeTakeFirst()

    if (latestAssistant) {
      const assistantText = extractAssistantText(latestAssistant.content) ?? '(no text)'
      preview = truncateText(`${latestAssistant.name}: ${assistantText}`, 80)
      lastMessageAt = latestAssistant.created_at
    } else if (
      latestJob &&
      latestJob.status === 'COMPLETED' &&
      !latestJob.final_response?.trim()?.length
    ) {
      preview = truncateText(receiptOnlyReplyFallback(latestJob.name), 80)
      lastMessageAt = latestJob.created_at
    } else {
      const userBody = parseWorkItemPayload(lastWorkItem.payload).body ?? lastWorkItem.title
      preview = truncateText(`You: ${userBody}`, 80)
    }
  }

  const context = describeSessionContext(session.session_key, linkedTicket.linkedTicket)
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
    context,
    forkedFromSessionKey: session.forked_from_session_key,
  }
}

export const sessionsRouter = router({
  startOrResume: protectedProcedure
    .input(
      z.object({
        agentId: z.string().min(1),
        ticketId: z.string().trim().optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = requireUserId(ctx.session)
      const agent = await findAgentById(input.agentId)
      if (!agent) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found.' })
      }

      if (input.ticketId) {
        const ticket = await findTicketById(input.ticketId)
        if (!ticket) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Ticket not found.' })
        }

        const session = await createTicketAppSession({
          ticketId: ticket.id,
          userId,
          agentId: input.agentId,
          title: ticket.title,
          createdBy: { kind: 'user', ref: userId },
        })
        const sessionKey = session.session_key
        if (
          ticket.assignee_kind !== 'agent' ||
          ticket.assignee_ref !== input.agentId ||
          ticket.status !== 'in_progress'
        ) {
          await claimTicket(ticket.id, {
            assigneeKind: 'agent',
            assigneeRef: input.agentId,
            claimedByKind: 'user',
            claimedByRef: userId,
          })
          await createWorkUpdate({
            goal_id: ticket.goal_id,
            ticket_id: ticket.id,
            team_id: null,
            author_kind: 'user',
            author_ref: userId,
            kind: 'status',
            body: `Started session ${sessionKey} with agent ${agent.name}.`,
            metadata_json: null,
          })
        }
        return { sessionKey }
      }

      const session = await createStandaloneAppSession({
        userId,
        agentId: input.agentId,
        title: null,
      })
      return { sessionKey: session.session_key }
    }),

  runTicketNow: protectedProcedure
    .input(
      z.object({
        ticketId: z.string().min(1),
        agentId: z.string().trim().optional().nullable(),
        message: z.string().trim().max(20_000).optional(),
        clientMessageId: z.string().trim().max(256).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = requireUserId(ctx.session)
      const senderName = getUserName(ctx.session)
      const ticket = await findTicketById(input.ticketId)
      if (!ticket) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Ticket not found.' })
      }

      const agentId =
        input.agentId?.trim() ||
        (ticket.assignee_kind === 'agent' && ticket.assignee_ref ? ticket.assignee_ref : null)
      if (!agentId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Ticket must be assigned to an agent or include an agentId.',
        })
      }

      const agent = await findAgentById(agentId)
      if (!agent) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found.' })
      }

      const session = await createTicketAppSession({
        ticketId: ticket.id,
        userId,
        agentId: agent.id,
        title: ticket.title,
        createdBy: { kind: 'user', ref: userId },
      })
      const sessionKey = session.session_key
      await ensureSessionParticipant({ sessionKey, agentId: agent.id, userId })

      if (
        ticket.assignee_kind !== 'agent' ||
        ticket.assignee_ref !== agent.id ||
        ticket.status !== 'in_progress'
      ) {
        await claimTicket(ticket.id, {
          assigneeKind: 'agent',
          assigneeRef: agent.id,
          claimedByKind: 'user',
          claimedByRef: userId,
        })
        await createWorkUpdate({
          goal_id: ticket.goal_id,
          ticket_id: ticket.id,
          team_id: null,
          author_kind: 'user',
          author_ref: userId,
          kind: 'status',
          body: `Queued execution in session ${sessionKey} with agent ${agent.name}.`,
          metadata_json: null,
        })
      }

      const goal = ticket.goal_id ? await findGoalById(ticket.goal_id) : null
      const result = await enqueueAppSessionMessage({
        sessionKey,
        userId,
        senderName,
        message: buildTicketExecutionMessage({
          title: ticket.title,
          body: ticket.body,
          message: input.message,
        }),
        targetAgents: [{ id: agent.id, handle: agent.handle, name: agent.name }],
        clientMessageId: input.clientMessageId,
        workContext: {
          ticketId: ticket.id,
          ticketTitle: ticket.title,
          ticketStatus: ticket.status,
          goalId: goal?.id ?? null,
          goalTitle: goal?.title ?? null,
          goalStatus: goal?.status ?? null,
          goalOutcome: goal?.outcome ?? null,
        },
      })

      return {
        ok: true as const,
        sessionKey,
        workItemId: result.workItemId,
        targetAgentIds: result.targetAgentIds,
      }
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

      const items = await Promise.all(sessions.map((session) => buildSessionListItem(db, session)))

      return { items }
    }),

  listRelated: protectedProcedure
    .input(
      z.object({
        sessionKey: z.string().trim().optional(),
        ticketId: z.string().trim().optional(),
        goalId: z.string().trim().optional(),
        routineId: z.string().trim().optional(),
        limit: z.number().int().min(1).max(20).default(10),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = requireUserId(ctx.session)
      const db = getDb()

      let prefix: string | null = null
      let linkedSessionKeys: string[] = []
      if (input.sessionKey) {
        const session = await findAppSessionByKeyAndOwner(input.sessionKey, userId)
        if (!session) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Session not found.' })
        }
        prefix = parseAppSessionKey(session.session_key).familyKey
      } else if (input.ticketId) {
        prefix = `app:ticket:${input.ticketId}`
        const links = await listTicketLinksByTicket(input.ticketId)
        linkedSessionKeys = links.filter((link) => link.kind === 'session').map((link) => link.ref)
      } else if (input.goalId) {
        prefix = `app:goal:${input.goalId}`
      } else if (input.routineId) {
        prefix = `app:routine:${input.routineId}`
      }

      if (!prefix && linkedSessionKeys.length === 0) {
        return { items: [] as Awaited<ReturnType<typeof buildSessionListItem>>[] }
      }

      const [prefixedSessions, linkedSessions] = await Promise.all([
        prefix
          ? listAppSessionsByOwnerAndPrefix(userId, prefix, {
              limit: input.limit,
              excludeSessionKey: input.sessionKey ?? null,
            })
          : Promise.resolve([]),
        linkedSessionKeys.length > 0
          ? listAppSessionsByOwnerAndKeys(userId, linkedSessionKeys, {
              limit: input.limit,
              excludeSessionKey: input.sessionKey ?? null,
            })
          : Promise.resolve([]),
      ])

      const sessions = [...prefixedSessions, ...linkedSessions]
        .filter(
          (session, index, all) =>
            all.findIndex((candidate) => candidate.session_key === session.session_key) === index
        )
        .sort((a, b) => {
          if (b.last_activity_at !== a.last_activity_at)
            return b.last_activity_at - a.last_activity_at
          return b.created_at - a.created_at
        })
        .slice(0, input.limit)

      const items = await Promise.all(sessions.map((session) => buildSessionListItem(db, session)))
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
        ticketId: z.string().trim().optional().nullable(),
        goalId: z.string().trim().optional().nullable(),
        routineId: z.string().trim().optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = requireUserId(ctx.session)
      const agent = await findAgentById(input.primaryAgentId)
      if (!agent) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Primary agent not found.' })
      }

      const session = input.ticketId
        ? await createTicketAppSession({
            ticketId: input.ticketId,
            userId,
            agentId: input.primaryAgentId,
            title: input.title?.trim() || null,
            createdBy: { kind: 'user', ref: userId },
          })
        : input.goalId
          ? await createGoalAppSession({
              goalId: input.goalId,
              userId,
              agentId: input.primaryAgentId,
              title: input.title?.trim() || null,
            })
          : input.routineId
            ? await createRoutineAppSession({
                routineId: input.routineId,
                userId,
                agentId: input.primaryAgentId,
                title: input.title?.trim() || null,
              })
            : await createStandaloneAppSession({
                userId,
                agentId: input.primaryAgentId,
                title: input.title?.trim() || null,
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

      const [participants, workContext] = await Promise.all([
        listAppSessionParticipantAgents(session.session_key),
        getSessionWorkContext(session.session_key),
      ])
      const forkedFrom =
        session.forked_from_session_key &&
        (await findAppSessionByKeyAndOwner(session.forked_from_session_key, userId))
      const relatedPrefix = parseAppSessionKey(session.session_key).familyKey
      const relatedSessions =
        relatedPrefix !== null
          ? await listAppSessionsByOwnerAndPrefix(userId, relatedPrefix, {
              limit: 10,
              excludeSessionKey: session.session_key,
            })
          : []
      return {
        sessionKey: session.session_key,
        title: session.title,
        primaryAgentId: session.primary_agent_id,
        createdAt: session.created_at,
        lastActivityAt: session.last_activity_at,
        context: describeSessionContext(session.session_key, workContext.linkedTicket),
        forkedFromSessionKey: session.forked_from_session_key,
        forkedFromSession: forkedFrom
          ? {
              sessionKey: forkedFrom.session_key,
              title: forkedFrom.title,
            }
          : null,
        relatedSessions: relatedSessions.map((item) => ({
          sessionKey: item.session_key,
          title: item.title,
          createdAt: item.created_at,
          lastActivityAt: item.last_activity_at,
        })),
        linkedTicket: workContext.linkedTicket,
        participants: participants.map(mapParticipantView),
      }
    }),

  forkSession: protectedProcedure
    .input(z.object({ sessionKey: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const userId = requireUserId(ctx.session)
      const session = await findAppSessionByKeyAndOwner(input.sessionKey, userId)
      if (!session) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Session not found.' })
      }

      const parsed = parseAppSessionKey(session.session_key)
      const participantAgents = await listAppSessionParticipantAgents(session.session_key)
      const sessionToCreate =
        !parsed.isAppSession || parsed.isLegacy || parsed.contextKind === 'standalone'
          ? await createStandaloneAppSession({
              userId,
              agentId: session.primary_agent_id,
              title: session.title,
              forkedFromSessionKey: session.session_key,
            })
          : parsed.contextKind === 'ticket'
            ? await createTicketAppSession({
                ticketId: parsed.contextId,
                userId,
                agentId: session.primary_agent_id,
                title: session.title,
                forkedFromSessionKey: session.session_key,
                createdBy: { kind: 'user', ref: userId },
              })
            : parsed.contextKind === 'goal'
              ? await createGoalAppSession({
                  goalId: parsed.contextId,
                  userId,
                  agentId: session.primary_agent_id,
                  title: session.title,
                  forkedFromSessionKey: session.session_key,
                })
              : await createRoutineAppSession({
                  routineId: parsed.contextId,
                  userId,
                  agentId: session.primary_agent_id,
                  title: session.title,
                  forkedFromSessionKey: session.session_key,
                })

      const extraAgentIds = participantAgents
        .map((participant) => participant.id)
        .filter((agentId) => agentId !== session.primary_agent_id)
      if (extraAgentIds.length > 0) {
        await addAppSessionParticipants({
          sessionKey: sessionToCreate.session_key,
          agentIds: extraAgentIds,
          addedByUserId: userId,
        })
      }

      return { sessionKey: sessionToCreate.session_key }
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
          const runLink = `/work-items/${item.id}`
          if (job) {
            const assistant = latestAssistantByJob.get(job.id)
            const message =
              assistant?.text ??
              (job.final_response ? job.final_response.trim() : null) ??
              (job.status === 'COMPLETED'
                ? 'Run completed without a chat reply. Check the run for receipts.'
                : null)
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
          runLink: `/work-items/${item.id}`,
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
      const workContext = await getSessionWorkContext(session.session_key)

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
        workContext: workContext.linkedTicket
          ? {
              ticketId: workContext.linkedTicket.id,
              ticketTitle: workContext.linkedTicket.title,
              ticketStatus: workContext.linkedTicket.status,
              goalId: workContext.linkedTicket.goalId,
              goalTitle: workContext.linkedTicket.goalTitle,
              goalStatus: workContext.linkedTicket.goalStatus,
              goalOutcome: workContext.linkedTicket.goalOutcome,
            }
          : null,
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
      const workContext = await getSessionWorkContext(input.sessionKey)

      const result = await enqueueAppSessionMessage({
        sessionKey: input.sessionKey,
        userId,
        senderName,
        message,
        targetAgents: targets,
        clientMessageId: payload.clientMessageId,
        workContext: workContext.linkedTicket
          ? {
              ticketId: workContext.linkedTicket.id,
              ticketTitle: workContext.linkedTicket.title,
              ticketStatus: workContext.linkedTicket.status,
              goalId: workContext.linkedTicket.goalId,
              goalTitle: workContext.linkedTicket.goalTitle,
              goalStatus: workContext.linkedTicket.goalStatus,
              goalOutcome: workContext.linkedTicket.goalOutcome,
            }
          : null,
      })

      return {
        ok: true,
        retriedFromWorkItemId: latestFailed.id,
        workItemId: result.workItemId,
        targetAgentIds: result.targetAgentIds,
      }
    }),
})
