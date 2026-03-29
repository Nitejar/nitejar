import type Anthropic from '@anthropic-ai/sdk'
import {
  addTicketParticipants,
  assertAgentGrant,
  claimTicket,
  createAttentionItem,
  createOneShotRoutineSchedule,
  createGoal,
  createTicketComment,
  createTicket,
  createTicketLink,
  createWorkItem,
  createWorkUpdate,
  enqueueTicketAgentWork,
  enqueueToLane,
  findAgentById,
  findGoalById,
  listAppSessionParticipantAgents,
  findTicketById,
  findTicketBySessionKey,
  findTicketByWorkItemId,
  getDb,
  listGoals,
  listTicketComments,
  listLinkedWorkItemsForTicket,
  listTicketParticipants,
  listTicketLinksByTicket,
  listTickets,
  resolveAttentionItemsForTargetOnTicket,
  touchAppSessionLastActivity,
  updateTicket,
} from '@nitejar/database'
import type { ToolHandler } from '../types'

const MESSAGE_TITLE_MAX_CHARS = 100
const APP_CHAT_DEBOUNCE_MS = 1000
const APP_CHAT_MAX_QUEUED = 10
const RUN_TICKET_DEDUPE_WINDOW_SEC = 120
const DEFAULT_TICKET_EXECUTION_MESSAGE =
  'Execute the linked ticket now. Inspect live ticket state, goal context, recent receipts, and the current session before acting. Advance the work with at least one durable artifact, and leave the next concrete step in motion before you stop.'

async function resolveActorLabel(kind: string | null, ref: string | null): Promise<string> {
  if (!kind || !ref) return 'unassigned'
  const db = getDb()
  if (kind === 'user') {
    const user = await db
      .selectFrom('users')
      .select(['name'])
      .where('id', '=', ref)
      .executeTakeFirst()
    return user?.name ?? ref
  }
  if (kind === 'agent') {
    const agent = await db
      .selectFrom('agents')
      .select(['name', 'handle'])
      .where('id', '=', ref)
      .executeTakeFirst()
    return agent ? `${agent.name} (@${agent.handle})` : ref
  }
  return ref
}

function parseStatuses(value: unknown, allowed: readonly string[]): string[] | undefined {
  const normalized =
    typeof value === 'string'
      ? value
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean)
      : []

  if (normalized.length === 0) return undefined
  if (normalized.some((entry) => entry === 'all')) return undefined

  const allowedSet = new Set(allowed)
  const filtered = Array.from(new Set(normalized.filter((entry) => allowedSet.has(entry))))
  return filtered.length > 0 ? filtered : undefined
}

function requireAgentId(context: { agentId?: string }): string {
  if (!context.agentId) {
    throw new Error('Agent context is required.')
  }
  return context.agentId
}

function parseMetadataJson(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    try {
      JSON.parse(trimmed)
      return trimmed
    } catch {
      throw new Error('metadata_json must be valid JSON.')
    }
  }

  try {
    return JSON.stringify(value)
  } catch {
    throw new Error('metadata_json must be JSON-serializable.')
  }
}

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function truncateText(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, maxChars - 1)}…`
}

function buildTicketExecutionMessage(input: {
  title: string
  body: string | null
  message?: string | null
  assigneeHandle?: string | null
  delegatorHandle?: string | null
}): string {
  const custom = input.message?.trim()
  if (custom) return custom

  const header =
    input.assigneeHandle && input.assigneeHandle.trim().length > 0
      ? `This ticket-lane work item is explicitly queued for @${input.assigneeHandle.trim()}${input.delegatorHandle?.trim() ? ` by @${input.delegatorHandle.trim()}` : ''}.`
      : null

  const bodySnippet = input.body?.trim()
  if (!bodySnippet) {
    return [header, DEFAULT_TICKET_EXECUTION_MESSAGE, `Ticket: ${input.title}`]
      .filter(Boolean)
      .join('\n\n')
  }

  return [
    header,
    DEFAULT_TICKET_EXECUTION_MESSAGE,
    `Ticket: ${input.title}\nScope:\n${bodySnippet}`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [
    ...new Set(
      value
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean)
    ),
  ]
}

function parseTicketCommentMetadata(value: string | null): {
  mentionAgentIds?: string[]
  mentionUserIds?: string[]
} {
  if (!value) return {}
  try {
    return (JSON.parse(value) as { mentionAgentIds?: string[]; mentionUserIds?: string[] }) ?? {}
  } catch {
    return {}
  }
}

export const searchGoalsDefinition: Anthropic.Tool = {
  name: 'search_goals',
  description: 'Search organization goals by title or outcome and return compact summaries.',
  input_schema: {
    type: 'object' as const,
    properties: {
      query: { type: 'string', description: 'Text to search for.' },
      owner_kind: {
        type: 'string',
        enum: ['user', 'agent'],
        description: 'Optional owner kind filter.',
      },
      owner_ref: { type: 'string', description: 'Optional owner ID filter.' },
      status: {
        type: 'string',
        description:
          'Optional status filter. Use a single status or a comma-separated list like "active,blocked". Use "all" for everything.',
      },
      limit: { type: 'integer', description: 'Maximum results (default: 10, max: 25).' },
    },
  },
}

export const searchGoalsTool: ToolHandler = async (input, context) => {
  const agentId = requireAgentId(context)
  await assertAgentGrant({ agentId, action: 'work.goal.read', resourceType: 'goal' })
  const q = typeof input.query === 'string' ? input.query.trim() : ''
  const ownerKind = typeof input.owner_kind === 'string' ? input.owner_kind.trim() : undefined
  const ownerRef = typeof input.owner_ref === 'string' ? input.owner_ref.trim() : undefined
  const limit = Math.min(Math.max(typeof input.limit === 'number' ? input.limit : 10, 1), 25)
  const statuses = parseStatuses(input.status, [
    'draft',
    'active',
    'at_risk',
    'blocked',
    'done',
    'archived',
  ])

  const goals = await listGoals({
    q: q || undefined,
    ownerKind: ownerKind || undefined,
    ownerRef: ownerRef || undefined,
    statuses,
    limit,
  })

  if (goals.length === 0) {
    return { success: true, output: 'No goals found.' }
  }

  const lines = await Promise.all(
    goals.map(async (goal) => {
      const owner = await resolveActorLabel(goal.owner_kind, goal.owner_ref)
      return `- ${goal.id} [${goal.status}] ${goal.title} — owner: ${owner}\n  ${goal.outcome}`
    })
  )

  return { success: true, output: lines.join('\n') }
}

export const searchTicketsDefinition: Anthropic.Tool = {
  name: 'search_tickets',
  description: 'Search tickets by title/body/status. Use this before starting duplicate work.',
  input_schema: {
    type: 'object' as const,
    properties: {
      query: { type: 'string', description: 'Text to search for.' },
      status: {
        type: 'string',
        description:
          'Optional status filter. Use a single status or a comma-separated list like "ready,in_progress,blocked". Use "all" for everything.',
      },
      goal_id: { type: 'string', description: 'Optional goal ID filter.' },
      assignee_kind: {
        type: 'string',
        enum: ['user', 'agent'],
        description: 'Optional assignee kind filter.',
      },
      assignee_ref: { type: 'string', description: 'Optional assignee ID filter.' },
      mine: {
        type: 'boolean',
        description: 'When true, only show tickets currently assigned to this agent.',
      },
      limit: { type: 'integer', description: 'Maximum results (default: 10, max: 25).' },
    },
  },
}

export const searchTicketsTool: ToolHandler = async (input, context) => {
  const agentId = requireAgentId(context)
  await assertAgentGrant({ agentId, action: 'work.ticket.read', resourceType: 'ticket' })
  const q = typeof input.query === 'string' ? input.query.trim() : ''
  const goalId = typeof input.goal_id === 'string' ? input.goal_id.trim() : undefined
  const assigneeKind =
    typeof input.assignee_kind === 'string' ? input.assignee_kind.trim() : undefined
  const assigneeRef = typeof input.assignee_ref === 'string' ? input.assignee_ref.trim() : undefined
  const mine = input.mine === true
  const limit = Math.min(Math.max(typeof input.limit === 'number' ? input.limit : 10, 1), 25)
  const statuses = parseStatuses(input.status, [
    'inbox',
    'ready',
    'in_progress',
    'blocked',
    'done',
    'canceled',
  ])

  const tickets = await listTickets({
    q: q || undefined,
    goalId,
    assigneeKind: assigneeKind || (mine ? 'agent' : undefined),
    assigneeRef: assigneeRef || (mine ? context.agentId : undefined),
    statuses,
    limit,
  })

  if (tickets.length === 0) {
    return { success: true, output: 'No tickets found.' }
  }

  const lines = await Promise.all(
    tickets.map(async (ticket) => {
      const goal = ticket.goal_id ? await findGoalById(ticket.goal_id) : null
      const assignee = await resolveActorLabel(ticket.assignee_kind, ticket.assignee_ref)
      return `- ${ticket.id} [${ticket.status}] ${ticket.title} — assignee: ${assignee}${goal ? ` | goal: ${goal.title}` : ''}`
    })
  )

  return { success: true, output: lines.join('\n') }
}

export const getTicketDefinition: Anthropic.Tool = {
  name: 'get_ticket',
  description: 'Get the full context for a ticket, including linked goal and receipts.',
  input_schema: {
    type: 'object' as const,
    properties: {
      ticket_id: { type: 'string', description: 'The ticket ID.' },
    },
    required: ['ticket_id'],
  },
}

export const getTicketTool: ToolHandler = async (input, context) => {
  const agentId = requireAgentId(context)
  const ticketId = typeof input.ticket_id === 'string' ? input.ticket_id.trim() : ''
  if (!ticketId) {
    return { success: false, error: 'ticket_id is required.' }
  }
  await assertAgentGrant({
    agentId,
    action: 'work.ticket.read',
    resourceType: 'ticket',
    resourceId: ticketId,
  })

  const ticket = await findTicketById(ticketId)
  if (!ticket) {
    return { success: false, error: `Ticket "${ticketId}" not found.` }
  }

  const [goal, assignee, links, workItems, comments, participants] = await Promise.all([
    ticket.goal_id ? findGoalById(ticket.goal_id) : Promise.resolve(null),
    resolveActorLabel(ticket.assignee_kind, ticket.assignee_ref),
    listTicketLinksByTicket(ticket.id),
    listLinkedWorkItemsForTicket(ticket.id),
    listTicketComments({ ticketId: ticket.id, limit: 20 }),
    listTicketParticipants(ticket.id),
  ])

  const lines = [
    `Ticket ${ticket.id} — ${ticket.status}`,
    `Title: ${ticket.title}`,
    `Body: ${ticket.body ?? '(none)'}`,
    `Assignee: ${assignee}`,
    `Goal: ${goal ? `${goal.id} — ${goal.title} [${goal.status}]` : '(none)'}`,
    `Linked receipts: ${links.length}`,
  ]

  if (links.length > 0) {
    lines.push('Links:')
    for (const link of links.slice(0, 10)) {
      lines.push(`- ${link.kind}: ${link.ref}${link.label ? ` (${link.label})` : ''}`)
    }
  }

  if (workItems.length > 0) {
    lines.push('Recent work items:')
    for (const item of workItems.slice(0, 10)) {
      lines.push(`- ${item.id} [${item.status}] ${item.title} (${item.source})`)
    }
  }

  if (participants.length > 0) {
    lines.push('Participants:')
    for (const participant of participants.slice(0, 10)) {
      const label = await resolveActorLabel(
        participant.participant_kind,
        participant.participant_ref
      )
      lines.push(`- ${label}`)
    }
  }

  if (comments.length > 0) {
    lines.push('Recent comments:')
    for (const comment of comments.slice(-10)) {
      const authorLabel = await resolveActorLabel(comment.author_kind, comment.author_ref)
      const metadata = parseTicketCommentMetadata(comment.metadata_json)
      const mentions = [
        ...(metadata.mentionAgentIds ?? []).map(async (id) => resolveActorLabel('agent', id)),
        ...(metadata.mentionUserIds ?? []).map(async (id) => resolveActorLabel('user', id)),
      ]
      const mentionLabels = mentions.length > 0 ? await Promise.all(mentions) : []
      lines.push(
        `- [${comment.kind}] ${authorLabel}: ${comment.body}${mentionLabels.length > 0 ? ` | mentions: ${mentionLabels.join(', ')}` : ''}`
      )
    }
  }

  return { success: true, output: lines.join('\n') }
}

export const claimTicketDefinition: Anthropic.Tool = {
  name: 'claim_ticket',
  description: 'Claim a ticket for this agent and mark it in progress.',
  input_schema: {
    type: 'object' as const,
    properties: {
      ticket_id: { type: 'string', description: 'The ticket ID to claim.' },
    },
    required: ['ticket_id'],
  },
}

export const claimTicketTool: ToolHandler = async (input, context) => {
  const agentId = requireAgentId(context)

  const ticketId = typeof input.ticket_id === 'string' ? input.ticket_id.trim() : ''
  if (!ticketId) {
    return { success: false, error: 'ticket_id is required.' }
  }
  await assertAgentGrant({
    agentId,
    action: 'work.ticket.write',
    resourceType: 'ticket',
    resourceId: ticketId,
  })

  const updated = await claimTicket(ticketId, {
    assigneeKind: 'agent',
    assigneeRef: agentId,
    claimedByKind: 'agent',
    claimedByRef: agentId,
  })
  if (!updated) {
    return { success: false, error: `Ticket "${ticketId}" not found.` }
  }

  await createWorkUpdate({
    goal_id: updated.goal_id,
    ticket_id: updated.id,
    team_id: null,
    author_kind: 'agent',
    author_ref: agentId,
    kind: 'status',
    body: `Claimed by this agent and moved to in_progress.`,
    metadata_json: null,
  })

  return {
    success: true,
    output: `Claimed ticket ${updated.id} and set status to ${updated.status}.`,
  }
}

export const updateTicketDefinition: Anthropic.Tool = {
  name: 'update_ticket',
  description: 'Update ticket fields like status, title, or body.',
  input_schema: {
    type: 'object' as const,
    properties: {
      ticket_id: { type: 'string', description: 'The ticket ID.' },
      status: {
        type: 'string',
        enum: ['inbox', 'ready', 'in_progress', 'blocked', 'done', 'canceled'],
      },
      title: { type: 'string' },
      body: { type: 'string' },
    },
    required: ['ticket_id'],
  },
}

export const updateTicketTool: ToolHandler = async (input, context) => {
  const agentId = requireAgentId(context)
  const ticketId = typeof input.ticket_id === 'string' ? input.ticket_id.trim() : ''
  if (!ticketId) {
    return { success: false, error: 'ticket_id is required.' }
  }
  await assertAgentGrant({
    agentId,
    action: 'work.ticket.write',
    resourceType: 'ticket',
    resourceId: ticketId,
  })

  const existing = await findTicketById(ticketId)
  if (!existing) {
    return { success: false, error: `Ticket "${ticketId}" not found.` }
  }

  const nextStatus = typeof input.status === 'string' ? input.status.trim() : existing.status
  const title = typeof input.title === 'string' ? input.title.trim() : existing.title
  const body = typeof input.body === 'string' ? input.body.trim() : existing.body

  const updated = await updateTicket(ticketId, {
    status: nextStatus,
    title,
    body,
  })
  if (!updated) {
    return { success: false, error: `Ticket "${ticketId}" update failed.` }
  }

  if (nextStatus !== existing.status) {
    await createWorkUpdate({
      goal_id: updated.goal_id,
      ticket_id: updated.id,
      team_id: null,
      author_kind: 'agent',
      author_ref: agentId,
      kind: 'status',
      body: `Status changed from ${existing.status} to ${updated.status}.`,
      metadata_json: null,
    })
  }

  return { success: true, output: `Updated ticket ${updated.id}.` }
}

export const assignTicketDefinition: Anthropic.Tool = {
  name: 'assign_ticket',
  description:
    'Assign a ticket to another agent and optionally kick off their run immediately on a dedicated ticket lane. Use this for cross-agent delegation.',
  input_schema: {
    type: 'object' as const,
    properties: {
      ticket_id: { type: 'string', description: 'The ticket ID to delegate.' },
      agent_id: { type: 'string', description: 'The target agent ID.' },
      message: {
        type: 'string',
        description:
          'Optional execution instruction for the assignee. Defaults to the ticket execution brief.',
      },
      kickstart_now: {
        type: 'boolean',
        description: 'When true (default), queue the assignee immediately.',
      },
    },
    required: ['ticket_id', 'agent_id'],
  },
}

export const assignTicketTool: ToolHandler = async (input, context) => {
  const agentId = requireAgentId(context)
  const ticketId = typeof input.ticket_id === 'string' ? input.ticket_id.trim() : ''
  const targetAgentId = typeof input.agent_id === 'string' ? input.agent_id.trim() : ''
  const customMessage = typeof input.message === 'string' ? input.message.trim() : ''
  const kickstartNow = input.kickstart_now !== false

  if (!ticketId) return { success: false, error: 'ticket_id is required.' }
  if (!targetAgentId) return { success: false, error: 'agent_id is required.' }

  await assertAgentGrant({
    agentId,
    action: 'work.ticket.write',
    resourceType: 'ticket',
    resourceId: ticketId,
  })

  const [ticket, delegator, assignee] = await Promise.all([
    findTicketById(ticketId),
    findAgentById(agentId),
    findAgentById(targetAgentId),
  ])

  if (!ticket) return { success: false, error: `Ticket "${ticketId}" not found.` }
  if (!delegator) return { success: false, error: `Agent "${agentId}" not found.` }
  if (!assignee) return { success: false, error: `Agent "${targetAgentId}" not found.` }

  const nextStatus =
    ticket.status === 'done' || ticket.status === 'canceled' ? ticket.status : 'ready'
  const updated = await updateTicket(ticket.id, {
    goal_id: ticket.goal_id,
    parent_ticket_id: ticket.parent_ticket_id,
    title: ticket.title,
    body: ticket.body,
    status: nextStatus,
    assignee_kind: 'agent',
    assignee_ref: assignee.id,
    claimed_by_kind: null,
    claimed_by_ref: null,
    claimed_at: null,
    archived_at: ticket.archived_at,
  })

  if (!updated) {
    return { success: false, error: `Ticket "${ticketId}" update failed.` }
  }

  await addTicketParticipants({
    ticketId: updated.id,
    participants: [
      { kind: 'agent', ref: agentId },
      { kind: 'agent', ref: assignee.id },
    ],
    addedByKind: 'agent',
    addedByRef: agentId,
  })

  let queuedWorkItemId: string | null = null
  if (kickstartNow && ticket.status !== 'done' && ticket.status !== 'canceled') {
    const workItem = await enqueueTicketAgentWork({
      ticketId: updated.id,
      agentId: assignee.id,
      source: 'ticket_delegate',
      sourceRef: `ticket:${updated.id}:delegate:${agentId}:${assignee.id}`,
      title: `Delegated ticket: ${updated.title}`,
      body:
        customMessage ||
        buildTicketExecutionMessage({
          title: updated.title,
          body: updated.body,
          assigneeHandle: assignee.handle,
          delegatorHandle: delegator.handle,
        }),
      senderName: delegator.name,
      actor: {
        kind: 'agent',
        agentId: delegator.id,
        handle: delegator.handle,
        displayName: delegator.name,
        source: 'ticket_delegate',
      },
      // Ticket delegation should stay ticket-native by default instead of
      // replying back into the delegator's current channel context.
      pluginInstanceId: null,
      responseContext: null,
      createReceiptLink: true,
      metadata: {
        delegatedByAgentId: delegator.id,
      },
    })
    queuedWorkItemId = workItem.id
  }

  await createWorkUpdate({
    goal_id: updated.goal_id,
    ticket_id: updated.id,
    team_id: null,
    author_kind: 'agent',
    author_ref: agentId,
    kind: 'note',
    body: kickstartNow
      ? `Delegated to ${assignee.name} (@${assignee.handle}) and queued immediate kickoff${queuedWorkItemId ? ` via work item ${queuedWorkItemId}` : ''}.`
      : `Delegated to ${assignee.name} (@${assignee.handle}).`,
    metadata_json: JSON.stringify({
      delegatedToAgentId: assignee.id,
      queuedWorkItemId,
    }),
  })

  return {
    success: true,
    output: kickstartNow
      ? `Assigned ticket ${updated.id} to ${assignee.name} and queued work item ${queuedWorkItemId ?? '(existing deduped item)'}.`
      : `Assigned ticket ${updated.id} to ${assignee.name}.`,
  }
}

export const postTicketCommentDefinition: Anthropic.Tool = {
  name: 'post_ticket_comment',
  description:
    'Post a coordination comment on a ticket, optionally mention agents or users, and optionally mark the ticket blocked. Mentioned agents can be notified and kicked off on the ticket lane.',
  input_schema: {
    type: 'object' as const,
    properties: {
      ticket_id: { type: 'string', description: 'The ticket ID.' },
      body: { type: 'string', description: 'Comment text.' },
      kind: {
        type: 'string',
        enum: ['comment', 'question', 'decision_needed', 'review_requested', 'blocked'],
        description: 'Comment type (default: comment).',
      },
      mention_agent_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional agent IDs to mention and notify.',
      },
      mention_user_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional user IDs to mention for in-app attention.',
      },
      mark_blocked: {
        type: 'boolean',
        description: 'When true, set the ticket status to blocked after posting.',
      },
      kickstart_agent_mentions: {
        type: 'boolean',
        description:
          'When true (default), mentioned agents are queued immediately on their ticket lane.',
      },
    },
    required: ['ticket_id', 'body'],
  },
}

export const postTicketCommentTool: ToolHandler = async (input, context) => {
  const agentId = requireAgentId(context)
  const ticketId = typeof input.ticket_id === 'string' ? input.ticket_id.trim() : ''
  const body = typeof input.body === 'string' ? input.body.trim() : ''
  const kind =
    typeof input.kind === 'string' &&
    ['comment', 'question', 'decision_needed', 'review_requested', 'blocked'].includes(input.kind)
      ? input.kind
      : 'comment'
  const mentionAgentIds = normalizeStringArray(input.mention_agent_ids).filter(
    (id) => id !== agentId
  )
  const mentionUserIds = normalizeStringArray(input.mention_user_ids)
  const markBlocked = input.mark_blocked === true || kind === 'blocked'
  const kickstartAgentMentions = input.kickstart_agent_mentions !== false

  if (!ticketId) return { success: false, error: 'ticket_id is required.' }
  if (!body) return { success: false, error: 'body is required.' }

  await assertAgentGrant({
    agentId,
    action: 'work.ticket.write',
    resourceType: 'ticket',
    resourceId: ticketId,
  })

  const [ticket, author] = await Promise.all([findTicketById(ticketId), findAgentById(agentId)])
  if (!ticket) return { success: false, error: `Ticket "${ticketId}" not found.` }
  if (!author) return { success: false, error: `Agent "${agentId}" not found.` }

  const db = getDb()
  const [mentionedAgents, mentionedUsers] = await Promise.all([
    mentionAgentIds.length > 0
      ? db
          .selectFrom('agents')
          .select(['id', 'name', 'handle'])
          .where('id', 'in', mentionAgentIds)
          .execute()
      : Promise.resolve([]),
    mentionUserIds.length > 0
      ? db.selectFrom('users').select(['id', 'name']).where('id', 'in', mentionUserIds).execute()
      : Promise.resolve([]),
  ])

  const metadataJson = JSON.stringify({
    mentionAgentIds: mentionedAgents.map((agent) => agent.id),
    mentionUserIds: mentionedUsers.map((user) => user.id),
  })

  const comment = await createTicketComment({
    ticket_id: ticket.id,
    author_kind: 'agent',
    author_ref: agentId,
    kind,
    body,
    metadata_json: metadataJson,
  })

  await addTicketParticipants({
    ticketId: ticket.id,
    participants: [
      { kind: 'agent', ref: agentId },
      ...mentionedAgents.map((agent) => ({ kind: 'agent' as const, ref: agent.id })),
      ...mentionedUsers.map((user) => ({ kind: 'user' as const, ref: user.id })),
    ],
    addedByKind: 'agent',
    addedByRef: agentId,
  })

  await resolveAttentionItemsForTargetOnTicket({
    ticketId: ticket.id,
    targetKind: 'agent',
    targetRef: agentId,
    resolvedByKind: 'agent',
    resolvedByRef: agentId,
  })

  for (const user of mentionedUsers) {
    await createAttentionItem({
      target_kind: 'user',
      target_ref: user.id,
      source_kind: 'ticket_comment',
      source_ref: comment.id,
      ticket_id: ticket.id,
      goal_id: ticket.goal_id,
      status: 'open',
      title: `${author.name} mentioned you on ${ticket.title}`,
      body,
      metadata_json: metadataJson,
      resolved_at: null,
      resolved_by_kind: null,
      resolved_by_ref: null,
    })
  }

  const queuedAgentWorkItems: string[] = []
  for (const agent of mentionedAgents) {
    await createAttentionItem({
      target_kind: 'agent',
      target_ref: agent.id,
      source_kind: 'ticket_comment',
      source_ref: comment.id,
      ticket_id: ticket.id,
      goal_id: ticket.goal_id,
      status: 'open',
      title: `${author.name} mentioned @${agent.handle} on ${ticket.title}`,
      body,
      metadata_json: metadataJson,
      resolved_at: null,
      resolved_by_kind: null,
      resolved_by_ref: null,
    })

    if (!kickstartAgentMentions) continue

    const workItem = await enqueueTicketAgentWork({
      ticketId: ticket.id,
      agentId: agent.id,
      source: 'ticket_comment',
      sourceRef: `ticket:${ticket.id}:comment:${comment.id}:mention:${agent.id}`,
      title: `Ticket comment: ${ticket.title}`,
      body: [
        `${author.name} mentioned you on ticket "${ticket.title}".`,
        '',
        `Comment type: ${kind.replace(/_/g, ' ')}`,
        `Comment: ${body}`,
        '',
        'Respond on the ticket thread with a concrete answer, question, or approval state before you stop.',
      ].join('\n'),
      senderName: author.name,
      actor: {
        kind: 'agent',
        agentId: author.id,
        handle: author.handle,
        displayName: author.name,
        source: 'ticket_comment',
      },
      // Ticket comments are canonical on the ticket; mentioned-agent follow-up
      // should not inherit the current plugin/channel response target.
      pluginInstanceId: null,
      responseContext: null,
      createReceiptLink: true,
      metadata: {
        ticketCommentId: comment.id,
        ticketCommentKind: kind,
      },
    })
    queuedAgentWorkItems.push(workItem.id)
  }

  if (
    markBlocked &&
    ticket.status !== 'done' &&
    ticket.status !== 'canceled' &&
    ticket.status !== 'blocked'
  ) {
    await updateTicket(ticket.id, {
      goal_id: ticket.goal_id,
      parent_ticket_id: ticket.parent_ticket_id,
      title: ticket.title,
      body: ticket.body,
      status: 'blocked',
      assignee_kind: ticket.assignee_kind,
      assignee_ref: ticket.assignee_ref,
      claimed_by_kind: ticket.claimed_by_kind,
      claimed_by_ref: ticket.claimed_by_ref,
      claimed_at: ticket.claimed_at,
      archived_at: ticket.archived_at,
    })

    await createWorkUpdate({
      goal_id: ticket.goal_id,
      ticket_id: ticket.id,
      team_id: null,
      author_kind: 'agent',
      author_ref: agentId,
      kind: 'status',
      body: `Status changed from ${ticket.status} to blocked.`,
      metadata_json: JSON.stringify({ ticketCommentId: comment.id }),
    })
  }

  return {
    success: true,
    output: `Posted ${kind} comment on ticket ${ticket.id}.${queuedAgentWorkItems.length > 0 ? ` Queued ${queuedAgentWorkItems.length} mentioned agent follow-up${queuedAgentWorkItems.length > 1 ? 's' : ''}.` : ''}`,
  }
}

export const postWorkUpdateDefinition: Anthropic.Tool = {
  name: 'post_work_update',
  description: 'Post a human-visible work update on a goal or ticket.',
  input_schema: {
    type: 'object' as const,
    properties: {
      goal_id: { type: 'string', description: 'Optional goal ID.' },
      ticket_id: { type: 'string', description: 'Optional ticket ID.' },
      kind: {
        type: 'string',
        enum: ['note', 'status', 'heartbeat'],
        description: 'Update kind (default: note).',
      },
      body: { type: 'string', description: 'The update text.' },
      metadata_json: {
        description:
          'Optional JSON object or JSON string for structured receipts such as routine IDs, work item IDs, or autonomy-cycle markers.',
      },
    },
    required: ['body'],
  },
}

export const postWorkUpdateTool: ToolHandler = async (input, context) => {
  const agentId = requireAgentId(context)
  const goalId = typeof input.goal_id === 'string' ? input.goal_id.trim() : ''
  const ticketId = typeof input.ticket_id === 'string' ? input.ticket_id.trim() : ''
  const teamId = typeof input.team_id === 'string' ? input.team_id.trim() : ''
  const body = typeof input.body === 'string' ? input.body.trim() : ''
  const metadataJson = parseMetadataJson(input.metadata_json)
  const kind =
    typeof input.kind === 'string' && ['note', 'status', 'heartbeat'].includes(input.kind)
      ? input.kind
      : 'note'

  if (teamId) {
    return {
      success: false,
      error: 'team_id is no longer supported in post_work_update. Use goal_id or ticket_id only.',
    }
  }

  if (!goalId && !ticketId) {
    return { success: false, error: 'goal_id or ticket_id is required.' }
  }
  if (!body) {
    return { success: false, error: 'body is required.' }
  }
  const ticket = ticketId ? await findTicketById(ticketId) : null
  const resolvedGoalId = ticket ? (ticket.goal_id ?? '') : goalId

  if (ticketId && !ticket) {
    return { success: false, error: `Ticket ${ticketId} not found.` }
  }

  if (kind === 'heartbeat') {
    if (!resolvedGoalId) {
      return { success: false, error: 'Heartbeat updates must target a goal.' }
    }
  }

  if (ticketId) {
    await assertAgentGrant({
      agentId,
      action: 'work.ticket.write',
      resourceType: 'ticket',
      resourceId: ticketId,
    })
  } else {
    await assertAgentGrant({
      agentId,
      action: 'work.goal.write',
      resourceType: 'goal',
      resourceId: goalId,
    })
  }

  await createWorkUpdate({
    goal_id: resolvedGoalId || null,
    ticket_id: ticketId || null,
    team_id: teamId || null,
    author_kind: 'agent',
    author_ref: agentId,
    kind,
    body,
    metadata_json: metadataJson,
  })

  return { success: true, output: 'Work update posted.' }
}

export const linkTicketReceiptDefinition: Anthropic.Tool = {
  name: 'link_ticket_receipt',
  description:
    'Attach a concrete receipt to a ticket so sessions and work items are visibly tied to the ticket.',
  input_schema: {
    type: 'object' as const,
    properties: {
      ticket_id: { type: 'string', description: 'Ticket ID to attach the receipt to.' },
      kind: {
        type: 'string',
        enum: ['session', 'work_item', 'external'],
        description: 'Receipt kind.',
      },
      ref: {
        type: 'string',
        description: 'Receipt reference such as session key, work item ID, or URL.',
      },
      label: { type: 'string', description: 'Optional human-friendly label.' },
      metadata_json: {
        description:
          'Optional JSON object or JSON string for structured receipt metadata such as autonomy-cycle IDs.',
      },
    },
    required: ['ticket_id', 'kind', 'ref'],
  },
}

export const linkTicketReceiptTool: ToolHandler = async (input, context) => {
  const agentId = requireAgentId(context)
  const ticketId = typeof input.ticket_id === 'string' ? input.ticket_id.trim() : ''
  const kind =
    typeof input.kind === 'string' && ['session', 'work_item', 'external'].includes(input.kind)
      ? input.kind
      : ''
  const ref = typeof input.ref === 'string' ? input.ref.trim() : ''
  const label = typeof input.label === 'string' ? input.label.trim() : null
  const metadataJson = parseMetadataJson(input.metadata_json)

  if (!ticketId) {
    return { success: false, error: 'ticket_id is required.' }
  }
  if (!kind) {
    return { success: false, error: 'kind must be one of: session, work_item, external.' }
  }
  if (!ref) {
    return { success: false, error: 'ref is required.' }
  }

  await assertAgentGrant({
    agentId,
    action: 'work.ticket.write',
    resourceType: 'ticket',
    resourceId: ticketId,
  })

  const ticket = await findTicketById(ticketId)
  if (!ticket) {
    return { success: false, error: `Ticket "${ticketId}" not found.` }
  }

  if (kind === 'session') {
    const existing = await findTicketBySessionKey(ref)
    if (existing && existing.id !== ticket.id) {
      return {
        success: false,
        error: `Session "${ref}" is already linked to ticket ${existing.id}.`,
      }
    }
  }

  if (kind === 'work_item') {
    const existing = await findTicketByWorkItemId(ref)
    if (existing && existing.id !== ticket.id) {
      return {
        success: false,
        error: `Work item "${ref}" is already linked to ticket ${existing.id}.`,
      }
    }
  }

  await createTicketLink({
    ticket_id: ticket.id,
    kind,
    ref,
    label,
    metadata_json: metadataJson,
    created_by_kind: 'agent',
    created_by_ref: agentId,
  })

  await createWorkUpdate({
    goal_id: ticket.goal_id,
    ticket_id: ticket.id,
    team_id: null,
    author_kind: 'agent',
    author_ref: agentId,
    kind: 'note',
    body: `Linked ${kind} receipt ${ref}.`,
    metadata_json: metadataJson,
  })

  return { success: true, output: `Linked ${kind} receipt ${ref} to ticket ${ticket.id}.` }
}

export const runTicketNowDefinition: Anthropic.Tool = {
  name: 'run_ticket_now',
  description:
    'Immediately enqueue a ticket execution pass for yourself in the current app session so a hot lane can continue without waiting for the next heartbeat. This does not delegate to another agent; use assign_ticket for cross-agent kickoff.',
  input_schema: {
    type: 'object' as const,
    properties: {
      ticket_id: { type: 'string', description: 'Ticket ID to execute now.' },
      message: {
        type: 'string',
        description:
          'Optional custom execution instruction. Defaults to a receipt-first ticket execution prompt.',
      },
      link_work_item_receipt: {
        type: 'boolean',
        description:
          'When true (default), attach the queued work item to the ticket as a visible receipt.',
      },
    },
    required: ['ticket_id'],
  },
}

export const runTicketNowTool: ToolHandler = async (input, context) => {
  const agentId = requireAgentId(context)
  const ticketId = typeof input.ticket_id === 'string' ? input.ticket_id.trim() : ''
  const sessionKey = context.sessionKey?.trim() ?? ''
  const customMessage = typeof input.message === 'string' ? input.message.trim() : ''
  const linkWorkItemReceipt = input.link_work_item_receipt !== false

  if (!ticketId) {
    return { success: false, error: 'ticket_id is required.' }
  }
  if (!sessionKey) {
    return {
      success: false,
      error:
        'run_ticket_now requires an active app session context and only runs the current agent. Use assign_ticket to delegate a ticket to another agent.',
    }
  }

  await assertAgentGrant({
    agentId,
    action: 'work.ticket.write',
    resourceType: 'ticket',
    resourceId: ticketId,
  })

  const [ticket, agent] = await Promise.all([findTicketById(ticketId), findAgentById(agentId)])
  if (!ticket) {
    return { success: false, error: `Ticket "${ticketId}" not found.` }
  }
  if (!agent) {
    return { success: false, error: `Agent "${agentId}" not found.` }
  }

  const participants = await listAppSessionParticipantAgents(sessionKey)
  if (!participants.some((participant) => participant.id === agentId)) {
    return {
      success: false,
      error: `Agent "${agent.handle}" is not a participant in session "${sessionKey}". run_ticket_now only runs the current agent in the current session; use assign_ticket for cross-agent delegation.`,
    }
  }

  if (
    ticket.assignee_kind !== 'agent' ||
    ticket.assignee_ref !== agentId ||
    ticket.status !== 'in_progress'
  ) {
    await claimTicket(ticket.id, {
      assigneeKind: 'agent',
      assigneeRef: agentId,
      claimedByKind: 'agent',
      claimedByRef: agentId,
    })
  }

  const goal = ticket.goal_id ? await findGoalById(ticket.goal_id) : null
  const message = buildTicketExecutionMessage({
    title: ticket.title,
    body: ticket.body,
    message: customMessage || null,
  })
  const timestamp = now()
  const recentLinkedWorkItems = await listLinkedWorkItemsForTicket(ticket.id)
  const sourceRef = `app-agent:${agentId}:ticket:${ticket.id}`
  const existingRecentWorkItem = recentLinkedWorkItems.find(
    (item) =>
      item.session_key === sessionKey &&
      item.source === 'app_chat' &&
      item.source_ref === sourceRef &&
      item.created_at >= timestamp - RUN_TICKET_DEDUPE_WINDOW_SEC
  )

  if (existingRecentWorkItem) {
    return {
      success: true,
      output: `Skipped duplicate ticket run for ${ticket.id}; recent work item ${existingRecentWorkItem.id} already exists in session ${sessionKey}.`,
    }
  }

  if (context.jobId) {
    const recentTicketLinks = await listTicketLinksByTicket(ticket.id)
    const existingRecentScheduledFollowup = recentTicketLinks.find(
      (link) =>
        link.kind === 'external' &&
        link.ref.startsWith('scheduled_item:') &&
        link.created_at >= timestamp - RUN_TICKET_DEDUPE_WINDOW_SEC
    )

    if (existingRecentScheduledFollowup) {
      return {
        success: true,
        output: `Skipped duplicate ticket follow-up for ${ticket.id}; recent scheduled receipt ${existingRecentScheduledFollowup.ref} already exists in session ${sessionKey}.`,
      }
    }

    const { routine, scheduledItem } = await createOneShotRoutineSchedule({
      agentId,
      name: `Scheduled ticket follow-up (${truncateText(ticket.title, 40)})`,
      description: `Ticket ${ticket.id}`,
      actionPrompt: message,
      runAt: timestamp + 60,
      sourceRef: `ticket:${ticket.id}`,
      targetPluginInstanceId: context.pluginInstanceId ?? null,
      targetSessionKey: sessionKey,
      targetResponseContext: context.responseContext
        ? JSON.stringify(context.responseContext)
        : null,
      createdByKind: 'agent',
      createdByRef: agentId,
    })

    if (linkWorkItemReceipt) {
      await createTicketLink({
        ticket_id: ticket.id,
        kind: 'external',
        ref: `scheduled_item:${scheduledItem.id}`,
        label: `Scheduled follow-up from session ${sessionKey}`,
        metadata_json: JSON.stringify({
          receiptKind: 'ticket_run_spike',
          sessionKey,
          routineId: routine.id,
          scheduledItemId: scheduledItem.id,
        }),
        created_by_kind: 'agent',
        created_by_ref: agentId,
      })
    }

    return {
      success: true,
      output: `Scheduled ticket ${ticket.id} in session ${sessionKey} as scheduled item ${scheduledItem.id} (routine ${routine.id}).`,
    }
  }

  const workItem = await createWorkItem({
    plugin_instance_id: context.pluginInstanceId ?? null,
    session_key: sessionKey,
    source: 'app_chat',
    source_ref: sourceRef,
    status: 'NEW',
    title: truncateText(message, MESSAGE_TITLE_MAX_CHARS),
    payload: JSON.stringify({
      body: message,
      senderName: agent.name,
      sessionKey,
      targetAgentIds: [agentId],
      ticketId: ticket.id,
      ticketTitle: ticket.title,
      ticketStatus: ticket.status,
      goalId: goal?.id ?? undefined,
      goalTitle: goal?.title ?? undefined,
      goalStatus: goal?.status ?? undefined,
      goalOutcome: goal?.outcome ?? undefined,
      actor: {
        kind: 'agent',
        agentId: agent.id,
        handle: agent.handle,
        displayName: agent.name,
        source: 'ticket_run_tool',
      },
    }),
  })

  const queueKey = `${sessionKey}:${agentId}`
  await enqueueToLane(
    {
      queue_key: queueKey,
      work_item_id: workItem.id,
      plugin_instance_id: context.pluginInstanceId ?? null,
      response_context: context.responseContext ? JSON.stringify(context.responseContext) : null,
      text: message,
      sender_name: agent.name,
      arrived_at: timestamp,
      status: 'pending',
      dispatch_id: null,
      drop_reason: null,
    },
    {
      queueKey,
      sessionKey,
      agentId,
      pluginInstanceId: context.pluginInstanceId ?? null,
      arrivedAt: timestamp,
      debounceMs: APP_CHAT_DEBOUNCE_MS,
      maxQueued: APP_CHAT_MAX_QUEUED,
      mode: 'steer',
    }
  )

  await touchAppSessionLastActivity(sessionKey)

  if (linkWorkItemReceipt) {
    const existingLinkedTicket = await findTicketByWorkItemId(workItem.id)
    if (!existingLinkedTicket) {
      await createTicketLink({
        ticket_id: ticket.id,
        kind: 'work_item',
        ref: workItem.id,
        label: `Queued from session ${sessionKey}`,
        metadata_json: JSON.stringify({
          receiptKind: 'ticket_run_spike',
          sessionKey,
        }),
        created_by_kind: 'agent',
        created_by_ref: agentId,
      })
    }
  }

  return {
    success: true,
    output: `Queued ticket ${ticket.id} in session ${sessionKey} as work item ${workItem.id}.`,
  }
}

export const createGoalDefinition: Anthropic.Tool = {
  name: 'create_goal',
  description: 'Create a new organizational goal.',
  input_schema: {
    type: 'object' as const,
    properties: {
      title: { type: 'string', description: 'Goal title.' },
      outcome: { type: 'string', description: 'Desired outcome (default: empty).' },
      parent_goal_id: { type: 'string', description: 'Optional parent goal ID for nesting.' },
      team_id: { type: 'string', description: 'Optional team ID to associate.' },
      owner_agent_id: {
        type: 'string',
        description: 'Optional agent ID to set as owner.',
      },
      status: {
        type: 'string',
        enum: ['draft', 'active', 'at_risk', 'blocked', 'done', 'archived'],
        description: 'Goal status (default: draft).',
      },
      progress_source: {
        type: 'string',
        description: 'Optional progress source.',
      },
    },
    required: ['title'],
  },
}

export const createGoalTool: ToolHandler = async (input, context) => {
  const agentId = requireAgentId(context)
  await assertAgentGrant({ agentId, action: 'work.goal.create', resourceType: 'goal' })

  const title = typeof input.title === 'string' ? input.title.trim() : ''
  if (!title) {
    return { success: false, error: 'title is required.' }
  }

  const outcome = typeof input.outcome === 'string' ? input.outcome.trim() : ''
  const parentGoalId = typeof input.parent_goal_id === 'string' ? input.parent_goal_id.trim() : null
  const teamId = typeof input.team_id === 'string' ? input.team_id.trim() : null
  const ownerAgentId = typeof input.owner_agent_id === 'string' ? input.owner_agent_id.trim() : null
  const status =
    typeof input.status === 'string' &&
    ['draft', 'active', 'at_risk', 'blocked', 'done', 'archived'].includes(input.status)
      ? input.status
      : 'draft'
  const progressSource =
    typeof input.progress_source === 'string' ? input.progress_source.trim() : undefined

  if (parentGoalId) {
    const parent = await findGoalById(parentGoalId)
    if (!parent) {
      return { success: false, error: `Parent goal "${parentGoalId}" not found.` }
    }
  }

  const goal = await createGoal({
    parent_goal_id: parentGoalId || null,
    title,
    outcome,
    status,
    owner_kind: ownerAgentId ? 'agent' : null,
    owner_ref: ownerAgentId || null,
    team_id: teamId || null,
    progress_source: progressSource as never,
    progress_current: null,
    progress_target: null,
    progress_unit: null,
    created_by_user_id: null,
  })

  return { success: true, output: `Created goal ${goal.id}: ${goal.title}` }
}

export const deleteGoalDefinition: Anthropic.Tool = {
  name: 'delete_goal',
  description: 'Delete a goal. Fails if the goal has child goals.',
  input_schema: {
    type: 'object' as const,
    properties: {
      goal_id: { type: 'string', description: 'The goal ID to delete.' },
    },
    required: ['goal_id'],
  },
}

export const deleteGoalTool: ToolHandler = async (input, context) => {
  const agentId = requireAgentId(context)
  const goalId = typeof input.goal_id === 'string' ? input.goal_id.trim() : ''
  if (!goalId) {
    return { success: false, error: 'goal_id is required.' }
  }
  await assertAgentGrant({
    agentId,
    action: 'work.goal.delete',
    resourceType: 'goal',
    resourceId: goalId,
  })

  const goal = await findGoalById(goalId)
  if (!goal) {
    return { success: false, error: `Goal "${goalId}" not found.` }
  }

  const children = await listGoals({ parentGoalId: goalId, limit: 1 })
  if (children.length > 0) {
    return { success: false, error: `Goal "${goalId}" has child goals. Remove them first.` }
  }

  const db = getDb()
  await db.deleteFrom('goals').where('id', '=', goalId).execute()

  return { success: true, output: `Deleted goal ${goalId}.` }
}

export const createTicketDefinition: Anthropic.Tool = {
  name: 'create_ticket',
  description: 'Create a new ticket, optionally linked to a goal.',
  input_schema: {
    type: 'object' as const,
    properties: {
      title: { type: 'string', description: 'Ticket title.' },
      body: { type: 'string', description: 'Optional ticket body/description.' },
      goal_id: { type: 'string', description: 'Optional goal ID to link this ticket to.' },
      parent_ticket_id: {
        type: 'string',
        description: 'Optional parent ticket ID for nesting.',
      },
      assignee_agent_id: {
        type: 'string',
        description: 'Optional agent ID to assign the ticket to.',
      },
      status: {
        type: 'string',
        enum: ['inbox', 'ready', 'in_progress', 'blocked', 'done', 'canceled'],
        description: 'Ticket status (default: inbox).',
      },
    },
    required: ['title'],
  },
}

export const createTicketTool: ToolHandler = async (input, context) => {
  const agentId = requireAgentId(context)
  await assertAgentGrant({ agentId, action: 'work.ticket.create', resourceType: 'ticket' })

  const title = typeof input.title === 'string' ? input.title.trim() : ''
  if (!title) {
    return { success: false, error: 'title is required.' }
  }

  const body = typeof input.body === 'string' ? input.body.trim() : null
  const goalId = typeof input.goal_id === 'string' ? input.goal_id.trim() : null
  const parentTicketId =
    typeof input.parent_ticket_id === 'string' ? input.parent_ticket_id.trim() : null
  const assigneeAgentId =
    typeof input.assignee_agent_id === 'string' ? input.assignee_agent_id.trim() : null
  const status =
    typeof input.status === 'string' &&
    ['inbox', 'ready', 'in_progress', 'blocked', 'done', 'canceled'].includes(input.status)
      ? input.status
      : 'inbox'

  if (goalId) {
    const goal = await findGoalById(goalId)
    if (!goal) {
      return { success: false, error: `Goal "${goalId}" not found.` }
    }
  }

  const ticket = await createTicket({
    goal_id: goalId || null,
    parent_ticket_id: parentTicketId || null,
    title,
    body,
    status,
    assignee_kind: assigneeAgentId ? 'agent' : null,
    assignee_ref: assigneeAgentId || null,
    created_by_user_id: null,
    claimed_by_kind: null,
    claimed_by_ref: null,
    claimed_at: null,
  })

  return { success: true, output: `Created ticket ${ticket.id}: ${ticket.title}` }
}

export const deleteTicketDefinition: Anthropic.Tool = {
  name: 'delete_ticket',
  description: 'Delete a ticket.',
  input_schema: {
    type: 'object' as const,
    properties: {
      ticket_id: { type: 'string', description: 'The ticket ID to delete.' },
    },
    required: ['ticket_id'],
  },
}

export const deleteTicketTool: ToolHandler = async (input, context) => {
  const agentId = requireAgentId(context)
  const ticketId = typeof input.ticket_id === 'string' ? input.ticket_id.trim() : ''
  if (!ticketId) {
    return { success: false, error: 'ticket_id is required.' }
  }
  await assertAgentGrant({
    agentId,
    action: 'work.ticket.delete',
    resourceType: 'ticket',
    resourceId: ticketId,
  })

  const ticket = await findTicketById(ticketId)
  if (!ticket) {
    return { success: false, error: `Ticket "${ticketId}" not found.` }
  }

  const db = getDb()
  await db.deleteFrom('tickets').where('id', '=', ticketId).execute()

  return { success: true, output: `Deleted ticket ${ticketId}.` }
}

export const workDefinitions: Anthropic.Tool[] = [
  searchGoalsDefinition,
  searchTicketsDefinition,
  getTicketDefinition,
  assignTicketDefinition,
  claimTicketDefinition,
  updateTicketDefinition,
  postTicketCommentDefinition,
  postWorkUpdateDefinition,
  linkTicketReceiptDefinition,
  runTicketNowDefinition,
  createGoalDefinition,
  deleteGoalDefinition,
  createTicketDefinition,
  deleteTicketDefinition,
]
