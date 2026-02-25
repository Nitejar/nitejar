import type Anthropic from '@anthropic-ai/sdk'
import type OpenAI from 'openai'
import {
  findAgentById,
  findWorkItemById,
  createJob,
  updateJob,
  startJob,
  completeJob,
  failJob,
  cancelJob,
  appendMessage,
  markLastAssistantAsFinalResponse,
  insertExternalApiCall,
  checkLimits,
  getPluginInstancesForAgent,
  listMessagesByJob,
  listMessagesBySession,
  listChannelThreadSummaries,
  listActiveWorkSnapshotsForAgent,
  type Agent,
  type Message,
  type WorkItem,
  type Job,
} from '@nitejar/database'
import {
  ensureSprite,
  getSpriteName,
  getSpritesTokenSettings,
  isSpritesExecutionAvailable,
  SpriteSessionManager,
  type ISpriteSession,
} from '@nitejar/sprites'
import { executeTool, type ToolContext, type SkillEntry, type ExternalApiCost } from './tools'
import { resolveSkillsForAgent, type ResolvedSkill } from './skill-resolver'
import type { ToolHandler } from './tools/types'
// Import channel providers so they self-register.
import './integrations/github'
import './integrations/telegram'
import './integrations/slack'
import {
  scanDirectoryContext,
  formatContextInjection,
  loadSpriteEnvironmentContext,
} from './context-loader'
import {
  buildSystemPrompt,
  buildUserMessage,
  buildPostProcessingPrompt,
  getModelConfig,
  getRequesterLabel,
  type TeamContext,
} from './prompt-builder'
import {
  resolveIntegrationProviders,
  getProviderForSource,
  extractIntegrationTools,
  CriticalContextError,
  type IntegrationProvider,
} from './integrations/registry'
import { parseAgentConfig, getEditToolMode, getSessionSettings } from './config'
import { ensureHomeSandboxForAgent, touchSandboxByName } from './sandboxes'
import { toSpriteNetworkPolicy } from './network-policy'
import {
  buildSessionContext,
  formatSessionMessages,
  dedupeRelayEchoDecision,
  normalizeRelayToHandle,
} from './session'
import { logPrompt } from './prompt-log'
import { agentLog, agentWarn, agentError } from './agent-logger'
import {
  MAX_TOOL_RESULT_CHARS,
  MAX_MODEL_INPUT_CHARS,
  truncateWithNotice,
  buildToolResultContent,
  prepareMessagesForModel,
  stripImageInputs,
} from './message-utils'
import {
  getClient,
  getOpenAITools,
  isLikelyImageInputUnsupportedError,
  isLikelyToolUseUnsupportedError,
  withProviderRetry,
  openRouterTrace,
} from './model-client'
import { buildUserMessageForModel, safeParsePayload } from './telegram-attachments'
import { sanitize, sanitizeLabel } from './prompt-sanitize'
import { isTavilyAvailable } from './web-search'
import { isImageGenAvailable, isSTTAvailable, isTTSAvailable } from './media-settings'
import { BackgroundTaskManager, type BackgroundTaskEvent } from './background-task-manager'
import { triageWorkItem, type TriageContext } from './triage'
import { buildChannelPrelude, CHANNEL_PRELUDE_MAX_MESSAGES } from './channel-prelude'
import { getSkippedFunctionToolCalls } from './steer-tool-batch'
import {
  recordStartingActivity,
  recordCompletedActivity,
  recordFailedActivity,
  recordPassActivity,
  getRelevantActivity,
} from './activity-log'
import { recordInferenceCallReceipt, type InferenceAttemptKind } from './model-call-receipts'

import { startSpan, endSpan, failSpan, type SpanContext } from './tracing'

/**
 * Event types emitted during agent execution
 */
export type AgentEvent =
  | { type: 'job_started'; jobId: string }
  | { type: 'thinking'; content: string }
  | { type: 'tool_use'; toolName: string; input: unknown }
  | { type: 'tool_result'; toolName: string; result: unknown }
  | { type: 'triage'; shouldRespond: boolean; reason: string; exclusiveClaim: boolean }
  | BackgroundTaskEvent
  | { type: 'message'; role: 'assistant'; content: string }
  | { type: 'job_completed'; jobId: string }
  | { type: 'job_failed'; jobId: string; error: string }

/**
 * Callback for streaming agent events
 */
export type AgentEventCallback = (event: AgentEvent) => void

/**
 * Options for running an agent on a work item
 */
/** Response mode for channel providers: 'streaming' posts intermediate updates, 'final' waits and posts once. */
export type ResponseMode = 'streaming' | 'final'

/** Steering message injected mid-run */
export interface SteeringMessage {
  text: string
  senderName: string
}

export interface RunOptions {
  /** Maximum number of tool-use turns (default: 500) */
  maxTurns?: number
  /** Callback for streaming events */
  onEvent?: AgentEventCallback
  /** System prompt override */
  systemPrompt?: string
  /** Override the user message text (used for coalesced queued messages) */
  coalescedText?: string
  /** Resume context from a prior job when replaying a failed run */
  resumeFromJobId?: string
  /** Team context for multi-agent awareness (triage + system prompt) */
  teamContext?: TeamContext
  /** Skip triage classification and proceed directly to inference loop. */
  skipTriage?: boolean
  /** Response mode: 'final' triggers post-processing of the raw assistant output */
  responseMode?: ResponseMode
  /** Cooperative run-control callback used by durable runtime workers */
  getRunControl?: () => Promise<'continue' | 'pause' | 'cancel'>
  /** Extended run-control that can return a steer directive with pending messages */
  getRunControlDirective?: () => Promise<
    | { action: 'continue' }
    | { action: 'pause' }
    | { action: 'cancel' }
    | { action: 'steer'; messages: SteeringMessage[] }
  >
  /** Called when steering messages are consumed, returning the messages to inject */
  onSteered?: () => Promise<SteeringMessage[]>
  /** Called when the run transitions into paused state */
  onPaused?: () => Promise<void> | void
  /** Called when a paused run resumes */
  onResumed?: () => Promise<void> | void
  /** Called right before cancellation is raised */
  onCancelled?: () => Promise<void> | void
  /**
   * Hook dispatch callback injected by the app layer.
   * Fires plugin hooks at key points in the agent run without requiring
   * a direct dependency on @nitejar/plugin-runtime.
   */
  hookDispatch?: <TData>(
    hookName: string,
    context: { workItemId: string; jobId: string; agentId: string },
    data: TData
  ) => Promise<{ data: TData; blocked: boolean }>
}

/**
 * Result of running an agent
 */
export interface RunResult {
  job: Job
  finalResponse: string | null
  /** True if the agent hit the max turns limit */
  hitLimit?: boolean
}

/**
 * Run an agent on a work item
 */
export async function runAgent(
  agentId: string,
  workItemId: string,
  options?: RunOptions
): Promise<RunResult> {
  const maxTurns = options?.maxTurns ?? 500
  const onEvent = options?.onEvent ?? (() => {})

  // Load agent and work item
  const agent = await findAgentById(agentId)
  if (!agent) {
    throw new Error(`Agent not found: ${agentId}`)
  }

  const workItem = await findWorkItemById(workItemId)
  if (!workItem) {
    throw new Error(`Work item not found: ${workItemId}`)
  }
  const agentConfig = parseAgentConfig(agent.config)

  // Ensure agent has a sprite when Sprites tool execution is available.
  let homeSpriteName: string | null = null
  let agentWithSprite = agent
  let sessionManager: SpriteSessionManager | null = null
  const spriteSettings = await getSpritesTokenSettings()

  if (isSpritesExecutionAvailable(spriteSettings)) {
    agentWithSprite = await ensureSprite(agent, {
      ...(agentConfig.networkPolicy
        ? { networkPolicy: toSpriteNetworkPolicy(agentConfig.networkPolicy) }
        : {}),
    })
    homeSpriteName = agentWithSprite.sprite_id || getSpriteName(agentWithSprite)
    sessionManager = new SpriteSessionManager()

    // Ensure home sandbox row exists and touch it
    await ensureHomeSandboxForAgent(agentWithSprite)
    await touchSandboxByName(agentWithSprite.id, 'home')
    agentLog('Sprites tool execution enabled', {
      tokenSource: spriteSettings.source,
    })
  } else {
    if (!spriteSettings.enabled) {
      agentWarn('Tool execution disabled in Settings > Capabilities.')
    } else {
      agentWarn('Sprites token not configured. Add it in Settings > Capabilities > Tool Execution.')
    }
  }

  // Active sandbox tracking: starts on "home", updated when agent switches sandboxes
  const activeSandboxName: string = 'home'
  const activeSpriteName: string | null = homeSpriteName

  // Create job
  const job = await createJob({
    work_item_id: workItemId,
    agent_id: agentId,
    status: 'PENDING',
  })
  const backgroundTaskManager = homeSpriteName
    ? new BackgroundTaskManager(job.id, agentId, homeSpriteName, onEvent)
    : null

  onEvent({ type: 'job_started', jobId: job.id })

  const spanCtx: SpanContext = { traceId: job.id, jobId: job.id, agentId: agentId }
  const parsedConfig = parseAgentConfig(agentWithSprite.config)
  const jobSpan = await startSpan(spanCtx, 'job', 'lifecycle', null, {
    work_item_id: workItemId,
    model: parsedConfig.model ?? 'default',
    max_turns: maxTurns,
  })

  // Resolve plugin-instance-specific tools and context providers for this agent.
  const agentPluginInstances = await getPluginInstancesForAgent(agentId)
  const enabledIntegrationTypes = agentPluginInstances
    .filter((i) => i.enabled === 1)
    .map((i) => i.type)
  const integrationProviders = resolveIntegrationProviders(enabledIntegrationTypes)
  const integrationTools = extractIntegrationTools(integrationProviders)
  const sourceProvider = getProviderForSource(workItem.source)

  let activityLogId: string | null = null

  try {
    // Start job
    await startJob(job.id)

    // Triage incoming work (lightweight model call to classify intent), unless caller opts out.
    let activityContext: string | undefined
    let channelPrelude: string | undefined
    const triageSpan = await startSpan(spanCtx, 'triage', 'lifecycle', jobSpan?.id ?? null)
    if (options?.skipTriage) {
      onEvent({
        type: 'triage',
        shouldRespond: true,
        reason: 'Triage skipped by dispatch policy',
        exclusiveClaim: false,
      })
      await endSpan(triageSpan, { skipped: true, reason: 'dispatch_skip' })
    } else {
      try {
        // Build lightweight context for triage: agent identity + recent session history
        const triageCtx = await buildTriageContext(agentWithSprite, workItem, job.id)
        // Inject team context from dispatch layer if available (format as string for triage)
        if (options?.teamContext) {
          const teamLines: string[] = []
          if (options.teamContext.teammates.length > 0) {
            teamLines.push(
              ...options.teamContext.teammates.map(
                (t) => `@${sanitize(t.handle)} (${sanitize(t.name)}) — ${sanitize(t.status)}`
              )
            )
          }
          if (options.teamContext.dispatchInfo) {
            teamLines.push(options.teamContext.dispatchInfo)
          }
          if (teamLines.length > 0) {
            triageCtx.teamContext = teamLines.join('\n')
          }
        }
        channelPrelude = triageCtx.channelPrelude
        const triage = await triageWorkItem(
          agentWithSprite,
          workItem,
          options?.coalescedText,
          triageCtx
        )
        onEvent({
          type: 'triage',
          shouldRespond: triage.shouldRespond,
          reason: triage.reason,
          exclusiveClaim: triage.exclusiveClaim === true,
        })

        // Track triage inference cost
        if (triage.usage) {
          try {
            await recordInferenceCallReceipt(
              {
                jobId: job.id,
                agentId,
                turn: 0, // triage is pre-loop
                model: triage.usage.model,
                promptTokens: triage.usage.promptTokens,
                completionTokens: triage.usage.completionTokens,
                totalTokens: triage.usage.totalTokens,
                costUsd: triage.usage.costUsd,
                finishReason: 'stop',
                isFallback: false,
                durationMs: triage.usage.durationMs,
                attemptKind: 'triage',
                attemptIndex: 0,
                modelSpanId: triageSpan?.id ?? null,
                requestPayload: triage.requestPayload,
                responsePayload: triage.responsePayload,
              },
              { warn: agentWarn }
            )
          } catch (costError) {
            agentWarn('Failed to log triage inference cost', {
              error: costError instanceof Error ? costError.message : String(costError),
            })
          }
        }

        // If the agent decided to pass, record it and short-circuit
        if (!triage.shouldRespond) {
          agentLog('Agent passed on work item', {
            agentId,
            workItemId,
            reason: triage.reason,
          })
          await recordPassActivity(agentWithSprite, job, workItem, triage)
          await completeJob(job.id)
          onEvent({ type: 'job_completed', jobId: job.id })
          await endSpan(triageSpan, {
            is_read_only: triage.isReadOnly,
            should_respond: false,
            reason: triage.reason,
            reason_auto_derived: triage.reasonAutoDerived,
            model: triage.usage?.model,
          })
          await endSpan(jobSpan, { passed: true })
          const updatedJob = await updateJob(job.id, {})
          return { job: updatedJob || job, finalResponse: null }
        }

        activityLogId = await recordStartingActivity(agentWithSprite, job, workItem, triage)
        if (!triage.isReadOnly) {
          const relevant = await getRelevantActivity(triage)
          if (relevant) {
            activityContext = relevant
          }
        }
        await endSpan(triageSpan, {
          is_read_only: triage.isReadOnly,
          should_respond: true,
          reason: triage.reason,
          reason_auto_derived: triage.reasonAutoDerived,
          resource_count: triage.resources.length,
          has_activity_context: !!activityContext,
          model: triage.usage?.model,
          prompt_tokens: triage.usage?.promptTokens,
          completion_tokens: triage.usage?.completionTokens,
        })
      } catch (triageError) {
        agentWarn('Triage/activity log hook failed, proceeding without', {
          error: triageError instanceof Error ? triageError.message : String(triageError),
        })
        await failSpan(triageSpan, triageError)
      }
    }

    // Run inference loop
    const {
      finalResponse: rawFinalResponse,
      hitLimit,
      messages: conversationMessages,
      currentRunStartIndex,
    } = await runInferenceLoop(
      agentWithSprite,
      workItem,
      job,
      homeSpriteName,
      maxTurns,
      onEvent,
      options?.systemPrompt,
      sessionManager,
      backgroundTaskManager,
      undefined,
      options?.coalescedText,
      options?.resumeFromJobId,
      spanCtx,
      jobSpan?.id ?? null,
      integrationTools,
      activeSandboxName,
      activeSpriteName,
      activityContext,
      options?.teamContext ?? undefined,
      options?.getRunControl,
      options?.onPaused,
      options?.onResumed,
      options?.onCancelled,
      options?.getRunControlDirective,
      options?.onSteered,
      integrationProviders,
      sourceProvider,
      options?.hookDispatch,
      channelPrelude
    )

    // Post-process final response for final-mode channel providers.
    let finalResponse = rawFinalResponse
    const responseMode = options?.responseMode ?? 'streaming'
    if (responseMode === 'final' && rawFinalResponse) {
      // Only pass current run's messages — exclude session history so the
      // post-processing model doesn't rehash content from previous responses.
      const currentRunMessages = conversationMessages.slice(currentRunStartIndex)

      // If the agent produced a single text response with no tool use, the raw
      // response is already clean prose — skip the post-processing LLM call.
      const singleCleanResponse = shouldSkipFinalModePostProcessing(currentRunMessages, hitLimit)

      if (singleCleanResponse) {
        agentLog('Skipping post-processing — single assistant message, no tool use')
        const persisted = await persistFinalModeResponseIfNeeded({
          responseMode,
          jobId: job.id,
          rawFinalResponse,
          currentRunMessages,
          hitLimit,
          skipPostProcessing: true,
        })
        finalResponse = persisted.finalResponse
        // Record a span so the trace shows post-processing was evaluated but skipped
        const skipSpan = spanCtx
          ? await startSpan(spanCtx, 'post_process', 'inference', jobSpan?.id ?? null)
          : null
        await endSpan(skipSpan, {
          skipped: true,
          reason: 'single_clean_response',
          raw_length: rawFinalResponse.length,
          processed_length: rawFinalResponse.length,
          inference_call: false,
          cost_usd: 0,
        })
      } else {
        const ppSpan = spanCtx
          ? await startSpan(spanCtx, 'post_process', 'inference', jobSpan?.id ?? null)
          : null
        try {
          agentLog('Post-processing final response for final-mode channel provider')
          const ppStart = Date.now()
          const requesterLabel = getRequesterLabel(workItem)
          const ppResult = await postProcessFinalResponse(agentWithSprite, currentRunMessages, {
            hitLimit,
            requesterLabel,
          })
          const persisted = await persistFinalModeResponseIfNeeded({
            responseMode,
            jobId: job.id,
            rawFinalResponse,
            processedFinalResponse: ppResult.response,
            currentRunMessages,
            hitLimit,
            skipPostProcessing: false,
          })
          finalResponse = persisted.finalResponse ?? ppResult.response

          // Track inference cost
          if (ppResult.usage) {
            try {
              await recordInferenceCallReceipt(
                {
                  jobId: job.id,
                  agentId,
                  turn: 0, // post-processing is post-loop
                  model: ppResult.usage.model,
                  promptTokens: ppResult.usage.promptTokens,
                  completionTokens: ppResult.usage.completionTokens,
                  totalTokens: ppResult.usage.totalTokens,
                  costUsd: ppResult.usage.costUsd,
                  finishReason: 'stop',
                  isFallback: false,
                  durationMs: Date.now() - ppStart,
                  attemptKind: 'post_process',
                  attemptIndex: 0,
                  modelSpanId: ppSpan?.id ?? null,
                  requestPayload: ppResult.requestPayload,
                  responsePayload: ppResult.responsePayload,
                },
                { warn: agentWarn }
              )
            } catch (costError) {
              agentWarn('Failed to log post-processing inference cost', {
                error: costError instanceof Error ? costError.message : String(costError),
              })
            }
          }

          agentLog('Post-processing complete', {
            rawLength: rawFinalResponse.length,
            processedLength: finalResponse.length,
            durationMs: Date.now() - ppStart,
          })
          await endSpan(ppSpan, {
            skipped: false,
            raw_length: rawFinalResponse.length,
            processed_length: finalResponse.length,
            inference_call: true,
            cost_usd: ppResult.usage?.costUsd ?? null,
          })
        } catch (ppError) {
          agentError('Post-processing failed', ppError)
          await failSpan(ppSpan, ppError)
          // Post-processing failure is fatal for final-mode — the raw response
          // won't make sense to the user (it's thinking-out-loud narration).
          await failJob(job.id, ppError instanceof Error ? ppError.message : String(ppError))
          throw ppError
        }
      }
    }

    if (backgroundTaskManager) {
      try {
        await backgroundTaskManager.cleanupRunTasks()
      } catch (cleanupError) {
        agentWarn('Failed to cleanup run-scoped background tasks on completion', {
          jobId: job.id,
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        })
      }
    }

    // Complete job
    await completeJob(job.id)
    try {
      const completionSummary = finalResponse ? finalResponse.slice(0, 300) : workItem.title
      await recordCompletedActivity(activityLogId, completionSummary)
    } catch (activityError) {
      agentWarn('Failed to record completed activity', {
        error: activityError instanceof Error ? activityError.message : String(activityError),
      })
    }
    onEvent({ type: 'job_completed', jobId: job.id })
    await endSpan(jobSpan, { hit_limit: hitLimit })

    const updatedJob = await updateJob(job.id, {})
    return { job: updatedJob || job, finalResponse, hitLimit }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const isCancelled = errorMessage.includes('__RUN_CANCELLED__')
    const userFacingError = isCancelled ? 'Run cancelled by operator.' : errorMessage
    const assistantFailureMessage = [
      isCancelled
        ? 'This run was cancelled by an operator before completion.'
        : 'I hit an internal error and could not complete this request.',
      '',
      `Error: ${userFacingError}`,
    ].join('\n')

    if (backgroundTaskManager) {
      try {
        await backgroundTaskManager.cleanupRunTasks()
      } catch (cleanupError) {
        agentWarn('Failed to cleanup run-scoped background tasks after failure', {
          jobId: job.id,
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        })
      }
    }

    try {
      await appendMessage(job.id, 'assistant', { text: assistantFailureMessage })
    } catch (appendError) {
      agentWarn('Failed to persist assistant failure message', {
        jobId: job.id,
        error: appendError instanceof Error ? appendError.message : String(appendError),
      })
    }
    if (isCancelled) {
      await cancelJob(job.id, 'Cancelled by operator')
    } else {
      await failJob(job.id, errorMessage)
    }
    try {
      await recordFailedActivity(activityLogId)
    } catch (activityError) {
      agentWarn('Failed to record failed activity', {
        error: activityError instanceof Error ? activityError.message : String(activityError),
      })
    }
    if (isCancelled) {
      onEvent({ type: 'job_failed', jobId: job.id, error: 'Cancelled by operator' })
      await failSpan(jobSpan, 'Cancelled by operator')
    } else {
      onEvent({ type: 'job_failed', jobId: job.id, error: errorMessage })
      await failSpan(jobSpan, errorMessage)
    }
    throw error
  }
  // Note: We no longer clean up sprite sessions when a job ends.
  // Sprite sessions are per-conversation (session_key + agent_id), not per-job.
  // Cleanup happens during conversation compaction or reset.
}

/**
 * Run the inference loop
 */
async function runInferenceLoop(
  agent: Agent,
  workItem: WorkItem,
  job: Job,
  spriteName: string | null,
  maxTurns: number,
  onEvent: AgentEventCallback,
  systemPromptOverride?: string,
  sessionManager?: SpriteSessionManager | null,
  backgroundTaskManager?: BackgroundTaskManager | null,
  onSessionCreated?: (session: ISpriteSession) => void,
  coalescedText?: string,
  resumeFromJobId?: string,
  spanCtx?: SpanContext,
  jobSpanId?: string | null,
  integrationTools?: { definitions: Anthropic.Tool[]; handlers: Record<string, ToolHandler> },
  initialActiveSandboxName?: string,
  initialActiveSpriteName?: string | null,
  activityContext?: string,
  teamContext?: TeamContext,
  getRunControl?: () => Promise<'continue' | 'pause' | 'cancel'>,
  onPaused?: () => Promise<void> | void,
  onResumed?: () => Promise<void> | void,
  onCancelled?: () => Promise<void> | void,
  getRunControlDirective?: RunOptions['getRunControlDirective'],
  onSteered?: RunOptions['onSteered'],
  integrationProviders?: IntegrationProvider[],
  sourceProvider?: IntegrationProvider,
  hookDispatch?: RunOptions['hookDispatch'],
  channelPrelude?: string
): Promise<{
  finalResponse: string | null
  hitLimit: boolean
  messages: OpenAI.ChatCompletionMessageParam[]
  /** Index into messages[] where the current run's messages start (after session history) */
  currentRunStartIndex: number
}> {
  const client = await getClient()
  const config = parseAgentConfig(agent.config)
  const modelConfig = getModelConfig(config)
  const editToolMode = getEditToolMode(config)
  const sessionSettings = getSessionSettings(config)

  // Declare resolvedDbSkills early so it can be passed to buildSystemPrompt.
  // The actual resolution happens later (after discovered skills are loaded),
  // but the prompt builder handles an empty array gracefully.
  let resolvedDbSkills: ResolvedSkill[] = []

  // Build system prompt (async - retrieves memories, injects activity + team context)
  const systemPrompt =
    systemPromptOverride ||
    (await buildSystemPrompt(agent, workItem, {
      activityContext,
      teamContext,
      channelPrelude,
      contextProviders: integrationProviders,
      resolvedDbSkills,
    }))

  // Build initial user message (coalescedText overrides when multiple messages were queued)
  let userMessage = coalescedText ? sanitize(coalescedText) : buildUserMessage(workItem)

  // Normalize display-name relay messages (e.g. "[🫠 Slopper] 5") to canonical handle
  // format (e.g. "[@nitejar-dev]: 5") so the current inbound matches session history.
  if (teamContext?.teammates) {
    const nameToHandle = new Map<string, string>()
    for (const t of teamContext.teammates) {
      nameToHandle.set(t.name.toLowerCase(), t.handle)
    }
    // Also include the current agent so self-relay is normalized
    nameToHandle.set(agent.name.toLowerCase(), agent.handle)
    userMessage = normalizeRelayToHandle(userMessage, nameToHandle)
  }

  // Hook 3: run.pre_prompt — allows plugins to inject context or transform messages
  let effectiveSystemPrompt = systemPrompt
  if (hookDispatch) {
    try {
      const hookResult = await hookDispatch(
        'run.pre_prompt',
        {
          workItemId: workItem.id,
          jobId: job.id,
          agentId: agent.id,
        },
        {
          systemPrompt,
          userMessage,
          agentId: agent.id,
          workItemId: workItem.id,
        }
      )
      if (hookResult.data.systemPrompt && hookResult.data.systemPrompt !== systemPrompt) {
        effectiveSystemPrompt = String(hookResult.data.systemPrompt)
      }
      if (hookResult.data.userMessage && hookResult.data.userMessage !== userMessage) {
        userMessage = String(hookResult.data.userMessage)
      }
    } catch {
      // Hook failure is non-fatal
    }
  }

  // Always go through buildUserMessageForModel so image attachments are included
  const userModelMessage = await buildUserMessageForModel(workItem, userMessage)
  const retrySeed = resumeFromJobId
    ? await buildRetrySeedFromJob(resumeFromJobId, userMessage)
    : null

  // Load session context (conversation history from same session_key)
  const sessionContext = await buildSessionContext(
    workItem.session_key,
    job.id,
    agent.id,
    sessionSettings,
    workItem.created_at
  )

  // Store initial messages
  // Persist multimodal content (with image data URLs) so session replay includes images
  await appendMessage(job.id, 'system', { text: effectiveSystemPrompt })
  await appendMessage(
    job.id,
    'user',
    Array.isArray(userModelMessage.content)
      ? { text: userMessage, content_parts: userModelMessage.content }
      : { text: userMessage }
  )

  // Preamble injection via source context provider (e.g. GitHub issue/PR context)
  let issuePreamble: OpenAI.ChatCompletionMessageParam | null = null
  if (sourceProvider?.getPreambleMessage) {
    try {
      issuePreamble = sourceProvider.getPreambleMessage(workItem)
      if (issuePreamble && typeof issuePreamble.content === 'string') {
        const preambleLabel = sourceProvider.getPreambleLabel?.(workItem) ?? 'preamble'
        await appendMessage(job.id, 'system', {
          text: `[${preambleLabel} context injected — ${issuePreamble.content.length} chars]`,
        })
      }
    } catch (error) {
      if (error instanceof CriticalContextError) throw error
      agentWarn('Source context provider getPreambleMessage failed, skipping preamble', {
        source: sourceProvider.integrationType,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // Initialize conversation (OpenAI format)
  // Order: system prompt, [issue preamble], session history, current user message
  const sessionMessages = formatSessionMessages(sessionContext)

  // Dedupe relay echo at the session-history → current-message boundary.
  // Session history may end with e.g. `[@pixel]: 1` while current inbound is
  // `[🎨 Pixel] 1` — same payload, different relay format. Always keep the
  // current inbound (it's the trigger for this run) and drop the session tail.
  const lastSessionMsg = sessionMessages[sessionMessages.length - 1]
  const boundaryDecision = lastSessionMsg
    ? dedupeRelayEchoDecision(lastSessionMsg, userModelMessage)
    : 'keep-both'
  const effectiveSessionMessages =
    boundaryDecision !== 'keep-both' ? sessionMessages.slice(0, -1) : sessionMessages

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: effectiveSystemPrompt },
    ...(issuePreamble ? [issuePreamble] : []),
    ...effectiveSessionMessages, // Inject past conversation
    userModelMessage,
    ...(retrySeed?.promptMessages ?? []),
  ]
  // Track where this run's messages start (after system + preamble + session history)
  // so post-processing can exclude session history and only synthesize current work.
  const currentRunStartIndex = messages.length - 1 // the userModelMessage

  if (retrySeed && retrySeed.promptMessages.length > 0) {
    await appendMessage(job.id, 'system', {
      text: `[Retry seed injected from job ${retrySeed.sourceJobId}: ${retrySeed.promptMessages.length} prompt message(s), dropped incomplete trailing turn=${retrySeed.droppedIncompleteTrailingTurn}, skipped initial duplicate user message=${retrySeed.skippedInitialDuplicateUser}]`,
    })
  }

  // Tool context for execution (only if we have a sprite)
  // Session is created lazily on first bash tool call
  let session: ISpriteSession | null = null
  let nextSessionCreateRetryAt = 0

  // CWD tracking and context injection state
  let trackedCwd = '/home/sprite'
  let lastScannedCwd: string | null = null
  let pendingContextInjection: string | null = null
  let discoveredSkills: SkillEntry[] = []
  let pendingSessionRecoveryReceipt = false
  let pendingRecoveryRequestedCwd: string | null = null

  // Sandbox tracking (mutable during the loop when agent switches sandboxes)
  let activeSandboxName = initialActiveSandboxName ?? 'home'
  let activeSpriteName = initialActiveSpriteName ?? spriteName

  // Inject sprite environment docs (OS, HTTP routing, services, checkpoints, network policy)
  // from the VM's built-in documentation at /.sprite/
  if (activeSpriteName) {
    try {
      const spriteEnvContext = await loadSpriteEnvironmentContext(
        activeSpriteName,
        session ?? undefined
      )
      if (spriteEnvContext) {
        messages.push({ role: 'system', content: sanitize(spriteEnvContext) })
        await appendMessage(job.id, 'system', {
          text: `[Sprite environment context injected — ${spriteEnvContext.length} chars from /.sprite/ docs]`,
        })
        agentLog('Injected sprite environment context', {
          chars: spriteEnvContext.length,
        })
      }
    } catch (error) {
      agentWarn('Failed to load sprite environment context', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // Directory context preload via source context provider (e.g. GitHub repo path).
  // Providers suggest a CWD; if present, scan for AGENTS.md, skills, etc.
  if (activeSpriteName && sourceProvider?.getDirectoryContextHint) {
    let dirCwdHint: string | null = null
    try {
      dirCwdHint = sourceProvider.getDirectoryContextHint(workItem)
    } catch (error) {
      if (error instanceof CriticalContextError) throw error
      agentWarn('Source context provider getDirectoryContextHint failed', {
        source: sourceProvider.integrationType,
        error: error instanceof Error ? error.message : String(error),
      })
    }
    if (dirCwdHint) {
      try {
        const dirContext = await scanDirectoryContext(
          activeSpriteName,
          dirCwdHint,
          session ?? undefined
        )
        discoveredSkills = dirContext.skills
        const injection = formatContextInjection(dirContext)
        if (injection) {
          messages.push({ role: 'system', content: injection })
          await appendMessage(job.id, 'system', {
            text: `[Directory context injected for ${dirCwdHint} — ${injection.length} chars, ${dirContext.skills.length} skills]`,
          })
        }
        agentLog('Preloaded directory context from provider', {
          source: sourceProvider.integrationType,
          cwd: dirCwdHint,
          skillCount: dirContext.skills.length,
          hasInstructions: Boolean(dirContext.instructions),
        })
      } catch (error) {
        agentWarn('Failed to preload directory context from provider hint', {
          source: sourceProvider.integrationType,
          cwd: dirCwdHint,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  // Resolve DB/plugin skills once at run start
  try {
    resolvedDbSkills = await resolveSkillsForAgent(
      agent.id,
      undefined, // teamId resolved inside the resolver via assignments
      discoveredSkills.length > 0 ? discoveredSkills : undefined
    )
    agentLog('Resolved DB skills for agent', { count: resolvedDbSkills.length })
  } catch (error) {
    agentWarn('Failed to resolve DB skills', {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  const getToolContext = async (): Promise<ToolContext | null> => {
    agentLog('getToolContext called', {
      spriteName: activeSpriteName,
      activeSandboxName,
      hasSession: !!session,
      hasSessionManager: !!sessionManager,
    })
    if (!activeSpriteName) {
      agentLog('No activeSpriteName, returning integration-only tool context')
      const parsedPayload = safeParsePayload(workItem.payload)
      return {
        spriteName: 'integration-only',
        cwd: trackedCwd,
        session: undefined,
        agentId: agent.id,
        jobId: job.id,
        sessionKey: workItem.session_key,
        discoveredSkills,
        resolvedDbSkills,
        pluginInstanceId: workItem.plugin_instance_id ?? undefined,
        responseContext: extractResponseContext(workItem),
        attachments: parsedPayload?.attachments,
        editToolMode,
        backgroundTaskManager: backgroundTaskManager ?? undefined,
        activeSandboxName,
      }
    }

    // Lazily create session on first tool call
    // Session is per-conversation (session_key + agent_id), not per-job
    if (!session && sessionManager) {
      if (Date.now() < nextSessionCreateRetryAt) {
        const parsedPayload = safeParsePayload(workItem.payload)
        return {
          spriteName: activeSpriteName,
          cwd: trackedCwd,
          session: undefined,
          agentId: agent.id,
          jobId: job.id,
          sessionKey: workItem.session_key,
          discoveredSkills,
          resolvedDbSkills,
          pluginInstanceId: workItem.plugin_instance_id ?? undefined,
          responseContext: extractResponseContext(workItem),
          attachments: parsedPayload?.attachments,
          editToolMode,
          backgroundTaskManager: backgroundTaskManager ?? undefined,
          activeSandboxName,
        }
      }
      agentLog('Resolving sprite tool session for conversation', {
        sessionKey: workItem.session_key,
        agentId: agent.id,
        spriteName: activeSpriteName,
      })
      try {
        const requestedCwd = trackedCwd || '/home/sprite'
        let resolvedSession: { session: ISpriteSession; reused: boolean }
        let usedCwdFallback = false

        try {
          resolvedSession = await sessionManager.getOrCreateSessionWithMeta(
            activeSpriteName,
            workItem.session_key,
            agent.id,
            { cwd: requestedCwd }
          )
        } catch (error) {
          if (requestedCwd === '/home/sprite') {
            throw error
          }

          agentWarn('Failed to create session at tracked cwd, retrying with /home/sprite', {
            requestedCwd,
            error: error instanceof Error ? error.message : String(error),
          })
          resolvedSession = await sessionManager.getOrCreateSessionWithMeta(
            activeSpriteName,
            workItem.session_key,
            agent.id,
            { cwd: '/home/sprite' }
          )
          usedCwdFallback = true
          trackedCwd = '/home/sprite'
        }

        session = resolvedSession.session
        agentLog('Sprite tool session ready', {
          kind: 'sprite_tool_session',
          action: resolvedSession.reused ? 'reused' : 'created',
          conversationSessionKey: workItem.session_key,
          sessionId: session.sessionId,
          recordId: session.recordId,
        })
        if (onSessionCreated) {
          onSessionCreated(session)
        }

        if (pendingSessionRecoveryReceipt) {
          const previousCwd = pendingRecoveryRequestedCwd || requestedCwd
          const receiptText = usedCwdFallback
            ? `[Session recovered after timeout — previous working directory "${previousCwd}" was unavailable, started at "/home/sprite" instead. Filesystem changes were preserved; shell state was reset.]`
            : `[Session recovered after timeout — started a new shell at "${requestedCwd}". Filesystem changes were preserved; shell state was reset.]`
          try {
            await appendMessage(job.id, 'system', { text: receiptText })
          } catch (receiptError) {
            agentWarn('Failed to persist session recovery receipt', {
              error: receiptError instanceof Error ? receiptError.message : String(receiptError),
            })
          } finally {
            pendingSessionRecoveryReceipt = false
            pendingRecoveryRequestedCwd = null
          }
        }
      } catch (error) {
        agentWarn('Failed to create session, will retry shortly', {
          error: error instanceof Error ? error.message : String(error),
        })
        // Session stays null for this tool call. We keep retrying on subsequent
        // tool calls to recover from transient session creation failures.
        nextSessionCreateRetryAt = Date.now() + 2000
      }
    }

    const parsedPayload = safeParsePayload(workItem.payload)
    return {
      spriteName: activeSpriteName,
      cwd: trackedCwd,
      session: session ?? undefined,
      agentId: agent.id,
      jobId: job.id,
      sessionKey: workItem.session_key,
      discoveredSkills,
      resolvedDbSkills,
      pluginInstanceId: workItem.plugin_instance_id ?? undefined,
      responseContext: extractResponseContext(workItem),
      attachments: parsedPayload?.attachments,
      editToolMode,
      backgroundTaskManager: backgroundTaskManager ?? undefined,
      activeSandboxName,
    }
  }

  // Get tools in OpenAI format (empty if no sprite)
  const [tavilyAvailable, imageGenAvailable, sttAvailable, ttsAvailable] = await Promise.all([
    isTavilyAvailable(),
    isImageGenAvailable(),
    isSTTAvailable(),
    isTTSAvailable(),
  ])

  const baseToolsUnfiltered = spriteName
    ? getOpenAITools({
        excludeWebTools: !tavilyAvailable,
        editToolMode,
        allowEphemeralSandboxCreation: config.allowEphemeralSandboxCreation,
        allowRoutineManagement: config.allowRoutineManagement,
      })
    : []
  const baseTools = baseToolsUnfiltered.filter((tool) => {
    const name =
      tool.type === 'function' && typeof tool.function?.name === 'string' ? tool.function.name : ''
    if (name === 'generate_image') return imageGenAvailable
    if (name === 'transcribe_audio') return sttAvailable
    if (name === 'synthesize_speech') return ttsAvailable
    return true
  })

  // Append provider-specific tools.
  const integrationOpenAITools: OpenAI.ChatCompletionTool[] = (
    integrationTools?.definitions ?? []
  ).map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }))
  const tools = [...baseTools, ...integrationOpenAITools]
  const integrationHandlers = integrationTools?.handlers
  let toolsEnabled = tools.length > 0

  // Log the full prompt if DEBUG_PROMPTS is enabled
  logPrompt({
    timestamp: new Date().toISOString(),
    jobId: job.id,
    workItemId: workItem.id,
    agentId: agent.id,
    sessionKey: workItem.session_key,
    model: modelConfig.model,
    temperature: modelConfig.temperature,
    maxTokens: modelConfig.maxTokens,
    messages,
    tools: tools.length > 0 ? tools : undefined,
    sessionTurnsLoaded: sessionContext.turnGroups.length,
  })

  let finalResponse: string | null = null
  let turns = 0
  let stoppedByCompletion = false
  let costWarned = false
  let turnLimitWarned = false
  let paused = false
  const repeatedToolErrorCounts = new Map<string, number>()

  const STEERED_MARKER = '__RUN_STEERED__'
  const STEER_PRIORITY_SYSTEM_NOTE =
    'A newer user message arrived while you were working. Treat the newest user message as the highest-priority instruction and adapt immediately.'
  const formatSteeringUserText = (steeringMsgs: SteeringMessage[]): string =>
    steeringMsgs
      .map((m) => `[${sanitizeLabel(m.senderName, 'User')}] ${sanitize(m.text)}`)
      .join('\n')
  const injectSteeringMessages = async (
    source: 'mid_run' | 'end_of_run' = 'mid_run'
  ): Promise<void> => {
    if (!onSteered) return

    const steeringMsgs = await onSteered()
    if (steeringMsgs.length === 0) return

    const steerText = formatSteeringUserText(steeringMsgs)
    messages.push({ role: 'system', content: STEER_PRIORITY_SYSTEM_NOTE })
    await appendMessage(job.id, 'system', {
      text: `[Steer ${source}] ${STEER_PRIORITY_SYSTEM_NOTE}`,
    })
    messages.push({ role: 'user', content: steerText })
    await appendMessage(job.id, 'user', { text: steerText })
    agentLog('Injected steering messages', { count: steeringMsgs.length, source })
  }

  const waitForRunControl = async (): Promise<void> => {
    // Use the extended directive check if available (steer-mode), fallback to simple control
    if (!getRunControlDirective && !getRunControl) return

    let blocked = true
    while (blocked) {
      if (getRunControlDirective) {
        const directive = await getRunControlDirective()
        if (directive.action === 'cancel') {
          await onCancelled?.()
          throw new Error('__RUN_CANCELLED__')
        }
        if (directive.action === 'pause') {
          if (!paused) {
            paused = true
            await onPaused?.()
          }
          await new Promise((resolve) => setTimeout(resolve, 1000))
          continue
        }
        if (paused) {
          paused = false
          await onResumed?.()
        }
        if (directive.action === 'steer') {
          // Consume the messages and throw marker for tool loop to catch
          throw new Error(STEERED_MARKER)
        }
        blocked = false
      } else if (getRunControl) {
        const state = await getRunControl()
        if (state === 'cancel') {
          await onCancelled?.()
          throw new Error('__RUN_CANCELLED__')
        }
        if (state === 'pause') {
          if (!paused) {
            paused = true
            await onPaused?.()
          }
          await new Promise((resolve) => setTimeout(resolve, 1000))
          continue
        }
        if (paused) {
          paused = false
          await onResumed?.()
        }
        blocked = false
      } else {
        blocked = false
      }
    }
  }

  const logCall = async (input: {
    response: OpenAI.ChatCompletion
    requestPayload: unknown
    isFallback: boolean
    turn: number
    startTime: number
    attemptKind: InferenceAttemptKind
    attemptIndex: number
    modelSpanId?: string | null
  }) => {
    try {
      const usage = input.response.usage
      const promptTokens = usage?.prompt_tokens ?? 0
      const completionTokens = usage?.completion_tokens ?? 0
      const totalTokens = promptTokens + completionTokens
      const actualModel = input.response.model || modelConfig.model
      const choice = input.response.choices?.[0]
      const toolCallNames =
        choice?.message?.tool_calls
          ?.filter(
            (tc): tc is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall =>
              !!tc && tc.type === 'function'
          )
          .map((tc) => tc.function.name)
          .filter(Boolean) ?? []
      const finishReason = choice?.finish_reason ?? null

      // OpenRouter extends usage with actual cost in USD
      const usageRecord = usage as Record<string, unknown> | undefined
      const openRouterCost = usageRecord?.cost
      const openRouterTotalCost = usageRecord?.total_cost
      const costUsd =
        typeof openRouterCost === 'number'
          ? openRouterCost
          : typeof openRouterTotalCost === 'number'
            ? openRouterTotalCost
            : null

      await recordInferenceCallReceipt(
        {
          jobId: job.id,
          agentId: agent.id,
          turn: input.turn,
          model: actualModel,
          promptTokens,
          completionTokens,
          totalTokens,
          costUsd,
          toolCallNames,
          finishReason,
          isFallback: input.isFallback,
          durationMs: Date.now() - input.startTime,
          attemptKind: input.attemptKind,
          attemptIndex: input.attemptIndex,
          modelSpanId: input.modelSpanId ?? null,
          requestPayload: input.requestPayload,
          responsePayload: input.response,
        },
        { warn: agentWarn }
      )
    } catch (err) {
      agentWarn('Failed to log inference call', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  agentLog('Starting inference loop', {
    model: modelConfig.model,
    maxTurns,
    toolCount: toolsEnabled ? tools.length : 0,
    availableToolCount: tools.length,
    messageCount: messages.length,
    spriteName,
    hasSessionManager: !!sessionManager,
  })

  while (turns < maxTurns) {
    try {
      await waitForRunControl()
    } catch (controlError) {
      const controlMsg = controlError instanceof Error ? controlError.message : String(controlError)
      if (controlMsg.includes(STEERED_MARKER)) {
        await injectSteeringMessages('mid_run')
        continue
      }
      throw controlError
    }
    turns++
    agentLog(`Turn ${turns}/${maxTurns}`)

    const turnSpan = spanCtx
      ? await startSpan(spanCtx, 'turn', 'lifecycle', jobSpanId ?? null, { turn_number: turns })
      : null

    // Check turn limit proximity — warn with 20 turns remaining so agent can wrap up
    const turnsRemaining = maxTurns - turns
    if (!turnLimitWarned && turnsRemaining <= 20) {
      turnLimitWarned = true
      agentWarn('Approaching turn limit', { turns, maxTurns, turnsRemaining })
      messages.push({
        role: 'system',
        content: `You have ${turnsRemaining} turns remaining before hitting your tool use limit. Wrap up your current task and provide a final response. Do not start new work.`,
      })
    }

    // Check cost limits before model call
    const limitStatus = await checkLimits(agent.id)
    if (limitStatus.exceeded) {
      agentWarn('Cost limit exceeded, stopping inference loop', {
        details: limitStatus.details,
      })
      throw new Error(`Cost limit exceeded: ${limitStatus.details}`)
    }
    if (limitStatus.warned && !costWarned) {
      costWarned = true
      agentWarn('Cost limit warning', { details: limitStatus.details })
      messages.push({
        role: 'system',
        content: `${sanitize(limitStatus.details ?? '')}. Finish your current task and wrap up efficiently.`,
      })
    }

    // Call the model
    let response
    let lastModelError: unknown
    const modelStart = Date.now()
    let attemptIndex = 0
    const preparedMessages = prepareMessagesForModel(messages)
    const activeTools = toolsEnabled ? tools : []
    const modelSpan = spanCtx
      ? await startSpan(spanCtx, 'model_call', 'inference', turnSpan?.id ?? null, {
          model: modelConfig.model,
          is_fallback: false,
        })
      : null
    try {
      if (
        preparedMessages.compactedToolMessages > 0 ||
        preparedMessages.compactedNonToolMessages > 0
      ) {
        agentWarn('Compacted prompt to fit model input limits', {
          maxChars: MAX_MODEL_INPUT_CHARS,
          initialChars: preparedMessages.initialChars,
          finalChars: preparedMessages.finalChars,
          compactedToolMessages: preparedMessages.compactedToolMessages,
          compactedNonToolMessages: preparedMessages.compactedNonToolMessages,
        })
      }

      // Hook 4: model.pre_call — allows plugins to adjust model params or block
      let effectiveModel = modelConfig.model
      let effectiveTemperature = modelConfig.temperature
      let effectiveMaxTokens = modelConfig.maxTokens
      let modelCallBlocked = false
      if (hookDispatch) {
        try {
          const hookResult = await hookDispatch(
            'model.pre_call',
            {
              workItemId: workItem.id,
              jobId: job.id,
              agentId: agent.id,
            },
            {
              model: modelConfig.model,
              temperature: modelConfig.temperature,
              maxTokens: modelConfig.maxTokens,
              turn: turns,
            }
          )
          if (hookResult.blocked) {
            modelCallBlocked = true
          } else {
            if (hookResult.data.model && typeof hookResult.data.model === 'string') {
              effectiveModel = hookResult.data.model
            }
            if (
              hookResult.data.temperature != null &&
              typeof hookResult.data.temperature === 'number'
            ) {
              effectiveTemperature = hookResult.data.temperature
            }
            if (
              hookResult.data.maxTokens != null &&
              typeof hookResult.data.maxTokens === 'number'
            ) {
              effectiveMaxTokens = hookResult.data.maxTokens
            }
          }
        } catch {
          // Hook failure is non-fatal
        }
      }
      if (modelCallBlocked) {
        agentLog('Model call blocked by plugin hook')
        await endSpan(modelSpan, { blocked_by_hook: true })
        await endSpan(turnSpan, { blocked_by_hook: true })
        break
      }

      agentLog('Calling model...', {
        model: effectiveModel,
        toolCount: activeTools.length,
        promptChars: preparedMessages.finalChars,
      })
      const primaryRequest = {
        model: effectiveModel,
        max_tokens: effectiveMaxTokens,
        temperature: effectiveTemperature,
        tools: activeTools.length > 0 ? activeTools : undefined,
        messages: preparedMessages.messages,
        ...openRouterTrace('inference', agent.handle),
      } satisfies OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming &
        Record<string, unknown>
      response = await withProviderRetry(() => client.chat.completions.create(primaryRequest), {
        label: `Turn ${turns} model call`,
      })
      agentLog('Model response received', {
        durationMs: Date.now() - modelStart,
        choiceCount: response.choices?.length,
        finishReason: response.choices?.[0]?.finish_reason,
        hasContent: !!response.choices?.[0]?.message?.content,
        hasToolCalls: !!response.choices?.[0]?.message?.tool_calls?.length,
        toolCallCount: response.choices?.[0]?.message?.tool_calls?.length ?? 0,
      })
      await logCall({
        response,
        requestPayload: primaryRequest,
        isFallback: false,
        turn: turns,
        startTime: modelStart,
        attemptKind: 'primary',
        attemptIndex,
        modelSpanId: modelSpan?.id ?? null,
      })
      await endSpan(modelSpan, {
        finish_reason: response.choices?.[0]?.finish_reason ?? null,
        prompt_tokens: response.usage?.prompt_tokens ?? 0,
        completion_tokens: response.usage?.completion_tokens ?? 0,
      })
      // Hook 5: model.post_call — observability only, no mutations
      if (hookDispatch && response) {
        try {
          await hookDispatch(
            'model.post_call',
            {
              workItemId: workItem.id,
              jobId: job.id,
              agentId: agent.id,
            },
            {
              model: effectiveModel,
              turn: turns,
              durationMs: Date.now() - modelStart,
              usage: {
                promptTokens: response.usage?.prompt_tokens ?? 0,
                completionTokens: response.usage?.completion_tokens ?? 0,
              },
            }
          )
        } catch {
          // Hook failure is non-fatal
        }
      }
    } catch (error) {
      lastModelError = error
      if (activeTools.length > 0 && isLikelyToolUseUnsupportedError(error)) {
        try {
          toolsEnabled = false
          attemptIndex += 1
          agentWarn('Model/provider rejected tool use, retrying without tools', {
            model: modelConfig.model,
          })
          const noToolsRequest = {
            model: modelConfig.model,
            max_tokens: modelConfig.maxTokens,
            temperature: modelConfig.temperature,
            messages: preparedMessages.messages,
            ...openRouterTrace('inference', agent.handle),
          } satisfies OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming &
            Record<string, unknown>
          response = await withProviderRetry(() => client.chat.completions.create(noToolsRequest), {
            label: `Turn ${turns} no-tools fallback`,
          })
          agentLog('Model response received (no-tools fallback)', {
            durationMs: Date.now() - modelStart,
            choiceCount: response.choices?.length,
            finishReason: response.choices?.[0]?.finish_reason,
            hasContent: !!response.choices?.[0]?.message?.content,
            hasToolCalls: !!response.choices?.[0]?.message?.tool_calls?.length,
            toolCallCount: response.choices?.[0]?.message?.tool_calls?.length ?? 0,
          })
          await logCall({
            response,
            requestPayload: noToolsRequest,
            isFallback: true,
            turn: turns,
            startTime: modelStart,
            attemptKind: 'no_tools_fallback',
            attemptIndex,
            modelSpanId: modelSpan?.id ?? null,
          })
          await endSpan(modelSpan, { is_fallback: true, fallback_reason: 'tool_use_unsupported' })
        } catch (fallbackError) {
          agentError('Model call failed', fallbackError, { durationMs: Date.now() - modelStart })
          await failSpan(modelSpan, fallbackError, { is_fallback: true })
          throw fallbackError
        }
      } else if (isLikelyImageInputUnsupportedError(error)) {
        try {
          const withoutImages = stripImageInputs(messages)
          const fallbackPreparedMessages = prepareMessagesForModel(withoutImages)
          const fallbackTools = toolsEnabled ? tools : []
          attemptIndex += 1
          agentWarn('Model likely does not support image input, retrying with text-only prompt', {
            model: modelConfig.model,
            toolCount: fallbackTools.length,
          })
          const imageFallbackRequest = {
            model: modelConfig.model,
            max_tokens: modelConfig.maxTokens,
            temperature: modelConfig.temperature,
            tools: fallbackTools.length > 0 ? fallbackTools : undefined,
            messages: fallbackPreparedMessages.messages,
            ...openRouterTrace('inference', agent.handle),
          } satisfies OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming &
            Record<string, unknown>
          response = await withProviderRetry(
            () => client.chat.completions.create(imageFallbackRequest),
            { label: `Turn ${turns} text-only fallback` }
          )
          agentLog('Model response received (text-only fallback)', {
            durationMs: Date.now() - modelStart,
            choiceCount: response.choices?.length,
            finishReason: response.choices?.[0]?.finish_reason,
            hasContent: !!response.choices?.[0]?.message?.content,
            hasToolCalls: !!response.choices?.[0]?.message?.tool_calls?.length,
            toolCallCount: response.choices?.[0]?.message?.tool_calls?.length ?? 0,
          })
          await logCall({
            response,
            requestPayload: imageFallbackRequest,
            isFallback: true,
            turn: turns,
            startTime: modelStart,
            attemptKind: 'image_fallback',
            attemptIndex,
            modelSpanId: modelSpan?.id ?? null,
          })
          await endSpan(modelSpan, {
            is_fallback: true,
            fallback_reason: 'image_input_unsupported',
          })
        } catch (fallbackError) {
          if (toolsEnabled && isLikelyToolUseUnsupportedError(fallbackError)) {
            try {
              const withoutImages = stripImageInputs(messages)
              const finalPreparedMessages = prepareMessagesForModel(withoutImages)
              toolsEnabled = false
              attemptIndex += 1
              agentWarn(
                'Model/provider rejected tool use during image fallback, retrying text-only without tools',
                {
                  model: modelConfig.model,
                }
              )
              const imageNoToolsFallbackRequest = {
                model: modelConfig.model,
                max_tokens: modelConfig.maxTokens,
                temperature: modelConfig.temperature,
                messages: finalPreparedMessages.messages,
                ...openRouterTrace('inference', agent.handle),
              } satisfies OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming &
                Record<string, unknown>
              response = await withProviderRetry(
                () => client.chat.completions.create(imageNoToolsFallbackRequest),
                { label: `Turn ${turns} text-only + no-tools fallback` }
              )
              agentLog('Model response received (text-only + no-tools fallback)', {
                durationMs: Date.now() - modelStart,
                choiceCount: response.choices?.length,
                finishReason: response.choices?.[0]?.finish_reason,
                hasContent: !!response.choices?.[0]?.message?.content,
                hasToolCalls: !!response.choices?.[0]?.message?.tool_calls?.length,
                toolCallCount: response.choices?.[0]?.message?.tool_calls?.length ?? 0,
              })
              await logCall({
                response,
                requestPayload: imageNoToolsFallbackRequest,
                isFallback: true,
                turn: turns,
                startTime: modelStart,
                attemptKind: 'image_no_tools_fallback',
                attemptIndex,
                modelSpanId: modelSpan?.id ?? null,
              })
              await endSpan(modelSpan, {
                is_fallback: true,
                fallback_reason: 'image_and_tool_unsupported',
              })
            } catch (finalFallbackError) {
              agentError('Model call failed', finalFallbackError, {
                durationMs: Date.now() - modelStart,
              })
              await failSpan(modelSpan, finalFallbackError, { is_fallback: true })
              throw finalFallbackError
            }
          } else {
            agentError('Model call failed', fallbackError, { durationMs: Date.now() - modelStart })
            await failSpan(modelSpan, fallbackError, { is_fallback: true })
            throw fallbackError
          }
        }
      }
    }

    if (!response) {
      agentError('Model call failed', lastModelError, { durationMs: Date.now() - modelStart })
      await failSpan(modelSpan, lastModelError)
      await failSpan(turnSpan, lastModelError)
      throw lastModelError
    }

    const choice = response.choices[0]
    if (!choice) {
      agentLog('No choice in response, breaking loop')
      await endSpan(turnSpan, { finish_reason: 'no_choice' })
      break
    }

    const assistantMessage = choice.message

    // Handle text content (ignore whitespace-only assistant outputs)
    const assistantText =
      typeof assistantMessage.content === 'string' ? assistantMessage.content.trim() : ''
    const hasAssistantText = assistantText.length > 0
    if (hasAssistantText) {
      onEvent({ type: 'message', role: 'assistant', content: assistantText })
      finalResponse = assistantText
    }

    // Store assistant message, but avoid writing empty text payloads.
    // Keep tool_calls metadata even when the model emits no visible text.
    const assistantPayload: {
      text?: string
      tool_calls?: typeof assistantMessage.tool_calls
    } = {}
    if (hasAssistantText) {
      assistantPayload.text = assistantText
    }
    if (assistantMessage.tool_calls) {
      assistantPayload.tool_calls = assistantMessage.tool_calls
    }
    if (Object.keys(assistantPayload).length > 0) {
      await appendMessage(job.id, 'assistant', assistantPayload)
    }

    // Add assistant message to conversation
    messages.push(assistantMessage)

    // Handle tool calls
    if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
      agentLog('Processing tool calls', { toolCallCount: assistantMessage.tool_calls.length })
      const toolBatchSpan = spanCtx
        ? await startSpan(spanCtx, 'tool_batch', 'lifecycle', turnSpan?.id ?? null, {
            tool_call_count: assistantMessage.tool_calls.length,
          })
        : null
      let steeredAtIndex = -1
      try {
        for (const [index, toolCall] of assistantMessage.tool_calls.entries()) {
          await waitForRunControl()
          steeredAtIndex = index
          // Skip non-function tool calls
          if (!toolCall || toolCall.type !== 'function') continue

          const toolName = toolCall.function.name
          let toolInput: Record<string, unknown> = {}

          try {
            toolInput = JSON.parse(toolCall.function.arguments) as Record<string, unknown>
          } catch {
            // If JSON parsing fails, use empty object
          }

          onEvent({ type: 'tool_use', toolName, input: toolInput })

          // Hook 6: tool.pre_exec — can block execution or transform toolInput
          let toolBlocked = false
          if (hookDispatch) {
            try {
              const hookResult = await hookDispatch(
                'tool.pre_exec',
                {
                  workItemId: workItem.id,
                  jobId: job.id,
                  agentId: agent.id,
                },
                {
                  toolName,
                  toolInput,
                  toolCallId: toolCall.id,
                  turn: turns,
                }
              )
              if (hookResult.blocked) {
                toolBlocked = true
              } else if (
                hookResult.data.toolInput &&
                typeof hookResult.data.toolInput === 'object' &&
                !Array.isArray(hookResult.data.toolInput)
              ) {
                toolInput = hookResult.data.toolInput
              }
            } catch {
              // Hook failure is non-fatal
            }
          }
          if (toolBlocked) {
            // Return a synthetic blocked result to the model
            const blockedContent = buildToolResultContent({
              success: false,
              error: 'Tool execution blocked by plugin policy',
            })
            messages.push({
              role: 'tool' as const,
              tool_call_id: toolCall.id,
              content: blockedContent,
            })
            await appendMessage(job.id, 'tool', {
              text: '[blocked by plugin]',
              tool_call_id: toolCall.id,
              tool_name: toolName,
            })
            onEvent({
              type: 'tool_result',
              toolName,
              result: { success: false, error: 'Blocked by plugin' },
            })
            continue
          }

          const toolStart = Date.now()
          const toolContext = await getToolContext()
          const toolExecSpan = spanCtx
            ? await startSpan(spanCtx, 'tool_exec', 'tool', toolBatchSpan?.id ?? null, {
                tool_name: toolName,
                tool_call_id: toolCall.id,
                edit_tool_mode: toolContext?.editToolMode ?? editToolMode,
              })
            : null
          agentLog('Executing tool', {
            toolName,
            toolCallId: toolCall.id,
            toolIndex: index + 1,
            totalToolCalls: assistantMessage.tool_calls.length,
          })

          // Execute tool (or return error if sprite-backed tool execution is unavailable)
          let result = toolContext
            ? await executeTool(toolName, toolInput, toolContext, integrationHandlers)
            : {
                success: false,
                error:
                  'Tool execution disabled. Configure Sprites in Settings > Capabilities > Tool Execution.',
              }

          // Track CWD from bash tool results
          if (result._meta?.cwd) {
            trackedCwd = result._meta.cwd
          }

          // Handle sandbox switch: reset session and update tracking
          if (result._meta?.sandboxSwitch) {
            const { sandboxName, spriteName: newSpriteName } = result._meta.sandboxSwitch
            agentLog('Sandbox switch detected', {
              from: activeSandboxName,
              to: sandboxName,
              newSpriteName,
            })
            activeSandboxName = sandboxName
            activeSpriteName = newSpriteName
            // Close the old session before switching sprites
            if (session) {
              try {
                await session.close()
              } catch {
                // Best-effort — session may already be dead
              }
            }
            session = null
            trackedCwd = '/home/sprite'
            lastScannedCwd = null
            // Touch the new sandbox to update last_used_at
            await touchSandboxByName(agent.id, sandboxName)
          }

          // Auto-retry on session-level errors (WebSocket keepalive timeout, missing session, etc.).
          // These are transient sprites.dev/session lifecycle issues, not command failures.
          // Triggered by tools that tag result._meta.sessionError.
          const MAX_SESSION_RETRIES = 2
          if (result._meta?.sessionError) {
            for (let retry = 1; retry <= MAX_SESSION_RETRIES; retry++) {
              const retrySpan = spanCtx
                ? await startSpan(spanCtx, 'session_retry', 'tool', toolExecSpan?.id ?? null, {
                    retry_number: retry,
                  })
                : null
              agentWarn(`Session connection error, retrying (${retry}/${MAX_SESSION_RETRIES})`, {
                sessionId: session?.sessionId ?? 'none',
                stderr: result.error,
              })
              // Close the dead session on sprites.dev before abandoning it
              if (session) {
                try {
                  await session.close()
                } catch {
                  // Best-effort — the session may already be dead
                }
              }
              session = null
              nextSessionCreateRetryAt = 0
              // Recreate session via getToolContext's lazy creation
              const retryContext = await getToolContext()
              if (!retryContext?.session) {
                agentWarn('Failed to recreate session for retry')
                await failSpan(retrySpan, 'Failed to recreate session')
                break
              }
              session = retryContext.session as unknown as ISpriteSession
              result = await executeTool(toolName, toolInput, retryContext, integrationHandlers)
              // Track CWD from retry result
              if (result._meta?.cwd) {
                trackedCwd = result._meta.cwd
              }
              if (!result._meta?.sessionError) {
                await endSpan(retrySpan, { success: true })
                break
              }
              await failSpan(retrySpan, result.error ?? 'Session error persisted')
            }

            // If still a session error after retries, null the session and rewrite
            // the result so the model gets a clear message instead of raw WebSocket errors
            if (result._meta?.sessionError) {
              agentWarn('Session connection failed after retries, invalidating', {
                sessionId: session ? session.sessionId : 'none',
              })
              if (session) {
                try {
                  await session.close()
                } catch {
                  // Best-effort cleanup
                }
              }
              session = null
              result = {
                success: false,
                error:
                  'Session connection lost (transient infrastructure issue). ' +
                  'The session has been reset. Please retry this command.',
              }
            }
          }

          // The session command timed out and was force-reset by the sprites layer.
          // Drop the local handle so the next tool call always recreates a fresh session.
          if (result._meta?.sessionInvalidated) {
            agentWarn(
              'Session invalidated after timeout; forcing fresh session on next tool call',
              {
                sessionId: session?.sessionId ?? 'none',
              }
            )
            session = null
            nextSessionCreateRetryAt = 0
            pendingSessionRecoveryReceipt = true
            pendingRecoveryRequestedCwd = trackedCwd || '/home/sprite'
          }

          agentLog('Tool completed', {
            toolName,
            toolCallId: toolCall.id,
            toolIndex: index + 1,
            totalToolCalls: assistantMessage.tool_calls.length,
            durationMs: Date.now() - toolStart,
            success: result.success,
          })
          const normalizedToolError = typeof result.error === 'string' ? result.error.trim() : ''
          const toolErrorKey =
            normalizedToolError.length > 0 ? `${toolName}::${normalizedToolError}` : null
          const repeatedToolErrorCount =
            !result.success && toolErrorKey
              ? (repeatedToolErrorCounts.get(toolErrorKey) ?? 0) + 1
              : 0
          if (!result.success && toolErrorKey) {
            repeatedToolErrorCounts.set(toolErrorKey, repeatedToolErrorCount)
            if (repeatedToolErrorCount === 4) {
              agentWarn('Repeated tool error detected', {
                jobId: job.id,
                toolName,
                repeatCount: repeatedToolErrorCount,
                error: normalizedToolError || 'unknown_error',
                toolExecSpanId: toolExecSpan?.id ?? null,
              })
            }
          }
          const toolSpanAttributes = {
            success: result.success,
            edit_tool_mode: toolContext?.editToolMode ?? editToolMode,
            active_sandbox: activeSandboxName,
            active_sprite: activeSpriteName ?? undefined,
            ...(repeatedToolErrorCount > 0 ? { repeat_count: repeatedToolErrorCount } : {}),
            ...(result._meta?.editOperation ? { edit_operation: result._meta.editOperation } : {}),
            ...(result._meta?.hashMismatch ? { hash_mismatch: true } : {}),
            ...(result._meta?.sandboxSwitch
              ? { sandbox_switch_to: result._meta.sandboxSwitch.sandboxName }
              : {}),
          }
          if (result.success) {
            await endSpan(toolExecSpan, toolSpanAttributes)
          } else {
            await failSpan(toolExecSpan, result.error ?? 'Tool execution failed', {
              session_error: !!result._meta?.sessionError,
              ...toolSpanAttributes,
            })
          }
          onEvent({ type: 'tool_result', toolName, result })

          // Hook 7: tool.post_exec — observability, can transform result.output
          if (hookDispatch) {
            try {
              const hookResult = await hookDispatch(
                'tool.post_exec',
                {
                  workItemId: workItem.id,
                  jobId: job.id,
                  agentId: agent.id,
                },
                {
                  toolName,
                  toolInput,
                  result: { success: result.success, output: result.output ?? result.error },
                  durationMs: Date.now() - toolStart,
                  turn: turns,
                }
              )
              if (hookResult.data.result && typeof hookResult.data.result === 'object') {
                const mutatedResult = hookResult.data.result
                if (
                  'output' in mutatedResult &&
                  mutatedResult.output !== undefined &&
                  typeof mutatedResult.output === 'string'
                ) {
                  result = { ...result, output: mutatedResult.output }
                }
              }
            } catch {
              // Hook failure is non-fatal
            }
          }

          // Persist external API costs (e.g. Tavily search/extract)
          if (result._meta?.externalApiCost) {
            const cost: ExternalApiCost = result._meta.externalApiCost
            try {
              await insertExternalApiCall({
                job_id: job.id,
                agent_id: agent.id,
                provider: cost.provider,
                operation: cost.operation,
                tool_call_id: toolCall.id,
                media_artifact_id: cost.mediaArtifactId ?? null,
                cost_usd: cost.costUsd,
                credits_used: cost.creditsUsed,
                pricing_status: cost.pricingStatus ?? (cost.costUsd != null ? 'actual' : 'unknown'),
                pricing_source: cost.pricingSource ?? null,
                duration_ms: cost.durationMs,
                metadata: cost.metadata ? JSON.stringify(cost.metadata) : null,
              })
            } catch (externalCostError) {
              agentWarn('Failed to persist external API cost', {
                provider: cost.provider,
                operation: cost.operation,
                error:
                  externalCostError instanceof Error
                    ? externalCostError.message
                    : String(externalCostError),
              })
            }
          }

          // Add tool result to messages
          // Always include output (which has stdout/stderr) even on failure.
          // Truncate aggressively to prevent runaway model input size.
          const rawToolResultContent = buildToolResultContent(result)
          const toolResultContent = truncateWithNotice(
            rawToolResultContent,
            MAX_TOOL_RESULT_CHARS,
            'tool output'
          )
          if (toolResultContent.length < rawToolResultContent.length) {
            agentWarn('Truncated tool result before appending to conversation', {
              toolName,
              toolCallId: toolCall.id,
              originalChars: rawToolResultContent.length,
              truncatedChars: toolResultContent.length,
            })
          }

          const toolResultMessage: OpenAI.ChatCompletionToolMessageParam = {
            role: 'tool',
            tool_call_id: toolCall.id,
            content: toolResultContent,
          }

          await appendMessage(job.id, 'tool', {
            tool_call_id: toolCall.id,
            content: toolResultMessage.content,
          })

          messages.push(toolResultMessage)
        }
      } catch (steerError) {
        const steerMsg = steerError instanceof Error ? steerError.message : String(steerError)
        if (!steerMsg.includes(STEERED_MARKER)) throw steerError

        // Steered mid-run: fill synthetic "skipped" results for unexecuted tools
        agentLog('Run steered mid-tool-batch', { steeredAtIndex })
        for (const skippedTc of getSkippedFunctionToolCalls(
          assistantMessage.tool_calls,
          steeredAtIndex
        )) {
          // Only skip tools that haven't been executed yet (steeredAtIndex is the one
          // that was about to run when waitForRunControl fired)
          const skippedResult: OpenAI.ChatCompletionToolMessageParam = {
            role: 'tool',
            tool_call_id: skippedTc.id,
            content: '[Tool skipped — new message arrived from user]',
          }
          messages.push(skippedResult)
        }

        // Consume the steering messages and inject as a user turn
        await injectSteeringMessages('mid_run')
      }

      await endSpan(toolBatchSpan)

      // After processing all tool calls, check if cwd changed and scan for context
      if (activeSpriteName && trackedCwd !== lastScannedCwd) {
        try {
          const dirContext = await scanDirectoryContext(
            activeSpriteName,
            trackedCwd,
            session ?? undefined
          )
          lastScannedCwd = trackedCwd
          discoveredSkills = dirContext.skills

          const injection = formatContextInjection(dirContext)
          if (injection) {
            pendingContextInjection = injection
          }
        } catch (error) {
          agentWarn('Failed to scan directory context', {
            cwd: trackedCwd,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      // Inject pending context as a system message
      if (pendingContextInjection) {
        messages.push({ role: 'system', content: pendingContextInjection })
        pendingContextInjection = null
      }
    }

    // Check if we should stop (no tool calls = done)
    if (choice.finish_reason === 'stop' || !assistantMessage.tool_calls?.length) {
      agentLog('Loop stopping', {
        finishReason: choice.finish_reason,
        hasToolCalls: !!assistantMessage.tool_calls?.length,
      })
      await endSpan(turnSpan, {
        finish_reason: choice.finish_reason,
        has_tool_calls: !!assistantMessage.tool_calls?.length,
      })
      stoppedByCompletion = true
      break
    }

    // Turn continues to next iteration — end this turn's span
    await endSpan(turnSpan, {
      finish_reason: choice.finish_reason,
      has_tool_calls: !!assistantMessage.tool_calls?.length,
    })
  }

  // If we exhaust turns without a natural stop, treat as limit hit.
  const hitLimit = turns >= maxTurns && !stoppedByCompletion
  if (hitLimit) {
    const limitMessage = `I hit my tool use limit (${maxTurns} turns) before completing the task. This might indicate I got stuck in a loop. Please try rephrasing your request or breaking it into smaller steps.`
    finalResponse = finalResponse ? `${finalResponse}\n\n${limitMessage}` : limitMessage
    await appendMessage(job.id, 'assistant', { text: limitMessage })
    agentWarn('Hit max turns limit, generated fallback response')
  }

  // Steer mode: end-of-run "last look" — before committing, check for pending messages
  // that arrived during the final turn. If any exist, inject and do one more pass.
  // Cap at 3 iterations to prevent infinite loops if messages keep arriving.
  const MAX_LAST_LOOK_PASSES = 3
  if (onSteered && stoppedByCompletion) {
    for (let pass = 0; pass < MAX_LAST_LOOK_PASSES; pass++) {
      if (getRunControlDirective) {
        const directive = await getRunControlDirective()
        if (directive.action === 'cancel') {
          await onCancelled?.()
          throw new Error('__RUN_CANCELLED__')
        }
        if (directive.action !== 'steer') break
      }

      const lastLookMsgs = await onSteered()
      if (lastLookMsgs.length === 0) break

      agentLog('End-of-run last look: injecting pending messages', {
        pass: pass + 1,
        count: lastLookMsgs.length,
      })

      const lastLookText = formatSteeringUserText(lastLookMsgs)
      messages.push({ role: 'system', content: STEER_PRIORITY_SYSTEM_NOTE })
      await appendMessage(job.id, 'system', {
        text: `[Steer end_of_run] ${STEER_PRIORITY_SYSTEM_NOTE}`,
      })
      messages.push({ role: 'user', content: lastLookText })
      await appendMessage(job.id, 'user', { text: lastLookText })

      // One more inference pass
      const lastLookRequest = {
        model: modelConfig.model,
        max_tokens: modelConfig.maxTokens,
        temperature: modelConfig.temperature,
        messages: prepareMessagesForModel(messages).messages,
        ...openRouterTrace('last-look', agent.handle),
      } satisfies OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming &
        Record<string, unknown>
      const lastLookStart = Date.now()
      const lastLookResp = await withProviderRetry(
        () => client.chat.completions.create(lastLookRequest),
        { label: `Last look pass ${pass + 1}` }
      )
      await logCall({
        response: lastLookResp,
        requestPayload: lastLookRequest,
        isFallback: false,
        turn: turns,
        startTime: lastLookStart,
        attemptKind: 'last_look',
        attemptIndex: pass + 1,
        modelSpanId: null,
      })

      const lastLookChoice = lastLookResp.choices[0]
      const lastLookContent =
        typeof lastLookChoice?.message?.content === 'string'
          ? lastLookChoice.message.content.trim()
          : ''
      if (lastLookContent) {
        finalResponse = lastLookContent
        messages.push(lastLookChoice!.message)
        await appendMessage(job.id, 'assistant', { text: lastLookContent })
        onEvent({ type: 'message', role: 'assistant', content: lastLookContent })
      }

      // If the model wants tool calls, we don't support that in last-look; just break
      if (lastLookChoice?.message?.tool_calls?.length) {
        agentWarn('Last look pass returned tool calls, stopping last-look loop')
        break
      }
    }
  }

  agentLog('Inference loop complete', {
    turns,
    hitLimit,
    finalResponse: finalResponse?.substring(0, 100),
  })
  return { finalResponse, hitLimit, messages, currentRunStartIndex }
}

type TranscriptUserLine = {
  label: string
  text: string
}

const USER_SPEAKER_LINE_REGEX = /^\[([^\]\n]{1,120})\]\s*(.+)$/
const USER_FROM_CONTEXT_REGEX = /\[From:\s*([^\]|]+)(?:\s*\|[^\]]*)?\]/i

function parseTranscriptUserLines(content: string, fallbackLabel: string): TranscriptUserLine[] {
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (lines.length > 0) {
    const parsed = lines.map((line) => {
      const match = line.match(USER_SPEAKER_LINE_REGEX)
      if (!match) return null

      const rawLabel = match[1]?.trim()
      const rawText = match[2]?.trim()
      if (!rawLabel || !rawText) return null
      if (rawLabel.includes(':')) return null

      return {
        label: sanitizeLabel(rawLabel, fallbackLabel),
        text: sanitize(rawText),
      } satisfies TranscriptUserLine
    })

    if (parsed.every((entry) => entry !== null)) {
      return parsed as TranscriptUserLine[]
    }
  }

  const fromMatch = content.match(USER_FROM_CONTEXT_REGEX)
  if (fromMatch) {
    const speaker = sanitizeLabel(fromMatch[1]!.trim(), fallbackLabel)
    const withoutFromLine = content.replace(/\[From:[^\]]+\]\s*\n?/i, '').trim()
    const cleanedText = withoutFromLine.length > 0 ? withoutFromLine : content
    return [{ label: speaker, text: sanitize(cleanedText) }]
  }

  return [{ label: fallbackLabel, text: sanitize(content) }]
}

/**
 * Format the conversation messages array for the post-processing input.
 * Produces a human-readable transcript the model can synthesize from.
 *
 * User labels prefer per-message participant names (for example in group channels)
 * and fall back to a requester label when no sender identity is embedded.
 */
export function formatConversationForPostProcessing(
  messages: OpenAI.ChatCompletionMessageParam[],
  agentName?: string,
  requesterLabel?: string
): string {
  const agentLabel = agentName ?? 'Agent'
  const requester = requesterLabel ?? 'Requester'
  const lines: string[] = []

  const safeRequester = sanitizeLabel(requester, 'Requester')
  const safeAgentLabel = sanitizeLabel(agentLabel, 'Agent')

  for (const msg of messages) {
    if (msg.role === 'system') {
      // Skip system messages — already captured in the lightweight system prompt
      continue
    }

    if (msg.role === 'user') {
      if (typeof msg.content === 'string') {
        const userLines = parseTranscriptUserLines(msg.content, safeRequester)
        for (const line of userLines) {
          lines.push(`[${line.label}]: ${line.text}`)
        }
      } else {
        lines.push(`[${safeRequester}]: [multimodal content]`)
      }
    }

    if (msg.role === 'assistant') {
      if (typeof msg.content === 'string' && msg.content.trim()) {
        lines.push(`[${safeAgentLabel}]: ${sanitize(msg.content)}`)
      }
      if ('tool_calls' in msg && msg.tool_calls && Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          if ('function' in tc) {
            lines.push(`[Tool: ${tc.function.name}]`)
          }
        }
      }
    }

    if (msg.role === 'tool') {
      const content = typeof msg.content === 'string' ? sanitize(msg.content) : ''
      const truncated =
        content.length > 2000
          ? content.slice(0, 2000) + `\n[... truncated ${content.length - 2000} chars]`
          : content
      lines.push(`[Tool Result]: ${truncated}`)
    }
  }

  return lines.join('\n\n')
}

type StoredMessageSeedInput = Pick<Message, 'role' | 'content'>

export interface RetrySeedPromptResult {
  promptMessages: OpenAI.ChatCompletionMessageParam[]
  droppedIncompleteTrailingTurn: boolean
  skippedInitialDuplicateUser: boolean
}

export function shouldSkipFinalModePostProcessing(
  currentRunMessages: OpenAI.ChatCompletionMessageParam[],
  hitLimit: boolean
): boolean {
  const assistantMessages = currentRunMessages.filter((message) => message.role === 'assistant')
  const hasToolUse = currentRunMessages.some((message) => message.role === 'tool')
  return assistantMessages.length === 1 && !hasToolUse && !hitLimit
}

export interface FinalModePersistenceDeps {
  updateJob: (jobId: string, updates: { final_response: string | null }) => Promise<unknown>
  markLastAssistantAsFinalResponse: (jobId: string) => Promise<void>
  appendMessage: (jobId: string, role: string, content: unknown) => Promise<unknown>
}

export interface PersistFinalModeResponseParams {
  responseMode?: ResponseMode
  jobId: string
  rawFinalResponse: string | null
  processedFinalResponse?: string
  currentRunMessages: OpenAI.ChatCompletionMessageParam[]
  hitLimit: boolean
  skipPostProcessing?: boolean
  deps?: Partial<FinalModePersistenceDeps>
}

export interface PersistFinalModeResponseResult {
  finalResponse: string | null
  handled: boolean
  skippedPostProcessing: boolean
}

export async function persistFinalModeResponseIfNeeded(
  params: PersistFinalModeResponseParams
): Promise<PersistFinalModeResponseResult> {
  const responseMode = params.responseMode ?? 'streaming'
  if (responseMode !== 'final' || !params.rawFinalResponse) {
    return {
      finalResponse: params.rawFinalResponse,
      handled: false,
      skippedPostProcessing: false,
    }
  }

  const skipPostProcessing =
    params.skipPostProcessing ??
    shouldSkipFinalModePostProcessing(params.currentRunMessages, params.hitLimit)
  const finalResponse = skipPostProcessing
    ? params.rawFinalResponse
    : (params.processedFinalResponse ?? params.rawFinalResponse)

  const deps: FinalModePersistenceDeps = {
    updateJob: params.deps?.updateJob ?? updateJob,
    markLastAssistantAsFinalResponse:
      params.deps?.markLastAssistantAsFinalResponse ?? markLastAssistantAsFinalResponse,
    appendMessage: params.deps?.appendMessage ?? appendMessage,
  }

  await deps.updateJob(params.jobId, { final_response: finalResponse })
  if (skipPostProcessing) {
    await deps.markLastAssistantAsFinalResponse(params.jobId)
  } else {
    await deps.appendMessage(params.jobId, 'assistant', {
      text: finalResponse,
      is_final_response: true,
    })
  }

  return {
    finalResponse,
    handled: true,
    skippedPostProcessing: skipPostProcessing,
  }
}

export function buildRetrySeedPromptFromStoredMessages(
  storedMessages: StoredMessageSeedInput[],
  currentUserText: string
): RetrySeedPromptResult {
  const messages = storedMessages.filter((msg) => msg.role !== 'system')
  const trimmed = [...messages]

  while (trimmed.length > 0) {
    const tail = trimmed[trimmed.length - 1]!
    if (tail.role !== 'assistant') break
    const { text } = parseAssistantPayload(tail.content)
    if (!isFailureTailMessage(text)) break
    trimmed.pop()
  }

  let lastGoodIndexExclusive = 0
  let pendingToolCallIds: Set<string> | null = null

  for (let i = 0; i < trimmed.length; i++) {
    const msg = trimmed[i]!

    if (pendingToolCallIds && msg.role !== 'tool') {
      break
    }

    if (msg.role === 'assistant') {
      const { toolCalls } = parseAssistantPayload(msg.content)
      const callIds = toolCalls
        .map((tc) => tc.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)

      if (callIds.length > 0) {
        pendingToolCallIds = new Set(callIds)
      } else {
        pendingToolCallIds = null
        lastGoodIndexExclusive = i + 1
      }
      continue
    }

    if (msg.role === 'tool') {
      if (!pendingToolCallIds) break
      const toolCallId = parseToolCallId(msg.content)
      if (!toolCallId || !pendingToolCallIds.has(toolCallId)) break
      pendingToolCallIds.delete(toolCallId)
      if (pendingToolCallIds.size === 0) {
        pendingToolCallIds = null
        lastGoodIndexExclusive = i + 1
      }
      continue
    }

    if (msg.role === 'user') {
      lastGoodIndexExclusive = i + 1
      continue
    }
  }

  const usable = trimmed.slice(0, lastGoodIndexExclusive)
  let firstUserHandled = false
  let skippedInitialDuplicateUser = false
  const normalizedCurrentUser = normalizeTextForComparison(currentUserText)
  const promptMessages: OpenAI.ChatCompletionMessageParam[] = []

  for (const msg of usable) {
    if (msg.role === 'user' && !firstUserHandled) {
      firstUserHandled = true
      const text = normalizeTextForComparison(parseMessageText(msg.content))
      if (text.length > 0 && text === normalizedCurrentUser) {
        skippedInitialDuplicateUser = true
        continue
      }
    }

    const converted = toOpenAIPromptMessage(msg)
    if (converted) {
      promptMessages.push(converted)
    }
  }

  return {
    promptMessages,
    droppedIncompleteTrailingTurn: lastGoodIndexExclusive < trimmed.length,
    skippedInitialDuplicateUser,
  }
}

interface RetrySeedBuildResult extends RetrySeedPromptResult {
  sourceJobId: string
}

async function buildRetrySeedFromJob(
  sourceJobId: string,
  currentUserText: string
): Promise<RetrySeedBuildResult | null> {
  try {
    const sourceMessages = await listMessagesByJob(sourceJobId)
    if (sourceMessages.length === 0) return null
    const seed = buildRetrySeedPromptFromStoredMessages(sourceMessages, currentUserText)
    if (seed.promptMessages.length === 0) return null
    return { sourceJobId, ...seed }
  } catch (error) {
    agentWarn('Failed to load retry seed context, continuing without resume seed', {
      sourceJobId,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

function normalizeTextForComparison(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function parseMessageText(content: string | null): string {
  if (!content) return ''
  try {
    const parsed: unknown = JSON.parse(content)
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>
      if (typeof record.text === 'string') return record.text
      if (typeof record.content === 'string') return record.content
    }
    return ''
  } catch {
    return content
  }
}

function parseAssistantPayload(content: string | null): {
  text: string
  toolCalls: OpenAI.ChatCompletionMessageToolCall[]
} {
  if (!content) return { text: '', toolCalls: [] }
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>
    const text = typeof parsed.text === 'string' ? parsed.text : ''
    const toolCalls = Array.isArray(parsed.tool_calls)
      ? (parsed.tool_calls as OpenAI.ChatCompletionMessageToolCall[])
      : []
    return { text, toolCalls }
  } catch {
    return { text: content, toolCalls: [] }
  }
}

function parseToolCallId(content: string | null): string | null {
  if (!content) return null
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>
    return typeof parsed.tool_call_id === 'string' ? parsed.tool_call_id : null
  } catch {
    return null
  }
}

function toOpenAIPromptMessage(
  msg: StoredMessageSeedInput
): OpenAI.ChatCompletionMessageParam | null {
  if (msg.role === 'system') return null

  if (msg.role === 'user') {
    try {
      const parsed = JSON.parse(msg.content || '{}') as {
        text?: string
        content?: string
        content_parts?: OpenAI.ChatCompletionContentPart[]
      }
      if (Array.isArray(parsed.content_parts) && parsed.content_parts.length > 0) {
        return { role: 'user', content: parsed.content_parts }
      }
      if (typeof parsed.text === 'string' && parsed.text.trim().length > 0) {
        return { role: 'user', content: sanitize(parsed.text) }
      }
      if (typeof parsed.content === 'string' && parsed.content.trim().length > 0) {
        return { role: 'user', content: sanitize(parsed.content) }
      }
      return null
    } catch {
      return msg.content && msg.content.trim().length > 0
        ? { role: 'user', content: sanitize(msg.content) }
        : null
    }
  }

  if (msg.role === 'assistant') {
    const { text, toolCalls } = parseAssistantPayload(msg.content)
    if (!text && toolCalls.length === 0) return null
    const assistant: OpenAI.ChatCompletionAssistantMessageParam = { role: 'assistant' }
    if (text) {
      assistant.content = sanitize(text)
    }
    if (toolCalls.length > 0) {
      assistant.tool_calls = toolCalls
    }
    return assistant
  }

  if (msg.role === 'tool') {
    try {
      const parsed = JSON.parse(msg.content || '{}') as Record<string, unknown>
      const toolCallId = typeof parsed.tool_call_id === 'string' ? parsed.tool_call_id : null
      if (!toolCallId) return null
      const content =
        typeof parsed.content === 'string' ? parsed.content : JSON.stringify(parsed.content ?? '')
      return { role: 'tool', tool_call_id: toolCallId, content: sanitize(content) }
    } catch {
      return null
    }
  }

  return null
}

function isFailureTailMessage(text: string): boolean {
  if (!text) return false
  return (
    text.includes('I hit an internal error and could not complete this request.') ||
    text.includes('This run was cancelled by an operator before completion.')
  )
}

/**
 * Post-process the agent's raw final response into a clean summary.
 * Makes a single LLM call with no tools — just prose synthesis.
 */
async function postProcessFinalResponse(
  agent: Agent,
  conversationMessages: OpenAI.ChatCompletionMessageParam[],
  options?: { hitLimit?: boolean; requesterLabel?: string }
): Promise<{
  response: string
  requestPayload: unknown
  responsePayload: unknown
  usage?: {
    model: string
    promptTokens: number
    completionTokens: number
    totalTokens: number
    costUsd: number | null
  }
}> {
  const client = await getClient()
  const config = parseAgentConfig(agent.config)
  const modelConfig = getModelConfig(config)

  const requesterLabel = options?.requesterLabel ?? 'Requester'
  const systemPrompt = buildPostProcessingPrompt(agent, {
    hitLimit: options?.hitLimit,
    requesterLabel,
  })
  const transcript = formatConversationForPostProcessing(
    conversationMessages,
    agent.name,
    requesterLabel
  )

  const requestPayload = {
    model: modelConfig.model,
    temperature: 0.3,
    max_tokens: modelConfig.maxTokens,
    messages: [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: `<transcript>\n${transcript}\n</transcript>` },
    ],
    ...openRouterTrace('post-processing', agent.handle),
  } satisfies OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming &
    Record<string, unknown>

  const response = await withProviderRetry(() => client.chat.completions.create(requestPayload), {
    label: 'Post-processing final response',
  })

  const choice = response.choices[0]
  const text = choice?.message?.content?.trim()
  if (!text) {
    throw new Error('Post-processing returned empty response')
  }

  const usage = response.usage
  const usageRecord = usage as Record<string, unknown> | undefined
  const openRouterCost = usageRecord?.cost
  const openRouterTotalCost = usageRecord?.total_cost
  const costUsd =
    typeof openRouterCost === 'number'
      ? openRouterCost
      : typeof openRouterTotalCost === 'number'
        ? openRouterTotalCost
        : null

  return {
    response: text,
    requestPayload,
    responsePayload: response,
    usage: usage
      ? {
          model: response.model || modelConfig.model,
          promptTokens: usage.prompt_tokens ?? 0,
          completionTokens: usage.completion_tokens ?? 0,
          totalTokens: (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0),
          costUsd,
        }
      : undefined,
  }
}

/**
 * Count user→assistant exchange pairs in session messages.
 * An "exchange" = one user message followed by at least one assistant message.
 */
function countThreadExchanges(messages: Array<{ role: string }>): number {
  let exchanges = 0
  let sawUser = false
  for (const msg of messages) {
    if (msg.role === 'user') {
      sawUser = true
    } else if (msg.role === 'assistant' && sawUser) {
      exchanges += 1
      sawUser = false
    }
  }
  return exchanges
}

/**
 * Threads with fewer than this many exchanges are considered "sparse"
 * and eligible for channel prelude injection.
 */
const CHANNEL_PRELUDE_SPARSE_THRESHOLD = 2

/**
 * Build lightweight triage context: agent identity + condensed recent session history.
 * Kept cheap — just parses recent message text, no embeddings or heavy processing.
 */
const TRIAGE_CONTEXT_LOOKBACK_MESSAGES_DEFAULT = 250
const TRIAGE_RECENT_HISTORY_MAX_CHARS_DEFAULT = 20_000
const TRIAGE_EXCHANGE_MAX_CHARS_DEFAULT = 500

async function buildTriageContext(
  agent: Agent,
  workItem: WorkItem,
  currentJobId: string
): Promise<TriageContext> {
  const config = parseAgentConfig(agent.config)
  const triageSettings = config.triageSettings ?? {}
  const lookbackMessages =
    triageSettings.recentHistoryLookbackMessages ?? TRIAGE_CONTEXT_LOOKBACK_MESSAGES_DEFAULT
  const recentHistoryMaxChars =
    triageSettings.recentHistoryMaxChars ?? TRIAGE_RECENT_HISTORY_MAX_CHARS_DEFAULT
  const exchangeMaxChars =
    triageSettings.recentHistoryPerMessageMaxChars ?? TRIAGE_EXCHANGE_MAX_CHARS_DEFAULT

  let recentHistory: string | null = null
  let activeWorkSnapshot: string | undefined
  try {
    // Fetch ALL agents' messages on this session (not just ours)
    const messages = await listMessagesBySession(workItem.session_key, {
      excludeJobId: currentJobId,
      completedBeforeTimestamp: workItem.created_at,
      completedOnly: true,
    })

    if (messages.length > 0) {
      // Extract recent user/assistant text exchanges (skip system/tool messages).
      // We look back over many messages, then pack by character budget instead of
      // fixed message count so older important context can still be included.
      // Attribute other agents' messages with their handle
      const exchanges: string[] = []
      let lastExchangeNorm: string | null = null
      for (const msg of messages.slice(-lookbackMessages)) {
        const rawText = parseMessageTextForTriage(msg.content)
        const text = rawText ? normalizeTriageText(rawText) : null
        if (!text) continue

        let exchange: string | null = null
        if (msg.role === 'user') {
          exchange = `User: ${middleTruncate(text, exchangeMaxChars)}`
        } else if (msg.role === 'assistant') {
          const prefix = msg.agentId !== agent.id ? `[@${msg.agentHandle}]` : 'You'
          exchange = `${prefix}: ${middleTruncate(text, exchangeMaxChars)}`
        }

        if (!exchange) continue
        const exchangeNorm = normalizeHistoryExchangeForDedup(exchange)
        if (exchangeNorm === lastExchangeNorm) continue

        exchanges.push(exchange)
        lastExchangeNorm = exchangeNorm
      }
      if (exchanges.length > 0) {
        recentHistory = packRecentHistoryByCharBudget(exchanges, recentHistoryMaxChars)
      }
    }
  } catch (error) {
    agentWarn('Failed to build triage session context', {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  try {
    const activeWork = await listActiveWorkSnapshotsForAgent(agent.id, {
      excludeJobId: currentJobId,
      limit: 8,
    })
    if (activeWork.length > 0) {
      activeWorkSnapshot = activeWork
        .map(
          (item, idx) =>
            `${idx + 1}. ${item.status} | ${item.source} | ${item.session_key} | ${middleTruncate(item.title, 120)}`
        )
        .join('\n')
    }
  } catch (error) {
    agentWarn('Failed to build active work snapshot for triage', {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  // Build channel prelude for sparse Slack threads
  let channelPrelude: string | undefined
  if (workItem.session_key.startsWith('slack:')) {
    try {
      // Count exchanges from the session messages we already fetched (in the outer try/catch)
      const sessionMessages = await listMessagesBySession(workItem.session_key, {
        excludeJobId: currentJobId,
        completedOnly: true,
      })
      const exchangeCount = countThreadExchanges(sessionMessages)

      if (exchangeCount <= CHANNEL_PRELUDE_SPARSE_THRESHOLD) {
        // Extract channelId from session_key format: slack:<channelId>:<threadTs>
        const parts = workItem.session_key.split(':')
        const channelId = parts[1]
        if (channelId) {
          const channelMessages = await listChannelThreadSummaries(channelId, {
            excludeSessionKey: workItem.session_key,
            limit: CHANNEL_PRELUDE_MAX_MESSAGES,
          })
          const prelude = buildChannelPrelude(channelMessages)
          if (prelude) {
            channelPrelude = prelude
          }
        }
      }
    } catch (error) {
      agentWarn('Failed to build channel prelude for triage', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return {
    agentName: agent.name,
    agentHandle: agent.handle,
    agentTitle: config.title ?? null,
    recentHistory,
    activeWorkSnapshot,
    channelPrelude,
  }
}

function packRecentHistoryByCharBudget(exchanges: string[], maxChars: number): string | null {
  if (exchanges.length === 0) return null
  if (maxChars <= 0) return null

  const selected: string[] = []
  let used = 0

  for (let i = exchanges.length - 1; i >= 0; i -= 1) {
    const line = exchanges[i]
    if (!line) continue
    const extra = line.length + (selected.length > 0 ? 1 : 0)
    if (used + extra > maxChars) {
      if (selected.length === 0) {
        selected.unshift(line.slice(Math.max(0, line.length - maxChars)))
      }
      break
    }
    selected.unshift(line)
    used += extra
  }

  return selected.length > 0 ? selected.join('\n') : null
}

function normalizeHistoryExchangeForDedup(exchange: string): string {
  return exchange
    .replace(/^(?:User|You):\s*/i, '')
    .replace(/^\[@[^\]]+\]:\s*/i, '')
    .replace(/^\[[^\]]+\]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function normalizeTriageText(text: string): string | null {
  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (!normalized) return null

  // Steering injections can include a synthetic wrapper line; keep payload lines only.
  if (/^\[\d+\s+messages arrived while you were working\]/i.test(normalized)) {
    const payloadLines = normalized
      .split('\n')
      .slice(1)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    if (payloadLines.length === 0) return null
    return payloadLines.join(' | ')
  }

  return normalized
}

/**
 * Parse stored message content to extract text for triage context.
 * Messages are stored as JSON objects with a 'text' field.
 */
function parseMessageTextForTriage(content: string | null): string | null {
  if (!content) return null
  try {
    const parsed: unknown = JSON.parse(content)
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>
      if (typeof record.text === 'string') return record.text
      if (typeof record.content === 'string') return record.content
    }
    return null
  } catch {
    return content
  }
}

/**
 * Middle-truncate text to maxLen, preserving the head (metadata tags, @mentions)
 * and tail (conclusions, asks). Bracket-delimited tags like [From: ...] that
 * straddle the cut boundary are kept intact by extending the head to the
 * closing bracket.
 */
function middleTruncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text

  // 60/40 split favoring the head (tags and context are front-loaded)
  let headLen = Math.floor(maxLen * 0.6)
  const tailLen = Math.floor(maxLen * 0.3)

  // If the head cut lands inside a [...] tag, extend to close it
  const headSlice = text.slice(0, headLen)
  const lastOpen = headSlice.lastIndexOf('[')
  if (lastOpen >= 0) {
    const closeAfterOpen = text.indexOf(']', lastOpen)
    if (closeAfterOpen >= 0 && closeAfterOpen >= headLen && closeAfterOpen < headLen + 80) {
      headLen = closeAfterOpen + 1
    }
  }

  const omitted = text.length - headLen - tailLen
  return `${text.slice(0, headLen)} [..${omitted} chars..] ${text.slice(text.length - tailLen)}`
}

/**
 * Extract response context from a work item's JSON payload.
 * The webhook router stores it at `payload.responseContext`.
 */
function extractResponseContext(workItem: WorkItem): unknown {
  if (!workItem.payload) return undefined
  try {
    const parsed = JSON.parse(workItem.payload) as Record<string, unknown>
    return parsed.responseContext ?? undefined
  } catch {
    return undefined
  }
}
