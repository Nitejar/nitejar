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
})
