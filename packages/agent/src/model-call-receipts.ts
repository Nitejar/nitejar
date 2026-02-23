import { insertInferenceCall, upsertModelCallPayload } from '@nitejar/database'

export type InferenceAttemptKind =
  | 'triage'
  | 'primary'
  | 'no_tools_fallback'
  | 'image_fallback'
  | 'image_no_tools_fallback'
  | 'last_look'
  | 'post_process'

export type InferencePayloadState =
  | 'captured'
  | 'request_only'
  | 'response_only'
  | 'unavailable'
  | 'legacy_unavailable'
  | 'reconstructed'

export interface RecordInferenceCallReceiptInput {
  jobId: string
  agentId: string
  turn: number
  model: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  costUsd: number | null
  toolCallNames?: string[]
  finishReason?: string | null
  isFallback: boolean
  durationMs: number | null
  attemptKind: InferenceAttemptKind
  attemptIndex: number
  modelSpanId?: string | null
  requestPayload?: unknown
  responsePayload?: unknown
  payloadState?: InferencePayloadState
}

export interface RecordInferenceCallReceiptOptions {
  warn?: (message: string, meta?: Record<string, unknown>) => void
}

function toToolCallNamesJson(names: string[] | undefined): string | null {
  if (!names || names.length === 0) return null
  return JSON.stringify(names)
}

function derivePayloadState(
  requestHash: string | null,
  responseHash: string | null,
  override?: InferencePayloadState
): InferencePayloadState {
  if (override) return override
  if (requestHash && responseHash) return 'captured'
  if (requestHash) return 'request_only'
  if (responseHash) return 'response_only'
  return 'unavailable'
}

async function storePayloadHash(
  payload: unknown,
  metadata: Record<string, unknown>,
  warn?: (message: string, meta?: Record<string, unknown>) => void
): Promise<string | null> {
  try {
    if (payload === undefined) return null
    const stored = await upsertModelCallPayload({ payload, metadata })
    return stored.hash
  } catch (error) {
    warn?.('Failed to persist model payload blob', {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

export async function recordInferenceCallReceipt(
  input: RecordInferenceCallReceiptInput,
  options?: RecordInferenceCallReceiptOptions
): Promise<void> {
  const metadataBase = {
    job_id: input.jobId,
    agent_id: input.agentId,
    turn: input.turn,
    attempt_kind: input.attemptKind,
    attempt_index: input.attemptIndex,
    model: input.model,
    model_span_id: input.modelSpanId ?? null,
  }

  const [requestHash, responseHash] = await Promise.all([
    storePayloadHash(
      input.requestPayload,
      { ...metadataBase, direction: 'request' },
      options?.warn
    ),
    storePayloadHash(
      input.responsePayload,
      { ...metadataBase, direction: 'response' },
      options?.warn
    ),
  ])

  const payloadState = derivePayloadState(requestHash, responseHash, input.payloadState)

  await insertInferenceCall({
    job_id: input.jobId,
    agent_id: input.agentId,
    turn: input.turn,
    model: input.model,
    prompt_tokens: input.promptTokens,
    completion_tokens: input.completionTokens,
    total_tokens: input.totalTokens,
    cost_usd: input.costUsd,
    tool_call_names: toToolCallNamesJson(input.toolCallNames),
    finish_reason: input.finishReason ?? null,
    is_fallback: input.isFallback ? 1 : 0,
    duration_ms: input.durationMs,
    request_payload_hash: requestHash,
    response_payload_hash: responseHash,
    attempt_kind: input.attemptKind,
    attempt_index: input.attemptIndex,
    payload_state: payloadState,
    model_span_id: input.modelSpanId ?? null,
  })
}
