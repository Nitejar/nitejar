import { beforeEach, describe, expect, it, vi } from 'vitest'
import { recordInferenceCallReceipt } from './model-call-receipts'
import * as Database from '@nitejar/database'

vi.mock('@nitejar/database', () => ({
  insertInferenceCall: vi.fn(),
  upsertModelCallPayload: vi.fn(),
}))

const mockedInsertInferenceCall = vi.mocked(Database.insertInferenceCall)
const mockedUpsertModelCallPayload = vi.mocked(Database.upsertModelCallPayload)

describe('recordInferenceCallReceipt', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockedInsertInferenceCall.mockResolvedValue({ id: 'call-1' } as never)
  })

  it('stores request/response payloads and writes captured state', async () => {
    mockedUpsertModelCallPayload
      .mockResolvedValueOnce({ hash: 'req-hash' } as never)
      .mockResolvedValueOnce({ hash: 'resp-hash' } as never)

    await recordInferenceCallReceipt({
      jobId: 'job-1',
      agentId: 'agent-1',
      turn: 2,
      model: 'test-model',
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      costUsd: 0.01,
      finishReason: 'stop',
      isFallback: false,
      durationMs: 123,
      attemptKind: 'primary',
      attemptIndex: 0,
      modelSpanId: 'span-1',
      requestPayload: { messages: [{ role: 'user', content: 'hi' }] },
      responsePayload: { id: 'resp-1' },
    })

    expect(mockedUpsertModelCallPayload).toHaveBeenCalledTimes(2)
    expect(mockedInsertInferenceCall).toHaveBeenCalledWith(
      expect.objectContaining({
        request_payload_hash: 'req-hash',
        response_payload_hash: 'resp-hash',
        attempt_kind: 'primary',
        attempt_index: 0,
        payload_state: 'captured',
        model_span_id: 'span-1',
      })
    )
  })

  it('writes request_only state when response payload is unavailable', async () => {
    mockedUpsertModelCallPayload.mockResolvedValueOnce({ hash: 'req-hash' } as never)

    await recordInferenceCallReceipt({
      jobId: 'job-1',
      agentId: 'agent-1',
      turn: 0,
      model: 'test-model',
      promptTokens: 3,
      completionTokens: 0,
      totalTokens: 3,
      costUsd: null,
      isFallback: true,
      durationMs: 50,
      attemptKind: 'triage',
      attemptIndex: 0,
      requestPayload: { triage: true },
    })

    expect(mockedUpsertModelCallPayload).toHaveBeenCalledTimes(1)
    expect(mockedInsertInferenceCall).toHaveBeenCalledWith(
      expect.objectContaining({
        request_payload_hash: 'req-hash',
        response_payload_hash: null,
        payload_state: 'request_only',
      })
    )
  })

  it('logs warnings and falls back to unavailable state when payload storage fails', async () => {
    const warn = vi.fn()
    mockedUpsertModelCallPayload.mockRejectedValue(new Error('storage failed'))

    await recordInferenceCallReceipt(
      {
        jobId: 'job-1',
        agentId: 'agent-1',
        turn: 1,
        model: 'test-model',
        promptTokens: 1,
        completionTokens: 1,
        totalTokens: 2,
        costUsd: null,
        isFallback: true,
        durationMs: 20,
        attemptKind: 'no_tools_fallback',
        attemptIndex: 1,
        requestPayload: { x: 1 },
        responsePayload: { y: 2 },
      },
      { warn }
    )

    expect(warn).toHaveBeenCalled()
    expect(mockedInsertInferenceCall).toHaveBeenCalledWith(
      expect.objectContaining({
        request_payload_hash: null,
        response_payload_hash: null,
        payload_state: 'unavailable',
      })
    )
  })
})
