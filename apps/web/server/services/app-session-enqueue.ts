import { createWorkItem, enqueueToLane, touchAppSessionLastActivity } from '@nitejar/database'
import { publishRoutineEnvelopeFromWorkItem } from './routines/publish'

const MESSAGE_TITLE_MAX_CHARS = 100
const APP_CHAT_DEBOUNCE_MS = 1000
const APP_CHAT_MAX_QUEUED = 10

type WorkItemPayload = {
  body?: string
  senderName?: string
  senderUserId?: string
  sessionKey?: string
  targetAgentIds?: string[]
  clientMessageId?: string
}

export type AppSessionTargetAgent = {
  id: string
  handle: string
  name: string
}

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function truncateText(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, maxChars - 1)}…`
}

export async function enqueueAppSessionMessage(input: {
  sessionKey: string
  userId: string
  senderName: string
  message: string
  targetAgents: AppSessionTargetAgent[]
  clientMessageId?: string
}): Promise<{ workItemId: string; targetAgentIds: string[] }> {
  const message = input.message.trim()
  const timestamp = now()
  const targetAgentIds = input.targetAgents.map((agent) => agent.id)

  const workItem = await createWorkItem({
    plugin_instance_id: null,
    session_key: input.sessionKey,
    source: 'app_chat',
    source_ref: `app-user:${input.userId}`,
    status: 'NEW',
    title: truncateText(message, MESSAGE_TITLE_MAX_CHARS),
    payload: JSON.stringify({
      body: message,
      senderName: input.senderName,
      senderUserId: input.userId,
      sessionKey: input.sessionKey,
      targetAgentIds,
      clientMessageId: input.clientMessageId,
    } satisfies WorkItemPayload),
  })

  await Promise.all(
    input.targetAgents.map((agent) => {
      const queueKey = `${input.sessionKey}:${agent.id}`
      return enqueueToLane(
        {
          queue_key: queueKey,
          work_item_id: workItem.id,
          plugin_instance_id: null,
          response_context: null,
          text: message,
          sender_name: input.senderName,
          arrived_at: timestamp,
          status: 'pending',
          dispatch_id: null,
          drop_reason: null,
        },
        {
          queueKey,
          sessionKey: input.sessionKey,
          agentId: agent.id,
          pluginInstanceId: null,
          arrivedAt: timestamp,
          debounceMs: APP_CHAT_DEBOUNCE_MS,
          maxQueued: APP_CHAT_MAX_QUEUED,
          mode: 'steer',
        }
      )
    })
  )

  await touchAppSessionLastActivity(input.sessionKey)
  await publishRoutineEnvelopeFromWorkItem(workItem.id).catch((error) => {
    console.warn('[sessions] Failed to publish routine envelope', {
      workItemId: workItem.id,
      error: error instanceof Error ? error.message : String(error),
    })
  })

  return {
    workItemId: workItem.id,
    targetAgentIds,
  }
}
