import { getDb } from '../db'
import type {
  MediaArtifact,
  MediaArtifactBlob,
  NewMediaArtifact,
  NewMediaArtifactBlob,
} from '../types'

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function uuid(): string {
  return crypto.randomUUID()
}

export async function insertMediaArtifact(
  data: Omit<NewMediaArtifact, 'id' | 'created_at'>
): Promise<MediaArtifact> {
  const db = getDb()
  const id = uuid()

  return db
    .insertInto('media_artifacts')
    .values({
      id,
      ...data,
      created_at: now(),
    })
    .returningAll()
    .executeTakeFirstOrThrow()
}

export async function listMediaArtifactsForJob(jobId: string): Promise<MediaArtifact[]> {
  const db = getDb()
  return db
    .selectFrom('media_artifacts')
    .selectAll()
    .where('job_id', '=', jobId)
    .orderBy('created_at', 'asc')
    .execute()
}

export async function listMediaArtifactsForWorkItem(workItemId: string): Promise<MediaArtifact[]> {
  const db = getDb()
  return db
    .selectFrom('media_artifacts')
    .innerJoin('jobs', 'jobs.id', 'media_artifacts.job_id')
    .selectAll('media_artifacts')
    .where('jobs.work_item_id', '=', workItemId)
    .orderBy('media_artifacts.created_at', 'asc')
    .execute()
}

export async function listMediaArtifactsByIds(artifactIds: string[]): Promise<MediaArtifact[]> {
  if (artifactIds.length === 0) return []
  const db = getDb()
  return db
    .selectFrom('media_artifacts')
    .selectAll()
    .where('id', 'in', artifactIds)
    .orderBy('created_at', 'asc')
    .execute()
}

export async function insertMediaArtifactBlob(
  data: Omit<NewMediaArtifactBlob, 'created_at'>
): Promise<MediaArtifactBlob> {
  const db = getDb()
  const row = await db
    .insertInto('media_artifact_blobs')
    .values({
      artifact_id: data.artifact_id,
      blob_data: data.blob_data,
      sha256: data.sha256,
      created_at: now(),
    })
    .onConflict((oc) =>
      oc.column('artifact_id').doUpdateSet({
        blob_data: data.blob_data,
        sha256: data.sha256,
        created_at: now(),
      })
    )
    .returningAll()
    .executeTakeFirstOrThrow()
  return row
}

export async function findMediaArtifactBlobByArtifactId(
  artifactId: string
): Promise<MediaArtifactBlob | null> {
  const db = getDb()
  const row = await db
    .selectFrom('media_artifact_blobs')
    .selectAll()
    .where('artifact_id', '=', artifactId)
    .executeTakeFirst()
  return row ?? null
}
