import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as DatabaseModule from '@nitejar/database'
import type { ToolContext } from './tools'
import { exploreCodebaseTool } from './tools/handlers/explore'

vi.mock('@nitejar/database', async () => {
  const actual = await vi.importActual<typeof DatabaseModule>('@nitejar/database')
  return {
    ...actual,
    findJobById: vi.fn(),
    findAgentById: vi.fn(),
    findWorkItemById: vi.fn(),
    createChildJob: vi.fn(),
  }
})

vi.mock('./explore-runner', () => ({
  runExploreChild: vi.fn(),
}))

import { createChildJob, findAgentById, findJobById, findWorkItemById } from '@nitejar/database'
import { runExploreChild } from './explore-runner'

const mockedFindJobById = vi.mocked(findJobById)
const mockedFindAgentById = vi.mocked(findAgentById)
const mockedFindWorkItemById = vi.mocked(findWorkItemById)
const mockedCreateChildJob = vi.mocked(createChildJob)
const mockedRunExploreChild = vi.mocked(runExploreChild)

const context: ToolContext = {
  spriteName: 'nitejar-scout',
  activeSandboxName: 'home',
  cwd: '/home/sprite/repos/nitejar/nitejar',
  agentId: 'agent-1',
  jobId: 'job-parent',
}

function createContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    ...context,
    ...overrides,
  }
}

describe('exploreCodebaseTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedFindJobById.mockResolvedValue({
      id: 'job-parent',
      work_item_id: 'work-1',
      agent_id: 'agent-1',
      parent_job_id: null,
      root_job_id: 'job-parent',
      run_kind: 'primary',
      origin_tool_name: null,
      status: 'RUNNING',
      error_text: null,
      todo_state: null,
      final_response: null,
      started_at: 1,
      completed_at: null,
      created_at: 1,
      updated_at: 1,
    } as never)
    mockedFindAgentById.mockResolvedValue({
      id: 'agent-1',
      handle: 'scout',
      name: 'Scout',
      sprite_id: 'sprite-1',
      config: JSON.stringify({ model: 'arcee-ai/trinity-large-preview:free' }),
      status: 'idle',
      created_at: 1,
      updated_at: 1,
    } as never)
    mockedFindWorkItemById.mockResolvedValue({
      id: 'work-1',
      plugin_instance_id: null,
      session_key: 'session-1',
      source: 'manual',
      source_ref: 'manual:1',
      status: 'IN_PROGRESS',
      title: 'Explore question',
      payload: JSON.stringify({ body: 'Parent run work context' }),
      created_at: 1,
      updated_at: 1,
    } as never)
    mockedCreateChildJob.mockResolvedValue({
      id: 'job-child',
      work_item_id: 'work-1',
      agent_id: 'agent-1',
      parent_job_id: 'job-parent',
      root_job_id: 'job-parent',
      run_kind: 'child_explore',
      origin_tool_name: 'explore_codebase',
      status: 'PENDING',
      error_text: null,
      todo_state: null,
      final_response: null,
      started_at: null,
      completed_at: null,
      created_at: 2,
      updated_at: 2,
    } as never)
    mockedRunExploreChild.mockResolvedValue(
      'Answer: Authentication lives in the web auth router.\nKey files:\n- apps/web/server/auth.ts — entrypoint'
    )
  })

  it('creates a child explore job and returns the compressed summary', async () => {
    const result = await exploreCodebaseTool(
      { question: 'Where is authentication handled?', depth: 'quick' },
      context
    )

    expect(mockedCreateChildJob).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'job-parent', work_item_id: 'work-1', agent_id: 'agent-1' }),
      expect.objectContaining({
        run_kind: 'child_explore',
        origin_tool_name: 'explore_codebase',
      })
    )
    expect(mockedRunExploreChild).toHaveBeenCalledWith(
      expect.objectContaining({
        question: 'Where is authentication handled?',
        depth: 'quick',
        cwd: '/home/sprite/repos/nitejar/nitejar',
        activeSandboxName: 'home',
      })
    )
    expect(result.success).toBe(true)
    expect(result.output).toContain('Answer:')
    expect(result.output).toContain('[child run: job-child]')
  })

  it('rejects when question is missing', async () => {
    const result = await exploreCodebaseTool({}, context)

    expect(result.success).toBe(false)
    expect(result.error).toBe('question is required')
    expect(mockedCreateChildJob).not.toHaveBeenCalled()
  })

  it('rejects when job or agent context is missing', async () => {
    const missingJobResult = await exploreCodebaseTool(
      { question: 'Where is auth handled?' },
      createContext({ jobId: undefined })
    )
    const missingAgentResult = await exploreCodebaseTool(
      { question: 'Where is auth handled?' },
      createContext({ agentId: undefined })
    )

    expect(missingJobResult.success).toBe(false)
    expect(missingJobResult.error).toContain('requires an active job and agent context')
    expect(missingAgentResult.success).toBe(false)
    expect(missingAgentResult.error).toContain('requires an active job and agent context')
  })

  it('falls back to medium depth for invalid depth input', async () => {
    await exploreCodebaseTool(
      { question: 'Where is authentication handled?', depth: 'wildly-deep' },
      context
    )

    expect(mockedRunExploreChild).toHaveBeenCalledWith(
      expect.objectContaining({
        depth: 'medium',
      })
    )
  })

  it('returns an error when the parent job cannot be found', async () => {
    mockedFindJobById.mockResolvedValueOnce(null as never)

    const result = await exploreCodebaseTool({ question: 'Where is auth handled?' }, context)

    expect(result.success).toBe(false)
    expect(result.error).toBe('Parent job not found: job-parent')
  })

  it('returns an error when the agent cannot be found', async () => {
    mockedFindAgentById.mockResolvedValueOnce(null as never)

    const result = await exploreCodebaseTool({ question: 'Where is auth handled?' }, context)

    expect(result.success).toBe(false)
    expect(result.error).toBe('Agent not found: agent-1')
  })

  it('returns an error when the work item cannot be found', async () => {
    mockedFindWorkItemById.mockResolvedValueOnce(null as never)

    const result = await exploreCodebaseTool({ question: 'Where is auth handled?' }, context)

    expect(result.success).toBe(false)
    expect(result.error).toBe('Work item not found: work-1')
  })

  it('returns child run metadata when the child runner fails', async () => {
    mockedRunExploreChild.mockRejectedValueOnce(new Error('explore child exploded'))

    const result = await exploreCodebaseTool({ question: 'Where is auth handled?' }, context)

    expect(result.success).toBe(false)
    expect(result.error).toBe('explore child exploded')
    expect(result.output).toBe('[child run: job-child]')
  })
})
