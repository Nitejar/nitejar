import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentMemory } from '@nitejar/database'

function makeMemoryResult(content: string, kind: string, strength: number): AgentMemory {
  return {
    id: `mem-${Math.random().toString(36).slice(2, 8)}`,
    agent_id: 'agent-1',
    content,
    embedding: null,
    strength,
    access_count: 0,
    permanent: 0,
    version: 1,
    last_accessed_at: null,
    created_at: 0,
    updated_at: 0,
    memory_kind: kind,
  }
}

// Mock all database deps before importing the worker
vi.mock('@nitejar/database', () => ({
  claimNextPassiveMemoryQueue: vi.fn(),
  markPassiveMemoryQueueCompleted: vi.fn(),
  markPassiveMemoryQueueFailed: vi.fn(),
  markPassiveMemoryQueueSkipped: vi.fn(),
  getRuntimeControl: vi.fn(),
  findAgentById: vi.fn(),
  listMessagesByJob: vi.fn(),
  insertInferenceCall: vi.fn(),
  listMemories: vi.fn().mockResolvedValue([]),
  findWorkItemById: vi.fn(),
  deleteMemory: vi.fn(),
  reinforceMemory: vi.fn(),
  getDb: vi.fn(),
  decrypt: vi.fn(),
  PASSIVE_MEMORY_EXTRACT_TURN_BASE: 100,
  PASSIVE_MEMORY_REFINE_TURN_BASE: 200,
}))

vi.mock('@nitejar/agent/memory', () => ({
  createMemoryWithEmbedding: vi
    .fn()
    .mockReturnValue(Promise.resolve(makeMemoryResult('', 'fact', 1.0))),
  findRelatedMemories: vi.fn().mockResolvedValue([]),
  updateMemoryWithEmbedding: vi.fn().mockResolvedValue(null),
}))

vi.mock('@nitejar/agent/prompt-builder', () => ({
  getRequesterIdentity: vi.fn().mockReturnValue(null),
}))

vi.mock('@nitejar/agent/config', () => ({
  getMemorySettings: vi.fn().mockReturnValue({
    enabled: true,
    passiveUpdatesEnabled: true,
    maxMemories: 15,
    maxStoredMemories: 200,
    decayRate: 0.1,
    reinforceAmount: 0.2,
    similarityWeight: 0.5,
    minStrength: 0.1,
    extractionHint: '',
  }),
  parseAgentConfig: vi.fn().mockReturnValue({}),
}))

vi.mock('@nitejar/agent/tracing', () => ({
  startSpan: vi.fn().mockResolvedValue({ id: 'span-1' }),
  endSpan: vi.fn().mockResolvedValue(undefined),
  failSpan: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@nitejar/agent/prompt-sanitize', () => ({
  sanitize: vi.fn((s: string) => s),
}))

vi.mock('./schema-mismatch', () => ({
  logSchemaMismatchOnce: vi.fn().mockReturnValue(false),
}))

const { __passiveMemoryWorkerTest } = await import('./passive-memory-worker')
const { parseCandidate, parseExtractionResponse, applyCandidates } = __passiveMemoryWorkerTest
const Memory = await import('@nitejar/agent/memory')
const mockedCreateMemory = vi.mocked(Memory.createMemoryWithEmbedding)

describe('parseCandidate', () => {
  it('accepts fact kind', () => {
    const result = parseCandidate({
      content: 'User prefers dark mode',
      kind: 'fact',
      confidence: 0.9,
      reason: 'preference',
    })
    expect(result).not.toBeNull()
    expect(result!.kind).toBe('fact')
  })

  it('accepts task kind', () => {
    const result = parseCandidate({
      content: 'Deploy to staging next',
      kind: 'task',
      confidence: 0.8,
      reason: 'next step',
    })
    expect(result).not.toBeNull()
    expect(result!.kind).toBe('task')
  })

  it('accepts digest kind', () => {
    const result = parseCandidate({
      content: 'Josh discussed CI pipeline improvements in #dev channel',
      kind: 'digest',
      confidence: 0.85,
      reason: 'conversation summary',
    })
    expect(result).not.toBeNull()
    expect(result!.kind).toBe('digest')
  })

  it('rejects unknown kind', () => {
    const result = parseCandidate({
      content: 'something',
      kind: 'unknown',
      confidence: 0.9,
      reason: 'test',
    })
    expect(result).toBeNull()
  })

  it('rejects missing content', () => {
    const result = parseCandidate({
      kind: 'fact',
      confidence: 0.9,
      reason: 'test',
    })
    expect(result).toBeNull()
  })
})

describe('parseExtractionResponse', () => {
  it('parses digest candidates from JSON', () => {
    const raw = JSON.stringify({
      memories: [
        { content: 'A fact', kind: 'fact', confidence: 0.9, reason: 'important' },
        {
          content: 'Josh and bot discussed deploy strategy in #ops',
          kind: 'digest',
          confidence: 0.8,
          reason: 'conversation summary',
        },
      ],
    })
    const candidates = parseExtractionResponse(raw)
    expect(candidates).toHaveLength(2)
    expect(candidates[0]!.kind).toBe('fact')
    expect(candidates[1]!.kind).toBe('digest')
  })

  it('filters out invalid kinds', () => {
    const raw = JSON.stringify({
      memories: [
        { content: 'Valid fact', kind: 'fact', confidence: 0.9, reason: 'ok' },
        { content: 'Bad kind', kind: 'opinion', confidence: 0.9, reason: 'nope' },
      ],
    })
    const candidates = parseExtractionResponse(raw)
    expect(candidates).toHaveLength(1)
    expect(candidates[0]!.kind).toBe('fact')
  })
})

describe('applyCandidates digest handling', () => {
  beforeEach(() => {
    mockedCreateMemory.mockReset()
    mockedCreateMemory.mockImplementation(
      (
        _agentId: string,
        content: string,
        _permanent?: boolean,
        options?: { kind?: string; strength?: number }
      ) =>
        Promise.resolve(
          makeMemoryResult(content, options?.kind ?? 'fact', options?.strength ?? 1.0)
        )
    )
    vi.mocked(Memory.findRelatedMemories).mockResolvedValue([])
  })

  it('creates digest memories with strength 0.5', async () => {
    const candidates = [
      {
        content: 'Digest of conversation',
        kind: 'digest' as const,
        confidence: 0.9,
        reason: 'summary',
      },
    ]

    const result = await applyCandidates('agent-1', candidates, 200, 0.2)
    expect(result.createdIds).toHaveLength(1)
    expect(mockedCreateMemory).toHaveBeenCalledWith('agent-1', 'Digest of conversation', false, {
      kind: 'digest',
      strength: 0.5,
    })
  })

  it('creates fact memories with default strength', async () => {
    const candidates = [
      { content: 'A new fact', kind: 'fact' as const, confidence: 0.9, reason: 'important' },
    ]

    const result = await applyCandidates('agent-1', candidates, 200, 0.2)
    expect(result.createdIds).toHaveLength(1)
    expect(mockedCreateMemory).toHaveBeenCalledWith('agent-1', 'A new fact', false, {
      kind: 'fact',
      strength: undefined,
    })
  })

  it('creates task memories with default strength', async () => {
    const candidates = [
      { content: 'Fix the bug', kind: 'task' as const, confidence: 0.9, reason: 'next step' },
    ]

    const result = await applyCandidates('agent-1', candidates, 200, 0.2)
    expect(result.createdIds).toHaveLength(1)
    expect(mockedCreateMemory).toHaveBeenCalledWith('agent-1', 'Fix the bug', false, {
      kind: 'task',
      strength: undefined,
    })
  })
})
