import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeTool, type ToolContext } from './tools'
import * as Database from '@nitejar/database'
import * as Memory from './memory'

vi.mock('@nitejar/database', async () => {
  const actual = await vi.importActual<typeof Database>('@nitejar/database')
  return {
    ...actual,
    listMemories: vi.fn(),
    deleteMemory: vi.fn(),
    updateMemory: vi.fn(),
  }
})

vi.mock('./memory', async () => {
  const actual = await vi.importActual<typeof Memory>('./memory')
  return {
    ...actual,
    createMemoryWithEmbedding: vi.fn(),
    updateMemoryWithEmbedding: vi.fn(),
  }
})

const mockedCreateMemoryWithEmbedding = vi.mocked(Memory.createMemoryWithEmbedding)
const mockedUpdateMemoryWithEmbedding = vi.mocked(Memory.updateMemoryWithEmbedding)
const mockedListMemories = vi.mocked(Database.listMemories)
const mockedDeleteMemory = vi.mocked(Database.deleteMemory)
const mockedUpdateMemory = vi.mocked(Database.updateMemory)

const context: ToolContext = {
  spriteName: 'sprite-1',
  cwd: '/home/sprite',
  agentId: 'agent-1',
}

describe('memory tools', () => {
  beforeEach(() => {
    mockedCreateMemoryWithEmbedding.mockReset()
    mockedUpdateMemoryWithEmbedding.mockReset()
    mockedListMemories.mockReset()
    mockedDeleteMemory.mockReset()
    mockedUpdateMemory.mockReset()
  })

  it('adds a memory for the current agent', async () => {
    mockedCreateMemoryWithEmbedding.mockResolvedValue({
      id: 'memory-1',
      agent_id: 'agent-1',
      content: 'Ship small PRs',
      embedding: null,
      strength: 1,
      access_count: 0,
      permanent: 1,
      version: 1,
      last_accessed_at: null,
      created_at: 0,
      updated_at: 0,
      memory_kind: 'fact',
    })

    const result = await executeTool(
      'add_memory',
      { content: 'Ship small PRs', permanent: true },
      context
    )

    expect(result.success).toBe(true)
    expect(mockedCreateMemoryWithEmbedding).toHaveBeenCalledWith('agent-1', 'Ship small PRs', true)
    expect(result.output).toContain('Stored memory memory-1')
  })

  it('rejects add_memory without agent identity', async () => {
    const result = await executeTool(
      'add_memory',
      { content: 'Remember this' },
      { spriteName: 'sprite-1', cwd: '/home/sprite' }
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('Missing agent identity')
  })

  it('removes memory by id when it belongs to the agent', async () => {
    mockedListMemories.mockResolvedValue([
      {
        id: 'memory-1',
        agent_id: 'agent-1',
        content: 'Ship small PRs',
      } as never,
    ])
    mockedDeleteMemory.mockResolvedValue(true)

    const result = await executeTool('remove_memory', { memory_id: 'memory-1' }, context)

    expect(result.success).toBe(true)
    expect(mockedDeleteMemory).toHaveBeenCalledWith('memory-1')
  })

  it('returns disambiguation error when content match is not unique', async () => {
    mockedListMemories.mockResolvedValue([
      { id: 'memory-1', agent_id: 'agent-1', content: 'Use pnpm workspaces' } as never,
      { id: 'memory-2', agent_id: 'agent-1', content: 'Use pnpm filters' } as never,
    ])

    const result = await executeTool(
      'remove_memory',
      { content: 'pnpm', match_mode: 'contains' },
      context
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('Provide memory_id to disambiguate')
  })

  it('updates memory content by id', async () => {
    mockedListMemories.mockResolvedValue([
      { id: 'memory-1', agent_id: 'agent-1', content: 'Draft PR summary' } as never,
    ])
    mockedUpdateMemoryWithEmbedding.mockResolvedValue({
      id: 'memory-1',
      agent_id: 'agent-1',
      content: 'Draft and post PR summary',
      embedding: null,
      strength: 1,
      access_count: 0,
      permanent: 1,
      version: 1,
      last_accessed_at: null,
      created_at: 0,
      updated_at: 0,
      memory_kind: 'fact',
    })

    const result = await executeTool(
      'update_memory',
      { memory_id: 'memory-1', new_content: 'Draft and post PR summary' },
      context
    )

    expect(result.success).toBe(true)
    expect(mockedUpdateMemoryWithEmbedding).toHaveBeenCalledWith(
      'memory-1',
      'Draft and post PR summary',
      undefined
    )
    expect(result.output).toContain('Updated memory memory-1')
  })

  it('can unpin a memory without changing content', async () => {
    mockedListMemories.mockResolvedValue([
      { id: 'memory-1', agent_id: 'agent-1', content: 'Follow up next week' } as never,
    ])
    mockedUpdateMemory.mockResolvedValue({
      id: 'memory-1',
      agent_id: 'agent-1',
      content: 'Follow up next week',
      embedding: null,
      strength: 0.8,
      access_count: 0,
      permanent: 0,
      last_accessed_at: null,
      created_at: 0,
      updated_at: 0,
    } as never)

    const result = await executeTool(
      'update_memory',
      { memory_id: 'memory-1', permanent: false },
      context
    )

    expect(result.success).toBe(true)
    expect(mockedUpdateMemory).toHaveBeenCalledWith('memory-1', { permanent: 0 }, undefined)
    expect(result.output).toContain('unpinned')
  })

  it('can delete via update_memory', async () => {
    mockedListMemories.mockResolvedValue([
      { id: 'memory-1', agent_id: 'agent-1', content: 'Temporary reminder' } as never,
    ])
    mockedDeleteMemory.mockResolvedValue(true)

    const result = await executeTool(
      'update_memory',
      { memory_id: 'memory-1', delete: true },
      context
    )

    expect(result.success).toBe(true)
    expect(mockedDeleteMemory).toHaveBeenCalledWith('memory-1')
    expect(result.output).toContain('Deleted memory memory-1')
  })
})
