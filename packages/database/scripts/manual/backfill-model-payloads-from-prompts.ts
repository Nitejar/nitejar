import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { closeDb, getDb, upsertModelCallPayload } from '../../src/index'

interface PromptLogLine {
  jobId?: unknown
  model?: unknown
  temperature?: unknown
  maxTokens?: unknown
  messages?: unknown
  tools?: unknown
}

type PromptEntry = {
  jobId: string
  payload: Record<string, unknown>
}

function parsePromptEntries(filePath: string): PromptEntry[] {
  const raw = readFileSync(filePath, 'utf8')
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  const entries: PromptEntry[] = []

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as PromptLogLine
      if (typeof parsed.jobId !== 'string' || parsed.jobId.length === 0) continue
      if (!Array.isArray(parsed.messages)) continue

      entries.push({
        jobId: parsed.jobId,
        payload: {
          model: parsed.model ?? null,
          temperature: parsed.temperature ?? null,
          maxTokens: parsed.maxTokens ?? null,
          messages: parsed.messages,
          tools: Array.isArray(parsed.tools) ? parsed.tools : null,
        },
      })
    } catch {
      // Ignore malformed lines.
    }
  }

  return entries
}

async function run(): Promise<void> {
  const inputPath = process.argv[2]
    ? resolve(process.argv[2])
    : resolve(process.cwd(), 'logs/prompts.jsonl')
  if (!existsSync(inputPath)) {
    console.log(`[backfill] prompt log not found: ${inputPath}`)
    return
  }

  const promptEntries = parsePromptEntries(inputPath)
  if (promptEntries.length === 0) {
    console.log('[backfill] no parsable prompt log entries found')
    return
  }

  const byJob = new Map<string, PromptEntry[]>()
  for (const entry of promptEntries) {
    const rows = byJob.get(entry.jobId) ?? []
    rows.push(entry)
    byJob.set(entry.jobId, rows)
  }

  const db = getDb()
  let updatedRows = 0

  for (const [jobId, entries] of byJob) {
    const calls = await db
      .selectFrom('inference_calls')
      .selectAll()
      .where('job_id', '=', jobId)
      .where('payload_state', '=', 'legacy_unavailable')
      .orderBy('created_at', 'asc')
      .execute()

    if (calls.length === 0) continue

    const updateCount = Math.min(calls.length, entries.length)
    for (let i = 0; i < updateCount; i += 1) {
      const call = calls[i]
      const entry = entries[i]
      if (!call || !entry) continue

      const stored = await upsertModelCallPayload({
        payload: entry.payload,
        metadata: {
          source: 'logs/prompts.jsonl',
          confidence: 'low',
          reconstructed: true,
          job_id: jobId,
          index: i,
        },
      })

      await db
        .updateTable('inference_calls')
        .set({
          request_payload_hash: stored.hash,
          payload_state: 'reconstructed',
          attempt_kind: call.attempt_kind ?? 'reconstructed',
          attempt_index: call.attempt_index ?? i,
        })
        .where('id', '=', call.id)
        .execute()

      updatedRows += 1
    }
  }

  await closeDb()
  console.log(`[backfill] updated ${updatedRows} inference call rows from ${inputPath}`)
}

run().catch(async (error) => {
  console.error(
    `[backfill] failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`
  )
  await closeDb()
  process.exitCode = 1
})
