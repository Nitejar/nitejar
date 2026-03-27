import {
  findRoutineById,
  findRoutineRunByScheduledItemId,
  findTicketById,
  listTicketsByWorkItemIds,
  parseAppSessionKey,
} from '@nitejar/database'

export interface WorkItemTicketContext {
  ticketId: string | null
  ticketTitle: string | null
  goalId: string | null
}

function extractScheduledItemId(sourceRef: string | null | undefined): string | null {
  if (!sourceRef) return null
  const match = /^routine:[^:]+:scheduled:(.+)$/.exec(sourceRef)
  return match?.[1] ?? null
}

function extractTicketId(triggerRef: string | null | undefined): string | null {
  if (!triggerRef?.startsWith('ticket:')) return null
  return triggerRef.slice('ticket:'.length) || null
}

function extractGoalIdFromGoalHeartbeatSessionKey(sessionKey: string | null | undefined): string | null {
  if (!sessionKey) return null
  const match = /^work:goal:(.+):heartbeat$/.exec(sessionKey)
  return match?.[1] ?? null
}

async function resolveGoalIdFromRoutineContext(routineId: string): Promise<string | null> {
  const routine = await findRoutineById(routineId)
  if (!routine) return null

  const parsedTarget = parseAppSessionKey(routine.target_session_key)
  if (parsedTarget.isAppSession && parsedTarget.contextKind === 'goal') {
    return parsedTarget.contextId
  }

  return extractGoalIdFromGoalHeartbeatSessionKey(routine.target_session_key)
}

export async function resolveWorkItemTicketContexts(
  items: Array<{
    workItemId: string
    sourceRef: string | null | undefined
    sessionKey?: string | null | undefined
  }>
): Promise<Map<string, WorkItemTicketContext>> {
  if (items.length === 0) return new Map()

  const byWorkItemId = new Map<string, WorkItemTicketContext>()
  const directLinks = await listTicketsByWorkItemIds(items.map((item) => item.workItemId))
  for (const row of directLinks) {
    byWorkItemId.set(row.work_item_id, {
      ticketId: row.ticket_id,
      ticketTitle: row.ticket_title,
      goalId: row.goal_id,
    })
  }

  const unresolved = items.filter((item) => !byWorkItemId.has(item.workItemId))
  if (unresolved.length === 0) return byWorkItemId

  const fallbackContexts = await Promise.all(
    unresolved.map(async (item) => {
      const scheduledItemId = extractScheduledItemId(item.sourceRef)
      if (scheduledItemId) {
        const routineRun = await findRoutineRunByScheduledItemId(scheduledItemId)
        const ticketId = extractTicketId(routineRun?.trigger_ref)
        if (ticketId) {
          const ticket = await findTicketById(ticketId)
          if (ticket) {
            return {
              workItemId: item.workItemId,
              context: {
                ticketId: ticket.id,
                ticketTitle: ticket.title,
                goalId: ticket.goal_id,
              },
            }
          }
        }
      }

      const parsedSession = item.sessionKey ? parseAppSessionKey(item.sessionKey) : null
      if (parsedSession?.isAppSession && parsedSession.contextKind === 'goal') {
        return {
          workItemId: item.workItemId,
              context: {
                ticketId: null,
                ticketTitle: null,
                goalId: parsedSession.contextId,
              },
        }
      }

      if (parsedSession?.isAppSession && parsedSession.contextKind === 'routine') {
        const goalId = await resolveGoalIdFromRoutineContext(parsedSession.contextId)
        if (goalId) {
          return {
            workItemId: item.workItemId,
              context: {
                ticketId: null,
                ticketTitle: null,
                goalId,
              },
          }
        }
      }
      return null
    })
  )

  for (const row of fallbackContexts) {
    if (!row) continue
    byWorkItemId.set(row.workItemId, row.context)
  }

  return byWorkItemId
}

export async function resolveDeferredTicketTitles(
  items: Array<{
    workItemId: string
    sourceRef: string | null | undefined
    sessionKey?: string | null | undefined
  }>
): Promise<Map<string, string>> {
  const contexts = await resolveWorkItemTicketContexts(items)
  return new Map(
    [...contexts.entries()]
      .filter(([, context]) => Boolean(context.ticketTitle))
      .map(([workItemId, context]) => [workItemId, context.ticketTitle as string])
  )
}
