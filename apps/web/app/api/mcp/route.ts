import {
  findAgentById,
  findMemoryById,
  getDb,
  listAgents,
  listMemories,
  updateAgent,
  updateMemory,
  deleteMemory,
  listPassiveMemoryQueueByAgent,
  countPassiveMemoryQueueByAgent,
} from '@nitejar/database'
import { ZodError, type ZodType } from 'zod'
import { mergeAgentConfig, parseAgentConfig, serializeAgentConfig } from '@nitejar/agent/config'
import { createMemoryWithEmbedding, updateMemoryWithEmbedding } from '@nitejar/agent/memory'
import type { AgentConfig } from '@nitejar/agent/types'
import { withMcpAuth } from 'better-auth/plugins'
import { ADMIN_ROLES, hasRequiredRole } from '@/lib/api-auth'
import { getAuth } from '@/lib/auth'
import {
  cancelRunInputSchema,
  getDispatchDecisionsInputSchema,
  getPluginInstanceInputSchema,
  getMessageChunkInputSchema,
  getRunInputSchema,
  getRunTraceInputSchema,
  getWorkItemInputSchema,
  getWorkItemQueueMessagesInputSchema,
  getWorkItemTriageReceiptsInputSchema,
  listPluginInstancesInputSchema,
  mcpInputSchemas,
  pauseRunInputSchema,
  resumeRunInputSchema,
  searchRunsInputSchema,
  searchWorkItemsInputSchema,
  setPluginInstanceAgentAssignmentInputSchema,
  setPluginInstanceEnabledInputSchema,
} from '@/server/services/ops/schemas'
import { getWorkItemOp, searchWorkItemsOp } from '@/server/services/ops/work-items'
import { getRunOp, searchRunsOp } from '@/server/services/ops/runs'
import { getRunTraceOp } from '@/server/services/ops/traces'
import {
  getDispatchDecisionsOp,
  getMessageChunkOp,
  getWorkItemQueueMessagesOp,
  getWorkItemTriageReceiptsOp,
} from '@/server/services/ops/receipts'
import {
  getPluginInstanceOp,
  listPluginInstancesOp,
  setPluginInstanceAgentAssignmentOp,
  setPluginInstanceEnabledOp,
} from '@/server/services/ops/plugin-instances'
import { cancelRunByJob, pauseRunByJob, resumeRunByJob } from '@/server/services/runtime-control'

type JsonRpcId = string | number | null

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: JsonRpcId
  method: string
  params?: unknown
}

interface McpSession {
  userId: string
  clientId: string
  scopes: string
}

type ToolMeta = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  requiredScope: 'agents.read' | 'agents.write' | 'memories.write'
  write: boolean
}

type ToolResult = Record<string, unknown>

class AccessDeniedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AccessDeniedError'
  }
}

const toolCatalog: ToolMeta[] = [
  {
    name: 'list_agents',
    description: 'List agents and their current status/identity metadata.',
    requiredScope: 'agents.read',
    write: false,
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'get_agent_config',
    description: 'Get the parsed configuration JSON for a specific agent.',
    requiredScope: 'agents.read',
    write: false,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['agentId'],
      properties: {
        agentId: { type: 'string' },
      },
    },
  },
  {
    name: 'update_agent_config',
    description:
      'Merge partial config updates into an agent configuration. Supports memorySettings (passiveUpdatesEnabled, enabled, maxMemories, maxStoredMemories, decayRate), sessionSettings, networkPolicy, triageSettings, and model parameters.',
    requiredScope: 'agents.write',
    write: true,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['agentId', 'updates'],
      properties: {
        agentId: { type: 'string' },
        updates: { type: 'object' },
      },
    },
  },
  {
    name: 'get_agent_soul',
    description: 'Get the soul prompt for an agent.',
    requiredScope: 'agents.read',
    write: false,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['agentId'],
      properties: {
        agentId: { type: 'string' },
      },
    },
  },
  {
    name: 'update_agent_soul',
    description: 'Update the soul prompt for an agent.',
    requiredScope: 'agents.write',
    write: true,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['agentId', 'soul'],
      properties: {
        agentId: { type: 'string' },
        soul: { type: 'string' },
      },
    },
  },
  {
    name: 'list_agent_memories',
    description: 'List memories for an agent.',
    requiredScope: 'agents.read',
    write: false,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['agentId'],
      properties: {
        agentId: { type: 'string' },
        minStrength: { type: 'number' },
      },
    },
  },
  {
    name: 'upsert_agent_memory',
    description: 'Create a new memory or update an existing one for an agent.',
    requiredScope: 'memories.write',
    write: true,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['agentId', 'content'],
      properties: {
        agentId: { type: 'string' },
        memoryId: { type: 'string' },
        content: { type: 'string' },
        permanent: { type: 'boolean' },
      },
    },
  },
  {
    name: 'delete_agent_memory',
    description: 'Delete a memory by ID.',
    requiredScope: 'memories.write',
    write: true,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['memoryId'],
      properties: {
        memoryId: { type: 'string' },
      },
    },
  },
  {
    name: 'search_work_items',
    description: 'Search work items with keyword and structured filters.',
    requiredScope: 'agents.read',
    write: false,
    inputSchema: mcpInputSchemas.search_work_items,
  },
  {
    name: 'get_work_item',
    description: 'Get one work item with optional runs, dispatches, and effects.',
    requiredScope: 'agents.read',
    write: false,
    inputSchema: mcpInputSchemas.get_work_item,
  },
  {
    name: 'get_work_item_queue_messages',
    description: 'List queue messages for a work item with paging and status filters.',
    requiredScope: 'agents.read',
    write: false,
    inputSchema: mcpInputSchemas.get_work_item_queue_messages,
  },
  {
    name: 'get_dispatch_decisions',
    description: 'Get dispatch decision timeline with parsed arbiter decisions.',
    requiredScope: 'agents.read',
    write: false,
    inputSchema: mcpInputSchemas.get_dispatch_decisions,
  },
  {
    name: 'get_work_item_triage_receipts',
    description: 'Get triage receipts for a work item, including usage/cost metadata.',
    requiredScope: 'agents.read',
    write: false,
    inputSchema: mcpInputSchemas.get_work_item_triage_receipts,
  },
  {
    name: 'get_message_chunk',
    description: 'Read a message content chunk by chunkIndex/chunkSize for large payloads.',
    requiredScope: 'agents.read',
    write: false,
    inputSchema: mcpInputSchemas.get_message_chunk,
  },
  {
    name: 'search_runs',
    description: 'Search runs with keyword and structured filters.',
    requiredScope: 'agents.read',
    write: false,
    inputSchema: mcpInputSchemas.search_runs,
  },
  {
    name: 'get_run',
    description: 'Get one run with optional messages, background tasks, and control state.',
    requiredScope: 'agents.read',
    write: false,
    inputSchema: mcpInputSchemas.get_run,
  },
  {
    name: 'get_run_trace',
    description: 'Get trace summary for a run, with opt-in trace sections.',
    requiredScope: 'agents.read',
    write: false,
    inputSchema: mcpInputSchemas.get_run_trace,
  },
  {
    name: 'list_plugin_instances',
    description: 'List plugin instances with filters and assigned agents.',
    requiredScope: 'agents.read',
    write: false,
    inputSchema: mcpInputSchemas.list_plugin_instances,
  },
  {
    name: 'get_plugin_instance',
    description: 'Get one plugin instance with redacted config and assignments.',
    requiredScope: 'agents.read',
    write: false,
    inputSchema: mcpInputSchemas.get_plugin_instance,
  },
  {
    name: 'pause_run',
    description: 'Request pause for an active run.',
    requiredScope: 'agents.write',
    write: true,
    inputSchema: mcpInputSchemas.pause_run,
  },
  {
    name: 'resume_run',
    description: 'Resume a paused run.',
    requiredScope: 'agents.write',
    write: true,
    inputSchema: mcpInputSchemas.resume_run,
  },
  {
    name: 'cancel_run',
    description: 'Cancel an active run.',
    requiredScope: 'agents.write',
    write: true,
    inputSchema: mcpInputSchemas.cancel_run,
  },
  {
    name: 'set_plugin_instance_enabled',
    description: 'Enable or disable a plugin instance.',
    requiredScope: 'agents.write',
    write: true,
    inputSchema: mcpInputSchemas.set_plugin_instance_enabled,
  },
  {
    name: 'set_plugin_instance_agent_assignment',
    description: 'Assign or unassign an agent for a plugin instance.',
    requiredScope: 'agents.write',
    write: true,
    inputSchema: mcpInputSchemas.set_plugin_instance_agent_assignment,
  },
  {
    name: 'list_passive_memory_queue',
    description:
      'List passive memory extraction queue entries for an agent. Shows extraction job status, attempts, errors, and results. Use to inspect whether passive memory extraction is running, pending, or failing.',
    requiredScope: 'agents.read',
    write: false,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['agentId'],
      properties: {
        agentId: { type: 'string', description: 'The agent ID to list passive memory queue for.' },
        status: {
          type: 'string',
          enum: ['pending', 'running', 'completed', 'failed', 'skipped'],
          description: 'Filter by queue entry status.',
        },
        limit: { type: 'number', description: 'Max entries to return (default 50, max 500).' },
        offset: { type: 'number', description: 'Offset for pagination.' },
      },
    },
  },
  {
    name: 'get_passive_memory_queue_stats',
    description:
      'Get aggregate counts of passive memory extraction queue entries by status for an agent. Quick way to check if extraction is healthy.',
    requiredScope: 'agents.read',
    write: false,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['agentId'],
      properties: {
        agentId: { type: 'string', description: 'The agent ID to get queue stats for.' },
      },
    },
  },
]

const now = () => Math.floor(Date.now() / 1000)
const uuid = () => crypto.randomUUID()

function jsonRpcResult(id: JsonRpcId, result: unknown): Response {
  return Response.json({ jsonrpc: '2.0', id, result })
}

function jsonRpcError(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
  status?: number
): Response {
  return Response.json(
    {
      jsonrpc: '2.0',
      id,
      error: { code, message, ...(data !== undefined ? { data } : {}) },
    },
    { status: status ?? (code === -32603 ? 500 : 400) }
  )
}

function toScopeSet(scopes: string): Set<string> {
  return new Set(
    scopes
      .split(/[,\s]+/)
      .map((value) => value.trim())
      .filter(Boolean)
  )
}

function hasScope(scopeSet: Set<string>, required: string): boolean {
  if (scopeSet.has(required) || scopeSet.has('*')) return true
  const [namespace] = required.split('.')
  return !!namespace && scopeSet.has(`${namespace}.*`)
}

async function assertMcpAccess(session: McpSession, tool: ToolMeta): Promise<{ role: string }> {
  const scopeSet = toScopeSet(session.scopes || '')
  if (!hasScope(scopeSet, tool.requiredScope)) {
    throw new AccessDeniedError(`Missing required scope: ${tool.requiredScope}`)
  }

  const db = getDb()
  const user = await db
    .selectFrom('users')
    .select(['id', 'role', 'status'])
    .where('id', '=', session.userId)
    .executeTakeFirst()
  if (!user) {
    throw new AccessDeniedError('User not found for MCP token')
  }
  if (user.status !== 'active') {
    throw new AccessDeniedError('User is not active')
  }
  if (tool.write && !hasRequiredRole(user.role, ADMIN_ROLES)) {
    throw new AccessDeniedError('Write operations require admin or superadmin role')
  }

  return { role: user.role }
}

async function appendMcpAuditLog(input: {
  toolName: string
  actorUserId: string
  role: string | null
  clientId: string
  targetAgentId?: string | null
  result: 'allowed' | 'denied' | 'error'
  details?: Record<string, unknown>
}): Promise<void> {
  const db = getDb()
  await db
    .insertInto('audit_logs')
    .values({
      id: uuid(),
      event_type: 'MCP_TOOL_WRITE',
      agent_id: input.targetAgentId ?? null,
      github_repo_id: null,
      capability: input.toolName,
      result: input.result,
      metadata: JSON.stringify({
        actorUserId: input.actorUserId,
        role: input.role ?? 'unknown',
        clientId: input.clientId,
        ...(input.details ? { details: input.details } : {}),
      }),
      created_at: now(),
    })
    .execute()
}

function assertObject(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(message)
  }
  return value as Record<string, unknown>
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${key} is required`)
  }
  return value.trim()
}

function optionalString(args: Record<string, unknown>, key: string): string | null {
  const value = args[key]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parseWithSchema<T>(schema: ZodType<T>, input: Record<string, unknown>): T {
  try {
    return schema.parse(input)
  } catch (error) {
    if (error instanceof ZodError) {
      const detail = error.issues
        .map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`)
        .join('; ')
      throw new Error(`Invalid arguments: ${detail}`)
    }
    throw error
  }
}

function parseJsonUnknown(value: string | null): unknown {
  if (!value) return null
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

function inferWriteChangedFields(
  toolName: ToolMeta['name'],
  args: Record<string, unknown>
): string[] | undefined {
  switch (toolName) {
    case 'update_agent_config': {
      const updates = args.updates
      if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
        return undefined
      }
      return Object.keys(updates as Record<string, unknown>).sort()
    }
    case 'update_agent_soul':
      return ['soul']
    case 'upsert_agent_memory': {
      const changed = ['content']
      if (Object.prototype.hasOwnProperty.call(args, 'permanent')) {
        changed.push('permanent')
      }
      return changed
    }
    case 'delete_agent_memory':
      return ['memory']
    case 'pause_run':
      return ['run_control']
    case 'resume_run':
      return ['run_control']
    case 'cancel_run':
      return ['run_control']
    case 'set_plugin_instance_enabled':
      return ['enabled']
    case 'set_plugin_instance_agent_assignment':
      return ['assignment']
    default:
      return undefined
  }
}

function isAccessDeniedError(error: unknown): error is AccessDeniedError {
  return error instanceof AccessDeniedError
}

function formatMemory(memory: {
  id: string
  agent_id: string
  content: string
  strength: number
  access_count: number
  permanent: number
  last_accessed_at: number | null
  created_at: number
  updated_at: number
}) {
  return {
    id: memory.id,
    agentId: memory.agent_id,
    content: memory.content,
    strength: memory.strength,
    accessCount: memory.access_count,
    permanent: memory.permanent === 1,
    lastAccessedAt: memory.last_accessed_at,
    createdAt: memory.created_at,
    updatedAt: memory.updated_at,
  }
}

async function handleToolCall(
  toolName: string,
  args: unknown,
  session: McpSession
): Promise<ToolResult> {
  const tool = toolCatalog.find((item) => item.name === toolName)
  if (!tool) {
    throw new Error(`Unknown tool: ${toolName}`)
  }

  const parsedArgs = args == null ? {} : assertObject(args, 'arguments must be an object')
  let accessRole: string | null = null
  let targetAgentId: string | null = optionalString(parsedArgs, 'agentId')
  const changedFields = tool.write ? inferWriteChangedFields(tool.name, parsedArgs) : undefined

  try {
    const access = await assertMcpAccess(session, tool)
    accessRole = access.role

    switch (toolName) {
      case 'list_agents': {
        const agents = await listAgents()
        return {
          agents: agents.map((agent) => {
            const config = parseAgentConfig(agent.config)
            return {
              id: agent.id,
              handle: agent.handle,
              name: agent.name,
              status: agent.status,
              title: config.title ?? null,
              emoji: config.emoji ?? null,
            }
          }),
        }
      }
      case 'get_agent_config': {
        const agentId = requireString(parsedArgs, 'agentId')
        const agent = await findAgentById(agentId)
        if (!agent) throw new Error('Agent not found')
        return { agentId: agent.id, config: parseAgentConfig(agent.config) }
      }
      case 'update_agent_config': {
        const agentId = requireString(parsedArgs, 'agentId')
        const updates = assertObject(
          parsedArgs.updates,
          'updates must be an object'
        ) as Partial<AgentConfig>
        const agent = await findAgentById(agentId)
        if (!agent) throw new Error('Agent not found')

        const existing = parseAgentConfig(agent.config)
        const merged = mergeAgentConfig(existing, updates)
        const updated = await updateAgent(agentId, { config: serializeAgentConfig(merged) })
        if (!updated) throw new Error('Failed to update agent config')

        await appendMcpAuditLog({
          toolName,
          actorUserId: session.userId,
          role: accessRole,
          clientId: session.clientId,
          targetAgentId: agentId,
          result: 'allowed',
          details: { changedFields: Object.keys(updates).sort() },
        })

        return { agentId, config: merged }
      }
      case 'get_agent_soul': {
        const agentId = requireString(parsedArgs, 'agentId')
        const agent = await findAgentById(agentId)
        if (!agent) throw new Error('Agent not found')
        const config = parseAgentConfig(agent.config)
        return { agentId, soul: config.soul ?? '' }
      }
      case 'update_agent_soul': {
        const agentId = requireString(parsedArgs, 'agentId')
        const soul = requireString(parsedArgs, 'soul')
        const agent = await findAgentById(agentId)
        if (!agent) throw new Error('Agent not found')
        const merged = mergeAgentConfig(parseAgentConfig(agent.config), { soul })
        const updated = await updateAgent(agentId, { config: serializeAgentConfig(merged) })
        if (!updated) throw new Error('Failed to update agent soul')

        await appendMcpAuditLog({
          toolName,
          actorUserId: session.userId,
          role: accessRole,
          clientId: session.clientId,
          targetAgentId: agentId,
          result: 'allowed',
          details: { changedFields: ['soul'], soulLength: soul.length },
        })

        return { agentId, soul: merged.soul ?? '' }
      }
      case 'list_agent_memories': {
        const agentId = requireString(parsedArgs, 'agentId')
        const minStrength =
          typeof parsedArgs.minStrength === 'number' && Number.isFinite(parsedArgs.minStrength)
            ? parsedArgs.minStrength
            : 0
        const agent = await findAgentById(agentId)
        if (!agent) throw new Error('Agent not found')
        const memories = await listMemories(agentId, minStrength)
        return { agentId, memories: memories.map(formatMemory) }
      }
      case 'upsert_agent_memory': {
        const agentId = requireString(parsedArgs, 'agentId')
        const content = requireString(parsedArgs, 'content')
        const permanent =
          typeof parsedArgs.permanent === 'boolean' ? parsedArgs.permanent : undefined
        const memoryId =
          typeof parsedArgs.memoryId === 'string' && parsedArgs.memoryId.trim().length > 0
            ? parsedArgs.memoryId.trim()
            : null

        const agent = await findAgentById(agentId)
        if (!agent) throw new Error('Agent not found')

        let memory
        if (memoryId) {
          const existing = await findMemoryById(memoryId)
          if (!existing) throw new Error('Memory not found')
          if (existing.agent_id !== agentId) {
            throw new Error('Memory does not belong to the requested agent')
          }

          memory = await updateMemoryWithEmbedding(memoryId, content)
          if (!memory) throw new Error('Failed to update memory')

          if (permanent !== undefined && memory.permanent !== (permanent ? 1 : 0)) {
            memory = (await updateMemory(memory.id, { permanent: permanent ? 1 : 0 })) ?? memory
          }
        } else {
          memory = await createMemoryWithEmbedding(agentId, content, permanent ?? false)
        }

        await appendMcpAuditLog({
          toolName,
          actorUserId: session.userId,
          role: accessRole,
          clientId: session.clientId,
          targetAgentId: agentId,
          result: 'allowed',
          details: {
            changedFields: permanent !== undefined ? ['content', 'permanent'] : ['content'],
            memoryId: memory.id,
            operation: memoryId ? 'update' : 'create',
          },
        })

        return { memory: formatMemory(memory) }
      }
      case 'delete_agent_memory': {
        const memoryId = requireString(parsedArgs, 'memoryId')
        const memory = await findMemoryById(memoryId)
        if (!memory) throw new Error('Memory not found')
        targetAgentId = memory.agent_id

        const deleted = await deleteMemory(memoryId)
        if (!deleted) throw new Error('Failed to delete memory')

        await appendMcpAuditLog({
          toolName,
          actorUserId: session.userId,
          role: accessRole,
          clientId: session.clientId,
          targetAgentId: memory.agent_id,
          result: 'allowed',
          details: { changedFields: ['memory'], memoryId },
        })

        return { deleted: true, memoryId }
      }
      case 'search_work_items': {
        const input = parseWithSchema(searchWorkItemsInputSchema, parsedArgs)
        return searchWorkItemsOp(input)
      }
      case 'get_work_item': {
        const input = parseWithSchema(getWorkItemInputSchema, parsedArgs)
        return getWorkItemOp(input)
      }
      case 'get_work_item_queue_messages': {
        const input = parseWithSchema(getWorkItemQueueMessagesInputSchema, parsedArgs)
        return getWorkItemQueueMessagesOp(input)
      }
      case 'get_dispatch_decisions': {
        const input = parseWithSchema(getDispatchDecisionsInputSchema, parsedArgs)
        return getDispatchDecisionsOp(input)
      }
      case 'get_work_item_triage_receipts': {
        const input = parseWithSchema(getWorkItemTriageReceiptsInputSchema, parsedArgs)
        return getWorkItemTriageReceiptsOp(input)
      }
      case 'get_message_chunk': {
        const input = parseWithSchema(getMessageChunkInputSchema, parsedArgs)
        return getMessageChunkOp(input)
      }
      case 'search_runs': {
        const input = parseWithSchema(searchRunsInputSchema, parsedArgs)
        return searchRunsOp(input)
      }
      case 'get_run': {
        const input = parseWithSchema(getRunInputSchema, parsedArgs)
        return getRunOp(input)
      }
      case 'get_run_trace': {
        const input = parseWithSchema(getRunTraceInputSchema, parsedArgs)
        return getRunTraceOp(input)
      }
      case 'list_plugin_instances': {
        const input = parseWithSchema(listPluginInstancesInputSchema, parsedArgs)
        return listPluginInstancesOp(input)
      }
      case 'get_plugin_instance': {
        const input = parseWithSchema(getPluginInstanceInputSchema, parsedArgs)
        return getPluginInstanceOp(input)
      }
      case 'pause_run': {
        const input = parseWithSchema(pauseRunInputSchema, parsedArgs)
        const result = await pauseRunByJob({
          jobId: input.jobId,
          actor: input.actor ?? 'admin',
          reason: input.reason,
        })
        await appendMcpAuditLog({
          toolName,
          actorUserId: session.userId,
          role: accessRole,
          clientId: session.clientId,
          result: 'allowed',
          details: {
            changedFields: ['run_control'],
            jobId: input.jobId,
            actor: input.actor,
            paused: result.ok,
          },
        })
        return result
      }
      case 'resume_run': {
        const input = parseWithSchema(resumeRunInputSchema, parsedArgs)
        const result = await resumeRunByJob(input)
        await appendMcpAuditLog({
          toolName,
          actorUserId: session.userId,
          role: accessRole,
          clientId: session.clientId,
          result: 'allowed',
          details: {
            changedFields: ['run_control'],
            jobId: input.jobId,
            resumed: result.ok,
          },
        })
        return result
      }
      case 'cancel_run': {
        const input = parseWithSchema(cancelRunInputSchema, parsedArgs)
        const result = await cancelRunByJob({
          jobId: input.jobId,
          actor: input.actor ?? 'admin',
          reason: input.reason,
        })
        await appendMcpAuditLog({
          toolName,
          actorUserId: session.userId,
          role: accessRole,
          clientId: session.clientId,
          result: 'allowed',
          details: {
            changedFields: ['run_control'],
            jobId: input.jobId,
            actor: input.actor,
            cancelled: result.ok,
          },
        })
        return result
      }
      case 'set_plugin_instance_enabled': {
        const input = parseWithSchema(setPluginInstanceEnabledInputSchema, parsedArgs)
        const result = await setPluginInstanceEnabledOp(input)
        await appendMcpAuditLog({
          toolName,
          actorUserId: session.userId,
          role: accessRole,
          clientId: session.clientId,
          result: 'allowed',
          details: {
            changedFields: ['enabled'],
            pluginInstanceId: input.pluginInstanceId,
            enabled: input.enabled,
          },
        })
        return result
      }
      case 'set_plugin_instance_agent_assignment': {
        const input = parseWithSchema(setPluginInstanceAgentAssignmentInputSchema, parsedArgs)
        const result = await setPluginInstanceAgentAssignmentOp(input)
        await appendMcpAuditLog({
          toolName,
          actorUserId: session.userId,
          role: accessRole,
          clientId: session.clientId,
          targetAgentId: input.agentId,
          result: 'allowed',
          details: {
            changedFields: ['assignment'],
            pluginInstanceId: input.pluginInstanceId,
            agentId: input.agentId,
            enabled: input.enabled,
          },
        })
        return result
      }
      case 'list_passive_memory_queue': {
        const agentId = requireString(parsedArgs, 'agentId')
        const agent = await findAgentById(agentId)
        if (!agent) throw new Error('Agent not found')
        const status = typeof parsedArgs.status === 'string' ? parsedArgs.status : undefined
        const limit = typeof parsedArgs.limit === 'number' ? parsedArgs.limit : undefined
        const offset = typeof parsedArgs.offset === 'number' ? parsedArgs.offset : undefined

        const entries = await listPassiveMemoryQueueByAgent(agentId, {
          status,
          limit,
          offset,
        })

        return {
          agentId,
          entries: entries.map((e) => ({
            id: e.id,
            jobId: e.job_id,
            workItemId: e.work_item_id,
            dispatchId: e.dispatch_id,
            status: e.status,
            attemptCount: e.attempt_count,
            maxAttempts: e.max_attempts,
            lastError: e.last_error,
            summaryJson: parseJsonUnknown(e.summary_json),
            createdAt: e.created_at,
            startedAt: e.started_at,
            completedAt: e.completed_at,
          })),
          count: entries.length,
        }
      }
      case 'get_passive_memory_queue_stats': {
        const agentId = requireString(parsedArgs, 'agentId')
        const agent = await findAgentById(agentId)
        if (!agent) throw new Error('Agent not found')
        const config = parseAgentConfig(agent.config)
        const counts = await countPassiveMemoryQueueByAgent(agentId)

        return {
          agentId,
          passiveUpdatesEnabled: config.memorySettings?.passiveUpdatesEnabled ?? false,
          memoryEnabled: config.memorySettings?.enabled !== false,
          statusCounts: counts,
          total: Object.values(counts).reduce((sum, n) => sum + n, 0),
        }
      }
      default:
        throw new Error(`Unknown tool: ${toolName}`)
    }
  } catch (error) {
    if (tool.write) {
      const denied = isAccessDeniedError(error)
      await appendMcpAuditLog({
        toolName,
        actorUserId: session.userId,
        role: accessRole,
        clientId: session.clientId,
        targetAgentId,
        result: denied ? 'denied' : 'error',
        details: {
          ...(changedFields ? { changedFields } : {}),
          error: error instanceof Error ? error.message : String(error),
        },
      })
    }
    throw error
  }
}

function createMcpHandler() {
  return withMcpAuth(getAuth() as never, async (request: Request, session: McpSession) => {
    let rpc: JsonRpcRequest
    try {
      const payload = (await request.json()) as unknown
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return jsonRpcError(null, -32600, 'Invalid JSON-RPC request')
      }
      rpc = payload as JsonRpcRequest
    } catch {
      return jsonRpcError(null, -32700, 'Parse error')
    }

    const id = rpc.id ?? null
    if (rpc.jsonrpc !== '2.0' || typeof rpc.method !== 'string') {
      return jsonRpcError(id, -32600, 'Invalid JSON-RPC request')
    }

    if (!('id' in rpc)) {
      return new Response(null, { status: 204 })
    }

    try {
      switch (rpc.method) {
        case 'initialize':
          return jsonRpcResult(id, {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'nitejar-mcp', version: '0.1.0' },
          })
        case 'notifications/initialized':
          return jsonRpcResult(id, {})
        case 'tools/list':
          return jsonRpcResult(id, {
            tools: toolCatalog.map((tool) => ({
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema,
            })),
          })
        case 'tools/call': {
          const params = assertObject(rpc.params, 'tools/call params are required')
          const name = requireString(params, 'name')
          const result = await handleToolCall(name, params.arguments, session)
          return jsonRpcResult(id, {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          })
        }
        default:
          return jsonRpcError(id, -32601, `Method not found: ${rpc.method}`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (isAccessDeniedError(error)) {
        return jsonRpcError(id, -32001, message, undefined, 403)
      }
      return jsonRpcError(id, -32603, message)
    }
  })
}

export const __mcpTest = {
  toolCatalog,
  handleToolCall,
}

export function GET(): Response {
  return Response.json({
    name: 'nitejar-mcp',
    transport: 'streamable-http',
    endpoint: '/api/mcp',
  })
}

export async function POST(request: Request): Promise<Response> {
  return createMcpHandler()(request)
}
