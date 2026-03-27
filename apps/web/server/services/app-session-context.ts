import { generateUuidV7 } from '@nitejar/core'
import {
  addAppSessionParticipants,
  buildGoalAppSessionKey,
  buildRoutineAppSessionKey,
  buildStandaloneAppSessionKey,
  buildTicketAppSessionKey,
  createAppSession,
  createTicketLink,
  findAppSessionByKey,
  listAppSessionParticipantAgents,
} from '@nitejar/database'

type SessionTransaction = Parameters<typeof createAppSession>[1]

type CreatedBy = {
  kind: 'user' | 'agent' | 'system'
  ref: string | null
}

type BaseSessionInput = {
  userId: string
  agentId: string
  title?: string | null
  forkedFromSessionKey?: string | null
  trx?: SessionTransaction
}

function normalizeTitle(title?: string | null): string | null {
  const trimmed = title?.trim()
  return trimmed ? trimmed : null
}

async function finalizeSession(input: {
  sessionKey: string
  userId: string
  agentId: string
  title?: string | null
  forkedFromSessionKey?: string | null
  participantAgentIds?: string[]
  trx?: SessionTransaction
}) {
  const session = await createAppSession({
    session_key: input.sessionKey,
    owner_user_id: input.userId,
    primary_agent_id: input.agentId,
    title: normalizeTitle(input.title),
    forked_from_session_key: input.forkedFromSessionKey?.trim() || null,
  }, input.trx)

  const participantAgentIds = Array.from(
    new Set([input.agentId, ...(input.participantAgentIds ?? [])].filter(Boolean))
  )
  await addAppSessionParticipants({
    sessionKey: input.sessionKey,
    agentIds: participantAgentIds,
    addedByUserId: input.userId,
  }, input.trx)

  return session
}

export async function createStandaloneAppSession(input: BaseSessionInput) {
  const sessionKey = buildStandaloneAppSessionKey(input.userId, generateUuidV7())
  return finalizeSession({
    sessionKey,
    userId: input.userId,
    agentId: input.agentId,
    title: input.title,
    forkedFromSessionKey: input.forkedFromSessionKey,
    trx: input.trx,
  })
}

export async function createGoalAppSession(
  input: BaseSessionInput & {
    goalId: string
  }
) {
  const sessionKey = buildGoalAppSessionKey(input.goalId, generateUuidV7())
  return finalizeSession({
    sessionKey,
    userId: input.userId,
    agentId: input.agentId,
    title: input.title,
    forkedFromSessionKey: input.forkedFromSessionKey,
    trx: input.trx,
  })
}

export async function createRoutineAppSession(
  input: BaseSessionInput & {
    routineId: string
    participantAgentIds?: string[]
  }
) {
  const sessionKey = buildRoutineAppSessionKey(input.routineId, generateUuidV7())
  return finalizeSession({
    sessionKey,
    userId: input.userId,
    agentId: input.agentId,
    title: input.title,
    forkedFromSessionKey: input.forkedFromSessionKey,
    participantAgentIds: input.participantAgentIds,
    trx: input.trx,
  })
}

export async function createTicketAppSession(
  input: BaseSessionInput & {
    ticketId: string
    createdBy: CreatedBy
  }
) {
  const sessionKey = buildTicketAppSessionKey(input.ticketId, generateUuidV7())
  const session = await finalizeSession({
    sessionKey,
    userId: input.userId,
    agentId: input.agentId,
    title: input.title,
    forkedFromSessionKey: input.forkedFromSessionKey,
    trx: input.trx,
  })

  await createTicketLink({
    ticket_id: input.ticketId,
    kind: 'session',
    ref: sessionKey,
    label: normalizeTitle(input.title),
    metadata_json: null,
    created_by_kind: input.createdBy.kind,
    created_by_ref: input.createdBy.ref,
  }, input.trx)

  return session
}

export async function createRoutineAppSessionFromSeed(input: {
  routineId: string
  seedSessionKey: string
  agentId: string
  fallbackTitle?: string | null
}) {
  const seed = await findAppSessionByKey(input.seedSessionKey)
  if (!seed) return null

  const participants = await listAppSessionParticipantAgents(seed.session_key)
  const participantAgentIds = participants.map((participant) => participant.id)

  return createRoutineAppSession({
    routineId: input.routineId,
    userId: seed.owner_user_id,
    agentId: input.agentId,
    title: normalizeTitle(input.fallbackTitle) ?? seed.title,
    participantAgentIds,
  })
}
