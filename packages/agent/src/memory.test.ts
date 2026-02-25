import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScoredMemory } from './types'

vi.mock('@nitejar/database', async () => {
  const actual = await vi.importActual('@nitejar/database')
  const mod = actual as Record<string, unknown>
  return {
    ...mod,
    listMemories: vi.fn().mockResolvedValue([]),
    decayMemories: vi.fn().mockResolvedValue(0),
    reinforceMemory: vi.fn().mockResolvedValue(null),
    findSimilarMemories: vi.fn().mockResolvedValue([]),
    createMemory: vi.fn().mockReturnValue(
      Promise.resolve({
        id: 'mem-new',
        agent_id: 'agent-1',
        content: '',
        embedding: null,
        strength: 1.0,
        access_count: 0,
        permanent: 0,
        version: 1,
        last_accessed_at: null,
        created_at: 0,
        updated_at: 0,
        memory_kind: 'fact',
      })
    ),
    updateMemory: vi.fn().mockResolvedValue(null),
    serializeEmbedding: vi.fn().mockReturnValue(new Uint8Array(0)),
    cosineSimilarity: mod.cosineSimilarity,
    deserializeEmbedding: mod.deserializeEmbedding,
  }
})

vi.mock('./embeddings', () => ({
  generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
  isEmbeddingsAvailable: vi.fn().mockReturnValue(false),
}))

vi.mock('./config', () => ({
  getMemorySettings: vi.fn().mockReturnValue({
    enabled: true,
    maxMemories: 15,
    maxStoredMemories: 200,
    decayRate: 0.1,
    reinforceAmount: 0.2,
    similarityWeight: 0.5,
    minStrength: 0.1,
    passiveUpdatesEnabled: false,
    extractionHint: '',
  }),
}))

// Import after mocks
const { formatMemoriesForPrompt, createMemoryWithEmbedding } = await import('./memory')
const Database = await import('@nitejar/database')

function makeScoredMemory(overrides: Partial<ScoredMemory> = {}): ScoredMemory {
  return {
    id: 'mem-1',
    agentId: 'agent-1',
    content: 'test memory',
    strength: 1,
    accessCount: 0,
    permanent: false,
    version: 1,
    lastAccessedAt: null,
    createdAt: 0,
    updatedAt: 0,
    score: 50,
    ...overrides,
  }
}

describe('formatMemoriesForPrompt', () => {
  it('returns empty string for no memories', () => {
    expect(formatMemoriesForPrompt([])).toBe('')
  })

  it('formats fact memories without filtering', () => {
    const memories = [
      makeScoredMemory({ id: 'f1', content: 'fact one', memoryKind: 'fact' }),
      makeScoredMemory({ id: 'f2', content: 'fact two', memoryKind: 'fact' }),
      makeScoredMemory({ id: 'f3', content: 'fact three', memoryKind: 'fact' }),
    ]
    const result = formatMemoriesForPrompt(memories)
    expect(result).toContain('fact one')
    expect(result).toContain('fact two')
    expect(result).toContain('fact three')
  })

  it('caps digest memories at 2', () => {
    const memories = [
      makeScoredMemory({ id: 'd1', content: 'digest one', memoryKind: 'digest', score: 90 }),
      makeScoredMemory({ id: 'd2', content: 'digest two', memoryKind: 'digest', score: 80 }),
      makeScoredMemory({ id: 'd3', content: 'digest three', memoryKind: 'digest', score: 70 }),
    ]
    const result = formatMemoriesForPrompt(memories)
    expect(result).toContain('digest one')
    expect(result).toContain('digest two')
    expect(result).not.toContain('digest three')
  })

  it('does not affect facts/tasks when capping digests', () => {
    const memories = [
      makeScoredMemory({ id: 'f1', content: 'fact one', memoryKind: 'fact', score: 95 }),
      makeScoredMemory({ id: 'd1', content: 'digest one', memoryKind: 'digest', score: 90 }),
      makeScoredMemory({ id: 'd2', content: 'digest two', memoryKind: 'digest', score: 85 }),
      makeScoredMemory({ id: 'd3', content: 'digest three', memoryKind: 'digest', score: 80 }),
      makeScoredMemory({ id: 't1', content: 'task one', memoryKind: 'task', score: 75 }),
    ]
    const result = formatMemoriesForPrompt(memories)
    expect(result).toContain('fact one')
    expect(result).toContain('digest one')
    expect(result).toContain('digest two')
    expect(result).not.toContain('digest three')
    expect(result).toContain('task one')
  })

  it('treats undefined memoryKind as non-digest (no cap)', () => {
    const memories = [
      makeScoredMemory({ id: 'u1', content: 'legacy one' }),
      makeScoredMemory({ id: 'u2', content: 'legacy two' }),
      makeScoredMemory({ id: 'u3', content: 'legacy three' }),
    ]
    const result = formatMemoriesForPrompt(memories)
    expect(result).toContain('legacy one')
    expect(result).toContain('legacy two')
    expect(result).toContain('legacy three')
  })
})

describe('createMemoryWithEmbedding', () => {
  const mockedCreateMemory = vi.mocked(Database.createMemory)

  beforeEach(() => {
    mockedCreateMemory.mockReset()
    mockedCreateMemory.mockReturnValue(
      Promise.resolve({
        id: 'mem-new',
        agent_id: 'agent-1',
        content: '',
        embedding: null,
        strength: 1.0,
        access_count: 0,
        permanent: 0,
        version: 1,
        last_accessed_at: null,
        created_at: 0,
        updated_at: 0,
        memory_kind: 'fact',
      }) as never
    )
  })

  it('defaults to kind=fact and strength=1.0', async () => {
    await createMemoryWithEmbedding('agent-1', 'a fact')
    expect(mockedCreateMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        memory_kind: 'fact',
        strength: 1.0,
      })
    )
  })

  it('passes kind and strength from options', async () => {
    await createMemoryWithEmbedding('agent-1', 'a digest', false, {
      kind: 'digest',
      strength: 0.5,
    })
    expect(mockedCreateMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        memory_kind: 'digest',
        strength: 0.5,
      })
    )
  })

  it('uses default strength when only kind is provided', async () => {
    await createMemoryWithEmbedding('agent-1', 'a task', false, { kind: 'task' })
    expect(mockedCreateMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        memory_kind: 'task',
        strength: 1.0,
      })
    )
  })
})
