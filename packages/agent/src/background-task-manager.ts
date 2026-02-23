import {
  createBackgroundTask,
  findBackgroundTaskById,
  listBackgroundTasksByJob,
  listRunningBackgroundTasksByJob,
  markBackgroundTaskFailed,
  markBackgroundTaskKilled,
  markBackgroundTaskSucceeded,
  updateBackgroundTaskOutputTail,
  type BackgroundTask,
} from '@nitejar/database'
import {
  attachBackgroundTaskSession,
  closeSpriteCommandSocket,
  isBackgroundTaskSessionActive,
  killBackgroundTaskSession,
  spawnDetachableBackgroundTask,
  type SpriteCommand,
} from '@nitejar/sprites'

const DEFAULT_OUTPUT_CHARS = 2000
const MAX_OUTPUT_CHARS = 20_000
const MAX_RUNTIME_OUTPUT_CHARS = 60_000
const MAX_OUTPUT_PROBE_CHARS = 12_000
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_REGEX = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

interface StartBackgroundTaskInput {
  command: string
  cwd?: string
  label?: string
  cleanupOnRunEnd: boolean
}

interface CheckBackgroundTaskOptions {
  block?: boolean
  timeoutSeconds?: number
  outputChars?: number
}

interface ListBackgroundTaskOptions {
  status: 'running' | 'succeeded' | 'failed' | 'killed' | 'all'
  includeOutput?: boolean
  outputChars?: number
}

interface StopBackgroundTaskOptions {
  force?: boolean
  graceSeconds?: number
  reason?: string
}

interface RuntimeTask {
  id: string
  sessionId: string
  marker: string
  cmd: SpriteCommand | null
  outputTail: string
  stdoutProbe: string
  status: 'running' | 'succeeded' | 'failed' | 'killed'
  finalized: boolean
  killRequested: boolean
  reattachAttempts: number
  completionPromise: Promise<void>
  resolveCompletion: () => void
}

export type BackgroundTaskEvent =
  | {
      type: 'background_task_started'
      jobId: string
      taskId: string
      spriteSessionId: string
      label: string | null
    }
  | {
      type: 'background_task_completed'
      jobId: string
      taskId: string
      spriteSessionId: string
      exitCode: number
    }
  | {
      type: 'background_task_failed'
      jobId: string
      taskId: string
      spriteSessionId: string
      error: string
      exitCode: number | null
    }
  | {
      type: 'background_task_killed'
      jobId: string
      taskId: string
      spriteSessionId: string
      reason: string | null
    }

export class BackgroundTaskManager {
  private readonly runtimes = new Map<string, RuntimeTask>()

  constructor(
    private readonly jobId: string,
    private readonly agentId: string,
    private readonly spriteName: string,
    private readonly emitEvent: (event: BackgroundTaskEvent) => void
  ) {}

  async startTask(input: StartBackgroundTaskInput): Promise<BackgroundTask> {
    const marker = `__SLOPBOT_BG_EXIT_${Date.now()}_${Math.random().toString(36).slice(2, 10)}__`
    const wrappedCommand = buildWrappedCommand(input.command, marker)

    const { cmd, sessionId } = await spawnDetachableBackgroundTask(
      this.spriteName,
      wrappedCommand,
      {
        ...(input.cwd ? { cwd: input.cwd } : {}),
      }
    )

    const startedAt = now()
    const task = await createBackgroundTask({
      job_id: this.jobId,
      agent_id: this.agentId,
      sprite_name: this.spriteName,
      sprite_session_id: sessionId,
      label: input.label ?? null,
      command: input.command,
      cwd: input.cwd ?? null,
      status: 'running',
      cleanup_on_run_end: input.cleanupOnRunEnd ? 1 : 0,
      exit_code: null,
      error_text: null,
      output_tail: null,
      started_at: startedAt,
      finished_at: null,
    })

    let resolveCompletion: (() => void) | null = null
    const completionPromise = new Promise<void>((resolve) => {
      resolveCompletion = resolve
    })

    const runtime: RuntimeTask = {
      id: task.id,
      sessionId,
      marker,
      cmd,
      outputTail: '',
      stdoutProbe: '',
      status: 'running',
      finalized: false,
      killRequested: false,
      reattachAttempts: 0,
      completionPromise,
      resolveCompletion: resolveCompletion ?? (() => {}),
    }

    this.runtimes.set(task.id, runtime)
    this.attachObservers(runtime, cmd)

    this.emitEvent({
      type: 'background_task_started',
      jobId: this.jobId,
      taskId: task.id,
      spriteSessionId: sessionId,
      label: task.label,
    })

    return task
  }

  async checkTask(
    taskId: string,
    options?: CheckBackgroundTaskOptions
  ): Promise<{
    task: BackgroundTask
    outputTail: string
  }> {
    let task = await this.getOwnedTask(taskId)
    let runtime = this.runtimes.get(taskId)

    const block = options?.block === true
    if (block && runtime && runtime.status === 'running') {
      const timeoutMs = Math.max(1, options?.timeoutSeconds ?? 30) * 1000
      await this.waitForCompletion(runtime, timeoutMs)
    }

    if (!runtime && task.status === 'running') {
      const active = await isBackgroundTaskSessionActive(this.spriteName, task.sprite_session_id)
      if (!active) {
        await markBackgroundTaskFailed(task.id, 'observer_lost', null, task.output_tail ?? null)
      }
    }

    runtime = this.runtimes.get(taskId)
    if (runtime) {
      await this.persistRuntimeOutput(runtime)
    }

    task = (await findBackgroundTaskById(taskId)) ?? task
    const outputTail = truncateTail(
      runtime?.outputTail ?? task.output_tail ?? '',
      clampOutputChars(options?.outputChars)
    )

    return { task, outputTail }
  }

  async listTasks(options?: ListBackgroundTaskOptions): Promise<
    Array<{
      task: BackgroundTask
      outputTail?: string
    }>
  > {
    const statusFilter = options?.status ?? 'running'
    const includeOutput = options?.includeOutput === true
    const outputChars = clampOutputChars(options?.outputChars)

    let tasks = await listBackgroundTasksByJob(this.jobId)
    if (statusFilter !== 'all') {
      tasks = tasks.filter((task) => task.status === statusFilter)
    }

    const rows: Array<{ task: BackgroundTask; outputTail?: string }> = []
    for (const task of tasks) {
      const runtime = this.runtimes.get(task.id)
      if (runtime) {
        await this.persistRuntimeOutput(runtime)
      }

      const refreshed = (await findBackgroundTaskById(task.id)) ?? task
      const outputTail = includeOutput
        ? truncateTail(runtime?.outputTail ?? refreshed.output_tail ?? '', outputChars)
        : undefined

      rows.push({ task: refreshed, ...(outputTail !== undefined ? { outputTail } : {}) })
    }

    return rows
  }

  async stopTask(taskId: string, options?: StopBackgroundTaskOptions): Promise<BackgroundTask> {
    const task = await this.getOwnedTask(taskId)
    if (task.status !== 'running') {
      return task
    }

    const runtime = this.runtimes.get(taskId)
    if (runtime) {
      runtime.killRequested = true
    }

    const force = options?.force === true
    const graceMs = Math.max(0, options?.graceSeconds ?? 5) * 1000

    if (!force && runtime?.cmd) {
      try {
        runtime.cmd.kill('SIGTERM')
      } catch {
        // Ignore local signal errors and proceed to API kill fallback.
      }

      const finished = await this.waitForCompletion(runtime, graceMs)
      if (finished) {
        return (await this.getOwnedTask(taskId)) ?? task
      }
    }

    await killBackgroundTaskSession(this.spriteName, task.sprite_session_id)

    if (runtime && !runtime.finalized) {
      await this.finalizeKilled(runtime, options?.reason ?? 'stopped_by_user')
    }

    return (await this.getOwnedTask(taskId)) ?? task
  }

  async cleanupRunTasks(): Promise<void> {
    const running = await listRunningBackgroundTasksByJob(this.jobId, { cleanupOnRunEnd: true })

    for (const task of running) {
      try {
        await this.stopTask(task.id, {
          force: true,
          graceSeconds: 0,
          reason: 'run_end_cleanup',
        })
      } catch {
        // Best-effort cleanup.
      }
    }
  }

  private attachObservers(runtime: RuntimeTask, observedCmd: SpriteCommand): void {
    runtime.cmd = observedCmd

    observedCmd.stdout.on('data', (chunk: Buffer | string) => {
      if (runtime.cmd !== observedCmd || runtime.finalized) return
      this.appendStdout(runtime, chunk.toString())
    })

    observedCmd.stderr.on('data', (chunk: Buffer | string) => {
      if (runtime.cmd !== observedCmd || runtime.finalized) return
      this.appendStderr(runtime, chunk.toString())
    })

    observedCmd.on('exit', (exitCode: number) => {
      if (runtime.cmd !== observedCmd || runtime.finalized) return
      void this.handleExit(runtime, exitCode)
    })

    observedCmd.on('error', (error: Error) => {
      if (runtime.cmd !== observedCmd || runtime.finalized) return
      void this.handleObserverError(runtime, observedCmd, error)
    })
  }

  private async handleExit(runtime: RuntimeTask, fallbackExitCode: number): Promise<void> {
    const markerExitCode = extractExitCodeFromMarker(runtime.stdoutProbe, runtime.marker)
    const exitCode = markerExitCode ?? fallbackExitCode

    if (runtime.killRequested) {
      await this.finalizeKilled(runtime, 'killed')
      return
    }

    if (exitCode === 0) {
      await this.finalizeSucceeded(runtime, 0)
      return
    }

    await this.finalizeFailed(runtime, `Command failed with exit code ${exitCode}`, exitCode)
  }

  private async handleObserverError(
    runtime: RuntimeTask,
    observedCmd: SpriteCommand,
    error: Error
  ): Promise<void> {
    const message = error.message

    if (runtime.killRequested) {
      return
    }

    if (!isRecoverableSocketError(message) || runtime.reattachAttempts >= 1) {
      await this.finalizeFailed(runtime, message, null)
      return
    }

    runtime.reattachAttempts += 1
    runtime.cmd = null
    closeSpriteCommandSocket(observedCmd)

    const active = await isBackgroundTaskSessionActive(this.spriteName, runtime.sessionId)
    if (!active) {
      await this.finalizeFailed(runtime, 'observer_lost', null)
      return
    }

    const reattached = attachBackgroundTaskSession(this.spriteName, runtime.sessionId)
    this.attachObservers(runtime, reattached)
  }

  private appendStdout(runtime: RuntimeTask, raw: string): void {
    runtime.stdoutProbe = truncateTail(runtime.stdoutProbe + raw, MAX_OUTPUT_PROBE_CHARS)
    const cleaned = sanitizeOutputChunk(raw, runtime.marker)
    if (!cleaned) return
    this.appendTail(runtime, cleaned)
  }

  private appendStderr(runtime: RuntimeTask, raw: string): void {
    const cleaned = sanitizeOutputChunk(raw, runtime.marker)
    if (!cleaned) return
    this.appendTail(runtime, `[stderr] ${cleaned}`)
  }

  private appendTail(runtime: RuntimeTask, text: string): void {
    runtime.outputTail = truncateTail(`${runtime.outputTail}${text}`, MAX_RUNTIME_OUTPUT_CHARS)
  }

  private async finalizeSucceeded(runtime: RuntimeTask, exitCode: number): Promise<void> {
    if (runtime.finalized) return
    runtime.finalized = true
    runtime.status = 'succeeded'

    const outputTail = runtime.outputTail || null
    await markBackgroundTaskSucceeded(runtime.id, exitCode, outputTail)

    this.emitEvent({
      type: 'background_task_completed',
      jobId: this.jobId,
      taskId: runtime.id,
      spriteSessionId: runtime.sessionId,
      exitCode,
    })

    runtime.resolveCompletion()
  }

  private async finalizeFailed(
    runtime: RuntimeTask,
    errorText: string,
    exitCode: number | null
  ): Promise<void> {
    if (runtime.finalized) return
    runtime.finalized = true
    runtime.status = 'failed'

    const outputTail = runtime.outputTail || null
    await markBackgroundTaskFailed(runtime.id, errorText, exitCode, outputTail)

    this.emitEvent({
      type: 'background_task_failed',
      jobId: this.jobId,
      taskId: runtime.id,
      spriteSessionId: runtime.sessionId,
      error: errorText,
      exitCode,
    })

    runtime.resolveCompletion()
  }

  private async finalizeKilled(runtime: RuntimeTask, reason: string): Promise<void> {
    if (runtime.finalized) return
    runtime.finalized = true
    runtime.status = 'killed'

    const outputTail = runtime.outputTail || null
    await markBackgroundTaskKilled(runtime.id, reason, outputTail)

    this.emitEvent({
      type: 'background_task_killed',
      jobId: this.jobId,
      taskId: runtime.id,
      spriteSessionId: runtime.sessionId,
      reason,
    })

    runtime.resolveCompletion()
  }

  private async waitForCompletion(runtime: RuntimeTask, timeoutMs: number): Promise<boolean> {
    if (runtime.finalized) return true
    if (timeoutMs <= 0) return runtime.finalized

    await Promise.race([
      runtime.completionPromise,
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ])

    return runtime.finalized
  }

  private async persistRuntimeOutput(runtime: RuntimeTask): Promise<void> {
    await updateBackgroundTaskOutputTail(runtime.id, runtime.outputTail || null)
  }

  private async getOwnedTask(taskId: string): Promise<BackgroundTask> {
    const task = await findBackgroundTaskById(taskId)
    if (!task) {
      throw new Error(`Background task ${taskId} not found.`)
    }

    if (task.job_id !== this.jobId || task.agent_id !== this.agentId) {
      throw new Error('Cannot access a background task belonging to another run.')
    }

    return task
  }
}

function buildWrappedCommand(command: string, marker: string): string {
  return [
    `(while true; do sleep 10 && printf '\\x01'; done) & __SLOPBOT_BG_HB_PID__=$!`,
    command,
    '__SLOPBOT_BG_EC__=$?',
    'kill $__SLOPBOT_BG_HB_PID__ 2>/dev/null || true; wait $__SLOPBOT_BG_HB_PID__ 2>/dev/null || true',
    `echo "${marker}$__SLOPBOT_BG_EC__"`,
    'exit $__SLOPBOT_BG_EC__',
  ].join('\n')
}

function sanitizeOutputChunk(chunk: string, marker: string): string {
  const cleaned = chunk.replace(/\r/g, '').replace(CONTROL_CHAR_REGEX, '')
  if (!cleaned) return ''

  return cleaned
    .split('\n')
    .filter((line) => !line.includes(marker))
    .join('\n')
}

function extractExitCodeFromMarker(output: string, marker: string): number | null {
  const escaped = escapeRegExp(marker)
  const match = output.match(new RegExp(`${escaped}(\\d+)`))
  if (!match || !match[1]) {
    return null
  }

  const parsed = Number.parseInt(match[1], 10)
  return Number.isFinite(parsed) ? parsed : null
}

function truncateTail(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  return value.slice(value.length - maxChars)
}

function clampOutputChars(value?: number): number {
  if (!value || !Number.isFinite(value)) {
    return DEFAULT_OUTPUT_CHARS
  }

  return Math.max(1, Math.min(MAX_OUTPUT_CHARS, Math.floor(value)))
}

function isRecoverableSocketError(message: string): boolean {
  return message === 'WebSocket keepalive timeout' || message === 'WebSocket error'
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function now(): number {
  return Math.floor(Date.now() / 1000)
}
