import type Anthropic from '@anthropic-ai/sdk'
import { listMemories, deleteMemory, updateMemory } from '@nitejar/database'
import { createMemoryWithEmbedding, updateMemoryWithEmbedding } from '../../memory'
import type { ToolContext, ToolHandler } from '../types'

export const memoryDefinitions: Anthropic.Tool[] = [
  {
    name: 'add_memory',
    description:
      'Store a long-term memory for this agent so it can be recalled in future conversations.',
    input_schema: {
      type: 'object' as const,
      properties: {
        content: {
          type: 'string',
          description: 'The memory content to store.',
        },
        permanent: {
          type: 'boolean',
          description: 'Whether this memory should be pinned and never decay (default: false).',
        },
      },
      required: ['content'],
    },
  },
  {
    name: 'remove_memory',
    description:
      'Delete one stored memory for this agent, by memory ID or by matching memory text.',
    input_schema: {
      type: 'object' as const,
      properties: {
        memory_id: {
          type: 'string',
          description: 'Exact memory ID to delete (preferred when known).',
        },
        content: {
          type: 'string',
          description: 'Memory text to match when memory_id is not provided.',
        },
        match_mode: {
          type: 'string',
          description: 'How to match content: exact or contains (default: exact).',
        },
      },
    },
  },
  {
    name: 'update_memory',
    description:
      'Update or delete one stored memory for this agent by ID or matching existing memory text. Supports content edits and pin/unpin. Provide version for safe concurrent updates.',
    input_schema: {
      type: 'object' as const,
      properties: {
        memory_id: {
          type: 'string',
          description: 'Exact memory ID to update/delete (preferred when known).',
        },
        content: {
          type: 'string',
          description: 'Existing memory text to match when memory_id is not provided.',
        },
        match_mode: {
          type: 'string',
          description: 'How to match content: exact or contains (default: exact).',
        },
        new_content: {
          type: 'string',
          description: 'Updated memory text. Regenerates embedding when provided.',
        },
        permanent: {
          type: 'boolean',
          description: 'Set pinned status explicitly. true pins the memory, false unpins it.',
        },
        delete: {
          type: 'boolean',
          description: 'If true, delete the matched memory instead of updating it.',
        },
        version: {
          type: 'integer',
          description:
            'Expected version for optimistic concurrency. If provided and the memory has been updated since, the update will fail with a conflict error. Re-read the memory to get the current version.',
        },
      },
    },
  },
]

type MemoryMatchMode = 'exact' | 'contains'

async function resolveMemoryId(
  context: ToolContext,
  memoryId: string,
  content: string,
  matchMode: MemoryMatchMode
): Promise<{ targetId?: string; error?: string }> {
  const memories = await listMemories(context.agentId!, 0)
  if (memories.length === 0) {
    return { error: 'No stored memories found for this agent.' }
  }

  if (memoryId) {
    const found = memories.find((memory) => memory.id === memoryId)
    if (!found) {
      return {
        error: `Memory ${memoryId} not found for this agent.`,
      }
    }
    return { targetId: found.id }
  }

  const normalizedQuery = content.toLowerCase()
  const matches = memories.filter((memory) => {
    const normalizedContent = memory.content.toLowerCase()
    return matchMode === 'contains'
      ? normalizedContent.includes(normalizedQuery)
      : normalizedContent === normalizedQuery
  })

  if (matches.length === 0) {
    return { error: 'No matching memory found.' }
  }

  if (matches.length > 1) {
    const options = matches
      .slice(0, 5)
      .map((memory) => `- ${memory.id}: ${memory.content}`)
      .join('\n')

    return {
      error: `Matched ${matches.length} memories. Provide memory_id to disambiguate.\n${options}`,
    }
  }

  return { targetId: matches[0]!.id }
}

export const addMemoryTool: ToolHandler = async (input, context) => {
  if (!context.agentId) {
    return { success: false, error: 'Missing agent identity for memory operations.' }
  }

  const content = typeof input.content === 'string' ? input.content.trim() : ''
  if (!content) {
    return { success: false, error: 'content is required.' }
  }

  const permanent = input.permanent === true
  const memory = await createMemoryWithEmbedding(context.agentId, content, permanent)

  return {
    success: true,
    output: `Stored memory ${memory.id}${permanent ? ' (pinned)' : ''}.`,
  }
}

export const removeMemoryTool: ToolHandler = async (input, context) => {
  if (!context.agentId) {
    return { success: false, error: 'Missing agent identity for memory operations.' }
  }

  const memoryId = typeof input.memory_id === 'string' ? input.memory_id.trim() : ''
  const content = typeof input.content === 'string' ? input.content.trim() : ''
  const matchMode = input.match_mode === 'contains' ? 'contains' : 'exact'

  if (!memoryId && !content) {
    return { success: false, error: 'Provide memory_id or content.' }
  }

  const resolved = await resolveMemoryId(context, memoryId, content, matchMode)
  if (!resolved.targetId) {
    return { success: false, error: resolved.error ?? 'No matching memory found.' }
  }

  const deleted = await deleteMemory(resolved.targetId)
  if (!deleted) {
    return { success: false, error: `Failed to delete memory ${resolved.targetId}.` }
  }

  return {
    success: true,
    output: `Deleted memory ${resolved.targetId}.`,
  }
}

export const updateMemoryTool: ToolHandler = async (input, context) => {
  if (!context.agentId) {
    return { success: false, error: 'Missing agent identity for memory operations.' }
  }

  const memoryId = typeof input.memory_id === 'string' ? input.memory_id.trim() : ''
  const content = typeof input.content === 'string' ? input.content.trim() : ''
  const matchMode = input.match_mode === 'contains' ? 'contains' : 'exact'
  const hasNewContent = typeof input.new_content === 'string'
  const newContent = hasNewContent ? (input.new_content as string).trim() : ''
  const hasPermanent = typeof input.permanent === 'boolean'
  const permanent = hasPermanent ? (input.permanent as boolean) : undefined
  const shouldDelete = input.delete === true
  const expectedVersion = typeof input.version === 'number' ? input.version : undefined

  if (!memoryId && !content) {
    return { success: false, error: 'Provide memory_id or content.' }
  }

  if (hasNewContent && !newContent) {
    return { success: false, error: 'new_content cannot be empty.' }
  }

  if (shouldDelete && (hasNewContent || hasPermanent)) {
    return {
      success: false,
      error: 'delete=true cannot be combined with new_content or permanent.',
    }
  }

  if (!shouldDelete && !hasNewContent && !hasPermanent) {
    return {
      success: false,
      error: 'Provide at least one update: new_content, permanent, or delete=true.',
    }
  }

  const resolved = await resolveMemoryId(context, memoryId, content, matchMode)
  if (!resolved.targetId) {
    return { success: false, error: resolved.error ?? 'No matching memory found.' }
  }

  if (shouldDelete) {
    const deleted = await deleteMemory(resolved.targetId)
    if (!deleted) {
      return { success: false, error: `Failed to delete memory ${resolved.targetId}.` }
    }

    return {
      success: true,
      output: `Deleted memory ${resolved.targetId}.`,
    }
  }

  if (hasNewContent) {
    const updated = await updateMemoryWithEmbedding(resolved.targetId, newContent, expectedVersion)
    if (!updated) {
      if (expectedVersion !== undefined) {
        return {
          success: false,
          error: `Version conflict: memory ${resolved.targetId} has been updated since version ${expectedVersion}. Re-read the memory to get the current version before updating.`,
        }
      }
      return { success: false, error: `Failed to update memory ${resolved.targetId}.` }
    }
  }

  if (hasPermanent) {
    const permanentUpdate = permanent ? { permanent: 1, strength: 1.0 } : { permanent: 0 }
    // Pass version for permanent-only updates too
    const versionToUse = hasNewContent ? undefined : expectedVersion
    const updated = await updateMemory(resolved.targetId, permanentUpdate, versionToUse)
    if (!updated) {
      if (versionToUse !== undefined) {
        return {
          success: false,
          error: `Version conflict: memory ${resolved.targetId} has been updated since version ${versionToUse}. Re-read the memory to get the current version before updating.`,
        }
      }
      return { success: false, error: `Failed to update memory ${resolved.targetId}.` }
    }
  }

  const changes: string[] = []
  if (hasNewContent) changes.push('content')
  if (hasPermanent) changes.push(permanent ? 'pinned' : 'unpinned')

  return {
    success: true,
    output: `Updated memory ${resolved.targetId} (${changes.join(', ')}).`,
  }
}
