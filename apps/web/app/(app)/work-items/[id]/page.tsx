import { notFound } from 'next/navigation'
import Link from 'next/link'
import {
  findWorkItemById,
  listJobsByWorkItem,
  findAgentById,
  listMessagesByJob,
  listInferenceCallsByJobWithPayloadsPaged,
  findPluginInstanceById,
  getCostByJobs,
  listSpansByJob,
  listExternalApiCallsByJob,
  listBackgroundTasksByJob,
  findActivityEntriesByJobIds,
  listRunDispatchesByWorkItem,
  listEffectOutboxByWorkItem,
  listQueueMessagesByWorkItem,
  listMediaArtifactsForWorkItem,
} from '@nitejar/database'
import {
  parseAgentConfig,
  getSessionSettings,
  buildSessionContext,
  formatSessionMessages,
} from '@nitejar/agent'
import { listModelCatalog } from '@/server/services/model-catalog'
import { IdentityBadge } from '../../components/IdentityBadge'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { LiveRunView } from './LiveRunView'
import { PayloadModal } from './PayloadViewer'
import { RunTodoPanel } from './RunTodoPanel'
import { TriagePanel } from './TriagePanel'
import { TraceView } from './TraceView'
import { CostBadge } from './CostBadge'
import { RunTimeline } from './RunTimeline'
import { RelativeTime } from './RelativeTime'
import { RetryRunButton } from './RetryRunButton'
import { WorkItemAutoRefresh } from './WorkItemAutoRefresh'
import { parseArbiterControlReason } from '@/lib/arbiter-receipts'
import {
  IconBrandTelegram,
  IconBrandGithub,
  IconPlugConnected,
  IconClock,
} from '@tabler/icons-react'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

const workItemStatusVariant = (status: string) => {
  switch (status) {
    case 'RUNNING':
      return 'default'
    case 'DONE':
    case 'COMPLETED':
      return 'secondary'
    case 'FAILED':
      return 'destructive'
    case 'NEEDS_APPROVAL':
      return 'outline'
    case 'CANCELED':
      return 'outline'
    default:
      return 'outline'
  }
}

const isActiveRun = (status: string) =>
  status === 'PENDING' || status === 'RUNNING' || status === 'PAUSED'

const pluginInstanceIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  telegram: IconBrandTelegram,
  github: IconBrandGithub,
}

type JobType = Awaited<ReturnType<typeof listJobsByWorkItem>>[number]
type SpanType = Awaited<ReturnType<typeof listSpansByJob>>[number]
type MessageType = Awaited<ReturnType<typeof listMessagesByJob>>[number]
type InferenceCallType = Awaited<
  ReturnType<typeof listInferenceCallsByJobWithPayloadsPaged>
>[number]
type ExternalCallType = Awaited<ReturnType<typeof listExternalApiCallsByJob>>[number]
type BackgroundTaskType = Awaited<ReturnType<typeof listBackgroundTasksByJob>>[number]
type ActivityEntryType = Awaited<ReturnType<typeof findActivityEntriesByJobIds>>[number]
type TraceMediaArtifactInfo = {
  id: string
  artifact_type: string
  operation: string
  file_name: string | null
  mime_type: string | null
  file_path: string | null
  created_at: number
}
type AgentType = NonNullable<Awaited<ReturnType<typeof findAgentById>>>
type AgentIdentityType = {
  name: string
  emoji: string | null
  avatarUrl: string | null
  title: string | null
}
type SessionHistoryData = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messages: any[]
  totalTokens: number
  turnCount: number
  truncated: boolean
  siblingJobIds: string[]
}
type ReplayMeta = {
  isReplay: boolean
  replayOfJobId: string | null
  isSuperseded: boolean
  dispatchId: string | null
  replayMode: 'restart' | 'resume' | null
}
type ModelCatalogEntry = {
  externalId: string
  name: string
  contextLength: number | null
  modalities: string[]
  pricing: { prompt?: number | null; completion?: number | null } | null
  supportsTools: boolean
}

function queueStatusClassName(status: string): string {
  switch (status) {
    case 'included':
      return 'bg-emerald-500/15 text-emerald-300/80'
    case 'pending':
      return 'bg-amber-500/15 text-amber-300/80'
    case 'dropped':
      return 'bg-zinc-500/15 text-zinc-300/80'
    case 'cancelled':
      return 'bg-red-500/15 text-red-300/80'
    default:
      return 'bg-white/10 text-white/60'
  }
}

function summarizeText(value: string | null, maxLength = 120): string | null {
  if (!value) return null
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) return null
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1)}…`
}

type SystemTimelineEvent = {
  id: string
  timestamp: number
  lane: 'decision' | 'queue' | 'effect'
  badge: string
  badgeClassName: string
  title: string
  detail: string | null
  relatedDispatchId?: string | null
}

function shortDispatchId(id: string): string {
  return id.slice(0, 13)
}

function laneAgentIdFromQueueKey(queueKey: string | null): string | null {
  if (!queueKey) return null
  const parts = queueKey.split(':').filter((part) => part.length > 0)
  if (parts.length === 0) return null
  return parts[parts.length - 1] ?? null
}

function parseJsonObject(value: string | null): Record<string, unknown> | null {
  if (!value) return null
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

function effectDestination(effect: {
  channel: string
  provider_ref: string | null
  payload: string
}): string | null {
  const payload = parseJsonObject(effect.payload)
  const ctx =
    payload && typeof payload.responseContext === 'object' && payload.responseContext
      ? (payload.responseContext as Record<string, unknown>)
      : null

  if (effect.channel === 'telegram' && ctx) {
    const chatId = ctx.chatId
    const threadId = ctx.messageThreadId
    const replyTo = ctx.replyToMessageId
    const parts: string[] = []
    if (typeof chatId === 'number' || typeof chatId === 'string') parts.push(`chat:${chatId}`)
    if (typeof threadId === 'number' || typeof threadId === 'string')
      parts.push(`thread:${threadId}`)
    if (typeof replyTo === 'number' || typeof replyTo === 'string')
      parts.push(`reply_to:${replyTo}`)
    if (parts.length > 0) return `telegram ${parts.join(' ')}`
  }

  if (effect.channel === 'github' && ctx) {
    const owner = typeof ctx.owner === 'string' ? ctx.owner : null
    const repo = typeof ctx.repo === 'string' ? ctx.repo : null
    const issueNumber =
      typeof ctx.issueNumber === 'number' || typeof ctx.issueNumber === 'string'
        ? String(ctx.issueNumber)
        : null
    if (owner && repo && issueNumber) return `github ${owner}/${repo}#${issueNumber}`
  }

  if (effect.provider_ref) return `provider:${effect.provider_ref}`
  return null
}

function JobDetail({
  job,
  isOpen,
  agentMap,
  agentIdentity,
  agentIdentityByHandle,
  messagesByJob,
  inferenceCallsByJob,
  spansByJob,
  externalCallsByJob,
  promptSessionHistoryByJob,
  backgroundTasksByJob,
  activityByJob,
  jobCostMap,
  mediaArtifactsByJob,
  replayMeta,
  allJobs,
  defaultUserLabel,
  isPrivateTelegramConversation,
  modelCatalog,
}: {
  job: JobType
  isOpen: boolean
  agentMap: Map<string, AgentType>
  agentIdentity: Map<string, AgentIdentityType>
  agentIdentityByHandle: Record<string, { name: string; emoji: string | null }>
  messagesByJob: Map<string, MessageType[]>
  inferenceCallsByJob: Map<string, InferenceCallType[]>
  spansByJob: Map<string, SpanType[]>
  externalCallsByJob: Map<string, ExternalCallType[]>
  promptSessionHistoryByJob: Map<string, SessionHistoryData>
  backgroundTasksByJob: Map<string, BackgroundTaskType[]>
  activityByJob: Map<string, ActivityEntryType>
  jobCostMap: Map<
    string,
    {
      total_cost: number
      prompt_tokens: number
      completion_tokens: number
      cache_read_tokens: number
      cache_write_tokens: number
    }
  >
  mediaArtifactsByJob: Map<string, TraceMediaArtifactInfo[]>
  replayMeta: ReplayMeta | undefined
  allJobs: JobType[]
  defaultUserLabel: string | null
  isPrivateTelegramConversation: boolean
  modelCatalog: ModelCatalogEntry[]
}) {
  const agent = agentMap.get(job.agent_id)
  const agentProfile = agent ? agentIdentity.get(agent.id) : null
  const messages = messagesByJob.get(job.id) ?? []
  const inferenceCalls = inferenceCallsByJob.get(job.id) ?? []
  const spans = spansByJob.get(job.id) ?? []
  const externalCalls = externalCallsByJob.get(job.id) ?? []
  const sessionHistoryData = promptSessionHistoryByJob.get(job.id) ?? {
    messages: [],
    totalTokens: 0,
    turnCount: 0,
    truncated: false,
    siblingJobIds: [] as string[],
  }
  const sessionHistory = {
    messages: sessionHistoryData.messages,
    totalTokens: sessionHistoryData.totalTokens,
    turnCount: sessionHistoryData.turnCount,
    truncated: sessionHistoryData.truncated,
  }
  const siblingMessages = (sessionHistoryData.siblingJobIds ?? []).flatMap((sibId) => {
    const sibJob = allJobs.find((j) => j.id === sibId)
    const sibProfile = sibJob ? agentIdentity.get(sibJob.agent_id) : null
    const sibMsgs = messagesByJob.get(sibId) ?? []
    return sibMsgs
      .filter((m) => {
        if (m.role !== 'assistant') return false
        try {
          const parsed = JSON.parse(m.content || '{}') as Record<string, unknown>
          const text = parsed.text
          const hasText = typeof text === 'string' && text.trim().length > 0
          return hasText
        } catch {
          return false
        }
      })
      .map((m) => ({
        ...m,
        agentName: sibProfile?.name ?? 'Unknown',
        agentEmoji: sibProfile?.emoji ?? null,
      }))
  })
  const backgroundTasks = backgroundTasksByJob.get(job.id) ?? []
  const jobMediaArtifacts = mediaArtifactsByJob.get(job.id) ?? []
  const activityEntry = activityByJob.get(job.id) ?? null
  const active = isActiveRun(job.status)
  const passed = activityEntry?.status === 'passed'
  const jobCost = jobCostMap.get(job.id)
  const jobExternalCost = externalCalls.reduce((sum, c) => sum + (c.cost_usd ?? 0), 0)
  const jobUnpricedExternalCallCount = externalCalls.filter((call) => call.cost_usd == null).length
  const hasSpans = !active && spans.length > 0
  // Show replay actions for failed/abandoned jobs that haven't already been replayed
  const canReplay =
    (job.status === 'FAILED' || job.status === 'ABANDONED') && !replayMeta?.isSuperseded

  const statusDotColor = passed
    ? 'bg-yellow-400/60'
    : job.status === 'COMPLETED'
      ? 'bg-emerald-400'
      : job.status === 'FAILED'
        ? 'bg-red-400'
        : job.status === 'CANCELLED'
          ? 'bg-orange-400'
          : job.status === 'PAUSED'
            ? 'bg-amber-300'
            : job.status === 'RUNNING'
              ? 'bg-primary animate-pulse'
              : 'bg-white/30'

  return (
    <details
      key={job.id}
      data-run-id={job.id}
      open={isOpen ? true : undefined}
      className="group/run"
    >
      <summary
        className={`flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 rounded-t-lg border border-white/10 bg-white/[0.02] px-4 py-2.5 [&::-webkit-details-marker]:hidden ${
          active ? 'ring-1 ring-primary/30' : ''
        } group-not-open/run:rounded-b-lg`}
      >
        <div className="flex items-center gap-3">
          <span className={`h-2 w-2 shrink-0 rounded-full ${statusDotColor}`} title={job.status} />
          {agentProfile ? (
            <Link href={`/admin/agents/${agent!.id}`} className="hover:opacity-80">
              <IdentityBadge
                name={agentProfile.name}
                subtitle={agentProfile.title ?? undefined}
                emoji={agentProfile.emoji}
                avatarUrl={agentProfile.avatarUrl}
                size="sm"
              />
            </Link>
          ) : (
            <span className="text-xs text-muted-foreground">Unknown agent</span>
          )}
          {passed && (
            <span className="rounded bg-yellow-400/10 px-1.5 py-0.5 text-[10px] font-medium text-yellow-400/80">
              PASS
            </span>
          )}
          {replayMeta?.isReplay && (
            <span className="rounded bg-blue-400/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-400/80">
              {replayMeta.replayMode === 'resume' ? 'RESUME' : 'RESTART'}
            </span>
          )}
          {replayMeta?.isSuperseded && (
            <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-medium text-white/40">
              SUPERSEDED
            </span>
          )}
          {job.error_text && (
            <span className="max-w-xs truncate text-[10px] text-red-400">{job.error_text}</span>
          )}
        </div>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          {jobCost && (
            <>
              <CostBadge
                totalCost={jobCost.total_cost}
                externalCost={jobExternalCost}
                externalCallCount={externalCalls.length}
                unpricedExternalCallCount={jobUnpricedExternalCallCount}
                promptTokens={jobCost.prompt_tokens}
                completionTokens={jobCost.completion_tokens}
                cacheReadTokens={jobCost.cache_read_tokens}
                cacheWriteTokens={jobCost.cache_write_tokens}
                variant="inline"
              />
              <span className="text-white/20">·</span>
            </>
          )}
          {job.started_at && (
            <span title="Started">
              <RelativeTime timestamp={job.started_at} />
            </span>
          )}
          {job.started_at && job.completed_at && (
            <>
              <span className="text-white/20">&rarr;</span>
              <span title="Completed">
                <RelativeTime timestamp={job.completed_at} />
              </span>
            </>
          )}
          {!job.started_at && <RelativeTime timestamp={job.created_at} />}
          {canReplay && replayMeta?.dispatchId && (
            <RetryRunButton dispatchId={replayMeta.dispatchId} />
          )}
        </div>
      </summary>

      {activityEntry && <TriagePanel entry={activityEntry} connected />}

      <RunTodoPanel todoState={job.todo_state} connected roundedBottom={!hasSpans && !active} />

      {hasSpans ? (
        <TraceView
          spans={spans}
          messages={messages}
          inferenceCalls={inferenceCalls}
          runStatus={job.status}
          sessionHistory={sessionHistory}
          siblingMessages={siblingMessages}
          agentByHandle={agentIdentityByHandle}
          agentLabel={
            agentProfile ? `${agentProfile.emoji ?? ''} ${agentProfile.name}`.trim() : undefined
          }
          defaultUserLabel={defaultUserLabel ?? undefined}
          applyDefaultUserLabelToHistory={isPrivateTelegramConversation}
          externalApiCalls={externalCalls}
          mediaArtifacts={jobMediaArtifacts}
          modelCatalog={modelCatalog}
          backgroundTasks={backgroundTasks}
        />
      ) : active ? (
        <LiveRunView jobId={job.id} />
      ) : null}
    </details>
  )
}

function JobList({
  sortedJobs,
  agentMap,
  agentIdentity,
  agentIdentityByHandle,
  messagesByJob,
  inferenceCallsByJob,
  spansByJob,
  externalCallsByJob,
  promptSessionHistoryByJob,
  backgroundTasksByJob,
  activityByJob,
  jobCostMap,
  mediaArtifactsByJob,
  jobReplayMeta,
  allJobs,
  defaultUserLabel,
  isPrivateTelegramConversation,
  modelCatalog,
}: {
  sortedJobs: JobType[]
  agentMap: Map<string, AgentType>
  agentIdentity: Map<string, AgentIdentityType>
  agentIdentityByHandle: Record<string, { name: string; emoji: string | null }>
  messagesByJob: Map<string, MessageType[]>
  inferenceCallsByJob: Map<string, InferenceCallType[]>
  spansByJob: Map<string, SpanType[]>
  externalCallsByJob: Map<string, ExternalCallType[]>
  promptSessionHistoryByJob: Map<string, SessionHistoryData>
  backgroundTasksByJob: Map<string, BackgroundTaskType[]>
  activityByJob: Map<string, ActivityEntryType>
  jobCostMap: Map<
    string,
    {
      total_cost: number
      prompt_tokens: number
      completion_tokens: number
      cache_read_tokens: number
      cache_write_tokens: number
    }
  >
  mediaArtifactsByJob: Map<string, TraceMediaArtifactInfo[]>
  jobReplayMeta: Map<string, ReplayMeta>
  allJobs: JobType[]
  defaultUserLabel: string | null
  isPrivateTelegramConversation: boolean
  modelCatalog: ModelCatalogEntry[]
}) {
  // Group jobs by agent_id, preserving sortedJobs order for the first appearance
  const agentGroups: { agentId: string; jobs: JobType[] }[] = []
  const seenAgents = new Map<string, number>()
  for (const job of sortedJobs) {
    const idx = seenAgents.get(job.agent_id)
    if (idx != null) {
      agentGroups[idx]!.jobs.push(job)
    } else {
      seenAgents.set(job.agent_id, agentGroups.length)
      agentGroups.push({ agentId: job.agent_id, jobs: [job] })
    }
  }

  // Find the first non-passed job across all groups (for auto-open logic)
  const firstNonPassedJobId = sortedJobs.find(
    (j) => activityByJob.get(j.id)?.status !== 'passed'
  )?.id

  const sharedProps = {
    agentMap,
    agentIdentity,
    agentIdentityByHandle,
    messagesByJob,
    inferenceCallsByJob,
    spansByJob,
    externalCallsByJob,
    promptSessionHistoryByJob,
    backgroundTasksByJob,
    activityByJob,
    jobCostMap,
    mediaArtifactsByJob,
    allJobs,
    defaultUserLabel,
    isPrivateTelegramConversation,
    modelCatalog,
  }

  return (
    <div className="space-y-4">
      {agentGroups.map((group) => {
        const hasMultipleRuns = group.jobs.length > 1
        // Derive latest attempt by timestamp so active/queued retries are never hidden
        // behind "earlier attempts" when higher-level ordering changes.
        const jobsByTime = [...group.jobs].sort((a, b) => {
          const aStart = a.started_at ?? a.created_at
          const bStart = b.started_at ?? b.created_at
          return aStart - bStart
        })
        const latestJob = jobsByTime[jobsByTime.length - 1]!
        const earlierJobs = jobsByTime.slice(0, -1)

        if (!hasMultipleRuns) {
          // Single run — render as-is
          const job = group.jobs[0]!
          const passed = activityByJob.get(job.id)?.status === 'passed'
          const active = isActiveRun(job.status)
          const isOpen = !passed && (job.id === firstNonPassedJobId || active)
          return (
            <JobDetail
              key={job.id}
              job={job}
              isOpen={isOpen}
              replayMeta={jobReplayMeta.get(job.id)}
              {...sharedProps}
            />
          )
        }

        // Multiple runs for same agent — group them
        const latestPassed = activityByJob.get(latestJob.id)?.status === 'passed'
        const latestActive = isActiveRun(latestJob.status)
        const latestIsOpen = !latestPassed && (latestJob.id === firstNonPassedJobId || latestActive)

        return (
          <div key={`agent-group-${group.agentId}`} className="space-y-1">
            {/* Earlier attempts disclosure */}
            <details className="group/earlier">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded border border-white/5 bg-white/[0.01] px-3 py-1.5 text-[11px] text-muted-foreground hover:bg-white/[0.03] [&::-webkit-details-marker]:hidden">
                <span className="transition-transform group-open/earlier:rotate-90">▸</span>
                <span>
                  {earlierJobs.length} earlier attempt{earlierJobs.length > 1 ? 's' : ''}
                </span>
                <span className="text-white/20">·</span>
                {earlierJobs.map((ej) => {
                  const status = ej.status
                  const duration =
                    ej.started_at && ej.completed_at
                      ? `${((ej.completed_at - ej.started_at) / 60).toFixed(1)}m`
                      : null
                  return (
                    <span
                      key={ej.id}
                      className={`${status === 'FAILED' ? 'text-red-400/60' : status === 'COMPLETED' ? 'text-emerald-400/60' : 'text-white/30'}`}
                    >
                      {status.toLowerCase()}
                      {duration && ` (${duration})`}
                    </span>
                  )
                })}
              </summary>
              <div className="mt-1 space-y-1">
                {earlierJobs.map((ej) => {
                  const passed = activityByJob.get(ej.id)?.status === 'passed'
                  return (
                    <JobDetail
                      key={ej.id}
                      job={ej}
                      isOpen={!passed && ej.id === firstNonPassedJobId}
                      replayMeta={jobReplayMeta.get(ej.id)}
                      {...sharedProps}
                    />
                  )
                })}
              </div>
            </details>

            {/* Latest attempt — always visible */}
            <JobDetail
              job={latestJob}
              isOpen={latestIsOpen}
              replayMeta={jobReplayMeta.get(latestJob.id)}
              {...sharedProps}
            />
          </div>
        )
      })}
    </div>
  )
}

export default async function WorkItemDetailPage({ params }: PageProps) {
  const { id } = await params
  const item = await findWorkItemById(id)

  if (!item) {
    notFound()
  }

  // Fetch plugin instance if it exists.
  const pluginInstance = item.plugin_instance_id
    ? await findPluginInstanceById(item.plugin_instance_id)
    : null

  const jobs = await listJobsByWorkItem(id)
  const [dispatches, effects, queueMessages] = await Promise.all([
    listRunDispatchesByWorkItem(id),
    listEffectOutboxByWorkItem(id),
    listQueueMessagesByWorkItem(id, { limit: 500 }),
  ])
  const jobCostData = await getCostByJobs(jobs.map((j) => j.id))
  const jobCostMap = new Map(jobCostData.map((c) => [c.job_id, c]))
  const totalCost = jobCostData.reduce((sum, c) => sum + c.total_cost, 0)
  const totalPromptTokens = jobCostData.reduce((sum, c) => sum + c.prompt_tokens, 0)
  const totalCompletionTokens = jobCostData.reduce((sum, c) => sum + c.completion_tokens, 0)
  const totalCacheReadTokens = jobCostData.reduce((sum, c) => sum + c.cache_read_tokens, 0)
  const totalCacheWriteTokens = jobCostData.reduce((sum, c) => sum + c.cache_write_tokens, 0)
  const agentIds = Array.from(new Set(jobs.map((job) => job.agent_id)))
  const agents = await Promise.all(agentIds.map((agentId) => findAgentById(agentId)))
  const agentMap = new Map(agents.filter(Boolean).map((agent) => [agent!.id, agent!]))
  const agentConfigMap = new Map(
    agents.filter(Boolean).map((agent) => [agent!.id, parseAgentConfig(agent!.config)])
  )
  const agentIdentity = new Map(
    agents.filter(Boolean).map((agent) => {
      const config = agentConfigMap.get(agent!.id) ?? {}
      return [
        agent!.id,
        {
          name: agent!.name,
          emoji: config.emoji ?? null,
          avatarUrl: config.avatarUrl ?? null,
          title: config.title ?? null,
        },
      ]
    })
  )
  const agentIdentityByHandle = Object.fromEntries(
    agents
      .filter((agent): agent is NonNullable<(typeof agents)[number]> => Boolean(agent))
      .map((agent) => {
        const config = agentConfigMap.get(agent.id) ?? {}
        return [
          agent.handle.toLowerCase(),
          {
            name: agent.name,
            emoji: config.emoji ?? null,
          },
        ] as const
      })
  )
  const [
    messagesByJobEntries,
    inferenceCallsByJobEntries,
    spansByJobEntries,
    externalCallsByJobEntries,
    promptSessionHistoryEntries,
    backgroundTasksByJobEntries,
    activityLogEntries,
  ] = await Promise.all([
    Promise.all(jobs.map(async (job) => [job.id, await listMessagesByJob(job.id)] as const)),
    Promise.all(
      jobs.map(
        async (job) =>
          [
            job.id,
            await listInferenceCallsByJobWithPayloadsPaged(job.id, {
              offset: 0,
              limit: 500,
            }),
          ] as const
      )
    ),
    Promise.all(jobs.map(async (job) => [job.id, await listSpansByJob(job.id)] as const)),
    Promise.all(
      jobs.map(async (job) => [job.id, await listExternalApiCallsByJob(job.id)] as const)
    ),
    Promise.all(
      jobs.map(async (job) => {
        const sessionSettings = getSessionSettings(agentConfigMap.get(job.agent_id) ?? {})
        const contextAsOf = job.started_at ?? job.created_at

        // Sibling jobs: other jobs in the same work item that completed before this job started
        const siblingJobIds = jobs
          .filter(
            (j) =>
              j.id !== job.id && j.completed_at != null && j.completed_at <= (job.started_at ?? 0)
          )
          .map((j) => j.id)

        // Exclude sibling jobs from session history — their messages
        // will be shown inline as immediate context rather than buried
        // in the collapsed history section.
        const sessionContext = await buildSessionContext(
          item.session_key,
          job.id,
          job.agent_id,
          sessionSettings,
          contextAsOf,
          siblingJobIds
        )

        return [
          job.id,
          {
            messages: formatSessionMessages(sessionContext),
            totalTokens: sessionContext.totalTokens,
            turnCount: sessionContext.turnGroups.length,
            truncated: sessionContext.truncated,
            siblingJobIds,
          },
        ] as const
      })
    ),
    Promise.all(jobs.map(async (job) => [job.id, await listBackgroundTasksByJob(job.id)] as const)),
    findActivityEntriesByJobIds(jobs.map((j) => j.id)),
  ])
  const messagesByJob = new Map(messagesByJobEntries)
  const inferenceCallsByJob = new Map(inferenceCallsByJobEntries)
  const spansByJob = new Map(spansByJobEntries)
  const externalCallsByJob = new Map(externalCallsByJobEntries)
  const promptSessionHistoryByJob = new Map(promptSessionHistoryEntries)
  const backgroundTasksByJob = new Map(backgroundTasksByJobEntries)
  const activityByJob = new Map(
    activityLogEntries.filter((e) => e.job_id != null).map((e) => [e.job_id!, e])
  )
  const totalExternalCost = Array.from(externalCallsByJob.values())
    .flat()
    .reduce((sum, c) => sum + (c.cost_usd ?? 0), 0)
  const allExternalCalls = Array.from(externalCallsByJob.values()).flat()
  const totalExternalCallCount = allExternalCalls.length
  const totalUnpricedExternalCallCount = allExternalCalls.filter(
    (call) => call.cost_usd == null
  ).length
  const mediaArtifacts = await listMediaArtifactsForWorkItem(id)
  const mediaArtifactsByJob = new Map<string, TraceMediaArtifactInfo[]>()
  for (const artifact of mediaArtifacts) {
    const existing = mediaArtifactsByJob.get(artifact.job_id) ?? []
    existing.push({
      id: artifact.id,
      artifact_type: artifact.artifact_type,
      operation: artifact.operation,
      file_name: artifact.file_name,
      mime_type: artifact.mime_type,
      file_path: artifact.file_path,
      created_at: artifact.created_at,
    })
    mediaArtifactsByJob.set(artifact.job_id, existing)
  }

  // Build dispatch→job replay metadata
  // Maps each dispatch to its job_id, and uses replay_of_dispatch_id to trace replay chains
  const dispatchByJobId = new Map(
    dispatches.filter((d) => d.job_id != null).map((d) => [d.job_id!, d])
  )
  const dispatchById = new Map(dispatches.map((d) => [d.id, d]))

  // For each job, determine: is it a replay? what job did it replay? is it the latest attempt?
  const jobReplayMeta = new Map<string, ReplayMeta>()

  // Collect all job IDs that have been replayed (i.e. a later dispatch references them)
  const supersededJobIds = new Set<string>()
  for (const dispatch of dispatches) {
    if (dispatch.replay_of_dispatch_id && dispatch.job_id) {
      const originalDispatch = dispatchById.get(dispatch.replay_of_dispatch_id)
      if (originalDispatch?.job_id) {
        supersededJobIds.add(originalDispatch.job_id)
      }
    }
  }

  for (const job of jobs) {
    const dispatch = dispatchByJobId.get(job.id)
    const replayOfId = dispatch?.replay_of_dispatch_id ?? null
    const isReplay = replayOfId != null
    const originalDispatch = replayOfId ? dispatchById.get(replayOfId) : null
    const replayOfJobId = originalDispatch?.job_id ?? null
    const isSuperseded = supersededJobIds.has(job.id)
    const replayMode =
      dispatch?.control_reason === 'resume_seed' || dispatch?.control_reason === 'restart_seed'
        ? 'resume'
        : 'restart'

    jobReplayMeta.set(job.id, {
      isReplay,
      replayOfJobId,
      isSuperseded,
      dispatchId: dispatch?.id ?? null,
      replayMode: isReplay ? replayMode : null,
    })
  }

  // Build model catalog lookup for TraceView tooltips
  const { models: catalogModels } = await listModelCatalog()
  const modelCatalog = catalogModels.map((m) => ({
    externalId: m.externalId,
    name: m.name,
    contextLength: (m.metadata?.contextLength as number) ?? null,
    modalities: Array.isArray(m.metadata?.modalities) ? (m.metadata.modalities as string[]) : [],
    pricing:
      (m.metadata?.pricing as { prompt?: number | null; completion?: number | null }) ?? null,
    supportsTools: (m.metadata?.supportsTools as boolean) ?? false,
  }))

  let payload: unknown = null
  if (item.payload) {
    try {
      payload = JSON.parse(item.payload)
    } catch {
      payload = item.payload
    }
  }

  const payloadRecord =
    payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null
  const senderName =
    payloadRecord && typeof payloadRecord.senderName === 'string' ? payloadRecord.senderName : null
  const senderUsername =
    payloadRecord && typeof payloadRecord.senderUsername === 'string'
      ? payloadRecord.senderUsername
      : null
  const defaultUserLabel = (() => {
    if (!senderName && !senderUsername) return null
    const parts: string[] = []
    if (senderName) parts.push(senderName)
    if (senderUsername) parts.push(`@${senderUsername}`)
    return `👤 ${parts.join(' ').trim()}`
  })()
  const isPrivateTelegramConversation =
    item.source === 'telegram' && payloadRecord?.chatType === 'private'

  // Sort jobs: active first, then by started_at ascending (chronological)
  const sortedJobs = [...jobs].sort((a, b) => {
    const aActive = isActiveRun(a.status)
    const bActive = isActiveRun(b.status)
    if (aActive && !bActive) return -1
    if (!aActive && bActive) return 1
    const aStart = a.started_at ?? a.created_at
    const bStart = b.started_at ?? b.created_at
    return aStart - bStart
  })
  const sortedDispatches = [...dispatches].sort((a, b) => {
    if (a.created_at === b.created_at) return a.id.localeCompare(b.id)
    return a.created_at - b.created_at
  })
  const sortedQueueMessages = [...queueMessages].sort((a, b) => {
    if (a.created_at === b.created_at) return a.id.localeCompare(b.id)
    return a.created_at - b.created_at
  })
  const sortedEffects = [...effects].sort((a, b) => {
    if (a.created_at === b.created_at) return a.id.localeCompare(b.id)
    return a.created_at - b.created_at
  })
  const systemEvents: SystemTimelineEvent[] = [
    ...sortedDispatches.map((dispatch) => {
      const parsedDecision = parseArbiterControlReason(dispatch.control_reason)
      const agent = agentIdentity.get(dispatch.agent_id)
      const laneLabel = agent
        ? `${agent.emoji ? `${agent.emoji} ` : ''}${agent.name}`
        : `lane ${dispatch.agent_id.slice(0, 8)}`
      const triage = dispatch.job_id ? activityByJob.get(dispatch.job_id) : null
      const triageDecision =
        triage?.status === 'passed'
          ? 'pass'
          : triage?.status === 'completed' || triage?.status === 'starting'
            ? 'respond'
            : null
      const decisionField = parsedDecision?.decision ?? triageDecision ?? 'none'
      const decisionSource = parsedDecision ? 'runtime' : triageDecision ? 'triage' : 'none'
      const stateField = dispatch.control_state ?? 'none'
      const reasonField = summarizeText(
        parsedDecision?.reason ?? triage?.summary ?? dispatch.control_reason,
        160
      )
      const detail = `decision=${decisionField} · source=${decisionSource} · state=${stateField}${
        reasonField ? ` · reason=${reasonField}` : ''
      }`
      return {
        id: `dispatch:${dispatch.id}`,
        timestamp: dispatch.created_at,
        lane: 'decision' as const,
        badge: 'Decision',
        badgeClassName: 'bg-sky-500/15 text-sky-300/80',
        title: `Control update · ${laneLabel}`,
        detail,
        relatedDispatchId: dispatch.id,
      }
    }),
    ...sortedQueueMessages.map((message) => {
      const parsedDropReason = parseArbiterControlReason(message.drop_reason)
      const laneAgentId = laneAgentIdFromQueueKey(message.queue_key)
      const laneAgent = laneAgentId ? agentIdentity.get(laneAgentId) : null
      const laneLabel = laneAgent
        ? `${laneAgent.emoji ? `${laneAgent.emoji} ` : ''}${laneAgent.name}`
        : laneAgentId
          ? `lane ${laneAgentId.slice(0, 8)}`
          : null
      const detail =
        summarizeText(message.text, 90) ??
        parsedDropReason?.reason ??
        summarizeText(message.drop_reason, 120)
      return {
        id: `queue:${message.id}`,
        timestamp: message.created_at,
        lane: 'queue' as const,
        badge: 'Queue',
        badgeClassName: queueStatusClassName(message.status),
        title: `Message ${message.status}${laneLabel ? ` · ${laneLabel}` : ''}`,
        detail,
        relatedDispatchId: message.dispatch_id,
      }
    }),
    ...sortedEffects.map((effect) => ({
      id: `effect:${effect.id}`,
      timestamp: effect.created_at,
      lane: 'effect' as const,
      badge: 'Effect',
      badgeClassName: 'bg-violet-500/15 text-violet-300/80',
      title: `${effect.kind} ${effect.status}`,
      detail:
        [
          effectDestination(effect),
          summarizeText(effect.last_error, 140),
          effect.provider_ref ? `provider_ref=${effect.provider_ref}` : null,
        ]
          .filter((part): part is string => Boolean(part))
          .join(' · ') || null,
      relatedDispatchId: effect.dispatch_id,
    })),
  ].sort((a, b) => {
    if (a.timestamp === b.timestamp) return a.id.localeCompare(b.id)
    return a.timestamp - b.timestamp
  })
  const dispatchEventsById = new Map<string, SystemTimelineEvent[]>()
  const unassignedEvents: SystemTimelineEvent[] = []
  for (const event of systemEvents) {
    if (!event.relatedDispatchId) {
      unassignedEvents.push(event)
      continue
    }

    const events = dispatchEventsById.get(event.relatedDispatchId) ?? []
    events.push(event)
    dispatchEventsById.set(event.relatedDispatchId, events)
  }

  const sortedDispatchIds = sortedDispatches.map((dispatch) => dispatch.id)
  const knownDispatchIds = new Set(sortedDispatchIds)
  const extraDispatchIds = Array.from(dispatchEventsById.keys()).filter(
    (id) => !knownDispatchIds.has(id)
  )
  const groupedDispatchIds = [...sortedDispatchIds, ...extraDispatchIds]

  const dispatchGroups = groupedDispatchIds
    .map((dispatchId) => ({
      dispatchId,
      dispatch: dispatchById.get(dispatchId) ?? null,
      events: dispatchEventsById.get(dispatchId) ?? [],
    }))
    .filter((group) => group.events.length > 0)
  const hasLiveDispatch = dispatches.some(
    (dispatch) => dispatch.status === 'queued' || dispatch.status === 'running'
  )

  const PluginInstanceIcon = pluginInstance
    ? pluginInstanceIcons[pluginInstance.type] || IconPlugConnected
    : IconPlugConnected

  return (
    <div className="space-y-6">
      <WorkItemAutoRefresh enabled={hasLiveDispatch} />
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Link
            href="/admin/work-items"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            &larr; Work Items
          </Link>
          <div className="flex items-center gap-2">
            {payload != null && <PayloadModal data={payload} />}
          </div>
        </div>
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-semibold">{item.title}</h2>
            <Badge variant={workItemStatusVariant(item.status)} className="text-xs">
              {item.status.replace('_', ' ')}
            </Badge>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {pluginInstance ? (
              <Link
                href={`/admin/plugins/instances/${pluginInstance.id}`}
                className="flex items-center gap-1 hover:text-foreground"
              >
                <PluginInstanceIcon className="h-3 w-3" />
                {pluginInstance.name}
              </Link>
            ) : (
              <span className="capitalize">{item.source}</span>
            )}
            <span className="text-white/20">·</span>
            <span className="flex items-center gap-1">
              <IconClock className="h-3 w-3" />
              <RelativeTime timestamp={item.created_at} />
            </span>
            {totalCost > 0 && (
              <>
                <span className="text-white/20">·</span>
                <CostBadge
                  totalCost={totalCost}
                  externalCost={totalExternalCost}
                  externalCallCount={totalExternalCallCount}
                  unpricedExternalCallCount={totalUnpricedExternalCallCount}
                  promptTokens={totalPromptTokens}
                  completionTokens={totalCompletionTokens}
                  cacheReadTokens={totalCacheReadTokens}
                  cacheWriteTokens={totalCacheWriteTokens}
                  variant="inline"
                />
              </>
            )}
          </div>
        </div>
      </div>

      {/* Runs */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">
            Runs <span className="text-sm font-normal text-muted-foreground">({jobs.length})</span>
          </h3>
        </div>

        {sortedJobs.length > 1 && (
          <RunTimeline
            runs={sortedJobs.map((job) => {
              const profile = agentIdentity.get(job.agent_id)
              const cost = jobCostMap.get(job.id)
              const jobActivity = activityByJob.get(job.id)
              const replayMeta = jobReplayMeta.get(job.id)
              return {
                jobId: job.id,
                agentId: job.agent_id,
                agentName: profile?.name ?? 'Unknown',
                agentEmoji: profile?.emoji,
                startedAt: job.started_at,
                completedAt: job.completed_at,
                status: job.status,
                cost: cost?.total_cost,
                errorText: job.error_text,
                passed: jobActivity?.status === 'passed',
                isReplay: replayMeta?.isReplay,
              }
            })}
          />
        )}

        {jobs.length === 0 ? (
          <Card className="border-dashed border-white/10 bg-white/[0.01]">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-white/5">
                <span className="text-2xl">🤖</span>
              </div>
              <p className="text-sm text-muted-foreground">
                No runs yet. Assign an agent to begin processing.
              </p>
            </CardContent>
          </Card>
        ) : (
          <JobList
            sortedJobs={sortedJobs}
            agentMap={agentMap}
            agentIdentity={agentIdentity}
            agentIdentityByHandle={agentIdentityByHandle}
            messagesByJob={messagesByJob}
            inferenceCallsByJob={inferenceCallsByJob}
            spansByJob={spansByJob}
            externalCallsByJob={externalCallsByJob}
            promptSessionHistoryByJob={promptSessionHistoryByJob}
            backgroundTasksByJob={backgroundTasksByJob}
            activityByJob={activityByJob}
            jobCostMap={jobCostMap}
            mediaArtifactsByJob={mediaArtifactsByJob}
            jobReplayMeta={jobReplayMeta}
            allJobs={jobs}
            defaultUserLabel={defaultUserLabel}
            isPrivateTelegramConversation={isPrivateTelegramConversation}
            modelCatalog={modelCatalog}
          />
        )}
      </div>

      {systemEvents.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-lg font-semibold">Receipts</h3>
          <Card className="border-white/10 bg-white/[0.02]">
            <CardContent className="space-y-3 py-0">
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-white/45">
                <span className="rounded bg-sky-500/10 px-1.5 py-0.5">
                  {sortedDispatches.length} decisions
                </span>
                <span className="rounded bg-white/[0.06] px-1.5 py-0.5">
                  {sortedQueueMessages.length} queue events
                </span>
                <span className="rounded bg-violet-500/10 px-1.5 py-0.5">
                  {sortedEffects.length} effects
                </span>
              </div>

              <div className="space-y-2">
                {dispatchGroups.map((group) => {
                  const dispatch = group.dispatch
                  const dispatchAgent = dispatch ? agentIdentity.get(dispatch.agent_id) : null
                  const headerTimestamp = dispatch?.created_at ?? group.events[0]!.timestamp

                  return (
                    <div
                      key={group.dispatchId}
                      className="rounded border border-white/10 bg-white/[0.015] p-2"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded bg-white/[0.08] px-1.5 py-0.5 text-[10px] text-white/60">
                          Dispatch
                        </span>
                        <span className="font-mono text-[10px] text-white/50">
                          {shortDispatchId(group.dispatchId)}
                        </span>
                        {dispatch?.status ? (
                          <span className="rounded bg-white/[0.05] px-1 py-px text-[10px] text-white/45">
                            {dispatch.status}
                          </span>
                        ) : null}
                        {dispatchAgent ? (
                          <span className="rounded bg-white/[0.05] px-1 py-px text-[10px] text-white/45">
                            {dispatchAgent.emoji ? `${dispatchAgent.emoji} ` : ''}
                            {dispatchAgent.name}
                          </span>
                        ) : null}
                        <span className="ml-auto text-[10px] text-white/35">
                          <RelativeTime timestamp={headerTimestamp} />
                        </span>
                      </div>

                      <div className="mt-2 space-y-1.5 border-l border-white/10 pl-2">
                        {group.events.map((event) => (
                          <div key={event.id} className="flex flex-wrap items-start gap-2">
                            <span
                              className={`rounded px-1 py-px text-[10px] ${event.badgeClassName}`}
                            >
                              {event.badge}
                            </span>
                            <span className="text-[11px] text-white/75">{event.title}</span>
                            <span className="ml-auto text-[10px] text-white/35">
                              <RelativeTime timestamp={event.timestamp} />
                            </span>
                            {event.detail ? (
                              <div className="w-full pl-0.5 text-[11px] text-white/50">
                                {event.detail}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}

                {unassignedEvents.length > 0 && (
                  <div className="rounded border border-dashed border-white/10 bg-white/[0.01] p-2">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-white/[0.08] px-1.5 py-0.5 text-[10px] text-white/60">
                        Unassigned
                      </span>
                      <span className="text-[10px] text-white/40">
                        Events without dispatch linkage
                      </span>
                    </div>
                    <div className="mt-2 space-y-1.5 border-l border-white/10 pl-2">
                      {unassignedEvents.map((event) => (
                        <div key={event.id} className="flex flex-wrap items-start gap-2">
                          <span
                            className={`rounded px-1 py-px text-[10px] ${event.badgeClassName}`}
                          >
                            {event.badge}
                          </span>
                          <span className="text-[11px] text-white/75">{event.title}</span>
                          <span className="ml-auto text-[10px] text-white/35">
                            <RelativeTime timestamp={event.timestamp} />
                          </span>
                          {event.detail ? (
                            <div className="w-full pl-0.5 text-[11px] text-white/50">
                              {event.detail}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
