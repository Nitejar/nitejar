import type Anthropic from '@anthropic-ai/sdk'
import {
  claimTicket,
  createWorkUpdate,
  findGoalById,
  findTicketById,
  getDb,
  listGoals,
  listLinkedWorkItemsForTicket,
  listTicketLinksByTicket,
  listTickets,
  updateTicket,
} from '@nitejar/database'
import type { ToolHandler } from '../types'

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
  if (kind === 'team') {
    const team = await db
      .selectFrom('teams')
      .select(['name'])
      .where('id', '=', ref)
      .executeTakeFirst()
    return team?.name ?? ref
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

export const searchGoalsDefinition: Anthropic.Tool = {
  name: 'search_goals',
  description: 'Search organization goals by title or outcome and return compact summaries.',
  input_schema: {
    type: 'object' as const,
    properties: {
      query: { type: 'string', description: 'Text to search for.' },
      owner_kind: {
        type: 'string',
        enum: ['user', 'agent', 'team'],
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

export const searchGoalsTool: ToolHandler = async (input) => {
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
        enum: ['user', 'agent', 'team'],
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

export const getTicketTool: ToolHandler = async (input) => {
  const ticketId = typeof input.ticket_id === 'string' ? input.ticket_id.trim() : ''
  if (!ticketId) {
    return { success: false, error: 'ticket_id is required.' }
  }

  const ticket = await findTicketById(ticketId)
  if (!ticket) {
    return { success: false, error: `Ticket "${ticketId}" not found.` }
  }

  const [goal, assignee, links, workItems] = await Promise.all([
    ticket.goal_id ? findGoalById(ticket.goal_id) : Promise.resolve(null),
    resolveActorLabel(ticket.assignee_kind, ticket.assignee_ref),
    listTicketLinksByTicket(ticket.id),
    listLinkedWorkItemsForTicket(ticket.id),
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
  if (!context.agentId) {
    return { success: false, error: 'Agent context is required.' }
  }

  const ticketId = typeof input.ticket_id === 'string' ? input.ticket_id.trim() : ''
  if (!ticketId) {
    return { success: false, error: 'ticket_id is required.' }
  }

  const updated = await claimTicket(ticketId, {
    assigneeKind: 'agent',
    assigneeRef: context.agentId,
    claimedByKind: 'agent',
    claimedByRef: context.agentId,
  })
  if (!updated) {
    return { success: false, error: `Ticket "${ticketId}" not found.` }
  }

  await createWorkUpdate({
    goal_id: updated.goal_id,
    ticket_id: updated.id,
    team_id: null,
    author_kind: 'agent',
    author_ref: context.agentId,
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
  const ticketId = typeof input.ticket_id === 'string' ? input.ticket_id.trim() : ''
  if (!ticketId) {
    return { success: false, error: 'ticket_id is required.' }
  }

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

  if (context.agentId && nextStatus !== existing.status) {
    await createWorkUpdate({
      goal_id: updated.goal_id,
      ticket_id: updated.id,
      team_id: null,
      author_kind: 'agent',
      author_ref: context.agentId,
      kind: 'status',
      body: `Status changed from ${existing.status} to ${updated.status}.`,
      metadata_json: null,
    })
  }

  return { success: true, output: `Updated ticket ${updated.id}.` }
}

export const postWorkUpdateDefinition: Anthropic.Tool = {
  name: 'post_work_update',
  description: 'Post a human-visible work update on a goal or ticket.',
  input_schema: {
    type: 'object' as const,
    properties: {
      goal_id: { type: 'string', description: 'Optional goal ID.' },
      ticket_id: { type: 'string', description: 'Optional ticket ID.' },
      team_id: { type: 'string', description: 'Optional team ID.' },
      kind: {
        type: 'string',
        enum: ['note', 'status', 'heartbeat'],
        description: 'Update kind (default: note).',
      },
      body: { type: 'string', description: 'The update text.' },
    },
    required: ['body'],
  },
}

export const postWorkUpdateTool: ToolHandler = async (input, context) => {
  const goalId = typeof input.goal_id === 'string' ? input.goal_id.trim() : ''
  const ticketId = typeof input.ticket_id === 'string' ? input.ticket_id.trim() : ''
  const teamId = typeof input.team_id === 'string' ? input.team_id.trim() : ''
  const body = typeof input.body === 'string' ? input.body.trim() : ''
  const kind =
    typeof input.kind === 'string' && ['note', 'status', 'heartbeat'].includes(input.kind)
      ? input.kind
      : 'note'

  if (!goalId && !ticketId && !teamId) {
    return { success: false, error: 'goal_id, ticket_id, or team_id is required.' }
  }
  if (!body) {
    return { success: false, error: 'body is required.' }
  }

  await createWorkUpdate({
    goal_id: goalId || null,
    ticket_id: ticketId || null,
    team_id: teamId || null,
    author_kind: context.agentId ? 'agent' : 'system',
    author_ref: context.agentId ?? null,
    kind,
    body,
    metadata_json: null,
  })

  return { success: true, output: 'Work update posted.' }
}

export const workDefinitions: Anthropic.Tool[] = [
  searchGoalsDefinition,
  searchTicketsDefinition,
  getTicketDefinition,
  claimTicketDefinition,
  updateTicketDefinition,
  postWorkUpdateDefinition,
]
