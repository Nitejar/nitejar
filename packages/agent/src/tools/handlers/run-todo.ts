import type Anthropic from '@anthropic-ai/sdk'
import { findJobById, updateJob } from '@nitejar/database'
import type { ToolHandler } from '../types'

export const runTodoDefinition: Anthropic.Tool = {
  name: 'run_todo',
  description:
    'Manage an ephemeral todo checklist scoped to the current run. Use this to plan multi-step work: add items at the start, check them off as you go, and list remaining items to stay on track. The checklist is discarded when the run ends — it is NOT persistent across runs. For persistent tracking, use add_memory instead.',
  input_schema: {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        enum: ['add', 'list', 'done', 'undo', 'remove', 'clear'],
        description: 'Todo action to perform.',
      },
      text: {
        type: 'string',
        description: 'Todo text (required for add).',
      },
      item_id: {
        type: 'string',
        description: 'Todo item ID (required for done, undo, remove).',
      },
      run_id: {
        type: 'string',
        description:
          'Optional run/job ID to read todos from. Defaults to current run. Write operations are only allowed on the current run.',
      },
      include_done: {
        type: 'boolean',
        description: 'When action=list, include completed items.',
      },
    },
    required: ['action'],
  },
}

const MAX_TODO_TEXT_LENGTH = 500
const MAX_TODO_ITEMS = 200

type TodoStatus = 'open' | 'done'
type RunTodoAction = 'add' | 'list' | 'done' | 'undo' | 'remove' | 'clear'

interface RunTodoItem {
  id: string
  text: string
  status: TodoStatus
  created_at: number
  done_at: number | null
}

interface RunTodoState {
  version: 1
  updated_at: number
  items: RunTodoItem[]
}

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function createEmptyState(): RunTodoState {
  return {
    version: 1,
    updated_at: now(),
    items: [],
  }
}

function isTodoItem(value: unknown): value is RunTodoItem {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return (
    typeof row.id === 'string' &&
    typeof row.text === 'string' &&
    (row.status === 'open' || row.status === 'done') &&
    typeof row.created_at === 'number' &&
    (typeof row.done_at === 'number' || row.done_at === null)
  )
}

function parseTodoState(raw: string | null): { state: RunTodoState; malformed: boolean } {
  if (!raw) {
    return { state: createEmptyState(), malformed: false }
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const parsedItems = parsed.items
    if (!Array.isArray(parsedItems)) {
      return { state: createEmptyState(), malformed: true }
    }

    const items: RunTodoItem[] = []
    for (const item of parsedItems) {
      if (!isTodoItem(item)) {
        return { state: createEmptyState(), malformed: true }
      }
      items.push(item)
    }

    const updatedAt = typeof parsed.updated_at === 'number' ? parsed.updated_at : now()
    return {
      state: {
        version: 1,
        updated_at: updatedAt,
        items,
      },
      malformed: false,
    }
  } catch {
    return { state: createEmptyState(), malformed: true }
  }
}

function formatTodoList(runId: string, state: RunTodoState, includeDone: boolean): string {
  const openItems = state.items.filter((item) => item.status === 'open')
  const doneItems = state.items.filter((item) => item.status === 'done')
  const lines: string[] = []

  lines.push(`Run: ${runId} | Open: ${openItems.length} | Done: ${doneItems.length}`)

  if (openItems.length === 0 && (!includeDone || doneItems.length === 0)) {
    lines.push('No todo items.')
    return lines.join('\n')
  }

  if (openItems.length > 0) {
    lines.push('Open items:')
    for (const item of openItems) {
      lines.push(`- [ ] ${item.id}: ${item.text}`)
    }
  }

  if (includeDone && doneItems.length > 0) {
    lines.push('Done items:')
    for (const item of doneItems) {
      lines.push(`- [x] ${item.id}: ${item.text}`)
    }
  }

  return lines.join('\n')
}

function ensureAction(value: unknown): RunTodoAction | null {
  if (value === 'add') return 'add'
  if (value === 'list') return 'list'
  if (value === 'done') return 'done'
  if (value === 'undo') return 'undo'
  if (value === 'remove') return 'remove'
  if (value === 'clear') return 'clear'
  return null
}

function requiresWrite(action: RunTodoAction): boolean {
  return action !== 'list'
}

async function saveTodoState(runId: string, state: RunTodoState): Promise<boolean> {
  const updated = await updateJob(runId, {
    todo_state: JSON.stringify(state),
  })
  return updated !== null
}

export const runTodoTool: ToolHandler = async (input, context) => {
  if (!context.agentId) {
    return { success: false, error: 'Missing agent identity.' }
  }

  const action = ensureAction(input.action)
  if (!action) {
    return {
      success: false,
      error: 'action must be one of: add, list, done, undo, remove, clear.',
    }
  }

  const runIdRaw = typeof input.run_id === 'string' ? input.run_id.trim() : ''
  const targetRunId = runIdRaw || context.jobId
  if (!targetRunId) {
    return { success: false, error: 'No run target available. Provide run_id.' }
  }

  const targetRun = await findJobById(targetRunId)
  if (!targetRun) {
    return { success: false, error: `Run ${targetRunId} not found.` }
  }

  if (targetRun.agent_id !== context.agentId) {
    return { success: false, error: 'Cannot access todos for another agent.' }
  }

  if (requiresWrite(action) && targetRunId !== context.jobId) {
    return {
      success: false,
      error: 'Write operations are only allowed for the current run.',
    }
  }

  const { state, malformed } = parseTodoState(targetRun.todo_state)

  if (action === 'list') {
    const includeDone = input.include_done === true
    const summary = formatTodoList(targetRunId, state, includeDone)
    if (malformed) {
      return { success: true, output: `Todo state was malformed and treated as empty.\n${summary}` }
    }
    return { success: true, output: summary }
  }

  if (action === 'add') {
    const text = typeof input.text === 'string' ? input.text.trim() : ''
    if (!text) {
      return { success: false, error: 'text is required for add.' }
    }
    if (text.length > MAX_TODO_TEXT_LENGTH) {
      return {
        success: false,
        error: `text must be ${MAX_TODO_TEXT_LENGTH} characters or fewer.`,
      }
    }
    if (state.items.length >= MAX_TODO_ITEMS) {
      return {
        success: false,
        error: `Todo list is full (max ${MAX_TODO_ITEMS} items).`,
      }
    }

    const timestamp = now()
    const item: RunTodoItem = {
      id: crypto.randomUUID(),
      text,
      status: 'open',
      created_at: timestamp,
      done_at: null,
    }
    state.items.push(item)
    state.updated_at = timestamp

    const saved = await saveTodoState(targetRunId, state)
    if (!saved) {
      return { success: false, error: 'Failed to save todo state.' }
    }

    return {
      success: true,
      output: `[Run ${targetRunId}] Added todo ${item.id}: ${item.text}`,
    }
  }

  if (action === 'clear') {
    state.items = []
    state.updated_at = now()
    const saved = await saveTodoState(targetRunId, state)
    if (!saved) {
      return { success: false, error: 'Failed to save todo state.' }
    }
    return { success: true, output: `[Run ${targetRunId}] Cleared all todo items.` }
  }

  const itemId = typeof input.item_id === 'string' ? input.item_id.trim() : ''
  if (!itemId) {
    return {
      success: false,
      error: 'item_id is required for done, undo, and remove.',
    }
  }

  const index = state.items.findIndex((item) => item.id === itemId)
  if (index === -1) {
    return { success: false, error: `Todo item ${itemId} not found.` }
  }

  if (action === 'remove') {
    const [removed] = state.items.splice(index, 1)
    state.updated_at = now()
    const saved = await saveTodoState(targetRunId, state)
    if (!saved) {
      return { success: false, error: 'Failed to save todo state.' }
    }
    return { success: true, output: `[Run ${targetRunId}] Removed todo ${removed!.id}.` }
  }

  const targetItem = state.items[index]!
  if (action === 'done') {
    targetItem.status = 'done'
    targetItem.done_at = now()
    state.updated_at = now()
    const saved = await saveTodoState(targetRunId, state)
    if (!saved) {
      return { success: false, error: 'Failed to save todo state.' }
    }
    return { success: true, output: `[Run ${targetRunId}] Marked todo ${targetItem.id} done.` }
  }

  targetItem.status = 'open'
  targetItem.done_at = null
  state.updated_at = now()
  const saved = await saveTodoState(targetRunId, state)
  if (!saved) {
    return { success: false, error: 'Failed to save todo state.' }
  }
  return { success: true, output: `[Run ${targetRunId}] Marked todo ${targetItem.id} open.` }
}
