import {
  claimNextPassiveMemoryQueue,
  markPassiveMemoryQueueCompleted,
  markPassiveMemoryQueueFailed,
  markPassiveMemoryQueueSkipped,
  getRuntimeControl,
  findAgentById,
  listMessagesByJob,
  insertInferenceCall,
  listMemories,
  findWorkItemById,
  deleteMemory,
  reinforceMemory,
  getDb,
  decrypt,
  PASSIVE_MEMORY_EXTRACT_TURN_BASE,
  PASSIVE_MEMORY_REFINE_TURN_BASE,
} from '@nitejar/database'
import { logSchemaMismatchOnce } from './schema-mismatch'
import {
  createMemoryWithEmbedding,
  findRelatedMemories,
  updateMemoryWithEmbedding,
} from '@nitejar/agent/memory'
import { getRequesterIdentity, type RequesterIdentity } from '@nitejar/agent/prompt-builder'
import { getMemorySettings, parseAgentConfig } from '@nitejar/agent/config'
import { startSpan, endSpan, failSpan, type SpanContext } from '@nitejar/agent/tracing'
import { sanitize } from '@nitejar/agent/prompt-sanitize'

const WORKER_STATE_KEY = '__nitejarPassiveMemoryWorker'
const TICK_MS = 1500
const LEASE_SECONDS = 180
const DEFAULT_EXTRACT_MODEL = 'arcee-ai/trinity-large-preview:free'
const DEFAULT_REFINE_MODEL = DEFAULT_EXTRACT_MODEL
const ASSISTANT_TRANSCRIPT_MAX_TOKENS = 4000
const CANDIDATE_LIMIT = 10
const MIN_CONFIDENCE = 0.7
const DEDUPE_THRESHOLD = 0.85
const KEYWORD_SIMILARITY_THRESHOLD = 0.35
const EMBEDDING_SIMILARITY_THRESHOLD = 0.72
const COMBINED_SIMILARITY_THRESHOLD = 0.7
const MAX_RECONCILE_MATCHES = 3

const EXTRACTION_SYSTEM_PROMPT = [
  'You extract long-term memories from conversations between a user and an AI assistant.',
  'Your job is to identify information the assistant should remember for future conversations.',
  '',
  'EXTRACT:',
  '- Facts about users: names, preferences, roles, projects, relationships, goals',
  '- Project-specific knowledge: tech stack, conventions, repo paths, deployment details',
  '- Decisions and agreements: choices made, policies established, constraints agreed upon',
  '- Task state worth resuming: in-progress work, blockers, next steps',
  '- Corrections: when users correct the assistant, remember the right answer',
  '',
  'DO NOT EXTRACT:',
  '- General knowledge the model already knows (science facts, definitions, how-tos)',
  "- The assistant's own phrasing or responses (what the assistant said is not a memory)",
  '- Transient status: "tests pass", "server is running", "build succeeded"',
  "- Self-referential statements about the assistant's capabilities or limitations",
  '- Greetings, acknowledgements, or conversational filler',
  "- One-off execution details that won't matter in future conversations",
  '',
  'Return ZERO memories if nothing worth remembering was said. An empty array is the correct',
  'answer for most conversations. Only extract when there is genuine new user/project knowledge.',
  '',
  'Return strict JSON only.',
].join('\n')

const RECONCILE_SYSTEM_PROMPT = [
  'You reconcile new memory candidates against existing stored memories.',
  'Decide per candidate whether to:',
  '- "create": keep it as a new memory',
  '- "update": replace or refine an existing memory entry (must choose targetMemoryId)',
  '- "skip": drop it because it is redundant, noisy, or low value',
  '',
  'Prefer update when the candidate is a better or newer version of an existing memory.',
  'Prefer skip when the candidate duplicates existing memory without improving it.',
  'Return strict JSON only.',
].join('\n')

const KEYWORD_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'has',
  'he',
  'in',
  'is',
  'it',
  'its',
  'of',
  'on',
  'or',
  'that',
  'the',
  'their',
  'this',
  'to',
  'was',
  'were',
  'with',
])

type WorkerState = {
  started: boolean
  running: boolean
  draining: boolean
  timer?: NodeJS.Timeout
  processFn?: () => Promise<void>
}

type PassiveMemoryCandidate = {
  content: string
  kind: 'fact' | 'task'
  confidence: number
  reason: string
  targetMemoryId?: string
}

type ModelUsage = {
  model: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  costUsd: number | null
  durationMs: number
}

type ExtractionResult = {
  candidates: PassiveMemoryCandidate[]
  usage: ModelUsage | null
}

type ApplyResult = {
  createdIds: string[]
  updatedIds: string[]
  evictedIds: string[]
  skipped: Array<{ reason: string; content: string }>
}

type ExistingMemory = Awaited<ReturnType<typeof listMemories>>[number]

type CandidateSimilarityMatch = {
  memoryId: string
  memoryVersion: number
  memoryContent: string
  embeddingSimilarity: number | null
  keywordSimilarity: number
  combinedSimilarity: number
}

type ReconcileResolution = {
  candidateIndex: number
  action: 'create' | 'update' | 'skip'
  content: string
  targetMemoryId: string | null
  reason: string
  confidence: number
}

type ReconcileDecisionReceipt = {
  candidateIndex: number
  action: 'create' | 'update' | 'skip'
  targetMemoryId: string | null
  content: string
  reason: string
  confidence: number
  topMatch: CandidateSimilarityMatch | null
}

type ReconcileResult = {
  candidates: PassiveMemoryCandidate[]
  skipped: Array<{ reason: string; content: string }>
  decisions: ReconcileDecisionReceipt[]
  usage: ModelUsage | null
}

type ActorIdentity = {
  source: string | null
  displayName: string
  handle: string | null
  externalId: string | null
  label: string
  possessiveLabel: string
}

function clampCharsForTokenBudget(text: string, maxTokens: number): string {
  const maxChars = Math.max(1, maxTokens * 4)
  if (text.length <= maxChars) return text
  return text.slice(-maxChars)
}

function normalizeText(input: string): string {
  return input.replace(/\s+/g, ' ').trim()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function getState(): WorkerState {
  const globalState = globalThis as typeof globalThis & {
    [WORKER_STATE_KEY]?: WorkerState
  }

  const existing = globalState[WORKER_STATE_KEY]
  if (existing) {
    return existing
  }

  const created: WorkerState = {
    started: false,
    running: false,
    draining: false,
  }
  globalState[WORKER_STATE_KEY] = created
  return created
}

function retryDelaySeconds(attempt: number): number {
  return Math.min(300, Math.max(10, attempt * 20))
}

function parseAssistantMessageText(content: string | null): string | null {
  if (!content) return null

  try {
    const parsed = JSON.parse(content) as Record<string, unknown>
    const text = typeof parsed.text === 'string' ? parsed.text : null
    if (!text) return null
    const normalized = normalizeText(text)
    return normalized.length > 0 ? normalized : null
  } catch {
    const normalized = normalizeText(content)
    return normalized.length > 0 ? normalized : null
  }
}

function parseCandidate(value: unknown): PassiveMemoryCandidate | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const content = typeof record.content === 'string' ? normalizeText(record.content) : ''
  const kindRaw = record.kind
  const kind = kindRaw === 'task' ? 'task' : kindRaw === 'fact' ? 'fact' : null
  const confidence = typeof record.confidence === 'number' ? record.confidence : null
  const reason = typeof record.reason === 'string' ? normalizeText(record.reason) : ''

  if (!content || !kind || confidence == null) return null
  return {
    content,
    kind,
    confidence,
    reason,
  }
}

function parseExtractionResponse(raw: string): PassiveMemoryCandidate[] {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const memories = Array.isArray(parsed.memories) ? parsed.memories : []
    const candidates = memories.map(parseCandidate).filter((v): v is PassiveMemoryCandidate => !!v)
    return candidates.slice(0, CANDIDATE_LIMIT)
  } catch {
    return []
  }
}

function toActorIdentity(requester: RequesterIdentity | null): ActorIdentity | null {
  if (!requester) return null

  const displayName =
    requester.displayName ??
    (requester.handle ? `@${requester.handle}` : null) ??
    (requester.externalId ? `#${requester.externalId}` : null)
  if (!displayName) return null

  const details: string[] = []
  if (requester.handle && `@${requester.handle}` !== displayName) {
    details.push(`@${requester.handle}`)
  }
  if (requester.externalId && `#${requester.externalId}` !== displayName) {
    details.push(`#${requester.externalId}`)
  }
  if (requester.source) {
    details.push(requester.source)
  }

  const label = details.length > 0 ? `${displayName} (${details.join(', ')})` : displayName
  const possessiveLabel = displayName.endsWith('s') ? `${displayName}'` : `${displayName}'s`

  return {
    source: requester.source,
    displayName,
    handle: requester.handle,
    externalId: requester.externalId,
    label,
    possessiveLabel,
  }
}

function tokenizeForKeywordSimilarity(text: string): string[] {
  return normalizeText(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length >= 3 && !KEYWORD_STOP_WORDS.has(token))
}

function keywordSimilarity(aText: string, bText: string): number {
  const aTokens = new Set(tokenizeForKeywordSimilarity(aText))
  const bTokens = new Set(tokenizeForKeywordSimilarity(bText))
  if (aTokens.size === 0 || bTokens.size === 0) return 0

  let overlap = 0
  for (const token of aTokens) {
    if (bTokens.has(token)) overlap++
  }

  const union = aTokens.size + bTokens.size - overlap
  if (union === 0) return 0
  return overlap / union
}

function clampProbability(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function parseUsageSummary(
  responseJson: Record<string, unknown>,
  modelFallback: string,
  durationMs: number
): ModelUsage | null {
  const usage = isRecord(responseJson.usage) ? responseJson.usage : null
  if (!usage) return null

  const promptTokens = typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : 0
  const completionTokens = typeof usage.completion_tokens === 'number' ? usage.completion_tokens : 0
  const costValue = usage.cost
  const costUsd = typeof costValue === 'number' ? costValue : 0
  const responseModel =
    typeof responseJson.model === 'string' && responseJson.model.length > 0
      ? responseJson.model
      : modelFallback

  return {
    model: responseModel,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    costUsd,
    durationMs,
  }
}

function mergeUsages(first: ModelUsage | null, second: ModelUsage | null): ModelUsage | null {
  if (!first && !second) return null
  if (!first) return second
  if (!second) return first

  return {
    model: first.model === second.model ? first.model : `${first.model},${second.model}`,
    promptTokens: first.promptTokens + second.promptTokens,
    completionTokens: first.completionTokens + second.completionTokens,
    totalTokens: first.totalTokens + second.totalTokens,
    costUsd: (first.costUsd ?? 0) + (second.costUsd ?? 0),
    durationMs: first.durationMs + second.durationMs,
  }
}

async function insertPassiveInferenceUsage(
  queueRow: { job_id: string; agent_id: string; attempt_count: number },
  usage: ModelUsage,
  turnBase: number,
  options?: {
    modelSpanId?: string | null
    attemptKind?: string | null
    attemptIndex?: number | null
  }
): Promise<void> {
  await insertInferenceCall({
    job_id: queueRow.job_id,
    agent_id: queueRow.agent_id,
    turn: turnBase + queueRow.attempt_count,
    model: usage.model,
    prompt_tokens: usage.promptTokens,
    completion_tokens: usage.completionTokens,
    total_tokens: usage.totalTokens,
    cost_usd: usage.costUsd,
    tool_call_names: null,
    finish_reason: 'stop',
    is_fallback: 0,
    duration_ms: usage.durationMs,
    attempt_kind: options?.attemptKind ?? null,
    attempt_index: options?.attemptIndex ?? null,
    payload_state: 'legacy_unavailable',
    model_span_id: options?.modelSpanId ?? null,
  })
}

function parseReconcileResolution(value: unknown): ReconcileResolution | null {
  if (!isRecord(value)) return null

  const candidateIndex = typeof value.candidateIndex === 'number' ? value.candidateIndex : null
  const actionRaw = value.action
  const action =
    actionRaw === 'create' || actionRaw === 'update' || actionRaw === 'skip' ? actionRaw : null
  const reason = typeof value.reason === 'string' ? normalizeText(value.reason) : ''
  const confidenceRaw = typeof value.confidence === 'number' ? value.confidence : null
  const confidence = confidenceRaw == null ? 0 : clampProbability(confidenceRaw)
  const content = typeof value.content === 'string' ? normalizeText(value.content) : ''
  const targetMemoryIdRaw = value.targetMemoryId
  const targetMemoryId =
    typeof targetMemoryIdRaw === 'string' && targetMemoryIdRaw.length > 0 ? targetMemoryIdRaw : null

  if (candidateIndex == null || action == null) return null
  return {
    candidateIndex,
    action,
    content,
    targetMemoryId,
    reason,
    confidence,
  }
}

function parseReconcileResponse(raw: string): ReconcileResolution[] {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const resolutions = Array.isArray(parsed.resolutions) ? parsed.resolutions : []
    return resolutions
      .map(parseReconcileResolution)
      .filter((resolution): resolution is ReconcileResolution => !!resolution)
  } catch {
    return []
  }
}

function findKeywordMatches(
  candidate: PassiveMemoryCandidate,
  existingMemories: ExistingMemory[]
): CandidateSimilarityMatch[] {
  const matches = existingMemories
    .map((memory) => {
      const keyword = keywordSimilarity(candidate.content, memory.content)
      return {
        memoryId: memory.id,
        memoryVersion: memory.version,
        memoryContent: memory.content,
        embeddingSimilarity: null,
        keywordSimilarity: keyword,
        combinedSimilarity: keyword,
      }
    })
    .filter((match) => match.keywordSimilarity >= KEYWORD_SIMILARITY_THRESHOLD)
    .sort((a, b) => b.keywordSimilarity - a.keywordSimilarity)

  return matches.slice(0, MAX_RECONCILE_MATCHES)
}

async function getGatewayCredentials(): Promise<{ apiKey: string; baseUrl: string }> {
  const db = getDb()
  const gateway = await db
    .selectFrom('gateway_settings')
    .selectAll()
    .where('id', '=', 'default')
    .executeTakeFirst()

  let apiKey: string | null = null
  if (gateway?.api_key_encrypted) {
    try {
      apiKey = decrypt(gateway.api_key_encrypted)
    } catch {
      /* decryption failed, fall through to env */
    }
  }

  // Fall back to env vars, matching the main runner's model-client.ts behavior
  apiKey = apiKey || process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || null
  if (!apiKey) {
    throw new Error('Gateway API key not configured for passive memory extraction')
  }

  const useOpenRouter = Boolean(gateway?.api_key_encrypted || process.env.OPENROUTER_API_KEY)
  const baseUrl = useOpenRouter
    ? gateway?.base_url || 'https://openrouter.ai/api/v1'
    : 'https://api.openai.com/v1'

  return { apiKey, baseUrl }
}

async function extractCandidates(
  assistantTranscript: string,
  extractionHint: string,
  actorIdentity: ActorIdentity | null
): Promise<ExtractionResult> {
  const { apiKey, baseUrl } = await getGatewayCredentials()
  const model = process.env.PASSIVE_MEMORY_MODEL || DEFAULT_EXTRACT_MODEL
  const startedAt = Date.now()

  const userPromptParts: string[] = [
    'Review the conversation transcript below and extract any memories worth keeping.',
    'Return 0 memories if nothing new or valuable was said — that is the right answer most of the time.',
    '',
  ]

  if (extractionHint) {
    userPromptParts.push(`Agent-specific guidance: ${sanitize(extractionHint)}`, '')
  }

  if (actorIdentity) {
    userPromptParts.push(
      `Conversation actor identity: ${sanitize(actorIdentity.label)}`,
      'When storing personal facts/preferences about this user, include identity explicitly in content.',
      `Prefer "${sanitize(actorIdentity.possessiveLabel)} ..." over generic "User's ..." phrasing.`,
      ''
    )
  }

  userPromptParts.push(
    'Output JSON: {"memories":[{"content":"...","kind":"fact|task","confidence":0.0-1.0,"reason":"..."}]}',
    'Return {"memories":[]} if nothing is worth remembering.',
    '',
    'Conversation transcript:',
    sanitize(assistantTranscript)
  )

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: EXTRACTION_SYSTEM_PROMPT,
        },
        {
          role: 'user',
          content: userPromptParts.join('\n'),
        },
      ],
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Passive memory extraction request failed (${response.status}): ${errorText}`)
  }

  const responseJson: unknown = await response.json()
  const durationMs = Date.now() - startedAt

  if (!isRecord(responseJson)) {
    return {
      candidates: [],
      usage: null,
    }
  }

  const choicesRaw: unknown[] = Array.isArray(responseJson.choices) ? responseJson.choices : []
  const firstChoice: unknown = choicesRaw[0]
  let rawContent = ''
  if (isRecord(firstChoice) && isRecord(firstChoice.message)) {
    const content = firstChoice.message.content
    if (typeof content === 'string') {
      rawContent = content
    }
  }

  const candidates = parseExtractionResponse(rawContent)
  const usageSummary = parseUsageSummary(responseJson, model, durationMs)

  return {
    candidates,
    usage: usageSummary,
  }
}

async function reconcileCandidates(
  agentId: string,
  candidates: PassiveMemoryCandidate[],
  existingMemories: ExistingMemory[],
  actorIdentity: ActorIdentity | null
): Promise<ReconcileResult> {
  if (candidates.length === 0 || existingMemories.length === 0) {
    return {
      candidates,
      skipped: [],
      decisions: [],
      usage: null,
    }
  }

  const candidateMatches = await Promise.all(
    candidates.map(async (candidate) => {
      const keywordMatches = findKeywordMatches(candidate, existingMemories)
      const embeddingMatches = await findRelatedMemories(
        agentId,
        candidate.content,
        MAX_RECONCILE_MATCHES
      )
      const matchById = new Map<string, CandidateSimilarityMatch>()

      for (const match of keywordMatches) {
        matchById.set(match.memoryId, match)
      }

      for (const match of embeddingMatches) {
        const current = matchById.get(match.id)
        const keyword = current?.keywordSimilarity ?? 0
        const combinedSimilarity = Math.max(match.similarity, keyword)
        matchById.set(match.id, {
          memoryId: match.id,
          memoryVersion: match.version,
          memoryContent: match.content,
          embeddingSimilarity: match.similarity,
          keywordSimilarity: keyword,
          combinedSimilarity,
        })
      }

      const matches = Array.from(matchById.values())
        .filter((match) => {
          return (
            (match.embeddingSimilarity ?? 0) >= EMBEDDING_SIMILARITY_THRESHOLD ||
            match.keywordSimilarity >= KEYWORD_SIMILARITY_THRESHOLD ||
            match.combinedSimilarity >= COMBINED_SIMILARITY_THRESHOLD
          )
        })
        .sort((a, b) => b.combinedSimilarity - a.combinedSimilarity)
        .slice(0, MAX_RECONCILE_MATCHES)

      return matches
    })
  )

  const toReview = candidateMatches
    .map((matches, candidateIndex) => ({ candidateIndex, matches }))
    .filter(({ matches }) => matches.length > 0)

  if (toReview.length === 0) {
    return {
      candidates,
      skipped: [],
      decisions: [],
      usage: null,
    }
  }

  const model =
    process.env.PASSIVE_MEMORY_REFINE_MODEL ||
    process.env.PASSIVE_MEMORY_MODEL ||
    DEFAULT_REFINE_MODEL
  const { apiKey, baseUrl } = await getGatewayCredentials()
  const startedAt = Date.now()

  const reviewPayload = toReview.map(({ candidateIndex, matches }) => {
    const candidate = candidates[candidateIndex]!
    return {
      candidateIndex,
      candidate: {
        content: candidate.content,
        kind: candidate.kind,
        confidence: candidate.confidence,
        reason: candidate.reason,
      },
      relatedMemories: matches.map((match) => ({
        id: match.memoryId,
        version: match.memoryVersion,
        content: match.memoryContent,
        embeddingSimilarity: match.embeddingSimilarity,
        keywordSimilarity: match.keywordSimilarity,
        combinedSimilarity: match.combinedSimilarity,
      })),
    }
  })

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: RECONCILE_SYSTEM_PROMPT,
        },
        {
          role: 'user',
          content: [
            'Resolve each candidate.',
            'Output JSON:',
            '{"resolutions":[{"candidateIndex":0,"action":"create|update|skip","targetMemoryId":"optional id","content":"canonical memory text","reason":"short reason","confidence":0.0-1.0}]}',
            'For action=update: targetMemoryId is required and content should be the final replacement text.',
            'For action=skip: content may be empty.',
            actorIdentity
              ? `Personal memory style: when the memory is about the user, include "${sanitize(actorIdentity.label)}" (or "${sanitize(actorIdentity.possessiveLabel)}") explicitly instead of generic "user".`
              : 'Personal memory style: avoid generic "user" phrasing when identity is known.',
            '',
            'Candidates with related memories:',
            sanitize(JSON.stringify(reviewPayload)),
          ].join('\n'),
        },
      ],
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Passive memory reconcile request failed (${response.status}): ${errorText}`)
  }

  const responseJson: unknown = await response.json()
  const durationMs = Date.now() - startedAt
  if (!isRecord(responseJson)) {
    return {
      candidates,
      skipped: [],
      decisions: [],
      usage: null,
    }
  }

  const choicesRaw: unknown[] = Array.isArray(responseJson.choices) ? responseJson.choices : []
  const firstChoice: unknown = choicesRaw[0]
  let rawContent = ''
  if (isRecord(firstChoice) && isRecord(firstChoice.message)) {
    const content = firstChoice.message.content
    if (typeof content === 'string') {
      rawContent = content
    }
  }

  const usage = parseUsageSummary(responseJson, model, durationMs)
  const resolutions = parseReconcileResponse(rawContent)
  const resolutionByCandidate = new Map<number, ReconcileResolution>()
  for (const resolution of resolutions) {
    if (resolution.candidateIndex < 0 || resolution.candidateIndex >= candidates.length) continue
    resolutionByCandidate.set(resolution.candidateIndex, resolution)
  }

  const resolvedCandidates: PassiveMemoryCandidate[] = []
  const skipped: Array<{ reason: string; content: string }> = []
  const decisions: ReconcileDecisionReceipt[] = []

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]!
    const resolution = resolutionByCandidate.get(i)
    const topMatch = candidateMatches[i]?.[0] ?? null

    if (!resolution) {
      resolvedCandidates.push(candidate)
      continue
    }

    const action = resolution.action
    const content = resolution.content || candidate.content
    const reason = resolution.reason || candidate.reason
    const confidence =
      resolution.confidence > 0 ? clampProbability(resolution.confidence) : candidate.confidence

    decisions.push({
      candidateIndex: i,
      action,
      targetMemoryId: resolution.targetMemoryId,
      content,
      reason,
      confidence,
      topMatch,
    })

    if (action === 'skip') {
      skipped.push({ reason: 'reconcile_skip', content: candidate.content })
      continue
    }

    if (action === 'update' && resolution.targetMemoryId) {
      resolvedCandidates.push({
        ...candidate,
        content,
        reason,
        confidence,
        targetMemoryId: resolution.targetMemoryId,
      })
      continue
    }

    resolvedCandidates.push({
      ...candidate,
      content,
      reason,
      confidence,
    })
  }

  return {
    candidates: resolvedCandidates,
    skipped,
    decisions,
    usage,
  }
}

async function applyCandidates(
  agentId: string,
  candidates: PassiveMemoryCandidate[],
  maxStoredMemories: number,
  reinforceAmount: number
): Promise<ApplyResult> {
  const result: ApplyResult = {
    createdIds: [],
    updatedIds: [],
    evictedIds: [],
    skipped: [],
  }

  const memories = await listMemories(agentId, 0)
  const seenContents = new Set<string>()

  for (const candidate of candidates) {
    if (candidate.confidence < MIN_CONFIDENCE) {
      result.skipped.push({ reason: 'low_confidence', content: candidate.content })
      continue
    }

    if (seenContents.has(candidate.content)) {
      result.skipped.push({ reason: 'duplicate_candidate', content: candidate.content })
      continue
    }
    seenContents.add(candidate.content)

    if (candidate.targetMemoryId) {
      const target = memories.find((memory) => memory.id === candidate.targetMemoryId)
      if (!target) {
        result.skipped.push({
          reason: 'target_memory_not_found_fallback',
          content: candidate.content,
        })
      } else {
        const updated =
          (await updateMemoryWithEmbedding(target.id, candidate.content, target.version)) ??
          (await updateMemoryWithEmbedding(target.id, candidate.content))
        if (updated) {
          const index = memories.findIndex((memory) => memory.id === updated.id)
          if (index >= 0) memories[index] = updated
          result.updatedIds.push(updated.id)
          await reinforceMemory(updated.id, reinforceAmount)
          continue
        }
        result.skipped.push({ reason: 'update_failed', content: candidate.content })
      }
    }

    const related = await findRelatedMemories(agentId, candidate.content, 5)
    const best = related.find((memory) => memory.similarity >= DEDUPE_THRESHOLD)

    if (best) {
      const updated =
        (await updateMemoryWithEmbedding(best.id, candidate.content, best.version)) ??
        (await updateMemoryWithEmbedding(best.id, candidate.content))
      if (updated) {
        const index = memories.findIndex((memory) => memory.id === updated.id)
        if (index >= 0) memories[index] = updated
        result.updatedIds.push(updated.id)
        await reinforceMemory(updated.id, reinforceAmount)
      } else {
        result.skipped.push({ reason: 'update_failed', content: candidate.content })
      }
      continue
    }

    if (memories.length >= maxStoredMemories) {
      const weakestNonPermanent = memories
        .filter((memory) => memory.permanent === 0)
        .sort((a, b) => {
          if (a.strength !== b.strength) return a.strength - b.strength
          return a.updated_at - b.updated_at
        })[0]

      if (!weakestNonPermanent) {
        result.skipped.push({ reason: 'memory_full_all_permanent', content: candidate.content })
        continue
      }

      await deleteMemory(weakestNonPermanent.id)
      const index = memories.findIndex((memory) => memory.id === weakestNonPermanent.id)
      if (index >= 0) memories.splice(index, 1)
      result.evictedIds.push(weakestNonPermanent.id)
    }

    const created = await createMemoryWithEmbedding(agentId, candidate.content, false)
    memories.push(created)
    result.createdIds.push(created.id)
  }

  return result
}

async function processNextPassiveMemoryQueue(): Promise<void> {
  const control = await getRuntimeControl()
  if (control.processing_enabled !== 1) return

  const workerId = `passive-memory-worker:${process.pid}`
  const queueRow = await claimNextPassiveMemoryQueue(workerId, { leaseSeconds: LEASE_SECONDS })
  if (!queueRow) return

  const spanCtx: SpanContext = {
    traceId: queueRow.job_id,
    jobId: queueRow.job_id,
    agentId: queueRow.agent_id,
  }

  const span = await startSpan(spanCtx, 'passive_memory_extract', 'inference', null, {
    queue_id: queueRow.id,
    attempt_count: queueRow.attempt_count,
  })

  const startedAt = Date.now()

  try {
    const agent = await findAgentById(queueRow.agent_id)
    if (!agent) {
      const summary = {
        reason: 'agent_not_found',
      }
      await markPassiveMemoryQueueSkipped(queueRow.id, JSON.stringify(summary))
      await endSpan(span, { skipped: true, reason: 'agent_not_found' })
      return
    }

    const config = parseAgentConfig(agent.config)
    const memorySettings = getMemorySettings(config)
    if (memorySettings.enabled === false || memorySettings.passiveUpdatesEnabled !== true) {
      const summary = {
        reason: 'passive_updates_disabled',
      }
      await markPassiveMemoryQueueSkipped(queueRow.id, JSON.stringify(summary))
      await endSpan(span, { skipped: true, reason: 'passive_updates_disabled' })
      return
    }

    const [messages, existingMemoriesRaw, workItem] = await Promise.all([
      listMessagesByJob(queueRow.job_id),
      listMemories(queueRow.agent_id, 0),
      findWorkItemById(queueRow.work_item_id),
    ])
    const actorIdentity = toActorIdentity(workItem ? getRequesterIdentity(workItem) : null)
    const userTranscriptLabel = actorIdentity ? `User: ${actorIdentity.label}` : 'User'

    // Build a conversation transcript with role labels so the extractor sees context
    const conversationParts: string[] = []
    for (const message of messages) {
      if (message.role !== 'user' && message.role !== 'assistant') continue
      const text = parseAssistantMessageText(message.content)
      if (!text) continue
      const label = message.role === 'user' ? userTranscriptLabel : 'Assistant'
      conversationParts.push(`[${label}]: ${text}`)
    }
    const assistantTranscript = conversationParts.join('\n')

    if (!assistantTranscript) {
      const summary = {
        reason: 'no_assistant_messages',
      }
      await markPassiveMemoryQueueSkipped(queueRow.id, JSON.stringify(summary))
      await endSpan(span, { skipped: true, reason: 'no_assistant_messages' })
      return
    }

    const cappedTranscript = clampCharsForTokenBudget(
      assistantTranscript,
      ASSISTANT_TRANSCRIPT_MAX_TOKENS
    )

    const extraction = await extractCandidates(
      cappedTranscript,
      memorySettings.extractionHint,
      actorIdentity
    )

    if (extraction.usage) {
      await insertPassiveInferenceUsage(
        queueRow,
        extraction.usage,
        PASSIVE_MEMORY_EXTRACT_TURN_BASE,
        {
          modelSpanId: span?.id ?? null,
          attemptKind: 'passive_memory_extract',
          attemptIndex: 0,
        }
      )
    }

    let reconcile: ReconcileResult = {
      candidates: extraction.candidates,
      skipped: [],
      decisions: [],
      usage: null,
    }
    let reconcileError: string | null = null
    try {
      reconcile = await reconcileCandidates(
        queueRow.agent_id,
        extraction.candidates,
        existingMemoriesRaw,
        actorIdentity
      )
    } catch (error) {
      reconcileError = error instanceof Error ? error.message : String(error)
      console.warn(
        '[PassiveMemoryWorker] Reconcile step failed, proceeding with raw candidates',
        error
      )
    }

    if (reconcile.usage) {
      await insertPassiveInferenceUsage(
        queueRow,
        reconcile.usage,
        PASSIVE_MEMORY_REFINE_TURN_BASE,
        {
          modelSpanId: span?.id ?? null,
          attemptKind: 'passive_memory_refine',
          attemptIndex: 1,
        }
      )
    }

    const applyResult = await applyCandidates(
      queueRow.agent_id,
      reconcile.candidates,
      memorySettings.maxStoredMemories,
      memorySettings.reinforceAmount
    )
    const combinedUsage = mergeUsages(extraction.usage, reconcile.usage)
    const skipped = [...reconcile.skipped, ...applyResult.skipped]

    const summary = {
      model: combinedUsage?.model ?? process.env.PASSIVE_MEMORY_MODEL ?? DEFAULT_EXTRACT_MODEL,
      actorIdentityLabel: actorIdentity?.label ?? null,
      inputAssistantChars: cappedTranscript.length,
      candidateCount: extraction.candidates.length,
      reconciledCandidateCount: reconcile.candidates.length,
      minConfidence: MIN_CONFIDENCE,
      dedupeThreshold: DEDUPE_THRESHOLD,
      createdIds: applyResult.createdIds,
      updatedIds: applyResult.updatedIds,
      evictedIds: applyResult.evictedIds,
      skipped,
      decisions: reconcile.decisions,
      usage: combinedUsage,
      extractionUsage: extraction.usage,
      refinementUsage: reconcile.usage,
      reconcileError,
      durationMs: Date.now() - startedAt,
    }

    await markPassiveMemoryQueueCompleted(queueRow.id, JSON.stringify(summary))
    await endSpan(span, {
      model: summary.model,
      candidate_count: summary.candidateCount,
      created_count: summary.createdIds.length,
      updated_count: summary.updatedIds.length,
      evicted_count: summary.evictedIds.length,
      skipped_count: summary.skipped.length,
      extraction_prompt_tokens: extraction.usage?.promptTokens ?? 0,
      extraction_completion_tokens: extraction.usage?.completionTokens ?? 0,
      extraction_cost_usd: extraction.usage?.costUsd ?? 0,
      refinement_prompt_tokens: reconcile.usage?.promptTokens ?? 0,
      refinement_completion_tokens: reconcile.usage?.completionTokens ?? 0,
      refinement_cost_usd: reconcile.usage?.costUsd ?? 0,
      total_inference_cost_usd: combinedUsage?.costUsd ?? 0,
      duration_ms: summary.durationMs,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const retryable =
      queueRow.attempt_count < queueRow.max_attempts &&
      !message.toLowerCase().includes('api key not configured')

    await markPassiveMemoryQueueFailed(queueRow.id, message, {
      retryable,
      retryDelaySeconds: retryDelaySeconds(queueRow.attempt_count),
      summaryJson: JSON.stringify({
        reason: 'processing_error',
        message,
      }),
    })

    await failSpan(span, error, {
      retryable,
      attempt_count: queueRow.attempt_count,
      max_attempts: queueRow.max_attempts,
    })
  }
}

export const __passiveMemoryWorkerTest = {
  processNextPassiveMemoryQueue,
}

export function ensurePassiveMemoryWorker(): void {
  const state = getState()

  state.processFn = processNextPassiveMemoryQueue

  if (state.started) return

  state.started = true

  const tick = async () => {
    if (state.running || state.draining) return
    state.running = true
    try {
      await state.processFn?.()
    } catch (error) {
      if (logSchemaMismatchOnce(error, 'PassiveMemoryWorker')) {
        stopPassiveMemoryWorker()
        return
      }
      console.warn('[PassiveMemoryWorker] Tick failed', error)
    } finally {
      state.running = false
    }
  }

  void tick()

  state.timer = setInterval(() => {
    void tick()
  }, TICK_MS)

  if (typeof state.timer.unref === 'function') {
    state.timer.unref()
  }

  console.log('[PassiveMemoryWorker] Started')
}

export function stopPassiveMemoryWorker(): void {
  const state = getState()
  state.draining = true
  if (state.timer) {
    clearInterval(state.timer)
    state.timer = undefined
  }
}

export function isPassiveMemoryWorkerBusy(): boolean {
  const state = getState()
  return state.running
}
