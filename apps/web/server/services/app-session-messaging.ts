import { extractMentions } from '@nitejar/agent/mention-parser'
import {
  findAgentById,
  findAppSessionByKeyAndOwner,
  findGoalById,
  findTicketBySessionKey,
  listAgents,
  listAppSessionParticipantAgents,
} from '@nitejar/database'
import {
  createGoalAppSession,
  createRoutineAppSession,
  createStandaloneAppSession,
  createTicketAppSession,
} from './app-session-context'
import { enqueueAppSessionMessage } from './app-session-enqueue'

type EnqueueAgent = { id: string; handle: string; name: string }

async function findAgentByHandle(handle: string) {
  const normalized = handle.trim().replace(/^@/, '').toLowerCase()
  if (!normalized) return null
  const agents = await listAgents()
  return agents.find((agent) => agent.handle.toLowerCase() === normalized) ?? null
}

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

async function startFreshAppSessionForUser(input: {
  userId: string
  agentId: string
  sessionTitle?: string | null
  ticketId?: string | null
  goalId?: string | null
  routineId?: string | null
}): Promise<{ sessionKey: string; primaryAgentId: string; createdSession: boolean }> {
  const session = input.ticketId
    ? await createTicketAppSession({
        ticketId: input.ticketId,
        userId: input.userId,
        agentId: input.agentId,
        title: input.sessionTitle,
        createdBy: { kind: 'user', ref: input.userId },
      })
    : input.goalId
      ? await createGoalAppSession({
          goalId: input.goalId,
          userId: input.userId,
          agentId: input.agentId,
          title: input.sessionTitle,
        })
      : input.routineId
        ? await createRoutineAppSession({
            routineId: input.routineId,
            userId: input.userId,
            agentId: input.agentId,
            title: input.sessionTitle,
          })
        : await createStandaloneAppSession({
            userId: input.userId,
            agentId: input.agentId,
            title: input.sessionTitle,
          })

  return {
    sessionKey: session.session_key,
    primaryAgentId: session.primary_agent_id,
    createdSession: true,
  }
}

export async function sendAppSessionMessageForUser(input: {
  userId: string
  senderName: string
  message: string
  sessionKey?: string
  agentId?: string
  agentHandle?: string
  ticketId?: string
  goalId?: string
  routineId?: string
  clientMessageId?: string
  sessionTitle?: string
}): Promise<{
  ok: true
  sessionKey: string
  workItemId: string
  targetAgentIds: string[]
  createdSession: boolean
}> {
  const message = input.message.trim()
  if (!message) {
    throw new Error('message is required')
  }

  let sessionKey: string
  let primaryAgentId: string
  let createdSession = false

  if (input.sessionKey?.trim()) {
    const session = await findAppSessionByKeyAndOwner(input.sessionKey.trim(), input.userId)
    if (!session) {
      throw new Error('Session not found')
    }
    sessionKey = session.session_key
    primaryAgentId = session.primary_agent_id
  } else {
    const directAgent =
      (input.agentId?.trim() ? await findAgentById(input.agentId.trim()) : null) ??
      (input.agentHandle?.trim() ? await findAgentByHandle(input.agentHandle) : null)

    if (!directAgent) {
      throw new Error('agentId or agentHandle is required when sessionKey is not provided')
    }

    const started = await startFreshAppSessionForUser({
      userId: input.userId,
      agentId: directAgent.id,
      sessionTitle: input.sessionTitle,
      ticketId: input.ticketId,
      goalId: input.goalId,
      routineId: input.routineId,
    })
    sessionKey = started.sessionKey
    primaryAgentId = started.primaryAgentId
    createdSession = started.createdSession
  }

  const targets = await resolveSessionTargets({
    sessionKey,
    primaryAgentId,
    message,
  })
  if (targets.length === 0) {
    throw new Error('No valid participant target found for this message.')
  }

  const workContext = await getSessionWorkContext(sessionKey)
  const result = await enqueueAppSessionMessage({
    sessionKey,
    userId: input.userId,
    senderName: input.senderName,
    message,
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
    sessionKey,
    workItemId: result.workItemId,
    targetAgentIds: result.targetAgentIds,
    createdSession,
  }
}
