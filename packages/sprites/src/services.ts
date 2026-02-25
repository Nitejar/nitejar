import type { ServiceLogStream, ServiceWithState, ServiceRequest } from '@fly/sprites'
import { getSprite, getSpriteByName } from './client'
import { spriteExec } from './exec'

/**
 * Result from consuming a service log stream (create/start/stop).
 */
export interface ServiceStartResult {
  started: boolean
  logs: string[]
  error?: string
}

/** Default timeout for consuming the service log stream (ms). */
const STREAM_TIMEOUT_MS = 30_000

/**
 * Consume a ServiceLogStream with a timeout.
 * Stops on `started`, `error`, `exit`, or `stopped` events.
 * Collects stdout/stderr lines as startup logs.
 */
async function consumeServiceLogStream(stream: ServiceLogStream): Promise<ServiceStartResult> {
  const logs: string[] = []
  let started = false
  let error: string | undefined
  let timedOut = false

  const timer = setTimeout(() => {
    timedOut = true
    stream.close()
  }, STREAM_TIMEOUT_MS)

  try {
    for await (const event of stream) {
      if (timedOut) break

      switch (event.type) {
        case 'stdout':
        case 'stderr':
          if (event.data) {
            logs.push(event.data)
          }
          break
        case 'started':
          started = true
          break
        case 'error':
          error = event.data ?? 'Unknown service error'
          break
        case 'exit':
          if (event.exitCode !== 0) {
            error = `Service exited with code ${event.exitCode}`
          }
          break
        case 'stopped':
          // For stop operations, stopped is the expected terminal event
          started = false
          break
      }

      // Terminal events — stop consuming
      if (
        event.type === 'started' ||
        event.type === 'error' ||
        event.type === 'exit' ||
        event.type === 'stopped'
      ) {
        break
      }
    }

    // If we timed out without an error, treat as success
    if (timedOut && !error) {
      started = true
    }
  } finally {
    clearTimeout(timer)
    stream.close()
  }

  return { started, logs, error }
}

/**
 * Create a managed service on a sprite.
 *
 * Uses `sprite-env services create` via exec as a workaround for the
 * broken REST API (`PUT /services/{name}` returns "service name required"
 * regardless of payload — bug in sprite agent rc32).
 */
export async function createSpriteService(
  spriteName: string,
  serviceName: string,
  config: ServiceRequest,
  duration?: string
): Promise<ServiceStartResult> {
  const parts = ['sprite-env', 'services', 'create', serviceName, '--cmd', config.cmd]

  if (config.args && config.args.length > 0) {
    parts.push('--args', config.args.join(','))
  }

  if (config.needs && config.needs.length > 0) {
    parts.push('--needs', config.needs.join(','))
  }

  if (config.httpPort != null) {
    parts.push('--http-port', String(config.httpPort))
  }

  if (duration) {
    parts.push('--duration', duration)
  }

  // Shell-escape each part and join
  const cmd = parts.map((p) => `'${p.replace(/'/g, "'\\''")}'`).join(' ')

  const result = await spriteExec(spriteName, cmd, { timeout: STREAM_TIMEOUT_MS })

  // Parse NDJSON output from sprite-env for log lines and status
  const logs: string[] = []
  let started = false
  let error: string | undefined

  interface SpriteEnvEvent {
    type: string
    data?: string
    message?: string
  }

  for (const line of result.stdout.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const event = JSON.parse(trimmed) as SpriteEnvEvent
      if (event.type === 'stdout' || event.type === 'stderr') {
        if (event.data) logs.push(event.data)
      } else if (event.type === 'started') {
        started = true
      } else if (event.type === 'complete') {
        // sprite-env emits "complete" on success
        started = true
      } else if (event.type === 'error') {
        error = event.data ?? event.message ?? 'Unknown service error'
      }
    } catch {
      // Non-JSON output goes to logs
      logs.push(trimmed)
    }
  }

  if (result.exitCode !== 0 && !error) {
    error = result.stderr || `sprite-env exited with code ${result.exitCode}`
  }

  // If no explicit error and no explicit started event, check exit code
  if (!error && !started && result.exitCode === 0) {
    started = true
  }

  return { started, logs, error }
}

/**
 * List all managed services on a sprite.
 */
export async function listSpriteServices(spriteName: string): Promise<ServiceWithState[]> {
  const sprite = await getSprite(spriteName)
  return sprite.listServices()
}

/**
 * Delete a managed service from a sprite.
 */
export async function deleteSpriteService(spriteName: string, serviceName: string): Promise<void> {
  const sprite = await getSprite(spriteName)
  await sprite.deleteService(serviceName)
}

/**
 * Start an existing service on a sprite.
 */
export async function startSpriteService(
  spriteName: string,
  serviceName: string,
  duration?: string
): Promise<ServiceStartResult> {
  const sprite = await getSprite(spriteName)
  const stream = await sprite.startService(serviceName, duration)
  return consumeServiceLogStream(stream)
}

/**
 * Stop a running service on a sprite.
 */
export async function stopSpriteService(
  spriteName: string,
  serviceName: string,
  timeout?: string
): Promise<ServiceStartResult> {
  const sprite = await getSprite(spriteName)
  const stream = await sprite.stopService(serviceName, timeout)
  return consumeServiceLogStream(stream)
}

/**
 * Get the public URL for a sprite (if available).
 */
export async function getSpriteUrl(spriteName: string): Promise<string | null> {
  const sprite = await getSpriteByName(spriteName)
  return sprite?.url ?? null
}

/**
 * Make the sprite's URL public and return it.
 */
export async function setSpriteUrlPublic(spriteName: string): Promise<string> {
  const sprite = await getSpriteByName(spriteName)
  if (!sprite) {
    throw new Error(`Sprite "${spriteName}" not found`)
  }

  await sprite.updateURLSettings({ auth: 'public' })

  // Re-fetch to get the updated URL
  const updated = await getSpriteByName(spriteName)
  if (!updated?.url) {
    throw new Error('Failed to get sprite URL after making it public')
  }

  return updated.url
}
