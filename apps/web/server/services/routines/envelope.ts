import { z } from 'zod'
import { type WorkItem } from '@nitejar/database'

export const ROUTINE_ENVELOPE_FIELDS = [
  'eventId',
  'source',
  'eventType',
  'sourceRef',
  'sessionKey',
  'pluginInstanceId',
  'actorKind',
  'actorHandle',
  'status',
  'title',
  'createdAt',
] as const

export type RoutineEnvelopeField = (typeof ROUTINE_ENVELOPE_FIELDS)[number]

export const RoutineEnvelopeSchema = z.object({
  eventId: z.string().min(1),
  source: z.string().min(1),
  eventType: z.string().min(1),
  sourceRef: z.string().nullable(),
  sessionKey: z.string().min(1),
  pluginInstanceId: z.string().nullable(),
  actorKind: z.string().nullable(),
  actorHandle: z.string().nullable(),
  status: z.string().nullable(),
  title: z.string().nullable(),
  createdAt: z.number().int(),
})

export type RoutineEnvelope = z.infer<typeof RoutineEnvelopeSchema>

function parsePayloadObject(payload: string | null): Record<string, unknown> {
  if (!payload) return {}
  try {
    const parsed: unknown = JSON.parse(payload)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // Ignore malformed payloads for envelope derivation.
  }

  return {}
}

function deriveEventType(payload: Record<string, unknown>): string {
  const fromType = payload.type
  if (typeof fromType === 'string' && fromType.trim().length > 0) {
    return fromType.trim()
  }

  return 'message'
}

export function buildRoutineEnvelopeFromWorkItem(workItem: WorkItem): RoutineEnvelope {
  const payload = parsePayloadObject(workItem.payload)
  const actorCandidate = payload.actor
  const actor =
    actorCandidate && typeof actorCandidate === 'object' && !Array.isArray(actorCandidate)
      ? (actorCandidate as Record<string, unknown>)
      : null

  return RoutineEnvelopeSchema.parse({
    eventId: workItem.id,
    source: workItem.source,
    eventType: deriveEventType(payload),
    sourceRef: workItem.source_ref,
    sessionKey: workItem.session_key,
    pluginInstanceId: workItem.plugin_instance_id,
    actorKind: actor && typeof actor.kind === 'string' ? actor.kind : null,
    actorHandle: actor && typeof actor.handle === 'string' ? actor.handle : null,
    status: workItem.status,
    title: workItem.title,
    createdAt: workItem.created_at,
  })
}
