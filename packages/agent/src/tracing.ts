import { insertSpan, completeSpan } from '@nitejar/database'
import { agentWarn } from './agent-logger'

export interface SpanContext {
  traceId: string
  jobId: string
  agentId: string
}

export interface SpanHandle {
  id: string
  startTime: number
  context: SpanContext
  initialAttributes?: Record<string, unknown>
}

/**
 * Start a new span. Inserts a row with end_time = NULL.
 * Never throws — tracing failures must not break the inference loop.
 */
export async function startSpan(
  ctx: SpanContext,
  name: string,
  kind: string,
  parentSpanId: string | null,
  attributes?: Record<string, unknown>
): Promise<SpanHandle | null> {
  const startTime = Date.now()
  try {
    const span = await insertSpan({
      trace_id: ctx.traceId,
      parent_span_id: parentSpanId,
      name,
      kind,
      status: 'ok',
      start_time: startTime,
      end_time: null,
      duration_ms: null,
      attributes: attributes ? JSON.stringify(attributes) : null,
      job_id: ctx.jobId,
      agent_id: ctx.agentId,
    })
    return { id: span.id, startTime, context: ctx, initialAttributes: attributes }
  } catch (err) {
    agentWarn('Failed to start span', {
      name,
      kind,
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

/**
 * Complete a span successfully. Merges additional attributes if provided.
 * Never throws.
 */
export async function endSpan(
  handle: SpanHandle | null,
  attributes?: Record<string, unknown>
): Promise<void> {
  if (!handle) return
  const endTime = Date.now()
  try {
    const merged = { ...handle.initialAttributes, ...attributes }
    const hasAttrs = Object.keys(merged).length > 0
    await completeSpan(handle.id, {
      end_time: endTime,
      duration_ms: endTime - handle.startTime,
      status: 'ok',
      ...(hasAttrs ? { attributes: JSON.stringify(merged) } : {}),
    })
  } catch (err) {
    agentWarn('Failed to end span', {
      spanId: handle.id,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/**
 * Mark a span as failed with error info.
 * Never throws.
 */
export async function failSpan(
  handle: SpanHandle | null,
  error: unknown,
  attributes?: Record<string, unknown>
): Promise<void> {
  if (!handle) return
  const endTime = Date.now()
  const errorMessage = error instanceof Error ? error.message : String(error)
  try {
    const merged = { ...handle.initialAttributes, ...attributes, error: errorMessage }
    await completeSpan(handle.id, {
      end_time: endTime,
      duration_ms: endTime - handle.startTime,
      status: 'error',
      attributes: JSON.stringify(merged),
    })
  } catch (err) {
    agentWarn('Failed to fail span', {
      spanId: handle.id,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
