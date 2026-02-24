#!/usr/bin/env npx tsx

import { createHmac } from 'node:crypto'
import { getDb } from '@nitejar/database'
import { buildSlackScenarioSuite, type SlackScenarioSpec } from './fixtures/slack-scenarios'
import {
  formatTraceJudgeResult,
  judgeSlackTrace,
  type SlackTraceAssertion,
  type SlackTraceBundle,
} from './helpers/trace-judge'

interface SlackPluginConfig {
  botUserId?: string
  signingSecret?: string
}

interface ResolvedSlackPlugin {
  id: string
  config: SlackPluginConfig
}

async function resolveAssignedAgentHandle(pluginInstanceId: string): Promise<string | null> {
  const db = getDb()
  const row = await db
    .selectFrom('agent_plugin_instances as api')
    .innerJoin('agents as a', 'a.id', 'api.agent_id')
    .select(['a.handle'])
    .where('api.plugin_instance_id', '=', pluginInstanceId)
    .where('a.handle', 'is not', null)
    .orderBy('api.created_at', 'desc')
    .executeTakeFirst()

  if (!row?.handle) return null
  const normalized = row.handle.trim()
  return normalized.length > 0 ? normalized : null
}

interface ScenarioRunResult {
  scenario: SlackScenarioSpec
  threadTs: string
  workItemId: string
  jobId: string
  trace: SlackTraceBundle
  assertion: SlackTraceAssertion
  createdAt: number
  completedAt: number | null
  judge: ReturnType<typeof judgeSlackTrace>
}

const TRANSIENT_PROVIDER_ERROR_PATTERNS = [
  /provider returned error/i,
  /rate limit/i,
  /\btimeout\b/i,
  /\btemporar/i,
  /\b5\d\d\b/,
  /service unavailable/i,
  /gateway/i,
]

function isTransientProviderFailure(job: { status: string; error_text: string | null }): boolean {
  if (job.status !== 'FAILED') return false
  const text = job.error_text ?? ''
  return TRANSIENT_PROVIDER_ERROR_PATTERNS.some((pattern) => pattern.test(text))
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function channelTypeForId(channelId: string): 'channel' | 'group' | 'im' | 'mpim' {
  if (channelId.startsWith('D')) return 'im'
  if (channelId.startsWith('G')) return 'group'
  return 'channel'
}

function slackTs(): string {
  const now = Date.now()
  const sec = Math.floor(now / 1000)
  const micros = String((now % 1000) * 1000 + Math.floor(Math.random() * 1000)).padStart(6, '0')
  return `${sec}.${micros}`
}

function parseArgs(argv: string[]): {
  reviewOnly: boolean
  skipReview: boolean
  lookbackHours: number
  timeoutMs: number
} {
  const reviewOnly = argv.includes('--review-only')
  const skipReview = argv.includes('--skip-review')

  const lookbackFlag = argv.find((value) => value.startsWith('--lookback-hours='))
  const timeoutFlag = argv.find((value) => value.startsWith('--timeout-ms='))

  const lookbackHours = lookbackFlag
    ? Math.max(1, Number.parseInt(lookbackFlag.split('=')[1] ?? '36', 10))
    : 36

  const timeoutMs = timeoutFlag
    ? Math.max(10_000, Number.parseInt(timeoutFlag.split('=')[1] ?? '180000', 10))
    : 180_000

  return {
    reviewOnly,
    skipReview,
    lookbackHours: Number.isFinite(lookbackHours) ? lookbackHours : 36,
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 180_000,
  }
}

async function resolveSlackPlugin(): Promise<ResolvedSlackPlugin> {
  const db = getDb()
  const plugin = await db
    .selectFrom('plugin_instances')
    .select(['id', 'config_json'])
    .where('plugin_id', '=', 'builtin.slack')
    .where('enabled', '=', 1)
    .orderBy('created_at', 'desc')
    .executeTakeFirst()

  if (!plugin) {
    throw new Error('No enabled built-in Slack plugin instance found.')
  }

  let config: SlackPluginConfig = {}
  if (plugin.config_json) {
    try {
      config = JSON.parse(plugin.config_json) as SlackPluginConfig
    } catch {
      config = {}
    }
  }

  return {
    id: plugin.id,
    config,
  }
}

async function resolveDefaultChannelId(): Promise<string | null> {
  const db = getDb()
  const row = await db
    .selectFrom('work_items')
    .select(['payload'])
    .where('source', '=', 'slack')
    .orderBy('created_at', 'desc')
    .executeTakeFirst()

  if (!row?.payload) return null

  try {
    const parsed = JSON.parse(row.payload) as Record<string, unknown>
    return typeof parsed.channel === 'string' ? parsed.channel : null
  } catch {
    return null
  }
}

function resolveBaseUrl(): string {
  return process.env.SLOPBOT_WEB_BASE_URL?.trim() || 'http://localhost:3000'
}

function createSlackSignature(signingSecret: string, timestamp: string, rawBody: string): string {
  const base = `v0:${timestamp}:${rawBody}`
  const digest = createHmac('sha256', signingSecret).update(base).digest('hex')
  return `v0=${digest}`
}

async function sendSyntheticSlackWebhook(input: {
  baseUrl: string
  pluginInstanceId: string
  signingSecret: string
  channelId: string
  threadTs?: string
  text: string
  botUserId: string
  eventType?: 'app_mention' | 'message'
}): Promise<{ sourceRef: string; ts: string; threadTs: string; accepted: boolean }> {
  const ts = slackTs()
  const effectiveThreadTs = input.threadTs ?? ts
  const eventId = `evt-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`
  const payload = {
    token: 'deterministic-test',
    type: 'event_callback',
    event_id: eventId,
    event_time: nowSeconds(),
    team_id: 'TDET',
    api_app_id: 'ADET',
    event: {
      type: input.eventType ?? 'app_mention',
      user: 'UDETUSER001',
      text: input.text,
      ts,
      thread_ts: effectiveThreadTs,
      channel: input.channelId,
      channel_type: channelTypeForId(input.channelId),
    },
    authorizations: [
      {
        team_id: 'TDET',
        user_id: input.botUserId,
        is_bot: true,
      },
    ],
  }

  const rawBody = JSON.stringify(payload)
  const timestamp = String(nowSeconds())
  const signature = createSlackSignature(input.signingSecret, timestamp, rawBody)

  const response = await fetch(
    `${input.baseUrl}/api/webhooks/plugins/slack/${encodeURIComponent(input.pluginInstanceId)}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-slack-request-timestamp': timestamp,
        'x-slack-signature': signature,
      },
      body: rawBody,
    }
  )

  const text = await response.text()
  if (!response.ok) {
    throw new Error(`Webhook returned ${response.status}: ${text}`)
  }

  const sourceRef = `slack:${input.channelId}:${ts}`
  const accepted = !text.includes('"ignored"')

  return {
    sourceRef,
    ts,
    threadTs: effectiveThreadTs,
    accepted,
  }
}

async function waitForWorkItemBySourceRef(
  sourceRef: string,
  timeoutMs: number
): Promise<{ id: string; source_ref: string; created_at: number }> {
  const db = getDb()
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const workItem = await db
      .selectFrom('work_items')
      .select(['id', 'source_ref', 'created_at'])
      .where('source', '=', 'slack')
      .where('source_ref', '=', sourceRef)
      .orderBy('created_at', 'desc')
      .executeTakeFirst()

    if (workItem) return workItem
    await sleep(700)
  }

  throw new Error(`Timed out waiting for work item with source_ref=${sourceRef}`)
}

async function waitForTerminalJobByWorkItem(
  workItemId: string,
  timeoutMs: number
): Promise<{
  id: string
  status: string
  error_text: string | null
  completed_at: number | null
}> {
  const db = getDb()
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const job = await db
      .selectFrom('jobs')
      .select(['id', 'status', 'error_text', 'completed_at'])
      .where('work_item_id', '=', workItemId)
      .orderBy('created_at', 'desc')
      .executeTakeFirst()

    if (job && ['COMPLETED', 'FAILED', 'CANCELLED'].includes(job.status)) {
      return job
    }

    await sleep(1000)
  }

  throw new Error(`Timed out waiting for terminal job for work item ${workItemId}`)
}

async function waitForWorkItemHandled(
  workItemId: string,
  timeoutMs: number
): Promise<{
  job: {
    id: string
    status: string
    error_text: string | null
    completed_at: number | null
  } | null
  handledDispatchId: string | null
}> {
  const db = getDb()
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const [workItem, job, queueMessages] = await Promise.all([
      db
        .selectFrom('work_items')
        .select(['id', 'status'])
        .where('id', '=', workItemId)
        .executeTakeFirst(),
      db
        .selectFrom('jobs')
        .select(['id', 'status', 'error_text', 'completed_at'])
        .where('work_item_id', '=', workItemId)
        .orderBy('created_at', 'desc')
        .executeTakeFirst(),
      db
        .selectFrom('queue_messages')
        .select(['status', 'dispatch_id'])
        .where('work_item_id', '=', workItemId)
        .execute(),
    ])

    if (job && ['COMPLETED', 'FAILED', 'CANCELLED'].includes(job.status)) {
      const handledDispatchId =
        queueMessages.find((message) => message.dispatch_id !== null)?.dispatch_id ?? null
      return { job, handledDispatchId }
    }

    const noPendingQueueMessages =
      queueMessages.length > 0 && queueMessages.every((message) => message.status !== 'pending')
    const handledDispatchId =
      queueMessages.find((message) => message.dispatch_id !== null)?.dispatch_id ?? null

    if (workItem && ['DONE', 'FAILED'].includes(workItem.status) && noPendingQueueMessages) {
      return { job: null, handledDispatchId }
    }

    await sleep(1000)
  }

  throw new Error(`Timed out waiting for handled outcome for work item ${workItemId}`)
}

async function waitForDispatchToRun(workItemId: string, timeoutMs: number): Promise<boolean> {
  const db = getDb()
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const dispatch = await db
      .selectFrom('run_dispatches')
      .select(['status'])
      .where('work_item_id', '=', workItemId)
      .orderBy('created_at', 'desc')
      .executeTakeFirst()

    if (dispatch?.status === 'running') {
      return true
    }
    if (dispatch?.status === 'completed' || dispatch?.status === 'failed') {
      return false
    }

    await sleep(500)
  }

  return false
}

async function loadTraceBundle(jobId: string, workItemId: string): Promise<SlackTraceBundle> {
  const db = getDb()

  const [job, workItem, dispatch, inferenceCalls, spans, messages, queueMessages] =
    await Promise.all([
      db
        .selectFrom('jobs')
        .select(['id', 'status', 'error_text'])
        .where('id', '=', jobId)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom('work_items')
        .select(['id', 'source_ref'])
        .where('id', '=', workItemId)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom('run_dispatches')
        .select(['id', 'status', 'control_reason', 'queue_key', 'started_at', 'finished_at'])
        .where('work_item_id', '=', workItemId)
        .orderBy('created_at', 'desc')
        .executeTakeFirst(),
      db
        .selectFrom('inference_calls')
        .select(['id', 'turn', 'finish_reason', 'tool_call_names', 'prompt_tokens'])
        .where('job_id', '=', jobId)
        .orderBy('turn', 'asc')
        .execute(),
      db
        .selectFrom('spans')
        .select(['id', 'name', 'status', 'attributes'])
        .where('job_id', '=', jobId)
        .orderBy('created_at', 'asc')
        .execute(),
      db
        .selectFrom('messages')
        .select(['id', 'role', 'content'])
        .where('job_id', '=', jobId)
        .orderBy('created_at', 'asc')
        .execute(),
      db
        .selectFrom('queue_messages')
        .select(['id', 'status', 'dispatch_id', 'drop_reason', 'text'])
        .where('work_item_id', '=', workItemId)
        .orderBy('created_at', 'asc')
        .execute(),
    ])

  const queueMode = dispatch
    ? ((
        await db
          .selectFrom('queue_lanes')
          .select(['mode'])
          .where('queue_key', '=', dispatch.queue_key)
          .executeTakeFirst()
      )?.mode ?? null)
    : null

  return {
    job,
    workItem,
    dispatch: dispatch
      ? {
          id: dispatch.id,
          status: dispatch.status,
          control_reason: dispatch.control_reason,
          queue_key: dispatch.queue_key,
          started_at: dispatch.started_at,
          finished_at: dispatch.finished_at,
        }
      : null,
    queueMode,
    inferenceCalls,
    spans,
    messages,
    queueMessages,
  }
}

function buildAssertion(
  scenario: SlackScenarioSpec,
  jobId: string,
  workItemId: string
): SlackTraceAssertion {
  return {
    jobId,
    workItemId,
    expectedTools: scenario.expectedTools,
    maxRepeatedToolErrorWarnThreshold: scenario.maxRepeatedToolErrorWarnThreshold,
    expectedQueueMode: scenario.expectedQueueMode,
    expectedFinalStatus: scenario.expectedFinalStatus,
    expectedReplyPattern: scenario.expectedReplyPattern,
    expectedChannelId: scenario.expectedChannelId,
  }
}

async function runSingleScenario(input: {
  baseUrl: string
  plugin: ResolvedSlackPlugin
  channelId: string
  scenario: SlackScenarioSpec
  timeoutMs: number
  threadTs?: string
  maxAttempts?: number
}): Promise<ScenarioRunResult> {
  const maxAttempts = Math.max(1, input.maxAttempts ?? 2)
  let lastResult: ScenarioRunResult | null = null
  let effectiveThreadTs = input.threadTs

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const sendResult = await sendSyntheticSlackWebhook({
      baseUrl: input.baseUrl,
      pluginInstanceId: input.plugin.id,
      signingSecret: input.plugin.config.signingSecret ?? '',
      channelId: input.channelId,
      threadTs: effectiveThreadTs,
      text: input.scenario.prompt,
      botUserId: input.plugin.config.botUserId ?? '',
    })

    if (!sendResult.accepted) {
      throw new Error(`Webhook message was ignored for scenario ${input.scenario.id}`)
    }

    effectiveThreadTs = sendResult.threadTs

    const workItem = await waitForWorkItemBySourceRef(sendResult.sourceRef, input.timeoutMs)
    const job = await waitForTerminalJobByWorkItem(workItem.id, input.timeoutMs)
    const trace = await loadTraceBundle(job.id, workItem.id)
    const assertion = buildAssertion(input.scenario, job.id, workItem.id)
    const judge = judgeSlackTrace(trace, assertion)

    const attemptResult: ScenarioRunResult = {
      scenario: input.scenario,
      threadTs: sendResult.threadTs,
      workItemId: workItem.id,
      jobId: job.id,
      trace,
      assertion,
      createdAt: workItem.created_at,
      completedAt: job.completed_at,
      judge,
    }

    lastResult = attemptResult

    if (judge.pass) {
      return attemptResult
    }

    const shouldRetry = attempt < maxAttempts && isTransientProviderFailure(job)
    if (!shouldRetry) {
      return attemptResult
    }

    console.log(
      `RETRY scenario=${input.scenario.id} attempt=${attempt + 1}/${maxAttempts} reason=transient_provider_failure job=${job.id} error=${job.error_text ?? 'unknown'}`
    )
    await sleep(1_500)
  }

  if (!lastResult) {
    throw new Error(`Scenario ${input.scenario.id} did not produce any run result.`)
  }
  return lastResult
}

function printScenarioResult(result: ScenarioRunResult): void {
  console.log(`\n=== Scenario: ${result.scenario.id} ===`)
  console.log(result.scenario.description)
  console.log(`job=${result.jobId} work_item=${result.workItemId}`)
  console.log(formatTraceJudgeResult(result.judge))
}

async function reviewRecentSlackFailures(lookbackHours: number): Promise<{
  warnings: string[]
  failures: string[]
}> {
  const db = getDb()
  const since = nowSeconds() - lookbackHours * 3600

  const failedJobs = await db
    .selectFrom('jobs as j')
    .innerJoin('work_items as w', 'w.id', 'j.work_item_id')
    .select(['j.id as job_id', 'j.error_text as error_text', 'j.created_at as created_at'])
    .where('w.source', '=', 'slack')
    .where('j.created_at', '>=', since)
    .where('j.status', '=', 'FAILED')
    .orderBy('j.created_at', 'desc')
    .execute()

  const warnings: string[] = []
  const failures: string[] = []

  if (failedJobs.length === 0) {
    warnings.push(`No failed Slack jobs in the last ${lookbackHours}h.`)
    return { warnings, failures }
  }

  for (const job of failedJobs) {
    const spans = await db
      .selectFrom('spans')
      .select(['id', 'name', 'status', 'attributes'])
      .where('job_id', '=', job.job_id)
      .orderBy('created_at', 'asc')
      .execute()

    const toolExecErrors = spans.filter(
      (span) => span.name === 'tool_exec' && span.status === 'error'
    )
    if (toolExecErrors.length > 3) {
      warnings.push(
        `Historical warning: job ${job.job_id} has ${toolExecErrors.length} tool_exec errors.`
      )
    }

    const hasToolDisabled = toolExecErrors.some((span) => {
      if (!span.attributes) return false
      return /tool execution disabled|sprites api key not configured|no sprites_token configured/i.test(
        span.attributes
      )
    })

    if (hasToolDisabled) {
      warnings.push(
        `Historical environment classification: job ${job.job_id} failed with tool-execution-disabled receipts.`
      )
      continue
    }

    failures.push(
      `Historical failed job ${job.job_id} (${job.error_text ?? 'no error text'}) needs follow-up triage.`
    )
  }

  return { warnings, failures }
}

async function runContextPairScenario(input: {
  baseUrl: string
  plugin: ResolvedSlackPlugin
  channelId: string
  timeoutMs: number
  firstPrompt: string
  secondScenario: SlackScenarioSpec
}): Promise<ScenarioRunResult> {
  const firstSend = await sendSyntheticSlackWebhook({
    baseUrl: input.baseUrl,
    pluginInstanceId: input.plugin.id,
    signingSecret: input.plugin.config.signingSecret ?? '',
    channelId: input.channelId,
    text: input.firstPrompt,
    botUserId: input.plugin.config.botUserId ?? '',
  })

  const firstWorkItem = await waitForWorkItemBySourceRef(firstSend.sourceRef, input.timeoutMs)
  await waitForTerminalJobByWorkItem(firstWorkItem.id, input.timeoutMs)

  return runSingleScenario({
    baseUrl: input.baseUrl,
    plugin: input.plugin,
    channelId: input.channelId,
    scenario: input.secondScenario,
    timeoutMs: input.timeoutMs,
    threadTs: firstSend.threadTs,
  })
}

async function runConcurrencyScenario(input: {
  baseUrl: string
  plugin: ResolvedSlackPlugin
  channelId: string
  timeoutMs: number
  firstPrompt: string
  secondScenario: SlackScenarioSpec
}): Promise<{
  first: ScenarioRunResult
  second: ScenarioRunResult
  warnings: string[]
  failures: string[]
}> {
  const warnings: string[] = []
  const failures: string[] = []

  const firstScenario: SlackScenarioSpec = {
    id: 'steer-concurrency-first-message',
    description: 'First message in steer-mode concurrency test.',
    prompt: input.firstPrompt,
    expectedTools: [],
    expectedQueueMode: 'steer',
    expectedFinalStatus: 'COMPLETED',
    expectedReplyPattern: undefined,
    expectedChannelId: input.channelId,
    maxRepeatedToolErrorWarnThreshold: input.secondScenario.maxRepeatedToolErrorWarnThreshold,
  }

  const firstSend = await sendSyntheticSlackWebhook({
    baseUrl: input.baseUrl,
    pluginInstanceId: input.plugin.id,
    signingSecret: input.plugin.config.signingSecret ?? '',
    channelId: input.channelId,
    text: firstScenario.prompt,
    botUserId: input.plugin.config.botUserId ?? '',
  })

  const firstWorkItem = await waitForWorkItemBySourceRef(firstSend.sourceRef, input.timeoutMs)

  const sawRunning = await waitForDispatchToRun(
    firstWorkItem.id,
    input.secondScenario.messageTiming?.waitForRunningDispatchMs ?? 30_000
  )
  if (!sawRunning) {
    warnings.push('First dispatch never observed in running state before sending second message.')
  }

  if ((input.secondScenario.messageTiming?.secondMessageDelayMs ?? 0) > 0) {
    await sleep(input.secondScenario.messageTiming?.secondMessageDelayMs ?? 0)
  }

  const secondSend = await sendSyntheticSlackWebhook({
    baseUrl: input.baseUrl,
    pluginInstanceId: input.plugin.id,
    signingSecret: input.plugin.config.signingSecret ?? '',
    channelId: input.channelId,
    threadTs: firstSend.threadTs,
    text: input.secondScenario.prompt,
    botUserId: input.plugin.config.botUserId ?? '',
  })

  const secondWorkItem = await waitForWorkItemBySourceRef(secondSend.sourceRef, input.timeoutMs)

  const [firstJob, secondOutcome] = await Promise.all([
    waitForTerminalJobByWorkItem(firstWorkItem.id, input.timeoutMs),
    waitForWorkItemHandled(secondWorkItem.id, input.timeoutMs),
  ])

  const firstTrace = await loadTraceBundle(firstJob.id, firstWorkItem.id)

  let secondJobId = firstJob.id
  let secondCompletedAt: number | null = firstJob.completed_at
  let secondTrace: SlackTraceBundle

  if (secondOutcome.job) {
    secondJobId = secondOutcome.job.id
    secondCompletedAt = secondOutcome.job.completed_at
    secondTrace = await loadTraceBundle(secondOutcome.job.id, secondWorkItem.id)
  } else {
    warnings.push(
      'Second work item completed without a dedicated job row (likely merged/steered into active dispatch).'
    )
    const db = getDb()
    const secondQueueMessages = await db
      .selectFrom('queue_messages')
      .select(['id', 'status', 'dispatch_id', 'drop_reason', 'text'])
      .where('work_item_id', '=', secondWorkItem.id)
      .orderBy('created_at', 'asc')
      .execute()
    secondTrace = {
      ...firstTrace,
      workItem: {
        id: secondWorkItem.id,
        source_ref: secondSend.sourceRef,
      },
      queueMessages: secondQueueMessages,
    }
  }

  const firstResult: ScenarioRunResult = {
    scenario: firstScenario,
    threadTs: firstSend.threadTs,
    workItemId: firstWorkItem.id,
    jobId: firstJob.id,
    trace: firstTrace,
    assertion: buildAssertion(firstScenario, firstJob.id, firstWorkItem.id),
    createdAt: firstWorkItem.created_at,
    completedAt: firstJob.completed_at,
    judge: judgeSlackTrace(
      firstTrace,
      buildAssertion(firstScenario, firstJob.id, firstWorkItem.id)
    ),
  }

  const secondResult: ScenarioRunResult = {
    scenario: input.secondScenario,
    threadTs: secondSend.threadTs,
    workItemId: secondWorkItem.id,
    jobId: secondJobId,
    trace: secondTrace,
    assertion: buildAssertion(input.secondScenario, secondJobId, secondWorkItem.id),
    createdAt: secondWorkItem.created_at,
    completedAt: secondCompletedAt,
    judge: judgeSlackTrace(
      secondTrace,
      buildAssertion(input.secondScenario, secondJobId, secondWorkItem.id)
    ),
  }

  const secondIncludedByFirstDispatch = secondTrace.queueMessages.some(
    (message) => message.dispatch_id && message.dispatch_id === firstTrace.dispatch?.id
  )
  const secondHandledByFirstDispatch =
    secondOutcome.handledDispatchId !== null &&
    secondOutcome.handledDispatchId === firstTrace.dispatch?.id

  const arrivedWhileRunning =
    firstResult.completedAt !== null && secondResult.createdAt <= firstResult.completedAt

  if (arrivedWhileRunning) {
    if (!secondIncludedByFirstDispatch && !secondHandledByFirstDispatch) {
      const policySignal =
        (firstTrace.dispatch?.control_reason ?? '').includes('arbiter:') ||
        (secondTrace.dispatch?.control_reason ?? '').includes('arbiter:')
      const queuedSequentiallyInSameLane =
        firstTrace.dispatch?.queue_key !== undefined &&
        secondTrace.dispatch?.queue_key !== undefined &&
        firstTrace.dispatch.queue_key === secondTrace.dispatch.queue_key &&
        firstTrace.dispatch.finished_at !== null &&
        secondTrace.dispatch.started_at !== null &&
        secondTrace.dispatch.started_at >= firstTrace.dispatch.finished_at

      if (policySignal) {
        warnings.push(
          'Second message arrived during first run and was handled without direct merge; policy signal present in dispatch control_reason.'
        )
      } else if (queuedSequentiallyInSameLane) {
        warnings.push(
          'Second message arrived while first run was active and was processed sequentially in the same lane without explicit steer control_reason.'
        )
      } else {
        failures.push(
          'Second message arrived while first run was active, but no steer-policy receipt was found.'
        )
      }
    }
  } else {
    warnings.push(
      'Second message was created after first run completed, so this was sequential rather than true in-progress steering.'
    )
  }

  return {
    first: firstResult,
    second: secondResult,
    warnings,
    failures,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const runId = `${Date.now().toString(36)}-${Math.floor(Math.random() * 10_000).toString(36)}`
  const baseUrl = resolveBaseUrl()

  const plugin = await resolveSlackPlugin()
  if (!plugin.config.signingSecret) {
    throw new Error('Slack plugin signingSecret is missing from plugin config.')
  }
  if (!plugin.config.botUserId) {
    throw new Error('Slack plugin botUserId is missing from plugin config.')
  }

  const channelId =
    process.env.SLOPBOT_SLACK_CHANNEL_ID?.trim() || (await resolveDefaultChannelId())
  if (!channelId) {
    throw new Error(
      'Could not determine Slack channel ID. Set SLOPBOT_SLACK_CHANNEL_ID or create a recent Slack work item first.'
    )
  }
  const mentionHandle =
    process.env.SLOPBOT_SLACK_AGENT_HANDLE?.trim() || (await resolveAssignedAgentHandle(plugin.id))
  if (!mentionHandle) {
    throw new Error(
      'Could not determine assigned agent handle. Set SLOPBOT_SLACK_AGENT_HANDLE or assign this Slack plugin to an agent with a handle.'
    )
  }

  console.log('Slack deterministic harness')
  console.log(`run_id=${runId}`)
  console.log(`base_url=${baseUrl}`)
  console.log(`plugin_instance=${plugin.id}`)
  console.log(`channel=${channelId}`)
  console.log(`mention_handle=@${mentionHandle.replace(/^@/, '')}`)

  const aggregateWarnings: string[] = []
  const aggregateFailures: string[] = []

  if (!args.skipReview) {
    const historical = await reviewRecentSlackFailures(args.lookbackHours)
    console.log(`\n=== Historical Trace Review (${args.lookbackHours}h) ===`)
    for (const warning of historical.warnings) {
      console.log(`WARN: ${warning}`)
    }
    for (const failure of historical.failures) {
      console.log(`FAIL: ${failure}`)
    }
    aggregateWarnings.push(...historical.warnings)
    aggregateFailures.push(...historical.failures)
  }

  if (args.reviewOnly) {
    if (aggregateFailures.length > 0) {
      process.exit(1)
    }
    return
  }

  const suite = buildSlackScenarioSuite({
    runId,
    agentHandle: mentionHandle.replace(/^@/, ''),
    channelId,
  })

  for (const scenario of suite.singleMessage) {
    const result = await runSingleScenario({
      baseUrl,
      plugin,
      channelId,
      scenario,
      timeoutMs: args.timeoutMs,
    })

    printScenarioResult(result)
    aggregateWarnings.push(...result.judge.warnings.map((warning) => `${scenario.id}: ${warning}`))
    aggregateFailures.push(...result.judge.failures.map((failure) => `${scenario.id}: ${failure}`))
  }

  console.log(`\n=== Scenario: ${suite.contextPair.id} ===`)
  const contextResult = await runContextPairScenario({
    baseUrl,
    plugin,
    channelId,
    timeoutMs: args.timeoutMs,
    firstPrompt: suite.contextPair.firstPrompt,
    secondScenario: suite.contextPair.second,
  })
  printScenarioResult(contextResult)
  aggregateWarnings.push(
    ...contextResult.judge.warnings.map((warning) => `${suite.contextPair.id}: ${warning}`)
  )
  aggregateFailures.push(
    ...contextResult.judge.failures.map((failure) => `${suite.contextPair.id}: ${failure}`)
  )

  console.log(`\n=== Scenario: ${suite.concurrency.id} ===`)
  const concurrency = await runConcurrencyScenario({
    baseUrl,
    plugin,
    channelId,
    timeoutMs: args.timeoutMs,
    firstPrompt: suite.concurrency.firstPrompt,
    secondScenario: suite.concurrency.second,
  })

  printScenarioResult(concurrency.first)
  printScenarioResult(concurrency.second)

  for (const warning of concurrency.warnings) {
    console.log(`WARN: ${warning}`)
  }
  for (const failure of concurrency.failures) {
    console.log(`FAIL: ${failure}`)
  }

  aggregateWarnings.push(
    ...concurrency.first.judge.warnings.map(
      (warning) => `${suite.concurrency.id}/first: ${warning}`
    ),
    ...concurrency.second.judge.warnings.map(
      (warning) => `${suite.concurrency.id}/second: ${warning}`
    ),
    ...concurrency.warnings.map((warning) => `${suite.concurrency.id}: ${warning}`)
  )

  aggregateFailures.push(
    ...concurrency.first.judge.failures.map(
      (failure) => `${suite.concurrency.id}/first: ${failure}`
    ),
    ...concurrency.second.judge.failures.map(
      (failure) => `${suite.concurrency.id}/second: ${failure}`
    ),
    ...concurrency.failures.map((failure) => `${suite.concurrency.id}: ${failure}`)
  )

  console.log('\n=== Final Summary ===')
  console.log(`warnings=${aggregateWarnings.length}`)
  console.log(`failures=${aggregateFailures.length}`)

  if (aggregateWarnings.length > 0) {
    console.log('Warnings:')
    for (const warning of aggregateWarnings) {
      console.log(`- ${warning}`)
    }
  }

  if (aggregateFailures.length > 0) {
    console.log('Failures:')
    for (const failure of aggregateFailures) {
      console.log(`- ${failure}`)
    }
    process.exit(1)
  }
}

main().catch((error) => {
  console.error('Slack deterministic harness failed:', error)
  process.exit(1)
})
