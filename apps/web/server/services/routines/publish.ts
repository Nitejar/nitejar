import { findWorkItemById, enqueueRoutineEvent } from '@nitejar/database'
import { buildRoutineEnvelopeFromWorkItem } from './envelope'

export async function publishRoutineEnvelopeFromWorkItem(
  workItemId: string
): Promise<{ enqueued: boolean; eventKey: string }> {
  const workItem = await findWorkItemById(workItemId)
  if (!workItem) {
    throw new Error(`Work item not found: ${workItemId}`)
  }

  const envelope = buildRoutineEnvelopeFromWorkItem(workItem)
  const eventKey = `work_item:${envelope.eventId}`

  const existing = await enqueueRoutineEvent({
    eventKey,
    envelopeJson: JSON.stringify(envelope),
  })

  return {
    enqueued: existing?.status === 'pending',
    eventKey,
  }
}
