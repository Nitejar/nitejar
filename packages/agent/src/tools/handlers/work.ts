import type Anthropic from '@anthropic-ai/sdk'
import {
  assertAgentGrant,
  claimTicket,
  createOneShotRoutineSchedule,
  createGoal,
  createTicket,
  createTicketLink,
  createWorkItem,
  createWorkUpdate,
  enqueueToLane,
  findAgentById,
  findGoalById,
  listAppSessionParticipantAgents,
  findTicketById,
  findTicketBySessionKey,
  findTicketByWorkItemId,
  getDb,
  listGoals,
  listLinkedWorkItemsForTicket,
  listTicketLinksByTicket,
  listTickets,
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
}): string {
  const custom = input.message?.trim()
  if (custom) return custom

  const bodySnippet = input.body?.trim()
  if (!bodySnippet) {
    return `${DEFAULT_TICKET_EXECUTION_MESSAGE}\n\nTicket: ${input.title}`
  }

  return `${DEFAULT_TICKET_EXECUTION_MESSAGE}\n\nTicket: ${input.title}\nScope:\n${bodySnippet}`
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
      ref: { type: 'string', description: 'Receipt reference such as session key, work item ID, or URL.' },
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
      return { success: false, error: `Session "${ref}" is already linked to ticket ${existing.id}.` }
    }
  }

  if (kind === 'work_item') {
    const existing = await findTicketByWorkItemId(ref)
    if (existing && existing.id !== ticket.id) {
      return { success: false, error: `Work item "${ref}" is already linked to ticket ${existing.id}.` }
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
    'Immediately enqueue a ticket execution pass in the current app session so a hot lane can continue without waiting for the next heartbeat.',
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
      error: 'run_ticket_now requires an active app session context.',
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
      error: `Agent "${agent.handle}" is not a participant in session "${sessionKey}".`,
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
      targetResponseContext: context.responseContext ? JSON.stringify(context.responseContext) : null,
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
  claimTicketDefinition,
  updateTicketDefinition,
  postWorkUpdateDefinition,
  linkTicketReceiptDefinition,
  runTicketNowDefinition,
  createGoalDefinition,
  deleteGoalDefinition,
  createTicketDefinition,
  deleteTicketDefinition,
]
