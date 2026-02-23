import { getDb } from '../db'
import type { MediaArtifactDelivery, NewMediaArtifactDelivery } from '../types'

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function uuid(): string {
  return crypto.randomUUID()
}

export async function insertMediaArtifactDelivery(
  data: Omit<NewMediaArtifactDelivery, 'id' | 'created_at'>
): Promise<MediaArtifactDelivery> {
  const db = getDb()
  const id = uuid()
  return db
    .insertInto('media_artifact_deliveries')
    .values({
      id,
      ...data,
      created_at: now(),
    })
    .returningAll()
    .executeTakeFirstOrThrow()
}

export async function listMediaArtifactDeliveriesByArtifactIds(
  artifactIds: string[]
): Promise<MediaArtifactDelivery[]> {
  if (artifactIds.length === 0) return []
  const db = getDb()
  return db
    .selectFrom('media_artifact_deliveries')
    .selectAll()
    .where('media_artifact_id', 'in', artifactIds)
    .orderBy('created_at', 'asc')
    .execute()
}

export async function listMediaArtifactDeliveriesByEffectOutboxId(
  effectOutboxId: string
): Promise<MediaArtifactDelivery[]> {
  const db = getDb()
  return db
    .selectFrom('media_artifact_deliveries')
    .selectAll()
    .where('effect_outbox_id', '=', effectOutboxId)
    .orderBy('created_at', 'asc')
    .execute()
}
