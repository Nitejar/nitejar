import { type SpriteCommand, type Sprite, type Session } from '@fly/sprites'
import { getSprite } from './client'
import { requireSpritesToken } from './token-settings'

const API_BASE = 'https://api.sprites.dev/v1'

export interface SpawnBackgroundTaskOptions {
  cwd?: string
}

export interface SpawnBackgroundTaskResult {
  cmd: SpriteCommand
  sessionId: string
}

/**
 * Spawn a detachable background task:
 *
 * 1. Create a non-TTY detachable session via sprite.spawn() with tty: false.
 *    (sprite.createSession() hardcodes tty: true, forcing terminal protocol.)
 * 2. Get the session ID from session_info message, or fall back to
 *    listSessions() if session_info doesn't arrive (non-TTY mode).
 * 3. Close the WebSocket (session stays alive on the sprite) and reattach
 *    with tty: false for clean binary stdout/stderr streaming.
 */
export async function spawnDetachableBackgroundTask(
  spriteName: string,
  wrappedCommand: string,
  options?: SpawnBackgroundTaskOptions
): Promise<SpawnBackgroundTaskResult> {
  const sprite = await getSprite(spriteName)

  // Step 1: Create a non-TTY detachable session to get the session ID.
  const sessionId = await createDetachableSession(sprite, options?.cwd)

  // Step 2: Reattach for binary stdout/stderr streaming.
  const cmd = sprite.spawn('', [], {
    sessionId,
    tty: false,
  })

  // Step 3: Wait for the WebSocket to connect, then send the command.
  await waitForSpawn(cmd)
  cmd.stdin.write(wrappedCommand + '\n')

  return { cmd, sessionId }
}

export async function attachBackgroundTaskSession(
  spriteName: string,
  sessionId: string
): Promise<SpriteCommand> {
  const sprite = await getSprite(spriteName)
  return sprite.spawn('', [], {
    sessionId,
    tty: false,
  })
}

export async function isBackgroundTaskSessionActive(
  spriteName: string,
  sessionId: string
): Promise<boolean> {
  const sprite = await getSprite(spriteName)
  const sessions = await sprite.listSessions()
  return sessions.some((session) => String(session.id) === String(sessionId) && session.isActive)
}

export async function killBackgroundTaskSession(
  spriteName: string,
  sessionId: string
): Promise<void> {
  const token = await requireSpritesToken()

  const response = await fetch(
    `${API_BASE}/sprites/${encodeURIComponent(spriteName)}/exec/${encodeURIComponent(sessionId)}/kill`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  )

  const body = await response.text()
  if (!response.ok) {
    throw new Error(`Failed to kill background task session ${sessionId}: ${body}`)
  }
}

export function closeSpriteCommandSocket(cmd: SpriteCommand): void {
  try {
    const wsCmd = (cmd as unknown as { wsCmd?: { close?: () => void } }).wsCmd
    if (wsCmd && typeof wsCmd.close === 'function') {
      wsCmd.close()
    }
  } catch {
    // Ignore close errors
  }
}

/**
 * Create a non-TTY detachable session and discover the session ID.
 *
 * Uses sprite.spawn() directly instead of sprite.createSession() because
 * createSession() hardcodes tty: true. With tty: false we get the binary
 * framed protocol (separate stdout/stderr streams, no ANSI escape codes).
 *
 * Session ID discovery: listens for session_info message (may arrive for
 * non-TTY spawns). Falls back to listSessions() diff after 2 seconds.
 */
async function createDetachableSession(sprite: Sprite, cwd?: string): Promise<string> {
  // Snapshot existing sessions for diff-based fallback
  let existingSessionIds: Set<string> | null = null
  try {
    const existing = await sprite.listSessions()
    existingSessionIds = new Set(existing.map((s: Session) => String(s.id)))
  } catch {
    // Non-critical
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
      rejectOnce(new Error('Timeout waiting for background task session id'))
    }, 10_000)

    // Use spawn() directly — createSession() hardcodes tty: true.
    const cmd = sprite.spawn('bash', [], {
      ...(cwd ? { cwd } : {}),
      detachable: true,
    })

    // Primary: get session_id from session_info message
    cmd.on('message', (msg: { type?: string; session_id?: number | string }) => {
      if (msg?.type === 'session_info' && msg.session_id !== undefined) {
        resolveOnce(String(msg.session_id))
      }
    })

    // Fallback: discover session via listSessions() diff
    cmd.on('spawn', () => {
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
      }, 2000)
    })

    cmd.on('error', (error: Error) => {
      rejectOnce(error)
    })
  })
}

/**
 * Wait for a SpriteCommand WebSocket to connect (spawn event).
 */
function waitForSpawn(cmd: SpriteCommand): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error('Timeout waiting for background task reattach'))
    }, 10_000)

    cmd.on('spawn', () => {
      clearTimeout(timeoutId)
      resolve()
    })

    cmd.on('error', (error: Error) => {
      clearTimeout(timeoutId)
      reject(error)
    })
  })
}
