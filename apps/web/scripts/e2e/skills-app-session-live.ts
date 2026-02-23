#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import {
  addAppSessionParticipants,
  closeDb,
  createAppSession,
  createSkill,
  createSkillAssignment,
  createSkillFile,
  findAgentById,
  findSkillBySlug,
  getDb,
  listAgents,
  listByJob,
  listMessagesByJob,
  listSkillAssignments,
  type Agent,
} from '@nitejar/database'
import { syncSkillsToSandbox } from '@nitejar/agent/skill-sync'
import { enqueueAppSessionMessage } from '../../server/services/app-session-enqueue'
import {
  ensureRunDispatchWorker,
  stopRunDispatchWorker,
} from '../../server/services/run-dispatch-worker'

type Args = {
  agentId?: string
  timeoutSeconds: number
  pollMs: number
  artifactPath?: string
  marker?: string
  message?: string
}

type DispatchRow = {
  id: string
  status: string
  job_id: string | null
  agent_id: string
  created_at: number
  queue_key: string
}

type JobRow = {
  id: string
  status: string
  final_response: string | null
  agent_id: string
  created_at: number
  completed_at: number | null
}

type InferenceCall = Awaited<ReturnType<typeof listByJob>>[number]

type WorkItemRow = {
  id: string
  status: string
  session_key: string | null
  created_at: number
}

type AssertionResult = {
  ok: boolean
  details?: string
}

function nowMs(): number {
  return Date.now()
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

function parseArgs(argv: string[]): Args {
  const out: Args = {
    timeoutSeconds: 210,
    pollMs: 1500,
  }

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token?.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[i + 1]
    const value = !next || next.startsWith('--') ? 'true' : next
    if (value !== 'true') i += 1

    if (key === 'agent-id') out.agentId = value
    if (key === 'timeout-seconds') out.timeoutSeconds = Number(value)
    if (key === 'poll-ms') out.pollMs = Number(value)
    if (key === 'artifact') out.artifactPath = value
    if (key === 'marker') out.marker = value
    if (key === 'message') out.message = value
  }

  return out
}

function toJsonArray(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((value): value is string => typeof value === 'string')
  } catch {
    return []
  }
}

function extractAssistantText(raw: string | null): string | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed === 'string') return parsed.trim() || null
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>
      if (typeof obj.text === 'string') return obj.text.trim() || null
      if (typeof obj.content === 'string') return obj.content.trim() || null
    }
    return raw.trim() || null
  } catch {
    return raw.trim() || null
  }
}

async function ensureE2EUser(userId: string): Promise<void> {
  const db = getDb()
  const email = `${userId}@example.local`
  await db
    .insertInto('users')
    .values({
      id: userId,
      name: 'Skills E2E User',
      email,
      email_verified: 1,
      avatar_url: null,
      role: 'member',
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .onConflict((oc) => oc.column('id').doNothing())
    .execute()
}

async function getTargetAgent(agentId?: string): Promise<Agent> {
  if (agentId) {
    const agent = await findAgentById(agentId)
    if (!agent) throw new Error(`Agent not found: ${agentId}`)
    if (!agent.sprite_id) throw new Error(`Agent ${agentId} has no sprite_id`)
    return agent
  }

  const agents = await listAgents()
  const withSprite = agents.find((agent) => Boolean(agent.sprite_id))
  if (!withSprite) {
    throw new Error('No agent with sprite_id was found. Cannot run live skill E2E.')
  }
  return withSprite
}

async function preflightModelConfig(): Promise<void> {
  const db = getDb()
  const gateway = await db
    .selectFrom('gateway_settings')
    .select(['api_key_encrypted'])
    .orderBy('updated_at', 'desc')
    .limit(1)
    .executeTakeFirst()
  const hasEnvKey = Boolean(process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY)
  const hasGatewayKey = Boolean(gateway?.api_key_encrypted)

  if (!hasEnvKey && !hasGatewayKey) {
    throw new Error(
      'No model API key configured. Set OPENROUTER_API_KEY/OPENAI_API_KEY or configure gateway settings.'
    )
  }
}

async function collectState(workItemId: string): Promise<{
  workItem: WorkItemRow | null
  dispatches: DispatchRow[]
  jobs: JobRow[]
  inferenceCalls: InferenceCall[]
  toolMessages: string[]
  assistantMessages: string[]
}> {
  const db = getDb()
  const workItem = await db
    .selectFrom('work_items')
    .select(['id', 'status', 'session_key', 'created_at'])
    .where('id', '=', workItemId)
    .executeTakeFirst()

  const dispatches = await db
    .selectFrom('run_dispatches')
    .select(['id', 'status', 'job_id', 'agent_id', 'created_at', 'queue_key'])
    .where('work_item_id', '=', workItemId)
    .orderBy('created_at', 'asc')
    .execute()

  const jobs = await db
    .selectFrom('jobs')
    .select(['id', 'status', 'final_response', 'agent_id', 'created_at', 'completed_at'])
    .where('work_item_id', '=', workItemId)
    .orderBy('created_at', 'asc')
    .execute()

  const inferenceCalls = (await Promise.all(jobs.map((job) => listByJob(job.id)))).flatMap(
    (calls) => calls
  )
  const messages = (await Promise.all(jobs.map((job) => listMessagesByJob(job.id)))).flatMap(
    (rows) => rows
  )

  return {
    workItem: workItem ?? null,
    dispatches,
    jobs,
    inferenceCalls,
    toolMessages: messages.filter((row) => row.role === 'tool').map((row) => row.content ?? ''),
    assistantMessages: messages
      .filter((row) => row.role === 'assistant')
      .flatMap((row) => {
        const text = extractAssistantText(row.content)
        return text ? [text] : []
      }),
  }
}

function isDispatchTerminal(status: string): boolean {
  return ['completed', 'failed', 'cancelled', 'abandoned', 'merged'].includes(status)
}

function isJobTerminal(status: string): boolean {
  return ['COMPLETED', 'FAILED', 'CANCELLED'].includes(status)
}

async function waitForTerminalState(input: {
  workItemId: string
  timeoutSeconds: number
  pollMs: number
}): Promise<Awaited<ReturnType<typeof collectState>>> {
  const deadline = nowMs() + input.timeoutSeconds * 1000
  let latest = await collectState(input.workItemId)

  while (nowMs() < deadline) {
    const dispatchTerminal =
      latest.dispatches.length > 0 &&
      latest.dispatches.every((row) => isDispatchTerminal(row.status))
    const jobsTerminal =
      latest.jobs.length > 0 && latest.jobs.every((row) => isJobTerminal(row.status))

    if (dispatchTerminal && jobsTerminal) {
      return latest
    }

    await sleep(input.pollMs)
    latest = await collectState(input.workItemId)
  }

  throw new Error(`Timed out waiting for terminal state on work item ${input.workItemId}`)
}

function summarizeInference(calls: InferenceCall[]): {
  callCount: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  totalCostUsd: number
  callsWithCost: number
  observedToolCallNames: string[]
} {
  const observedToolNames = new Set<string>()
  let promptTokens = 0
  let completionTokens = 0
  let totalTokens = 0
  let totalCostUsd = 0
  let callsWithCost = 0

  for (const call of calls) {
    promptTokens += call.prompt_tokens
    completionTokens += call.completion_tokens
    totalTokens += call.total_tokens
    if (typeof call.cost_usd === 'number') {
      totalCostUsd += call.cost_usd
      callsWithCost += 1
    }
    for (const toolName of toJsonArray(call.tool_call_names)) {
      observedToolNames.add(toolName)
    }
  }

  return {
    callCount: calls.length,
    promptTokens,
    completionTokens,
    totalTokens,
    totalCostUsd,
    callsWithCost,
    observedToolCallNames: Array.from(observedToolNames),
  }
}

function assertCondition(ok: boolean, details?: string): AssertionResult {
  return { ok, details }
}

async function writeArtifact(filePath: string, payload: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(payload, null, 2), 'utf-8')
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv)
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const scriptDir = path.dirname(fileURLToPath(import.meta.url))
  const repoRoot = path.resolve(scriptDir, '../../../..')
  await loadEnvFile(path.resolve(scriptDir, '../../.env'))
  const marker = args.marker ?? `SKILLS_E2E_MARKER_${runId}`
  const userId = `e2e-skills-user-${runId}`
  const sessionKey = `app:${userId}:skills-live-${runId}`
  const skillSlug = `e2e-skill-${runId}`
  const skillName = `E2E Skill ${runId}`
  const artifactPath =
    args.artifactPath ??
    path.join(repoRoot, 'artifacts', 'e2e', 'skills-app-session-live', `${runId}.json`)
  const startedAtIso = new Date().toISOString()
  const failures: string[] = []

  let workItemId = ''

  try {
    await preflightModelConfig()
    const targetAgent = await getTargetAgent(args.agentId)
    if (!targetAgent.sprite_id) {
      throw new Error(`Agent ${targetAgent.id} has no sprite_id`)
    }

    await ensureE2EUser(userId)

    const skillContent = [
      '---',
      `name: ${skillName}`,
      'description: Skill fixture for live app-session E2E.',
      'version: 1.0.0',
      '---',
      '',
      'Read references/marker.txt before replying.',
      'When the user asks for the marker, return it exactly as written.',
    ].join('\n')
    const existing = await findSkillBySlug(skillSlug)
    if (existing) {
      throw new Error(`Unexpected skill collision for slug ${skillSlug}`)
    }

    const skill = await createSkill({
      name: skillName,
      slug: skillSlug,
      description: 'E2E fixture skill for app-session live harness',
      category: 'testing',
      sourceKind: 'admin',
      content: skillContent,
      isDirectory: true,
      tags: ['e2e', 'skills'],
    })

    await createSkillFile({
      skillId: skill.id,
      relativePath: 'references/marker.txt',
      content: marker,
      contentType: 'text/plain',
    })
    await createSkillFile({
      skillId: skill.id,
      relativePath: 'references/instructions.md',
      content: 'Use read_file on references/marker.txt and return the exact marker.',
      contentType: 'text/markdown',
    })

    const existingAssignments = await listSkillAssignments({ skillId: skill.id })
    const hasAgentAssignment = existingAssignments.some(
      (assignment) => assignment.scope === 'agent' && assignment.scope_id === targetAgent.id
    )
    if (!hasAgentAssignment) {
      await createSkillAssignment({
        skillId: skill.id,
        skillSlug: skill.slug,
        scope: 'agent',
        scopeId: targetAgent.id,
        priority: 10,
        autoInject: false,
      })
    }

    const syncResult = await syncSkillsToSandbox(targetAgent.id, targetAgent.sprite_id)
    if (syncResult.errors.length > 0) {
      throw new Error(`Skill sync failed: ${syncResult.errors.join(' | ')}`)
    }

    await createAppSession({
      session_key: sessionKey,
      owner_user_id: userId,
      primary_agent_id: targetAgent.id,
      title: `Skills live E2E ${runId}`,
    })
    await addAppSessionParticipants({
      sessionKey,
      agentIds: [targetAgent.id],
      addedByUserId: userId,
    })

    ensureRunDispatchWorker()

    const message =
      args.message ??
      `Use the "${skillName}" skill via use_skill, read references/marker.txt from it, and reply with only this marker: ${marker}`
    const enqueueResult = await enqueueAppSessionMessage({
      sessionKey,
      userId,
      senderName: 'Skills E2E Harness',
      message,
      targetAgents: [
        {
          id: targetAgent.id,
          handle: targetAgent.handle,
          name: targetAgent.name,
        },
      ],
      clientMessageId: `skills-live-${runId}`,
    })
    workItemId = enqueueResult.workItemId

    const terminal = await waitForTerminalState({
      workItemId,
      timeoutSeconds: args.timeoutSeconds,
      pollMs: args.pollMs,
    })
    const inferenceSummary = summarizeInference(terminal.inferenceCalls)
    const finalResponse =
      terminal.jobs.find((job) => job.final_response)?.final_response ??
      terminal.assistantMessages.filter((value): value is string => Boolean(value)).at(-1) ??
      null
    const markerFound = Boolean(finalResponse && finalResponse.includes(marker))
    const skillPathRoot = `/home/sprite/.skills/${skillSlug}`

    const dispatchSuccess = assertCondition(
      terminal.dispatches.length > 0 &&
        terminal.dispatches.some((row) => row.status === 'completed') &&
        terminal.dispatches.every(
          (row) => !['failed', 'cancelled', 'abandoned'].includes(row.status)
        ),
      `dispatch statuses: ${terminal.dispatches.map((row) => row.status).join(', ')}`
    )
    const jobSuccess = assertCondition(
      terminal.jobs.length > 0 &&
        terminal.jobs.some((row) => row.status === 'COMPLETED') &&
        terminal.jobs.every((row) => !['FAILED', 'CANCELLED'].includes(row.status)),
      `job statuses: ${terminal.jobs.map((row) => row.status).join(', ')}`
    )
    const workItemSuccess = assertCondition(
      terminal.workItem?.status === 'DONE',
      `work item status: ${terminal.workItem?.status ?? 'missing'}`
    )
    const inferenceSuccess = assertCondition(
      terminal.inferenceCalls.length > 0 && inferenceSummary.totalTokens > 0,
      `calls=${terminal.inferenceCalls.length} totalTokens=${inferenceSummary.totalTokens}`
    )
    const useSkillObserved = assertCondition(
      inferenceSummary.observedToolCallNames.includes('use_skill'),
      `observed tools: ${inferenceSummary.observedToolCallNames.join(', ')}`
    )
    const hasSkillReadEvidence =
      inferenceSummary.observedToolCallNames.includes('read_file') &&
      terminal.toolMessages.some(
        (content) =>
          content.includes(skillPathRoot) ||
          content.includes(`${skillPathRoot}/SKILL.md`) ||
          content.includes(`${skillPathRoot}/references/marker.txt`)
      )
    const skillReadObserved = assertCondition(
      hasSkillReadEvidence,
      hasSkillReadEvidence
        ? `observed read_file receipts for ${skillPathRoot}`
        : 'read_file was not observed against the expected sandbox skill path'
    )
    const markerAssertion = assertCondition(
      markerFound,
      `final response: ${finalResponse ?? '<null>'}`
    )

    const assertionMap = {
      dispatchSuccess,
      jobSuccess,
      workItemSuccess,
      inferenceSuccess,
      useSkillObserved,
      skillReadObserved,
      markerAssertion,
    }
    for (const [name, assertion] of Object.entries(assertionMap)) {
      if (!assertion.ok) failures.push(`${name}: ${assertion.details ?? 'failed'}`)
    }

    const receipt = {
      startedAt: startedAtIso,
      completedAt: new Date().toISOString(),
      runId,
      sessionKey,
      workItemId,
      dispatchIds: terminal.dispatches.map((row) => row.id),
      jobIds: terminal.jobs.map((row) => row.id),
      targetAgentId: targetAgent.id,
      skill: {
        slug: skillSlug,
        name: skillName,
        sandboxPath: skillPathRoot,
      },
      marker,
      finalResponse,
      markerFound,
      statuses: {
        workItem: terminal.workItem?.status ?? null,
        dispatches: terminal.dispatches.map((row) => ({ id: row.id, status: row.status })),
        jobs: terminal.jobs.map((row) => ({ id: row.id, status: row.status })),
      },
      observedToolCallNames: inferenceSummary.observedToolCallNames,
      inferenceSummary: {
        callCount: inferenceSummary.callCount,
        promptTokens: inferenceSummary.promptTokens,
        completionTokens: inferenceSummary.completionTokens,
        totalTokens: inferenceSummary.totalTokens,
        totalCostUsd: inferenceSummary.totalCostUsd,
        callsWithCost: inferenceSummary.callsWithCost,
        costFieldsPresent: inferenceSummary.callsWithCost > 0,
      },
      assertions: assertionMap,
      failures,
    }

    await writeArtifact(artifactPath, receipt)

    if (failures.length > 0) {
      console.error('[skills-app-session-live] FAILED')
      console.error(`- Artifact: ${artifactPath}`)
      for (const failure of failures) {
        console.error(`- ${failure}`)
      }
      return 1
    }

    console.log('[skills-app-session-live] PASSED')
    console.log(`Artifact: ${artifactPath}`)
    console.log(`Session: ${sessionKey}`)
    console.log(`Work item: ${workItemId}`)
    console.log(`Dispatches: ${receipt.dispatchIds.join(', ')}`)
    console.log(`Jobs: ${receipt.jobIds.join(', ')}`)
    console.log(`Observed tools: ${receipt.observedToolCallNames.join(', ')}`)
    console.log(
      `Inference tokens: prompt=${receipt.inferenceSummary.promptTokens} completion=${receipt.inferenceSummary.completionTokens} total=${receipt.inferenceSummary.totalTokens}`
    )
    if (receipt.inferenceSummary.costFieldsPresent) {
      console.log(`Inference cost total (usd): ${receipt.inferenceSummary.totalCostUsd.toFixed(6)}`)
    } else {
      console.log('Inference cost total (usd): not provided by provider')
    }
    return 0
  } finally {
    stopRunDispatchWorker()
    await closeDb().catch(() => undefined)

    if (workItemId && failures.length > 0) {
      console.error(`Receipt pointer: work_items.id=${workItemId}`)
    }
  }
}

main()
  .then((exitCode) => {
    process.exit(exitCode)
  })
  .catch((error) => {
    console.error('[skills-app-session-live] FAILED')
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
