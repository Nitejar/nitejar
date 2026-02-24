import { generateUuidV7 } from '@nitejar/core'
import {
  addAppSessionParticipants,
  appendActivityEntry,
  closeDb,
  createAgent,
  createAppSession,
  createJob,
  createMessage,
  createPluginInstance,
  createQueueMessage,
  createWorkItem,
  getDb,
  insertInferenceCall,
  upsertQueueLaneOnMessage,
} from '@nitejar/database'

type DemoAgent = {
  id: string
  handle: string
  name: string
}

type WorkContext = {
  workItemId: string
  sessionKey: string
}

const DEMO_MODEL = 'arcee-ai/trinity-large-preview:free'
const DEMO_NAME_PREFIX = 'Screenshot Demo'

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function requireScreenshotDbPath(): string {
  const dbPath = process.env.DATABASE_URL
  if (!dbPath) {
    throw new Error(
      'DATABASE_URL is required. Point it at an isolated screenshot DB (for example: nitejar.screenshots.db).'
    )
  }

  if (!dbPath.includes('screenshots')) {
    throw new Error(
      `Refusing to seed DATABASE_URL=${dbPath}. Use a dedicated screenshot DB path that includes "screenshots".`
    )
  }

  return dbPath
}

function withAge(secondsAgo: number): number {
  return now() - secondsAgo
}

async function createDemoAgents(suffix: string): Promise<DemoAgent[]> {
  const profiles = [
    { name: 'Iris Vale', handle: `iris-${suffix}`, emoji: '\u{1F6F0}\u{FE0F}' },
    { name: 'Marin Quill', handle: `marin-${suffix}`, emoji: '\u{1F9ED}' },
    { name: 'Rook Ember', handle: `rook-${suffix}`, emoji: '\u{1F525}' },
    { name: 'Sable Finch', handle: `sable-${suffix}`, emoji: '\u{1F4E6}' },
  ]

  const agents: DemoAgent[] = []
  for (const profile of profiles) {
    const created = await createAgent({
      handle: profile.handle,
      name: profile.name,
      sprite_id: null,
      config: JSON.stringify({
        emoji: profile.emoji,
        title: 'Autonomous teammate',
      }),
      status: 'idle',
    })

    agents.push({
      id: created.id,
      handle: created.handle,
      name: created.name,
    })
  }

  return agents
}

async function createDemoPlugins(
  suffix: string
): Promise<{ githubId: string; telegramId: string }> {
  const github = await createPluginInstance({
    plugin_id: 'builtin.github',
    name: `${DEMO_NAME_PREFIX} GitHub ${suffix}`,
    config_json: JSON.stringify({ owner: 'nitejar', repo: 'nitejar' }),
    scope: 'global',
    enabled: 1,
  })

  const telegram = await createPluginInstance({
    plugin_id: 'builtin.telegram',
    name: `${DEMO_NAME_PREFIX} Telegram ${suffix}`,
    config_json: JSON.stringify({ channel: '@nitejar_ops' }),
    scope: 'global',
    enabled: 1,
  })

  return { githubId: github.id, telegramId: telegram.id }
}

async function seedInference(
  jobId: string,
  agentId: string,
  costUsd: number,
  turn = 1
): Promise<void> {
  await insertInferenceCall({
    job_id: jobId,
    agent_id: agentId,
    turn,
    model: DEMO_MODEL,
    prompt_tokens: 900 + turn * 120,
    completion_tokens: 210 + turn * 35,
    total_tokens: 1110 + turn * 155,
    cache_read_tokens: 64,
    cache_write_tokens: 0,
    cost_usd: costUsd,
    tool_call_names: JSON.stringify(['query_activity', 'write_file']),
    finish_reason: 'stop',
    is_fallback: 0,
    duration_ms: 1800 + turn * 220,
    request_payload_hash: null,
    response_payload_hash: null,
    attempt_kind: 'primary',
    attempt_index: turn - 1,
    payload_state: null,
    model_span_id: null,
  })
}

async function seedActivityForJob(input: {
  agentId: string
  agentHandle: string
  jobId: string
  sessionKey: string
  status: 'starting' | 'completed' | 'failed' | 'passed'
  summary: string
  resources: string[]
}): Promise<void> {
  await appendActivityEntry({
    agent_id: input.agentId,
    agent_handle: input.agentHandle,
    job_id: input.jobId,
    session_key: input.sessionKey,
    status: input.status,
    summary: input.summary,
    resources: JSON.stringify(input.resources),
    embedding: null,
  })
}

async function createWorkItemWithJob(input: {
  pluginInstanceId: string | null
  sessionKey: string
  source: string
  sourceRef: string
  title: string
  userBody: string
  agent: DemoAgent
  jobStatus: 'COMPLETED' | 'FAILED' | 'RUNNING' | 'PENDING'
  ageSeconds: number
  finalResponse: string
  costUsd: number
  activitySummary: string
  activityStatus?: 'starting' | 'completed' | 'failed' | 'passed'
}): Promise<WorkContext> {
  const ts = withAge(input.ageSeconds)

  const workItem = await createWorkItem({
    plugin_instance_id: input.pluginInstanceId,
    session_key: input.sessionKey,
    source: input.source,
    source_ref: input.sourceRef,
    status: input.jobStatus === 'FAILED' ? 'FAILED' : 'DONE',
    title: input.title,
    payload: JSON.stringify({
      body: input.userBody,
      senderName: 'Josh',
      senderUserId: 'demo-user',
      sessionKey: input.sessionKey,
      targetAgentIds: [input.agent.id],
    }),
  })

  const startedAt = input.jobStatus === 'PENDING' ? null : ts + 10
  const completedAt =
    input.jobStatus === 'COMPLETED' || input.jobStatus === 'FAILED' ? ts + 90 : null

  const job = await createJob({
    work_item_id: workItem.id,
    agent_id: input.agent.id,
    status: input.jobStatus,
    error_text: input.jobStatus === 'FAILED' ? 'Demo failure: webhook timeout' : null,
    todo_state: null,
    final_response: input.jobStatus === 'COMPLETED' ? input.finalResponse : null,
    started_at: startedAt,
    completed_at: completedAt,
  })

  await createMessage({
    job_id: job.id,
    role: 'user',
    content: JSON.stringify({ text: input.userBody }),
    embedding: null,
  })

  await createMessage({
    job_id: job.id,
    role: 'assistant',
    content: JSON.stringify({ text: input.finalResponse, is_final_response: true }),
    embedding: null,
  })

  await seedInference(job.id, input.agent.id, input.costUsd)

  await seedActivityForJob({
    agentId: input.agent.id,
    agentHandle: input.agent.handle,
    jobId: job.id,
    sessionKey: input.sessionKey,
    status: input.activityStatus ?? (input.jobStatus === 'FAILED' ? 'failed' : 'completed'),
    summary: input.activitySummary,
    resources: [
      input.source === 'github' ? 'github.com/nitejar/nitejar' : 'telegram:@nitejar_ops',
      `work_item:${workItem.id}`,
    ],
  })

  const db = getDb()
  await db
    .updateTable('work_items')
    .set({ created_at: ts, updated_at: ts + 120 })
    .where('id', '=', workItem.id)
    .execute()

  await db
    .updateTable('jobs')
    .set({ created_at: ts + 5, updated_at: ts + 120 })
    .where('id', '=', job.id)
    .execute()

  return {
    workItemId: workItem.id,
    sessionKey: input.sessionKey,
  }
}

async function seedCollaborationSessions(input: {
  ownerUserId: string
  agents: DemoAgent[]
  githubPluginId: string
}): Promise<void> {
  const [a1, a2, a3] = input.agents
  if (!a1 || !a2 || !a3) return

  const sessionKey = `app:${input.ownerUserId}:demo-collab-${generateUuidV7()}`
  await createAppSession({
    session_key: sessionKey,
    owner_user_id: input.ownerUserId,
    primary_agent_id: a1.id,
    title: 'Ship v0.4 launch thread',
  })

  await addAppSessionParticipants({
    sessionKey,
    agentIds: [a1.id, a2.id, a3.id],
    addedByUserId: input.ownerUserId,
  })

  await createWorkItemWithJob({
    pluginInstanceId: input.githubPluginId,
    sessionKey,
    source: 'app_chat',
    sourceRef: `app_chat:${sessionKey}:001`,
    title: 'Draft release thread from latest activity',
    userBody: "Draft a launch thread using tonight's receipts and costs.",
    agent: a1,
    jobStatus: 'COMPLETED',
    ageSeconds: 40 * 60,
    finalResponse: 'Drafted 8-post thread with links to activity timeline and cost breakdown.',
    costUsd: 0.0132,
    activitySummary: 'Drafted launch thread with explicit receipts and cost notes.',
  })

  await createWorkItemWithJob({
    pluginInstanceId: input.githubPluginId,
    sessionKey,
    source: 'agent_dm',
    sourceRef: `agent_relay:${a1.id}:${a2.id}:thread-polish`,
    title: 'Polish copy and tighten CTA',
    userBody: 'Tighten hook and cut buzzwords from post 1 and 2.',
    agent: a2,
    jobStatus: 'COMPLETED',
    ageSeconds: 32 * 60,
    finalResponse: 'Adjusted post 1 hook and replaced generic claims with concrete actions.',
    costUsd: 0.0081,
    activitySummary: 'Polished copy for thread opener and proof points.',
  })

  await createWorkItemWithJob({
    pluginInstanceId: input.githubPluginId,
    sessionKey,
    source: 'agent_dm',
    sourceRef: `agent_relay:${a1.id}:${a3.id}:proof-links`,
    title: 'Attach collaboration proof links',
    userBody: 'Add links that show multi-agent collaboration in-app.',
    agent: a3,
    jobStatus: 'COMPLETED',
    ageSeconds: 26 * 60,
    finalResponse: 'Attached session recap, timeline link, and cost delta screenshot references.',
    costUsd: 0.0074,
    activitySummary: 'Gathered collaboration receipts for launch thread.',
  })

  const db = getDb()
  await db
    .updateTable('app_sessions')
    .set({
      created_at: withAge(41 * 60),
      updated_at: withAge(24 * 60),
      last_activity_at: withAge(24 * 60),
    })
    .where('session_key', '=', sessionKey)
    .execute()
}

async function seedFleetAndActivity(input: {
  agents: DemoAgent[]
  githubPluginId: string
  telegramPluginId: string
}): Promise<void> {
  const [a1, a2, a3, a4] = input.agents
  if (!a1 || !a2 || !a3 || !a4) return

  const parent = await createWorkItemWithJob({
    pluginInstanceId: input.githubPluginId,
    sessionKey: `gh:nitejar:nitejar:issues:4121`,
    source: 'github',
    sourceRef: 'nitejar/nitejar#issue:4121',
    title: 'Triage regressions from nightly canary',
    userBody: 'Investigate fresh regressions from canary build and propose fixes.',
    agent: a1,
    jobStatus: 'COMPLETED',
    ageSeconds: 3 * 3600,
    finalResponse: 'Reproduced two regressions, opened fix plan, and linked failing traces.',
    costUsd: 0.0215,
    activitySummary: 'Triaged nightly regressions and posted actionable fix plan.',
  })

  await createWorkItemWithJob({
    pluginInstanceId: input.githubPluginId,
    sessionKey: parent.sessionKey,
    source: 'agent_dm',
    sourceRef: `agent_relay:${a1.id}:${a4.id}:verify-fix`,
    title: 'Verify fix branch and CI receipts',
    userBody: 'Run CI verification and summarize changed checks.',
    agent: a4,
    jobStatus: 'FAILED',
    ageSeconds: 2 * 3600 + 15 * 60,
    finalResponse: 'CI verification failed because snapshot baseline is stale.',
    costUsd: 0.0102,
    activitySummary: 'Verification run failed on stale snapshot baseline.',
  })

  await createWorkItemWithJob({
    pluginInstanceId: input.telegramPluginId,
    sessionKey: 'tg:product:ops-room',
    source: 'telegram',
    sourceRef: 'telegram:ops-room:883102',
    title: 'Summarize overnight fleet activity',
    userBody: 'Give me the overnight summary with spend and blocker list.',
    agent: a2,
    jobStatus: 'RUNNING',
    ageSeconds: 8 * 60,
    finalResponse: 'Compiling active jobs and cost deltas now.',
    costUsd: 0.0046,
    activitySummary: 'Collecting overnight fleet summary for ops room.',
    activityStatus: 'starting',
  })

  await createWorkItemWithJob({
    pluginInstanceId: input.telegramPluginId,
    sessionKey: 'tg:launch:war-room',
    source: 'telegram',
    sourceRef: 'telegram:launch-war-room:883355',
    title: 'Draft response for launch FAQ',
    userBody: 'Write a clear answer for data retention and receipts.',
    agent: a3,
    jobStatus: 'PENDING',
    ageSeconds: 4 * 60,
    finalResponse: 'Queued response draft for approval.',
    costUsd: 0.0,
    activitySummary: 'Queued FAQ response draft for launch war room.',
    activityStatus: 'starting',
  })

  const db = getDb()

  // Make one running + one queued dispatch so Fleet shows active operations and pending count.
  const activeWorkItem = await db
    .selectFrom('work_items')
    .select(['id', 'session_key'])
    .where('title', '=', 'Summarize overnight fleet activity')
    .orderBy('created_at', 'desc')
    .executeTakeFirstOrThrow()

  const queuedWorkItem = await db
    .selectFrom('work_items')
    .select(['id', 'session_key'])
    .where('title', '=', 'Draft response for launch FAQ')
    .orderBy('created_at', 'desc')
    .executeTakeFirstOrThrow()

  const runningQueueKey = `${activeWorkItem.session_key}:${a2.id}`
  const queuedQueueKey = `${queuedWorkItem.session_key}:${a3.id}`

  await upsertQueueLaneOnMessage({
    queueKey: runningQueueKey,
    sessionKey: activeWorkItem.session_key,
    agentId: a2.id,
    pluginInstanceId: input.telegramPluginId,
    arrivedAt: withAge(10 * 60),
    debounceMs: 2000,
    maxQueued: 10,
    mode: 'steer',
  })

  await upsertQueueLaneOnMessage({
    queueKey: queuedQueueKey,
    sessionKey: queuedWorkItem.session_key,
    agentId: a3.id,
    pluginInstanceId: input.telegramPluginId,
    arrivedAt: withAge(6 * 60),
    debounceMs: 2000,
    maxQueued: 10,
    mode: 'steer',
  })

  const runningDispatchId = generateUuidV7()
  const queuedDispatchId = generateUuidV7()

  await db
    .insertInto('run_dispatches')
    .values([
      {
        id: runningDispatchId,
        run_key: `${runningQueueKey}:${runningDispatchId}`,
        queue_key: runningQueueKey,
        work_item_id: activeWorkItem.id,
        agent_id: a2.id,
        plugin_instance_id: input.telegramPluginId,
        session_key: activeWorkItem.session_key,
        status: 'running',
        control_state: 'normal',
        control_reason: null,
        control_updated_at: null,
        input_text: 'Generate overnight summary with costs and blockers',
        coalesced_text: null,
        sender_name: 'Josh',
        response_context: null,
        job_id: null,
        attempt_count: 1,
        claimed_by: 'demo-worker',
        lease_expires_at: withAge(-5 * 60),
        claimed_epoch: 1,
        last_error: null,
        replay_of_dispatch_id: null,
        merged_into_dispatch_id: null,
        scheduled_at: withAge(10 * 60),
        started_at: withAge(9 * 60),
        finished_at: null,
        created_at: withAge(10 * 60),
        updated_at: withAge(2 * 60),
      },
      {
        id: queuedDispatchId,
        run_key: `${queuedQueueKey}:${queuedDispatchId}`,
        queue_key: queuedQueueKey,
        work_item_id: queuedWorkItem.id,
        agent_id: a3.id,
        plugin_instance_id: input.telegramPluginId,
        session_key: queuedWorkItem.session_key,
        status: 'queued',
        control_state: 'normal',
        control_reason: null,
        control_updated_at: null,
        input_text: 'Draft FAQ response with collaboration note',
        coalesced_text: null,
        sender_name: 'Josh',
        response_context: null,
        job_id: null,
        attempt_count: 0,
        claimed_by: null,
        lease_expires_at: null,
        claimed_epoch: 0,
        last_error: null,
        replay_of_dispatch_id: null,
        merged_into_dispatch_id: null,
        scheduled_at: withAge(6 * 60),
        started_at: null,
        finished_at: null,
        created_at: withAge(6 * 60),
        updated_at: withAge(3 * 60),
      },
    ])
    .execute()

  await db
    .updateTable('queue_lanes')
    .set({ state: 'running', active_dispatch_id: runningDispatchId, updated_at: withAge(2 * 60) })
    .where('queue_key', '=', runningQueueKey)
    .execute()

  await db
    .updateTable('queue_lanes')
    .set({ state: 'queued', active_dispatch_id: null, updated_at: withAge(2 * 60) })
    .where('queue_key', '=', queuedQueueKey)
    .execute()

  await createQueueMessage({
    queue_key: queuedQueueKey,
    work_item_id: queuedWorkItem.id,
    plugin_instance_id: input.telegramPluginId,
    response_context: null,
    text: 'Follow-up: include collaboration proof points',
    sender_name: 'Josh',
    arrived_at: withAge(5 * 60),
    status: 'pending',
    dispatch_id: null,
    drop_reason: null,
  })
}

async function main(): Promise<void> {
  const dbPath = requireScreenshotDbPath()
  const db = getDb()

  const owner = await db
    .selectFrom('users')
    .select(['id'])
    .orderBy('created_at', 'asc')
    .executeTakeFirst()

  if (!owner) {
    throw new Error(
      'No users found in screenshot DB. Create a user first (or copy a DB that already has at least one user).'
    )
  }

  const suffix = generateUuidV7().slice(-6)

  const agents = await createDemoAgents(suffix)
  const plugins = await createDemoPlugins(suffix)

  await seedCollaborationSessions({
    ownerUserId: owner.id,
    agents,
    githubPluginId: plugins.githubId,
  })

  await seedFleetAndActivity({
    agents,
    githubPluginId: plugins.githubId,
    telegramPluginId: plugins.telegramId,
  })

  console.log(`Seeded screenshot demo data into ${dbPath}`)
  console.log(`Created ${agents.length} agents and collaboration + activity demo receipts.`)
}

main()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[seed-demo-data] ${message}`)
    process.exitCode = 1
  })
  .finally(async () => {
    await closeDb()
  })
