import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSelectUser, mockAuditInsert, mockGetDb } = vi.hoisted(() => {
  const selectUser = vi.fn()
  const auditInsert = vi.fn()
  const getDb = vi.fn(() => ({
    selectFrom: vi.fn(() => ({
      select: vi.fn(() => ({
        where: vi.fn(() => ({
          executeTakeFirst: selectUser,
        })),
      })),
    })),
    insertInto: vi.fn(() => ({
      values: vi.fn((value: unknown) => {
        auditInsert(value)
        return {
          execute: vi.fn(),
        }
      }),
    })),
  }))

  return {
    mockSelectUser: selectUser,
    mockAuditInsert: auditInsert,
    mockGetDb: getDb,
  }
})

vi.mock('@nitejar/database', () => ({
  findAgentById: vi.fn(),
  findMemoryById: vi.fn(),
  getDb: mockGetDb,
  listAgents: vi.fn(),
  listMemories: vi.fn(),
  updateAgent: vi.fn(),
  updateMemory: vi.fn(),
  deleteMemory: vi.fn(),
}))

vi.mock('@nitejar/agent/config', () => ({
  mergeAgentConfig: vi.fn((a: object, b: object) => ({ ...a, ...b })),
  parseAgentConfig: vi.fn(() => ({})),
  serializeAgentConfig: vi.fn(() => '{}'),
}))

vi.mock('@nitejar/agent/memory', () => ({
  createMemoryWithEmbedding: vi.fn(),
  updateMemoryWithEmbedding: vi.fn(),
}))

vi.mock('@/server/services/ops/work-items', () => ({
  searchWorkItemsOp: vi.fn(),
  getWorkItemOp: vi.fn(),
}))

vi.mock('@/server/services/ops/runs', () => ({
  searchRunsOp: vi.fn(),
  getRunOp: vi.fn(),
}))

vi.mock('@/server/services/ops/traces', () => ({
  getRunTraceOp: vi.fn(),
}))

vi.mock('@/server/services/ops/receipts', () => ({
  getWorkItemQueueMessagesOp: vi.fn(),
  getDispatchDecisionsOp: vi.fn(),
  getWorkItemTriageReceiptsOp: vi.fn(),
  getMessageChunkOp: vi.fn(),
}))

vi.mock('@/server/services/ops/schemas', async () => {
  const { z } = await import('zod')
  return {
    searchWorkItemsInputSchema: z.object({ limit: z.number().optional() }).strict(),
    getWorkItemInputSchema: z.object({ workItemId: z.string() }).strict(),
    getWorkItemQueueMessagesInputSchema: z.object({ workItemId: z.string() }).strict(),
    getDispatchDecisionsInputSchema: z
      .object({ workItemId: z.string().optional(), dispatchId: z.string().optional() })
      .strict(),
    getWorkItemTriageReceiptsInputSchema: z.object({ workItemId: z.string() }).strict(),
    getMessageChunkInputSchema: z.object({ messageId: z.string() }).strict(),
    searchRunsInputSchema: z.object({}).strict(),
    getRunInputSchema: z.object({ jobId: z.string() }).strict(),
    getRunTraceInputSchema: z.object({ jobId: z.string() }).strict(),
    listPluginInstancesInputSchema: z.object({}).strict(),
    getPluginInstanceInputSchema: z.object({ pluginInstanceId: z.string() }).strict(),
    pauseRunInputSchema: z
      .object({
        jobId: z.string(),
        actor: z.string().default('admin'),
        reason: z.string().optional(),
      })
      .strict(),
    resumeRunInputSchema: z.object({ jobId: z.string() }).strict(),
    cancelRunInputSchema: z
      .object({
        jobId: z.string(),
        actor: z.string().default('admin'),
        reason: z.string().optional(),
      })
      .strict(),
    setPluginInstanceEnabledInputSchema: z
      .object({
        pluginInstanceId: z.string(),
        enabled: z.boolean(),
      })
      .strict(),
    setPluginInstanceAgentAssignmentInputSchema: z
      .object({
        pluginInstanceId: z.string(),
        agentId: z.string(),
        enabled: z.boolean(),
      })
      .strict(),
    mcpInputSchemas: {
      search_work_items: {},
      get_work_item: {},
      get_work_item_queue_messages: {},
      get_dispatch_decisions: {},
      get_work_item_triage_receipts: {},
      get_message_chunk: {},
      search_runs: {},
      get_run: {},
      get_run_trace: {},
      list_plugin_instances: {},
      get_plugin_instance: {},
      pause_run: {},
      resume_run: {},
      cancel_run: {},
      set_plugin_instance_enabled: {},
      set_plugin_instance_agent_assignment: {},
    },
  }
})

vi.mock('@/server/services/ops/plugin-instances', () => ({
  listPluginInstancesOp: vi.fn(),
  getPluginInstanceOp: vi.fn(),
  setPluginInstanceEnabledOp: vi.fn(() =>
    Promise.resolve({ pluginInstanceId: 'int-1', enabled: true })
  ),
  setPluginInstanceAgentAssignmentOp: vi.fn(),
}))

vi.mock('@/server/services/runtime-control', () => ({
  pauseRunByJob: vi.fn(() => Promise.resolve({ ok: true, dispatchId: 'dispatch-1' })),
  resumeRunByJob: vi.fn(() => Promise.resolve({ ok: true, dispatchId: 'dispatch-1' })),
  cancelRunByJob: vi.fn(() => Promise.resolve({ ok: true, dispatchId: 'dispatch-1' })),
}))

vi.mock('better-auth/plugins', () => ({
  withMcpAuth: (_auth: unknown, handler: unknown) => handler,
}))

vi.mock('@/lib/auth', () => ({
  auth: {},
}))

vi.mock('@/lib/api-auth', () => ({
  ADMIN_ROLES: ['admin', 'superadmin'],
  hasRequiredRole: (role: string | null | undefined, allowed: string[]) =>
    !!role && allowed.includes(role),
}))

import { __mcpTest } from './route'

describe('mcp route tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSelectUser.mockResolvedValue({ id: 'u-1', role: 'admin', status: 'active' })
  })

  it('includes newly added tools in catalog', () => {
    const names = __mcpTest.toolCatalog.map((tool) => tool.name)
    expect(names).toContain('search_work_items')
    expect(names).toContain('get_work_item')
    expect(names).toContain('search_runs')
    expect(names).toContain('get_run')
    expect(names).toContain('get_run_trace')
    expect(names).toContain('get_work_item_queue_messages')
    expect(names).toContain('get_dispatch_decisions')
    expect(names).toContain('get_work_item_triage_receipts')
    expect(names).toContain('get_message_chunk')
    expect(names).toContain('list_plugin_instances')
    expect(names).toContain('get_plugin_instance')
    expect(names).toContain('pause_run')
    expect(names).toContain('resume_run')
    expect(names).toContain('cancel_run')
    expect(names).toContain('set_plugin_instance_enabled')
    expect(names).toContain('set_plugin_instance_agent_assignment')
  })

  it('returns deterministic schema validation errors', async () => {
    await expect(
      __mcpTest.handleToolCall(
        'search_work_items',
        { limit: 'bad' },
        { userId: 'u-1', clientId: 'c-1', scopes: 'agents.read' }
      )
    ).rejects.toThrow('Invalid arguments: limit')
  })

  it('enforces scope gate for write tools and records denied audit', async () => {
    await expect(
      __mcpTest.handleToolCall(
        'pause_run',
        { jobId: 'job-1' },
        { userId: 'u-1', clientId: 'c-1', scopes: 'agents.read' }
      )
    ).rejects.toThrow('Missing required scope: agents.write')

    const deniedLog = mockAuditInsert.mock.calls.find(
      (call) => (call[0] as { result?: string }).result === 'denied'
    )
    expect(deniedLog).toBeTruthy()
  })

  it('enforces role gate for write tools and records denied audit', async () => {
    mockSelectUser.mockResolvedValue({ id: 'u-1', role: 'member', status: 'active' })

    await expect(
      __mcpTest.handleToolCall(
        'pause_run',
        { jobId: 'job-1' },
        { userId: 'u-1', clientId: 'c-1', scopes: 'agents.write' }
      )
    ).rejects.toThrow('Write operations require admin or superadmin role')

    const deniedLog = mockAuditInsert.mock.calls.find(
      (call) => (call[0] as { result?: string }).result === 'denied'
    )
    expect(deniedLog).toBeTruthy()
  })

  it('records allowed audit logs for successful writes', async () => {
    const result = await __mcpTest.handleToolCall(
      'pause_run',
      { jobId: 'job-1', actor: 'tester' },
      { userId: 'u-1', clientId: 'c-1', scopes: 'agents.write' }
    )
    expect(result).toEqual({ ok: true, dispatchId: 'dispatch-1' })

    const allowedLog = mockAuditInsert.mock.calls.find(
      (call) => (call[0] as { result?: string }).result === 'allowed'
    )
    expect(allowedLog).toBeTruthy()
  })
})
