import type { ISpriteSession } from './session'
import { requireSpritesToken } from './token-settings'

/**
 * Result of executing a command on a sprite
 */
export interface ExecResult {
  exitCode: number
  stdout: string
  stderr: string
  duration: number
}

/**
 * Options for command execution
 */
export interface ExecOptions {
  /** Working directory for the command */
  cwd?: string
  /** Environment variables to set */
  env?: Record<string, string>
  /** Timeout in milliseconds (default: 5 minutes) */
  timeout?: number
}

/**
 * Extended options that can include a session for stateful execution
 */
export interface ExecWithSessionOptions extends ExecOptions {
  /** Sprite session for stateful execution across commands */
  session?: ISpriteSession
}

const API_BASE = 'https://api.sprites.dev/v1'

/**
 * Execute a command on a sprite
 *
 * If a session is provided in options, uses the session for stateful execution
 * (shell state persists across commands). Otherwise, uses HTTP POST for simple
 * one-off commands.
 */
export async function spriteExec(
  spriteName: string,
  command: string,
  options?: ExecWithSessionOptions
): Promise<ExecResult> {
  // If a session is provided, use it for stateful execution
  if (options?.session) {
    return options.session.exec(command, options)
  }

  // Otherwise, fall back to HTTP POST for simple one-off commands
  return spriteExecHttp(spriteName, command, options)
}

/**
 * Execute a command on a sprite using HTTP POST API
 * Uses the simple HTTP endpoint instead of WebSocket for reliability
 * This is stateless - each command runs in a fresh shell
 */
export async function spriteExecHttp(
  spriteName: string,
  command: string,
  options?: ExecOptions
): Promise<ExecResult> {
  const startTime = Date.now()
  const token = await requireSpritesToken()

  // Build query params - use bash -c to run shell commands
  const params = new URLSearchParams()
  params.append('cmd', 'bash')
  params.append('cmd', '-c')
  params.append('cmd', command)

  if (options?.cwd) {
    params.append('dir', options.cwd)
  }

  if (options?.env) {
    for (const [key, value] of Object.entries(options.env)) {
      params.append('env', `${key}=${value}`)
    }
  }

  const url = `${API_BASE}/sprites/${encodeURIComponent(spriteName)}/exec?${params.toString()}`

  try {
    const controller = new AbortController()
    const timeout = options?.timeout ?? 300000 // 5 minutes default
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    const duration = Date.now() - startTime

    if (!response.ok) {
      const errorText = await response.text()
      return {
        exitCode: 1,
        stdout: '',
        stderr: `HTTP ${response.status}: ${errorText}`,
        duration,
      }
    }

    const output = await response.text()

    // HTTP POST exec doesn't return exit code separately
    // Assume success if we got a 200 response
    return {
      exitCode: 0,
      stdout: output,
      stderr: '',
      duration,
    }
  } catch (error) {
    const duration = Date.now() - startTime

    if (error instanceof Error && error.name === 'AbortError') {
      return {
        exitCode: 124, // timeout exit code
        stdout: '',
        stderr: 'Command timed out',
        duration,
      }
    }

    return {
      exitCode: 1,
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
      duration,
    }
  }
}

/**
 * Execute a command on a sprite instance (compatibility wrapper)
 */
export async function spriteExecOnSprite(
  sprite: { name: string },
  command: string,
  options?: ExecOptions
): Promise<ExecResult> {
  return spriteExec(sprite.name, command, options)
}

/**
 * Execute multiple commands in sequence
 */
export async function spriteExecMultiple(
  spriteName: string,
  commands: string[],
  options?: ExecOptions
): Promise<ExecResult[]> {
  const results: ExecResult[] = []

  for (const command of commands) {
    const result = await spriteExec(spriteName, command, options)
    results.push(result)

    // Stop on first failure
    if (result.exitCode !== 0) {
      break
    }
  }

  return results
}
