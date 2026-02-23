#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import {
  addAppSessionParticipants,
  createAppSession,
  findAgentById,
  getDb,
  listMessagesByJob,
} from '@nitejar/database'
import { enqueueAppSessionMessage } from '../../server/services/app-session-enqueue'
import {
  ensureRunDispatchWorker,
  stopRunDispatchWorker,
} from '../../server/services/run-dispatch-worker'

type TurnResult = {
  name: string
  ok: boolean
  workItemId: string
  jobId: string | null
  jobStatus: string | null
  assistantText: string | null
  toolMessages: string[]
  externalCalls: Array<{
    provider: string
    operation: string
    cost_usd: number | null
    credits_used: number | null
  }>
  artifacts: Array<{
    artifact_type: string
    provider: string
    model: string
    operation: string
    file_path: string | null
    cost_usd: number | null
  }>
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function loadEnvFile(filePath: string): Promise<void> {
  let content = ''
  try {
    content = await readFile(filePath, 'utf-8')
  } catch {
    return
  }

  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator <= 0) continue

    const key = trimmed.slice(0, separator).trim()
    const rawValue = trimmed.slice(separator + 1).trim()
    if (!key || process.env[key]) continue

    const unquoted =
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
        ? rawValue.slice(1, -1)
        : rawValue
    process.env[key] = unquoted
  }
}

function flattenAssistantText(raw: string | null): string {
  if (!raw) return ''
  try {
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed === 'string') return parsed
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>
      if (typeof obj.content === 'string') return obj.content
      if (typeof obj.text === 'string') return obj.text
    }
    return raw
  } catch {
    return raw
  }
}

async function runTurn(input: {
  db: ReturnType<typeof getDb>
  sessionKey: string
  userId: string
  senderName: string
  targetAgent: { id: string; handle: string; name: string }
  name: string
  message: string
  timeoutMs?: number
}): Promise<TurnResult> {
  const timeoutMs = input.timeoutMs ?? 150_000
  const enqueue = await enqueueAppSessionMessage({
    sessionKey: input.sessionKey,
    userId: input.userId,
    senderName: input.senderName,
    message: input.message,
    targetAgents: [input.targetAgent],
  })

  const workItemId = enqueue.workItemId
  const started = Date.now()
  let jobId: string | null = null
  let jobStatus: string | null = null

  while (Date.now() - started < timeoutMs) {
    const job = await input.db
      .selectFrom('jobs')
      .select(['id', 'status'])
      .where('work_item_id', '=', workItemId)
      .orderBy('created_at', 'desc')
      .executeTakeFirst()

    if (job) {
      jobId = job.id
      jobStatus = job.status
      if (job.status === 'COMPLETED' || job.status === 'FAILED' || job.status === 'CANCELLED') {
        break
      }
    }

    await sleep(1500)
  }

  if (!jobId) {
    return {
      name: input.name,
      ok: false,
      workItemId,
      jobId: null,
      jobStatus,
      assistantText: null,
      toolMessages: [],
      externalCalls: [],
      artifacts: [],
    }
  }

  const job = await input.db
    .selectFrom('jobs')
    .select(['id', 'status', 'final_response'])
    .where('id', '=', jobId)
    .executeTakeFirstOrThrow()

  const messages = await listMessagesByJob(jobId)
  const assistantText = flattenAssistantText(job.final_response)
  const toolMessages = messages
    .filter((m) => m.role === 'tool' && typeof m.content === 'string')
    .map((m) => m.content as string)

  const externalCalls = await input.db
    .selectFrom('external_api_calls')
    .select(['provider', 'operation', 'cost_usd', 'credits_used'])
    .where('job_id', '=', jobId)
    .orderBy('created_at', 'asc')
    .execute()

  const artifacts = await input.db
    .selectFrom('media_artifacts')
    .select(['artifact_type', 'provider', 'model', 'operation', 'file_path', 'cost_usd'])
    .where('job_id', '=', jobId)
    .orderBy('created_at', 'asc')
    .execute()

  return {
    name: input.name,
    ok: job.status === 'COMPLETED',
    workItemId,
    jobId,
    jobStatus: job.status,
    assistantText: assistantText || null,
    toolMessages,
    externalCalls,
    artifacts,
  }
}

async function main(): Promise<number> {
  const homeDir = process.env.HOME ?? '~'
  await loadEnvFile(path.join(homeDir, 'Projects', 'nitejar', 'nitejar', 'apps', 'web', '.env'))

  const db = getDb()
  const userId = `media-workflow-${Date.now()}`
  const senderName = 'Media Workflow E2E'
  const agentId = process.argv[2] ?? 'fa61a8b7-8dd7-4182-ab74-aeb4e940e095' // nitejar-dev

  const agent = await findAgentById(agentId)
  if (!agent) throw new Error(`Agent not found: ${agentId}`)

  await db
    .insertInto('users')
    .values({
      id: userId,
      name: senderName,
      email: `${userId}@example.local`,
      email_verified: 1,
      avatar_url: null,
      role: 'member',
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .execute()

  const sessionKey = `app:${userId}:${crypto.randomUUID()}`
  await createAppSession({
    session_key: sessionKey,
    owner_user_id: userId,
    primary_agent_id: agent.id,
    title: 'Media workflow smoke',
  })

  await addAppSessionParticipants({
    sessionKey,
    addedByUserId: userId,
    agentIds: [agent.id],
  })

  ensureRunDispatchWorker()

  const imagePath = `/tmp/media/workflow-image-${Date.now()}.png`
  const audioPath = `/tmp/media/workflow-audio-${Date.now()}.mp3`

  const imageTurn = await runTurn({
    db,
    sessionKey,
    userId,
    senderName,
    targetAgent: { id: agent.id, handle: agent.handle, name: agent.name },
    name: 'image',
    message: [
      'Call generate_image exactly once.',
      'Prompt: "retro synthwave skyline at sunset".',
      `output_path: ${imagePath}`,
      'If it fails, return the exact tool error once and stop.',
    ].join(' '),
  })

  const ttsTurn = await runTurn({
    db,
    sessionKey,
    userId,
    senderName,
    targetAgent: { id: agent.id, handle: agent.handle, name: agent.name },
    name: 'tts',
    message: [
      'Call synthesize_speech exactly once.',
      'text: "this is a media workflow smoke test".',
      'voice: alloy.',
      `output_path: ${audioPath}`,
      'If it fails, return the exact tool error once and stop.',
    ].join(' '),
  })

  const sttTurn = await runTurn({
    db,
    sessionKey,
    userId,
    senderName,
    targetAgent: { id: agent.id, handle: agent.handle, name: agent.name },
    name: 'stt',
    message: [
      'Call transcribe_audio exactly once.',
      `input_path: ${audioPath}`,
      'Return only the transcript text.',
      'If it fails, return the exact tool error once and stop.',
    ].join(' '),
  })

  const result = {
    sessionKey,
    agent: { id: agent.id, handle: agent.handle, name: agent.name },
    turns: [imageTurn, ttsTurn, sttTurn],
  }

  console.log(JSON.stringify(result, null, 2))

  stopRunDispatchWorker()
  const allOk = result.turns.every((t) => t.ok)
  return allOk ? 0 : 1
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
