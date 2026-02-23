import type Anthropic from '@anthropic-ai/sdk'
import {
  createOneShotRoutineSchedule,
  findScheduledItemById,
  listScheduledItemsByAgent,
  markScheduledItemCancelled,
} from '@nitejar/database'
import type { ToolHandler } from '../types'

export const scheduleDefinitions: Anthropic.Tool[] = [
  {
    name: 'schedule_check',
    description:
      'Schedule a deferred check-in. After the specified delay, you will be re-invoked with the provided instructions in this same conversation.',
    input_schema: {
      type: 'object' as const,
      properties: {
        delay_minutes: {
          type: 'number',
          description: 'Minutes from now to fire (1-1440).',
        },
        instructions: {
          type: 'string',
          description: 'Instructions for yourself when the scheduled check fires.',
        },
        reference: {
          type: 'string',
          description: 'Optional reference (e.g. PR URL, check run ID) for context.',
        },
      },
      required: ['delay_minutes', 'instructions'],
    },
  },
  {
    name: 'list_schedule',
    description: 'List your pending scheduled items.',
    input_schema: {
      type: 'object' as const,
      properties: {
        session_only: {
          type: 'boolean',
          description: 'If true, only show items for the current conversation session.',
        },
      },
    },
  },
  {
    name: 'cancel_scheduled',
    description: 'Cancel a pending scheduled item by its ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        scheduled_id: {
          type: 'string',
          description: 'The ID of the scheduled item to cancel.',
        },
      },
      required: ['scheduled_id'],
    },
  },
]

export const scheduleCheckTool: ToolHandler = async (input, context) => {
  if (!context.agentId) {
    return { success: false, error: 'Missing agent identity.' }
  }
  if (!context.sessionKey) {
    return { success: false, error: 'Missing session key.' }
  }

  const delayMinutes = input.delay_minutes as number
  if (!delayMinutes || delayMinutes < 1 || delayMinutes > 1440) {
    return { success: false, error: 'delay_minutes must be between 1 and 1440.' }
  }

  const instructions = typeof input.instructions === 'string' ? input.instructions.trim() : ''
  if (!instructions) {
    return { success: false, error: 'instructions is required.' }
  }

  const reference = typeof input.reference === 'string' ? input.reference.trim() : undefined
  const runAt = Math.floor(Date.now() / 1000) + delayMinutes * 60

  if (!context.pluginInstanceId) {
    return {
      success: false,
      error: 'Cannot schedule a check without a plugin instance delivery target.',
    }
  }

  const { routine, scheduledItem } = await createOneShotRoutineSchedule({
    agentId: context.agentId,
    name: `Scheduled check (${delayMinutes}m)`,
    description: reference ?? null,
    actionPrompt: instructions,
    runAt,
    sourceRef: reference ?? null,
    targetPluginInstanceId: context.pluginInstanceId,
    targetSessionKey: context.sessionKey,
    targetResponseContext: context.responseContext ? JSON.stringify(context.responseContext) : null,
    createdByKind: 'agent',
    createdByRef: context.agentId,
  })

  const fireTime = new Date(runAt * 1000).toISOString()
  return {
    success: true,
    output: `Scheduled check ${scheduledItem.id} (routine ${routine.id}) — will fire at ${fireTime} (in ${delayMinutes} minute${delayMinutes === 1 ? '' : 's'}).`,
  }
}

export const listScheduleTool: ToolHandler = async (input, context) => {
  if (!context.agentId) {
    return { success: false, error: 'Missing agent identity.' }
  }

  const sessionOnly = input.session_only === true
  const items = await listScheduledItemsByAgent(
    context.agentId,
    sessionOnly && context.sessionKey ? { sessionKey: context.sessionKey } : undefined
  )

  const pending = items.filter((item) => item.status === 'pending')
  if (pending.length === 0) {
    return { success: true, output: 'No pending scheduled items.' }
  }

  const lines = pending.map((item) => {
    const fireTime = new Date(item.run_at * 1000).toISOString()
    const snippet = item.payload.length > 80 ? item.payload.slice(0, 80) + '...' : item.payload
    return `- ${item.id} [${item.type}] fires at ${fireTime}: ${snippet}`
  })

  return { success: true, output: lines.join('\n') }
}

export const cancelScheduledTool: ToolHandler = async (input, context) => {
  if (!context.agentId) {
    return { success: false, error: 'Missing agent identity.' }
  }

  const scheduledId = typeof input.scheduled_id === 'string' ? input.scheduled_id.trim() : ''
  if (!scheduledId) {
    return { success: false, error: 'scheduled_id is required.' }
  }

  const item = await findScheduledItemById(scheduledId)
  if (!item) {
    return { success: false, error: `Scheduled item ${scheduledId} not found.` }
  }
  if (item.agent_id !== context.agentId) {
    return {
      success: false,
      error: 'Cannot cancel a scheduled item belonging to another agent.',
    }
  }
  if (item.status !== 'pending') {
    return { success: false, error: `Scheduled item is already ${item.status}.` }
  }

  await markScheduledItemCancelled(scheduledId)
  return { success: true, output: `Cancelled scheduled item ${scheduledId}.` }
}
