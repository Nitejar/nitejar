import type Anthropic from '@anthropic-ai/sdk'
import { queryActivityLog } from '@nitejar/database'
import { generateEmbedding, isEmbeddingsAvailable } from '../../embeddings'
import type { ToolHandler } from '../types'

export const queryActivityDefinition: Anthropic.Tool = {
  name: 'query_activity',
  description:
    'Search the cross-agent activity log. Use this to check what other agents are working on, find potential conflicts, or review recent activity. Results include agent handle, status, summary, and resource references.',
  input_schema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description:
          'Text to search for (embedded for similarity search). Describe the work or topic you want to find.',
      },
      agent_handle: {
        type: 'string',
        description: 'Filter by agent handle (e.g. "scout"). Optional.',
      },
      status: {
        type: 'string',
        description: 'Filter by status: starting, completed, or failed. Optional.',
      },
      max_age_minutes: {
        type: 'integer',
        description: 'Maximum age of entries in minutes (default: 60).',
      },
      limit: {
        type: 'integer',
        description: 'Maximum number of results (default: 10).',
      },
    },
    required: ['query'],
  },
}

export const queryActivityTool: ToolHandler = async (input) => {
  const query = typeof input.query === 'string' ? input.query.trim() : ''
  if (!query) {
    return { success: false, error: 'query is required.' }
  }

  const agentHandle = typeof input.agent_handle === 'string' ? input.agent_handle.trim() : undefined
  const status = typeof input.status === 'string' ? input.status.trim() : undefined
  const maxAgeMinutes = typeof input.max_age_minutes === 'number' ? input.max_age_minutes : 60
  const limit = typeof input.limit === 'number' ? input.limit : 10

  let queryEmbedding: number[] | undefined
  if (isEmbeddingsAvailable()) {
    try {
      queryEmbedding = await generateEmbedding(query)
    } catch {
      // Proceed without embedding — will fall back to filtered list
    }
  }

  const entries = await queryActivityLog({
    queryEmbedding,
    agentHandle,
    status,
    maxAgeSeconds: maxAgeMinutes * 60,
    limit,
  })

  if (entries.length === 0) {
    return {
      success: true,
      output: 'No matching activity found.',
    }
  }

  const now = Math.floor(Date.now() / 1000)
  const lines = entries.map((entry) => {
    const age = formatAge(now - entry.created_at)
    const sim =
      'similarity' in entry && entry.similarity ? ` (sim: ${entry.similarity.toFixed(2)})` : ''
    const resources = entry.resources ? ` | ref: ${parseResourcesSafe(entry.resources)}` : ''
    return `- [${age}] agent:${entry.agent_handle} — ${entry.status}: ${entry.summary}${resources}${sim}`
  })

  return {
    success: true,
    output: lines.join('\n'),
  }
}

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}min ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
}

function parseResourcesSafe(resourcesJson: string): string {
  try {
    const arr = JSON.parse(resourcesJson) as string[]
    return arr.join(', ')
  } catch {
    return resourcesJson
  }
}
