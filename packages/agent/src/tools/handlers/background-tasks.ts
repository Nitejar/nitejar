import type Anthropic from '@anthropic-ai/sdk'
import type { BackgroundTask } from '@nitejar/database'
import type { ToolHandler, ToolContext } from '../types'

export const backgroundTaskDefinitions: Anthropic.Tool[] = [
  {
    name: 'start_background_task',
    description:
      'Start a run-scoped background task in a detachable session. Use this for long-running commands while you continue with other work.',
    input_schema: {
      type: 'object' as const,
      properties: {
        command: {
          type: 'string',
          description: 'Shell command to execute in the background.',
        },
        cwd: {
          type: 'string',
          description: 'Optional working directory for the background command.',
        },
        label: {
          type: 'string',
          description: 'Optional short label to identify this task later.',
        },
        cleanup_on_run_end: {
          type: 'boolean',
          description: 'If true (default), the task is killed when this run ends.',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'check_background_task',
    description: 'Check the status and latest output tail for a background task.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_id: {
          type: 'string',
          description: 'Background task ID returned by start_background_task.',
        },
        block: {
          type: 'boolean',
          description:
            'If true, wait up to timeout_seconds for the task to complete before returning.',
        },
        timeout_seconds: {
          type: 'number',
          description: 'Wait timeout when block is true (default: 30, max: 300).',
        },
        output_chars: {
          type: 'number',
          description: 'Maximum output tail characters to include (default: 2000, max: 20000).',
        },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'list_background_tasks',
    description: 'List background tasks for the current run.',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: {
          type: 'string',
          enum: ['running', 'succeeded', 'failed', 'killed', 'all'],
          description: 'Filter tasks by status (default: running).',
        },
        include_output: {
          type: 'boolean',
          description: 'If true, include output tails for each listed task.',
        },
        output_chars: {
          type: 'number',
          description:
            'Maximum output tail characters per task when include_output is true (default: 2000, max: 20000).',
        },
      },
    },
  },
  {
    name: 'stop_background_task',
    description: 'Stop a running background task.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_id: {
          type: 'string',
          description: 'Background task ID to stop.',
        },
        force: {
          type: 'boolean',
          description: 'If true, force kill immediately instead of grace period termination.',
        },
        grace_seconds: {
          type: 'number',
          description: 'Grace period before force-killing when force is false (default: 5).',
        },
      },
      required: ['task_id'],
    },
  },
]

const DEFAULT_OUTPUT_CHARS = 2000

function getManager(context: ToolContext) {
  if (!context.backgroundTaskManager) {
    return { error: 'Background tasks are unavailable in this run.' } as const
  }
  return { manager: context.backgroundTaskManager } as const
}

function formatTaskLine(task: BackgroundTask): string {
  const started = new Date(task.started_at * 1000).toISOString()
  const finished = task.finished_at ? new Date(task.finished_at * 1000).toISOString() : null
  const base = [
    `id=${task.id}`,
    `status=${task.status}`,
    `session=${task.sprite_session_id}`,
    task.exit_code !== null ? `exit=${task.exit_code}` : null,
    `started=${started}`,
    finished ? `finished=${finished}` : null,
    task.cleanup_on_run_end === 1 ? 'cleanup_on_run_end=true' : 'cleanup_on_run_end=false',
  ]
    .filter(Boolean)
    .join(' ')

  return task.label ? `${base} label="${task.label}"` : base
}

export const startBackgroundTaskTool: ToolHandler = async (input, context) => {
  const managerResult = getManager(context)
  if ('error' in managerResult) {
    return { success: false, error: managerResult.error }
  }

  const command = typeof input.command === 'string' ? input.command.trim() : ''
  if (!command) {
    return { success: false, error: 'command is required.' }
  }

  const cwd = typeof input.cwd === 'string' && input.cwd.trim() ? input.cwd.trim() : undefined
  const label =
    typeof input.label === 'string' && input.label.trim().length > 0
      ? input.label.trim()
      : undefined
  const cleanupOnRunEnd = input.cleanup_on_run_end !== false

  const task = await managerResult.manager.startTask({
    command,
    ...(cwd ? { cwd } : {}),
    ...(label ? { label } : {}),
    cleanupOnRunEnd,
  })

  return {
    success: true,
    output: [
      'Background task started.',
      `task_id: ${task.id}`,
      `sprite_session_id: ${task.sprite_session_id}`,
      `status: ${task.status}`,
      `started_at: ${new Date(task.started_at * 1000).toISOString()}`,
    ].join('\n'),
  }
}

export const checkBackgroundTaskTool: ToolHandler = async (input, context) => {
  const managerResult = getManager(context)
  if ('error' in managerResult) {
    return { success: false, error: managerResult.error }
  }

  const taskId = typeof input.task_id === 'string' ? input.task_id.trim() : ''
  if (!taskId) {
    return { success: false, error: 'task_id is required.' }
  }

  const block = input.block === true
  const timeoutSeconds =
    typeof input.timeout_seconds === 'number' && Number.isFinite(input.timeout_seconds)
      ? Math.max(1, Math.min(300, Math.floor(input.timeout_seconds)))
      : 30
  const outputChars =
    typeof input.output_chars === 'number' && Number.isFinite(input.output_chars)
      ? Math.max(1, Math.min(20_000, Math.floor(input.output_chars)))
      : DEFAULT_OUTPUT_CHARS

  const { task, outputTail } = await managerResult.manager.checkTask(taskId, {
    block,
    timeoutSeconds,
    outputChars,
  })

  const lines = [formatTaskLine(task)]
  if (task.error_text) {
    lines.push(`error=${task.error_text}`)
  }
  if (outputTail.trim().length > 0) {
    lines.push(`output_tail:\n${outputTail}`)
  }

  return {
    success: true,
    output: lines.join('\n\n'),
  }
}

export const listBackgroundTasksTool: ToolHandler = async (input, context) => {
  const managerResult = getManager(context)
  if ('error' in managerResult) {
    return { success: false, error: managerResult.error }
  }

  const status =
    input.status === 'running' ||
    input.status === 'succeeded' ||
    input.status === 'failed' ||
    input.status === 'killed' ||
    input.status === 'all'
      ? input.status
      : 'running'

  const includeOutput = input.include_output === true
  const outputChars =
    typeof input.output_chars === 'number' && Number.isFinite(input.output_chars)
      ? Math.max(1, Math.min(20_000, Math.floor(input.output_chars)))
      : DEFAULT_OUTPUT_CHARS

  const rows = await managerResult.manager.listTasks({
    status,
    includeOutput,
    outputChars,
  })

  if (rows.length === 0) {
    return { success: true, output: 'No background tasks found.' }
  }

  const chunks = rows.map(({ task, outputTail }) => {
    const lines = [formatTaskLine(task)]
    if (task.error_text) {
      lines.push(`error=${task.error_text}`)
    }
    if (includeOutput && outputTail && outputTail.trim().length > 0) {
      lines.push(`output_tail:\n${outputTail}`)
    }
    return lines.join('\n\n')
  })

  return {
    success: true,
    output: chunks.join('\n\n---\n\n'),
  }
}

export const stopBackgroundTaskTool: ToolHandler = async (input, context) => {
  const managerResult = getManager(context)
  if ('error' in managerResult) {
    return { success: false, error: managerResult.error }
  }

  const taskId = typeof input.task_id === 'string' ? input.task_id.trim() : ''
  if (!taskId) {
    return { success: false, error: 'task_id is required.' }
  }

  const force = input.force === true
  const graceSeconds =
    typeof input.grace_seconds === 'number' && Number.isFinite(input.grace_seconds)
      ? Math.max(0, Math.min(60, Math.floor(input.grace_seconds)))
      : 5

  const task = await managerResult.manager.stopTask(taskId, {
    force,
    graceSeconds,
  })

  return {
    success: true,
    output: `Background task stopped.\n${formatTaskLine(task)}`,
  }
}
