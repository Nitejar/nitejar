import { getDb } from '../db'
import type { BackgroundTask, BackgroundTaskUpdate, NewBackgroundTask } from '../types'
import { generateUuidV7 } from '@nitejar/core'

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function uuid(): string {
  return generateUuidV7()
}

export async function createBackgroundTask(
  data: Omit<NewBackgroundTask, 'id' | 'created_at' | 'updated_at'>
): Promise<BackgroundTask> {
  const db = getDb()
  const id = uuid()
  const timestamp = now()

  return db
    .insertInto('background_tasks')
    .values({
      id,
      ...data,
      created_at: timestamp,
      updated_at: timestamp,
    })
    .returningAll()
    .executeTakeFirstOrThrow()
}

export async function findBackgroundTaskById(id: string): Promise<BackgroundTask | null> {
  const db = getDb()
  const result = await db
    .selectFrom('background_tasks')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst()
  return result ?? null
}

export async function listBackgroundTasksByJob(jobId: string): Promise<BackgroundTask[]> {
  const db = getDb()
  return db
    .selectFrom('background_tasks')
    .selectAll()
    .where('job_id', '=', jobId)
    .orderBy('created_at', 'desc')
    .execute()
}

export async function countBackgroundTasksByJob(jobId: string): Promise<number> {
  const db = getDb()
  const result = await db
    .selectFrom('background_tasks')
    .select((eb) => eb.fn.count<string>('id').as('count'))
    .where('job_id', '=', jobId)
    .executeTakeFirst()
  return Number(result?.count ?? 0)
}

export async function listBackgroundTasksByJobPaged(
  jobId: string,
  options?: { offset?: number; limit?: number }
): Promise<BackgroundTask[]> {
  const db = getDb()
  const offset = Math.max(0, options?.offset ?? 0)
  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 500)
  return db
    .selectFrom('background_tasks')
    .selectAll()
    .where('job_id', '=', jobId)
    .orderBy('created_at', 'desc')
    .offset(offset)
    .limit(limit)
    .execute()
}

export async function listRunningBackgroundTasksByJob(
  jobId: string,
  opts?: { cleanupOnRunEnd?: boolean }
): Promise<BackgroundTask[]> {
  const db = getDb()
  let query = db
    .selectFrom('background_tasks')
    .selectAll()
    .where('job_id', '=', jobId)
    .where('status', '=', 'running')

  if (opts?.cleanupOnRunEnd !== undefined) {
    query = query.where('cleanup_on_run_end', '=', opts.cleanupOnRunEnd ? 1 : 0)
  }

  return query.orderBy('created_at', 'asc').execute()
}

export async function updateBackgroundTask(
  id: string,
  data: Omit<BackgroundTaskUpdate, 'id' | 'created_at'>
): Promise<BackgroundTask | null> {
  const db = getDb()
  const result = await db
    .updateTable('background_tasks')
    .set({
      ...data,
      updated_at: now(),
    })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirst()

  return result ?? null
}

export async function updateBackgroundTaskOutputTail(
  id: string,
  outputTail: string | null
): Promise<BackgroundTask | null> {
  return updateBackgroundTask(id, { output_tail: outputTail })
}

export async function markBackgroundTaskSucceeded(
  id: string,
  exitCode: number,
  outputTail?: string | null
): Promise<BackgroundTask | null> {
  return updateBackgroundTask(id, {
    status: 'succeeded',
    exit_code: exitCode,
    error_text: null,
    finished_at: now(),
    ...(outputTail !== undefined ? { output_tail: outputTail } : {}),
  })
}

export async function markBackgroundTaskFailed(
  id: string,
  errorText: string,
  exitCode?: number | null,
  outputTail?: string | null
): Promise<BackgroundTask | null> {
  return updateBackgroundTask(id, {
    status: 'failed',
    error_text: errorText,
    exit_code: exitCode ?? null,
    finished_at: now(),
    ...(outputTail !== undefined ? { output_tail: outputTail } : {}),
  })
}

export async function markBackgroundTaskKilled(
  id: string,
  errorText?: string,
  outputTail?: string | null
): Promise<BackgroundTask | null> {
  return updateBackgroundTask(id, {
    status: 'killed',
    error_text: errorText ?? null,
    finished_at: now(),
    ...(outputTail !== undefined ? { output_tail: outputTail } : {}),
  })
}
