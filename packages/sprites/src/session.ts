import { type Sprite, type SpriteCommand, type Session } from '@fly/sprites'
import { getSprite } from './client'
import { getOptionalSpritesToken, requireSpritesToken } from './token-settings'
import {
  createSpriteSession,
  findActiveSessionsForConversation,
  findSpriteSessionBySessionKey,
  touchSpriteSession,
  closeSpriteSession,
  errorSpriteSession,
  closeSessionsForConversation,
  findStaleSessions,
  deleteOldSessions,
  type SpriteSession as SpriteSessionRecord,
} from '@nitejar/database'
import type { ExecResult, ExecOptions } from './exec'

const API_BASE = 'https://api.sprites.dev/v1'
const ANSI_CSI_ESCAPE_REGEX = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g')
const ANSI_OSC_ESCAPE_REGEX = new RegExp(
  `${String.fromCharCode(27)}\\][^${String.fromCharCode(7)}${String.fromCharCode(27)}]*(?:${String.fromCharCode(7)}|${String.fromCharCode(27)}\\\\)`,
  'g'
)
const ANSI_SINGLE_ESCAPE_REGEX = new RegExp(`${String.fromCharCode(27)}[@-_]`, 'g')
const RESIDUAL_OSC_FRAGMENT_REGEX = /\][0-9]+;[^\n]*/g
const RESIDUAL_CSI_FRAGMENT_REGEX = /\[(?:\?[0-9;]*)?[0-9;]*[A-Za-z]/g
const RESIDUAL_OSC_TERMINATOR_SLASH_REGEX = /\\(?=\[(?:\?[0-9;]*)?[0-9;]*[A-Za-z])/g
const PROMPT_ECHO_FRAGMENT_REGEX = /^[\w.-]+@[\w.-]+:.*[$#]\s*<.*$/
const CONTROL_CHAR_REGEX = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(8)}${String.fromCharCode(11)}${String.fromCharCode(12)}${String.fromCharCode(14)}-${String.fromCharCode(31)}]`,
  'g'
)
const SESSION_CREATE_TIMEOUT_MS = 30000
const SESSION_CREATE_MAX_RETRIES = 3
const SESSION_CREATE_RETRY_BACKOFF_MS = 1500

export function sanitizeSessionOutput(output: string, endMarker: string): string {
  const withoutEscapes = output
    .replace(ANSI_OSC_ESCAPE_REGEX, '')
    .replace(ANSI_CSI_ESCAPE_REGEX, '')
    .replace(ANSI_SINGLE_ESCAPE_REGEX, '')
    .replace(/\r/g, '')
    .replace(CONTROL_CHAR_REGEX, '')

  const lines = withoutEscapes.split('\n')
  const cleanedLines: string[] = []

  for (const rawLine of lines) {
    const line = rawLine
      .replace(RESIDUAL_OSC_FRAGMENT_REGEX, '')
      .replace(RESIDUAL_OSC_TERMINATOR_SLASH_REGEX, '')
      .replace(RESIDUAL_CSI_FRAGMENT_REGEX, '')
      .trimEnd()

    if (line.includes(endMarker)) {
      continue
    }

    if (PROMPT_ECHO_FRAGMENT_REGEX.test(line)) {
      continue
    }

    cleanedLines.push(line)
  }

  return cleanedLines.join('\n').trim()
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function createOneShotHandler<T extends unknown[]>(
  handler: (...args: T) => void
): (...args: T) => void {
  let fired = false
  return (...args: T) => {
    if (fired) return
    fired = true
    handler(...args)
  }
}

/**
 * Result from a single session exec attempt.
 * - `completed`: markers found, command finished normally
 * - `keepalive_timeout`: WebSocket dropped during silence, session still alive
 * - `error`: non-recoverable failure (connection refused, actual timeout, etc.)
 */
interface SessionExecAttemptResult {
  type: 'completed' | 'keepalive_timeout' | 'error'
  exitCode: number
  stdout: string
  stderr: string
}

/**
 * Extract command output from a buffer using start/end markers.
 * Returns null if the end marker is not found (command still running).
 */
export function extractMarkerOutput(
  output: string,
  startMarker: string,
  endMarker: string
): { output: string; exitCode: number } | null {
  const endPattern = new RegExp(endMarker.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&') + '(\\d+)')
  const endMatch = output.match(endPattern)
  if (!endMatch || !endMatch[1]) return null

  const exitCode = parseInt(endMatch[1], 10)
  const endIdx = output.indexOf(endMatch[0])

  const startPattern = new RegExp(startMarker + '\\r?\\n')
  const startMatch = output.match(startPattern)

  let commandOutput = ''
  if (startMatch) {
    const startIdx = output.indexOf(startMatch[0]) + startMatch[0].length
    commandOutput = output.slice(startIdx, endIdx)
  }

  return { output: commandOutput, exitCode }
}

/**
 * Extract partial command output after this command's start marker.
 * Returns an empty string when the start marker isn't present to avoid
 * leaking session scrollback from prior commands.
 */
export function extractPartialOutputAfterStartMarker(
  output: string,
  startMarker: string,
  endMarker: string
): string {
  const startPattern = new RegExp(
    startMarker.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&') + '\\r?\\n'
  )
  const startMatch = output.match(startPattern)
  if (!startMatch) return ''

  const startIdx = output.indexOf(startMatch[0]) + startMatch[0].length
  return sanitizeSessionOutput(output.slice(startIdx), endMarker)
}

export function buildSessionCommand(command: string, cwd?: string): string {
  const trimmedCwd = cwd?.trim()
  if (!trimmedCwd) {
    return command
  }

  // Honor explicit cwd for this exec call while still allowing subsequent
  // commands to inherit any directory changes made by the command itself.
  return `cd ${shellQuote(trimmedCwd)} || exit 1\n${command}`
}

/**
 * Options for creating a sprite session
 */
export interface SessionOptions {
  /** Working directory for commands */
  cwd?: string
  /** Enable TTY mode (default: false for agent use) */
  tty?: boolean
}

/**
 * A sprite session that maintains shell state across commands
 */
export interface ISpriteSession {
  /** The Sprites API session ID */
  readonly sessionId: string
  /** The sprite name */
  readonly spriteName: string
  /** Database record ID */
  readonly recordId: string

  /** Execute a command in this session */
  exec(command: string, options?: ExecOptions): Promise<ExecResult>

  /** Close the session (kills it on the sprites API) */
  close(): Promise<void>
}

/**
 * Implementation of a sprite session using the @fly/sprites SDK
 *
 * Each exec() call:
 * 1. Connects WebSocket to the session
 * 2. Runs command with markers
 * 3. Disconnects WebSocket (session stays alive on sprites side)
 *
 * Sessions persist via max_run_after_disconnect=0 on the sprites API.
 * Cleanup is explicit via close() or compaction.
 */
class SpriteSessionImpl implements ISpriteSession {
  readonly sessionId: string
  readonly spriteName: string
  readonly recordId: string
  private sprite: Sprite
  private cwd: string
  private tty: boolean
  private closed = false

  constructor(
    sessionId: string,
    spriteName: string,
    recordId: string,
    sprite: Sprite,
    cwd: string,
    tty: boolean
  ) {
    this.sessionId = sessionId
    this.spriteName = spriteName
    this.recordId = recordId
    this.sprite = sprite
    this.cwd = cwd
    this.tty = tty
  }

  async exec(command: string, options?: ExecOptions): Promise<ExecResult> {
    if (this.closed) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: 'Session is closed',
        duration: 0,
      }
    }

    const startTime = Date.now()
    const timeout = options?.timeout ?? 300000 // 5 minutes default

    try {
      // Update last active timestamp in DB
      await touchSpriteSession(this.recordId)

      // Connect, run, disconnect
      const commandToRun = buildSessionCommand(command, options?.cwd)
      const result = await this.execWithReconnect(commandToRun, timeout)
      if (this.shouldAttemptRecoveryAfterTimeout(result)) {
        const recovered = await this.tryInterruptRecovery()
        if (recovered) {
          const recoveredNotice = 'Session recovered via interrupt after timeout.'
          result.stderr = result.stderr ? `${result.stderr}\n${recoveredNotice}` : recoveredNotice
        } else {
          await this.invalidateAfterTimeout()
          const resetNotice =
            'Session reset after timeout to avoid a wedged shell. ' +
            'Filesystem changes are preserved, but shell state (running processes, exports, history) is lost.'
          result.stderr = result.stderr ? `${result.stderr}\n${resetNotice}` : resetNotice
        }
      }
      const duration = Date.now() - startTime

      return {
        ...result,
        duration,
      }
    } catch (error) {
      const duration = Date.now() - startTime
      return {
        exitCode: 1,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        duration,
      }
    }
  }

  private shouldAttemptRecoveryAfterTimeout(result: Omit<ExecResult, 'duration'>): boolean {
    if (result.exitCode !== 124) return false
    return (
      result.stderr === 'Command timed out' ||
      result.stderr.includes('before start marker was observed') ||
      result.stderr.startsWith('Command appears to be waiting for interactive input')
    )
  }

  private async tryInterruptRecovery(): Promise<boolean> {
    const marker = `__SLOPBOT_RECOVERED_${Date.now()}__`
    const recoveryTimeoutMs = 1200

    return new Promise((resolve) => {
      let resolved = false
      let cmd: SpriteCommand | null = null
      let onSpawn: (() => void) | null = null
      let onMessage: ((msg: { type: string }) => void) | null = null
      let outputBuffer = ''

      const finish = (ok: boolean) => {
        if (resolved) return
        resolved = true
        if (timeoutId) clearTimeout(timeoutId)

        if (cmd) {
          const emitter = cmd as SpriteCommand & {
            off?: (event: string, listener: (...args: unknown[]) => void) => void
            removeListener?: (event: string, listener: (...args: unknown[]) => void) => void
          }
          if (onSpawn) {
            if (typeof emitter.off === 'function') {
              emitter.off('spawn', onSpawn)
            } else if (typeof emitter.removeListener === 'function') {
              emitter.removeListener('spawn', onSpawn)
            }
          }
          if (onMessage) {
            if (typeof emitter.off === 'function') {
              emitter.off('message', onMessage)
            } else if (typeof emitter.removeListener === 'function') {
              emitter.removeListener('message', onMessage)
            }
          }
        }

        if (cmd) {
          try {
            cmd.kill()
          } catch {
            // Ignore kill errors
          }
        }

        resolve(ok)
      }

      const timeoutId = setTimeout(() => finish(false), recoveryTimeoutMs)

      cmd = this.sprite.spawn('', [], {
        sessionId: this.sessionId,
        // Force TTY for interrupt probes so ETX (Ctrl+C) can be interpreted
        // by terminal line discipline and delivered as SIGINT.
        tty: true,
      })

      cmd.stdout.on('data', (chunk: Buffer | string) => {
        outputBuffer += chunk.toString()
        if (outputBuffer.includes(marker)) {
          finish(true)
        }
      })

      cmd.stderr.on('data', (chunk: Buffer | string) => {
        outputBuffer += chunk.toString()
        if (outputBuffer.includes(marker)) {
          finish(true)
        }
      })

      cmd.on('error', () => finish(false))
      cmd.on('exit', () => finish(outputBuffer.includes(marker)))

      const sendInterruptAndProbe = () => {
        if (!cmd || resolved) return
        try {
          // Send ETX (Ctrl+C) to interrupt a foreground process, then probe shell health.
          cmd.stdin.write('\u0003')
          cmd.stdin.write(`echo "${marker}"\n`)
        } catch {
          finish(false)
        }
      }

      onSpawn = () => sendInterruptAndProbe()
      cmd.on('spawn', onSpawn)

      onMessage = (msg: { type: string }) => {
        if (msg.type === 'session_info') {
          sendInterruptAndProbe()
        }
      }
      cmd.on('message', onMessage)
    })
  }

  private async invalidateAfterTimeout(): Promise<void> {
    if (this.closed) return
    this.closed = true

    await this.killRemoteSession()

    try {
      await errorSpriteSession(this.recordId)
    } catch (error) {
      console.warn(`Failed to mark session ${this.sessionId} as errored:`, error)
    }
  }

  private async killRemoteSession(): Promise<void> {
    const token = await getOptionalSpritesToken()
    if (!token) return

    try {
      const response = await fetch(
        `${API_BASE}/sprites/${encodeURIComponent(this.spriteName)}/exec/${this.sessionId}/kill`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      )

      // Read the response to completion (it is a streaming NDJSON endpoint).
      await response.text()
    } catch (error) {
      console.warn(`Failed to kill session ${this.sessionId}:`, error)
    }
  }

  /**
   * Execute a command by connecting to the session, running, and disconnecting.
   *
   * If the WebSocket connection drops due to a keepalive timeout (common during
   * long-running commands with no stdout, e.g. large downloads), the method
   * reattaches to the same session. The session stays alive on the sprite side
   * (detachable with max_run_after_disconnect=0), and the scrollback buffer
   * preserves command output. On reattach we skip resending the command and
   * just poll for our end marker in the scrollback + any new output.
   */
  private async execWithReconnect(
    command: string,
    timeout: number
  ): Promise<Omit<ExecResult, 'duration'>> {
    const ts = Date.now()
    const startMarker = `__SLOPBOT_START_${ts}__`
    const endMarker = `__SLOPBOT_EXIT_${ts}__`
    // Start a background heartbeat that emits a control character (SOH, \x01)
    // every 10 seconds to keep the WebSocket alive during silent periods like
    // large downloads. We kill it when the command finishes. The SOH byte is
    // stripped by sanitizeSessionOutput's CONTROL_CHAR_REGEX.
    const wrappedCommand =
      [
        // Suppress ANSI escape codes and color output from child processes.
        // Even if the session has a PTY (tmux), TERM=dumb tells programs the
        // terminal doesn't support escape sequences. NO_COLOR is a widely
        // adopted convention (https://no-color.org/).
        `export TERM=dumb NO_COLOR=1 2>/dev/null`,
        `(while true; do sleep 10 && printf '\\x01'; done) & __SLOPBOT_HB_PID__=$!`,
        `echo "${startMarker}"`,
        command,
        `__SLOPBOT_EC__=$?`,
        `kill $__SLOPBOT_HB_PID__ 2>/dev/null || true; wait $__SLOPBOT_HB_PID__ 2>/dev/null || true`,
        `echo "${endMarker}$__SLOPBOT_EC__"`,
      ].join('\n') + '\n'

    const MAX_REATTACH = 3
    const deadline = Date.now() + timeout

    for (let attempt = 0; attempt <= MAX_REATTACH; attempt++) {
      const remainingTimeout = deadline - Date.now()
      if (remainingTimeout <= 0) {
        return { exitCode: 124, stdout: '', stderr: 'Command timed out' }
      }

      const isReattach = attempt > 0
      const result = await this.attemptSessionExec(
        startMarker,
        endMarker,
        isReattach ? null : wrappedCommand,
        remainingTimeout
      )

      if (result.type !== 'keepalive_timeout') {
        return {
          exitCode: result.exitCode,
          stdout: result.stdout.trim(),
          stderr: result.stderr.trim(),
        }
      }

      // Keepalive timeout — the command may have finished right before the
      // connection dropped. Check if our markers are in the partial output.
      const extracted = extractMarkerOutput(result.stdout, startMarker, endMarker)
      if (extracted) {
        const output = sanitizeSessionOutput(extracted.output, endMarker)
        return { exitCode: extracted.exitCode, stdout: output.trim(), stderr: result.stderr.trim() }
      }

      if (attempt < MAX_REATTACH) {
        // Brief pause — the session is still alive on the sprite (detachable),
        // we just lost the WebSocket connection during a silent period.
        await new Promise((r) => setTimeout(r, 1500))
      }
    }

    return {
      exitCode: 1,
      stdout: '',
      stderr: 'WebSocket keepalive timeout (reattach attempts exhausted)',
    }
  }

  /**
   * A single attempt to connect to the session and wait for command output.
   *
   * @param wrappedCommand - The command to send, or null for reattach (don't
   *   resend; just read scrollback and wait for markers).
   */
  private attemptSessionExec(
    startMarker: string,
    endMarker: string,
    wrappedCommand: string | null,
    timeout: number
  ): Promise<SessionExecAttemptResult> {
    return new Promise((resolve) => {
      let resolved = false
      let cmd: SpriteCommand | null = null
      let onSpawn: (() => void) | null = null
      let onMessage: ((msg: { type: string }) => void) | null = null

      let outputBuffer = ''
      let stderrBuffer = ''
      let timeoutId: ReturnType<typeof setTimeout> | null = null
      let intervalId: ReturnType<typeof setInterval> | null = null

      const finish = (
        type: SessionExecAttemptResult['type'],
        exitCode: number,
        stdout: string,
        stderr: string
      ) => {
        if (resolved) return
        resolved = true
        if (timeoutId) clearTimeout(timeoutId)
        if (intervalId) clearInterval(intervalId)

        // Remove listeners before killing the socket to avoid duplicate dispatch
        if (cmd) {
          const emitter = cmd as SpriteCommand & {
            off?: (event: string, listener: (...args: unknown[]) => void) => void
            removeListener?: (event: string, listener: (...args: unknown[]) => void) => void
          }
          if (onSpawn) {
            if (typeof emitter.off === 'function') {
              emitter.off('spawn', onSpawn)
            } else if (typeof emitter.removeListener === 'function') {
              emitter.removeListener('spawn', onSpawn)
            }
          }
          if (onMessage) {
            if (typeof emitter.off === 'function') {
              emitter.off('message', onMessage)
            } else if (typeof emitter.removeListener === 'function') {
              emitter.removeListener('message', onMessage)
            }
          }
        }

        // Disconnect WebSocket (session stays alive on sprites side)
        if (cmd) {
          try {
            cmd.kill()
          } catch {
            // Ignore kill errors
          }
        }

        resolve({ type, exitCode, stdout, stderr })
      }

      // Overall timeout
      timeoutId = setTimeout(() => {
        if (!resolved) {
          // Try to extract just the current command's output from the buffer
          // before falling back to the raw buffer (which includes scrollback
          // from previous commands, ANSI codes, and marker noise).
          const extracted = extractMarkerOutput(outputBuffer, startMarker, endMarker)
          if (extracted) {
            const output = sanitizeSessionOutput(extracted.output, endMarker)
            finish('error', extracted.exitCode, output, stderrBuffer || 'Command timed out')
          } else {
            const partialOutput = extractPartialOutputAfterStartMarker(
              outputBuffer,
              startMarker,
              endMarker
            )
            finish(
              'error',
              124,
              partialOutput,
              stderrBuffer ||
                (partialOutput
                  ? 'Command timed out'
                  : 'Command timed out before start marker was observed')
            )
          }
        }
      }, timeout)

      // Connection timeout
      const connectionTimeout = setTimeout(() => {
        if (!resolved) {
          finish('error', 1, '', 'Timeout connecting to session')
        }
      }, 10000)

      cmd = this.sprite.spawn('', [], {
        sessionId: this.sessionId,
        tty: this.tty,
      })

      // Collect output
      cmd.stdout.on('data', (chunk: Buffer | string) => {
        outputBuffer += chunk.toString()
      })

      cmd.stderr.on('data', (chunk: Buffer | string) => {
        stderrBuffer += chunk.toString()
      })

      cmd.on('exit', () => {
        if (!resolved) {
          // Attempt clean extraction before dumping raw buffer
          const extracted = extractMarkerOutput(outputBuffer, startMarker, endMarker)
          if (extracted) {
            const output = sanitizeSessionOutput(extracted.output, endMarker)
            finish(
              'error',
              extracted.exitCode,
              output,
              stderrBuffer || 'Session exited unexpectedly'
            )
          } else {
            const partialOutput = extractPartialOutputAfterStartMarker(
              outputBuffer,
              startMarker,
              endMarker
            )
            finish(
              'error',
              1,
              partialOutput,
              stderrBuffer ||
                (partialOutput
                  ? 'Session exited unexpectedly'
                  : 'Session exited before start marker was observed')
            )
          }
        }
      })

      cmd.on('error', (error: Error) => {
        if (!resolved) {
          clearTimeout(connectionTimeout)
          if (error.message === 'WebSocket keepalive timeout') {
            // Don't treat as fatal — the session is still alive on the sprite.
            // Return partial output so the caller can reattach.
            finish('keepalive_timeout', 1, outputBuffer, stderrBuffer)
          } else {
            finish('error', 1, '', error.message)
          }
        }
      })

      // Wait for connection
      const onConnected = createOneShotHandler(() => {
        if (resolved) return
        clearTimeout(connectionTimeout)

        if (wrappedCommand) {
          // First attempt: clear buffer (discard pre-connection noise) and send command
          outputBuffer = ''
          stderrBuffer = ''
          if (!cmd) {
            finish('error', 1, '', 'Command session not available')
            return
          }
          cmd.stdin.write(wrappedCommand)
        }
        // Reattach: don't clear buffer — scrollback data from the still-running
        // command flows in as stdout and may already contain our markers.
        // Don't send the command again — it's already running on the session.
      })

      onSpawn = () => onConnected()
      cmd.on('spawn', onSpawn)

      // Backup: also accept message event
      onMessage = (msg: { type: string }) => {
        if (msg.type === 'session_info') {
          onConnected()
        }
      }
      cmd.on('message', onMessage)

      // Monitor output buffer for our markers and detect stalled commands.
      // If the command started (start marker seen) but no new output arrives
      // for STALL_TIMEOUT_MS, it's likely waiting for interactive input that
      // will never come. Fail early with a helpful message instead of waiting
      // for the full 5-minute timeout.
      const STALL_TIMEOUT_MS = 30_000
      let lastOutputLen = 0
      let lastOutputChangeTime = Date.now()
      let startMarkerSeen = false

      const checkForMarker = () => {
        const extracted = extractMarkerOutput(outputBuffer, startMarker, endMarker)
        if (extracted) {
          const output = sanitizeSessionOutput(extracted.output, endMarker)
          finish('completed', extracted.exitCode, output, stderrBuffer)
          return
        }

        // Track whether output is still flowing
        if (!startMarkerSeen && outputBuffer.includes(startMarker)) {
          startMarkerSeen = true
        }

        if (outputBuffer.length !== lastOutputLen) {
          lastOutputLen = outputBuffer.length
          lastOutputChangeTime = Date.now()
        } else if (startMarkerSeen && Date.now() - lastOutputChangeTime >= STALL_TIMEOUT_MS) {
          // Output stalled after command started — likely an interactive prompt
          const partialOutput = extractPartialOutputAfterStartMarker(
            outputBuffer,
            startMarker,
            endMarker
          )
          finish(
            'error',
            124,
            partialOutput,
            'Command appears to be waiting for interactive input (no output for 30s). ' +
              'Use non-interactive flags or environment variables to avoid prompts.'
          )
        }
      }

      intervalId = setInterval(checkForMarker, 50)
    })
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.killRemoteSession()

    // Update database record
    await closeSpriteSession(this.recordId)
  }
}

/**
 * Manages sprite sessions for agent tool execution
 *
 * Sessions are per-conversation (session_key + agent_id), not per-job.
 * Commands within the same conversation share a session.
 * Cleanup happens when the conversation is compacted or reset.
 */
export class SpriteSessionManager {
  /**
   * Get or create a session for a conversation
   * Sessions are lazily created on first command execution
   */
  async getOrCreateSession(
    spriteName: string,
    sessionKey: string,
    agentId: string,
    options?: SessionOptions
  ): Promise<ISpriteSession> {
    const result = await this.getOrCreateSessionWithMeta(spriteName, sessionKey, agentId, options)
    return result.session
  }

  /**
   * Get or create a session for a conversation and include whether it was reused.
   */
  async getOrCreateSessionWithMeta(
    spriteName: string,
    sessionKey: string,
    agentId: string,
    options?: SessionOptions
  ): Promise<{ session: ISpriteSession; reused: boolean }> {
    // Check database for existing session
    const existingRecord = await findSpriteSessionBySessionKey(sessionKey, agentId, spriteName)
    if (existingRecord && existingRecord.status === 'active') {
      // Try to reconnect to existing session
      const session = await this.reconnectSession(existingRecord, options)
      if (session) {
        return { session, reused: true }
      }
      // Session is dead, mark it as errored
      await errorSpriteSession(existingRecord.id)
    }

    // Create new session
    const session = await this.createSession(spriteName, sessionKey, agentId, options)
    return { session, reused: false }
  }

  /**
   * Create a new session on the sprite
   */
  private async createSession(
    spriteName: string,
    sessionKey: string,
    agentId: string,
    options?: SessionOptions
  ): Promise<ISpriteSession> {
    const cwd = options?.cwd ?? '/home/sprite'
    const tty = options?.tty ?? false

    const sprite = await getSprite(spriteName)

    // Create a detachable bash session and wait for session info.
    // Session creation can fail transiently; retry before giving up.
    const sessionId = await this.createSessionWithRetry(sprite, cwd, tty)

    // Store in database
    const record = await createSpriteSession({
      sprite_name: spriteName,
      session_id: sessionId,
      session_key: sessionKey,
      agent_id: agentId,
      status: 'active',
    })

    return new SpriteSessionImpl(sessionId, spriteName, record.id, sprite, cwd, tty)
  }

  private async createSessionWithRetry(sprite: Sprite, cwd: string, tty: boolean): Promise<string> {
    let lastError: unknown

    for (let attempt = 1; attempt <= SESSION_CREATE_MAX_RETRIES; attempt++) {
      try {
        return await this.createAndWaitForSession(sprite, cwd, tty)
      } catch (error) {
        lastError = error
        if (attempt < SESSION_CREATE_MAX_RETRIES) {
          await new Promise((resolve) =>
            setTimeout(resolve, SESSION_CREATE_RETRY_BACKOFF_MS * attempt)
          )
        }
      }
    }

    throw new Error(
      `Failed to create sprite session after ${SESSION_CREATE_MAX_RETRIES} attempts: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`
    )
  }

  /**
   * Create a session and wait for the session ID.
   *
   * Uses sprite.spawn() directly instead of sprite.createSession() because
   * createSession() hardcodes tty: true, forcing terminal protocol (merged
   * stdout/stderr, ANSI escape codes). With tty: false we get the binary
   * framed protocol with separate stdout/stderr streams.
   *
   * Session ID discovery: listen for session_info message first (arrives
   * for TTY sessions and may arrive for non-TTY). If it doesn't arrive
   * within SESSION_INFO_WAIT_MS, fall back to listSessions() to find the
   * newly created session.
   */
  private async createAndWaitForSession(
    sprite: Sprite,
    cwd: string,
    tty: boolean
  ): Promise<string> {
    // Snapshot existing session IDs so we can identify the new one
    // if session_info doesn't arrive (non-TTY mode).
    let existingSessionIds: Set<string> | null = null
    try {
      const existing = await sprite.listSessions()
      existingSessionIds = new Set(existing.map((s: Session) => String(s.id)))
    } catch {
      // Non-critical — we'll rely on session_info
    }

    return new Promise((resolve, reject) => {
      let resolved = false
      let fallbackTimeoutId: ReturnType<typeof setTimeout> | null = null

      const closeWs = () => {
        try {
          const wsCmd = (cmd as unknown as { wsCmd?: { close?: () => void } }).wsCmd
          if (wsCmd && typeof wsCmd.close === 'function') {
            wsCmd.close()
          }
        } catch {
          // Ignore close errors
        }
      }

      const resolveOnce = (sessionId: string) => {
        if (resolved) return
        resolved = true
        clearTimeout(timeoutId)
        if (fallbackTimeoutId) clearTimeout(fallbackTimeoutId)
        closeWs()
        resolve(sessionId)
      }

      const rejectOnce = (error: Error) => {
        if (resolved) return
        resolved = true
        clearTimeout(timeoutId)
        if (fallbackTimeoutId) clearTimeout(fallbackTimeoutId)
        closeWs()
        reject(error)
      }

      const timeoutId = setTimeout(() => {
        rejectOnce(new Error('Timeout waiting for session creation'))
      }, SESSION_CREATE_TIMEOUT_MS)

      // Use spawn() directly — createSession() hardcodes tty: true.
      const cmd = sprite.spawn('bash', [], {
        cwd,
        tty,
        detachable: true,
      })

      // Primary: get session_id from session_info message
      cmd.on('message', (msg: { type: string; session_id?: number }) => {
        if (msg.type === 'session_info' && msg.session_id !== undefined) {
          resolveOnce(String(msg.session_id))
        }
      })

      // Fallback: if session_info doesn't arrive (non-TTY spawns may not
      // emit it), discover the session via listSessions() diff.
      cmd.on('spawn', () => {
        const SESSION_INFO_WAIT_MS = 2000
        fallbackTimeoutId = setTimeout(() => {
          if (resolved || !existingSessionIds) return
          const knownIds = existingSessionIds

          void (async () => {
            try {
              const sessions = await sprite.listSessions()
              const newSession = sessions.find(
                (s: Session) => s.isActive && !knownIds.has(String(s.id))
              )
              if (newSession) {
                resolveOnce(String(newSession.id))
              }
            } catch {
              // Will hit overall timeout
            }
          })()
        }, SESSION_INFO_WAIT_MS)
      })

      cmd.on('error', (error: Error) => {
        rejectOnce(error)
      })
    })
  }

  /**
   * Reconnect to an existing session
   */
  private async reconnectSession(
    record: SpriteSessionRecord,
    options?: SessionOptions
  ): Promise<ISpriteSession | null> {
    try {
      const sprite = await getSprite(record.sprite_name)
      const sessions = await sprite.listSessions()

      // Compare as strings since session_id is stored as text
      const isAlive = sessions.some(
        (s: Session) => String(s.id) === record.session_id && s.isActive
      )

      if (!isAlive) {
        return null
      }

      // Update last active timestamp
      await touchSpriteSession(record.id)

      return new SpriteSessionImpl(
        record.session_id,
        record.sprite_name,
        record.id,
        sprite,
        options?.cwd ?? '/home/sprite',
        options?.tty ?? false
      )
    } catch {
      return null
    }
  }

  /**
   * Close a session for a conversation (called during compaction/reset)
   */
  async closeSessionForConversation(sessionKey: string, agentId: string): Promise<void> {
    const token = await getOptionalSpritesToken()

    const records = await findActiveSessionsForConversation(sessionKey, agentId)
    for (const record of records) {
      if (!token) continue
      try {
        const response = await fetch(
          `${API_BASE}/sprites/${encodeURIComponent(record.sprite_name)}/exec/${record.session_id}/kill`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        )
        await response.text()
      } catch (error) {
        console.warn(`Failed to kill session ${record.session_id}:`, error)
      }
    }

    // Close in database
    await closeSessionsForConversation(sessionKey, agentId)
  }

  /**
   * Clean up stale sessions (for use in cleanup endpoint)
   * @param maxAgeSeconds Maximum age in seconds for active sessions (default: 1 hour)
   * @param deleteOlderThan Delete closed/errored sessions older than this (default: 24 hours)
   */
  async cleanupStaleSessions(
    maxAgeSeconds = 3600,
    deleteOlderThan = 86400
  ): Promise<{ closedStale: number; deleted: number }> {
    const token = await getOptionalSpritesToken()
    if (!token) {
      return { closedStale: 0, deleted: 0 }
    }

    // Find and close stale active sessions
    const staleSessions = await findStaleSessions(maxAgeSeconds)
    let closedStale = 0

    for (const record of staleSessions) {
      try {
        // Try to kill the session on Sprites API
        await fetch(
          `${API_BASE}/sprites/${encodeURIComponent(record.sprite_name)}/exec/${record.session_id}/kill`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        )
      } catch {
        // Ignore errors - session might already be dead
      }

      await closeSpriteSession(record.id)
      closedStale++
    }

    // Delete old closed/errored session records
    const deleted = await deleteOldSessions(deleteOlderThan)

    return { closedStale, deleted }
  }
}

// Singleton instance
let sessionManager: SpriteSessionManager | null = null

/**
 * Get the singleton session manager instance
 */
export function getSpriteSessionManager(): SpriteSessionManager {
  if (!sessionManager) {
    sessionManager = new SpriteSessionManager()
  }
  return sessionManager
}

/**
 * Close a sprite session for a conversation (exported for use in agent session.ts)
 */
export async function closeSpriteSessionForConversation(
  sessionKey: string,
  agentId: string
): Promise<void> {
  try {
    await requireSpritesToken()
    const manager = getSpriteSessionManager()
    await manager.closeSessionForConversation(sessionKey, agentId)
  } catch {
    // Tool execution may be disabled or unconfigured. Swallow for best-effort cleanup.
  }
}
