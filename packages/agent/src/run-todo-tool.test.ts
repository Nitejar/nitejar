import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeTool, type ToolContext } from './tools'
import * as Database from '@nitejar/database'

vi.mock('@nitejar/database', async () => {
  const actual = await vi.importActual<typeof Database>('@nitejar/database')
  return {
    ...actual,
    findJobById: vi.fn(),
    updateJob: vi.fn(),
  }
})

const mockedFindJobById = vi.mocked(Database.findJobById)
const mockedUpdateJob = vi.mocked(Database.updateJob)

const context: ToolContext = {
  spriteName: 'sprite-1',
  cwd: '/home/sprite',
  agentId: 'agent-1',
  jobId: 'job-1',
}

function makeJob(id: string, agentId: string, todoState: string | null = null): Database.Job {
  return {
    id,
    work_item_id: 'work-item-1',
    agent_id: agentId,
    status: 'RUNNING',
    error_text: null,
    todo_state: todoState,
    final_response: null,
    started_at: null,
    completed_at: null,
    created_at: 0,
    updated_at: 0,
  }
}

function parseSavedState(): {
  version: number
  updated_at: number
  items: Array<{
    id: string
    text: string
    status: string
    created_at: number
    done_at: number | null
  }>
} {
  const updateInput = mockedUpdateJob.mock.calls[0]?.[1] as { todo_state?: string } | undefined
  expect(updateInput?.todo_state).toBeTypeOf('string')
  return JSON.parse(updateInput!.todo_state!) as {
    version: number
    updated_at: number
    items: Array<{
      id: string
      text: string
      status: string
      created_at: number
      done_at: number | null
    }>
  }
}

describe('run_todo tool', () => {
  beforeEach(() => {
    mockedFindJobById.mockReset()
    mockedUpdateJob.mockReset()
  })

  it('adds and lists todos on the current run', async () => {
    mockedFindJobById.mockResolvedValueOnce(makeJob('job-1', 'agent-1', null))
    mockedUpdateJob.mockResolvedValueOnce(makeJob('job-1', 'agent-1'))

    const addResult = await executeTool(
      'run_todo',
      { action: 'add', text: 'Ship the patch' },
      context
    )
    expect(addResult.success).toBe(true)
    expect(mockedUpdateJob).toHaveBeenCalledTimes(1)

    const savedState = parseSavedState()
    expect(savedState.version).toBe(1)
    expect(savedState.items).toHaveLength(1)
    expect(savedState.items[0]?.text).toBe('Ship the patch')
    expect(savedState.items[0]?.status).toBe('open')

    mockedFindJobById.mockResolvedValueOnce(makeJob('job-1', 'agent-1', JSON.stringify(savedState)))
    const listResult = await executeTool('run_todo', { action: 'list' }, context)
    expect(listResult.success).toBe(true)
    expect(listResult.output).toContain('Run: job-1')
    expect(listResult.output).toContain('Open: 1 | Done: 0')
    expect(listResult.output).toContain('Ship the patch')
  })

  it('marks todo done and undo', async () => {
    const state = {
      version: 1,
      updated_at: 1,
      items: [
        {
          id: 'todo-1',
          text: 'Run tests',
          status: 'open',
          created_at: 1,
          done_at: null,
        },
      ],
    }

    mockedFindJobById.mockResolvedValueOnce(makeJob('job-1', 'agent-1', JSON.stringify(state)))
    mockedUpdateJob.mockResolvedValueOnce(makeJob('job-1', 'agent-1'))
    const doneResult = await executeTool('run_todo', { action: 'done', item_id: 'todo-1' }, context)
    expect(doneResult.success).toBe(true)
    let savedState = parseSavedState()
    expect(savedState.items[0]?.status).toBe('done')
    expect(savedState.items[0]?.done_at).toBeTypeOf('number')

    mockedUpdateJob.mockReset()
    mockedFindJobById.mockResolvedValueOnce(makeJob('job-1', 'agent-1', JSON.stringify(savedState)))
    mockedUpdateJob.mockResolvedValueOnce(makeJob('job-1', 'agent-1'))
    const undoResult = await executeTool('run_todo', { action: 'undo', item_id: 'todo-1' }, context)
    expect(undoResult.success).toBe(true)
    savedState = parseSavedState()
    expect(savedState.items[0]?.status).toBe('open')
    expect(savedState.items[0]?.done_at).toBeNull()
  })

  it('removes and clears todos', async () => {
    const state = {
      version: 1,
      updated_at: 1,
      items: [
        { id: 'todo-1', text: 'A', status: 'open', created_at: 1, done_at: null },
        { id: 'todo-2', text: 'B', status: 'done', created_at: 1, done_at: 2 },
      ],
    }

    mockedFindJobById.mockResolvedValueOnce(makeJob('job-1', 'agent-1', JSON.stringify(state)))
    mockedUpdateJob.mockResolvedValueOnce(makeJob('job-1', 'agent-1'))
    const removeResult = await executeTool(
      'run_todo',
      { action: 'remove', item_id: 'todo-1' },
      context
    )
    expect(removeResult.success).toBe(true)
    let savedState = parseSavedState()
    expect(savedState.items).toHaveLength(1)
    expect(savedState.items[0]?.id).toBe('todo-2')

    mockedUpdateJob.mockReset()
    mockedFindJobById.mockResolvedValueOnce(makeJob('job-1', 'agent-1', JSON.stringify(savedState)))
    mockedUpdateJob.mockResolvedValueOnce(makeJob('job-1', 'agent-1'))
    const clearResult = await executeTool('run_todo', { action: 'clear' }, context)
    expect(clearResult.success).toBe(true)
    savedState = parseSavedState()
    expect(savedState.items).toHaveLength(0)
  })

  it('allows list with run_id for another run owned by the same agent', async () => {
    const state = {
      version: 1,
      updated_at: 1,
      items: [{ id: 'todo-1', text: 'Follow up', status: 'open', created_at: 1, done_at: null }],
    }
    mockedFindJobById.mockResolvedValueOnce(makeJob('job-2', 'agent-1', JSON.stringify(state)))

    const result = await executeTool('run_todo', { action: 'list', run_id: 'job-2' }, context)
    expect(result.success).toBe(true)
    expect(result.output).toContain('Follow up')
    expect(mockedUpdateJob).not.toHaveBeenCalled()
  })

  it('rejects write when run_id targets a non-current run', async () => {
    mockedFindJobById.mockResolvedValueOnce(makeJob('job-2', 'agent-1', null))

    const result = await executeTool(
      'run_todo',
      { action: 'add', run_id: 'job-2', text: 'Should fail' },
      context
    )
    expect(result.success).toBe(false)
    expect(result.error).toContain('current run')
    expect(mockedUpdateJob).not.toHaveBeenCalled()
  })

  it('rejects access to runs belonging to another agent', async () => {
    mockedFindJobById.mockResolvedValueOnce(makeJob('job-2', 'agent-2', null))

    const result = await executeTool('run_todo', { action: 'list', run_id: 'job-2' }, context)
    expect(result.success).toBe(false)
    expect(result.error).toContain('another agent')
    expect(mockedUpdateJob).not.toHaveBeenCalled()
  })

  it('treats malformed todo_state as empty and overwrites on write', async () => {
    mockedFindJobById.mockResolvedValueOnce(makeJob('job-1', 'agent-1', '{not-json'))
    mockedUpdateJob.mockResolvedValueOnce(makeJob('job-1', 'agent-1'))

    const result = await executeTool('run_todo', { action: 'add', text: 'Recover state' }, context)
    expect(result.success).toBe(true)

    const savedState = parseSavedState()
    expect(savedState.items).toHaveLength(1)
    expect(savedState.items[0]?.text).toBe('Recover state')
  })
})
