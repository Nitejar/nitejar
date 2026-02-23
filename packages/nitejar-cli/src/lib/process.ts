import {
  existsSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'

import type { MigrationReceipt, Paths, RuntimeMeta, StatusPayload } from './types.js'

export function readPid(paths: Paths): number | null {
  if (!existsSync(paths.pidFile)) return null
  const text = readFileSync(paths.pidFile, 'utf8').trim()
  const value = Number.parseInt(text, 10)
  return Number.isFinite(value) ? value : null
}

export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function readMeta(paths: Paths): RuntimeMeta | null {
  if (!existsSync(paths.metaFile)) return null
  try {
    return JSON.parse(readFileSync(paths.metaFile, 'utf8')) as RuntimeMeta
  } catch {
    return null
  }
}

export function writeMeta(paths: Paths, meta: RuntimeMeta): void {
  writeFileSync(paths.metaFile, `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
}

type ProcessSnapshot = {
  command: string
  startTime: string
}

function readProcessField(pid: number, field: 'command=' | 'lstart='): string | null {
  const run = spawnSync('ps', ['-p', String(pid), '-o', field], {
    encoding: 'utf8',
  })
  if (run.status !== 0) return null
  const value = run.stdout.trim()
  return value.length > 0 ? value : null
}

function getProcessSnapshot(pid: number): ProcessSnapshot | null {
  const command = readProcessField(pid, 'command=')
  const startTime = readProcessField(pid, 'lstart=')
  if (!command || !startTime) return null
  return { command, startTime }
}

function verifyManagedProcess(paths: Paths, pid: number): void {
  const meta = readMeta(paths)
  const snapshot = getProcessSnapshot(pid)

  if (!snapshot) {
    throw new Error(
      `Unable to inspect process ${pid}. Refusing to stop unknown process. Verify ${paths.metaFile}, then remove ${paths.pidFile} if stale.`
    )
  }

  if (meta?.pidStartTime && meta.pidStartTime !== snapshot.startTime) {
    throw new Error(
      `PID ${pid} start time does not match recorded daemon identity. Refusing to stop process. Remove stale ${paths.pidFile} if needed.`
    )
  }

  const commandLooksLikeNitejar =
    snapshot.command.includes('apps/web/server.js') ||
    snapshot.command.includes('nitejar-daemon') ||
    snapshot.command.includes('next-server')

  if (meta?.pidCommand) {
    const commandMatchesRecorded = snapshot.command.includes(meta.pidCommand)
    if (!commandMatchesRecorded && !commandLooksLikeNitejar) {
      throw new Error(
        `PID ${pid} command does not match recorded daemon identity. Refusing to stop process. Remove stale ${paths.pidFile} if needed.`
      )
    }
  }

  if (!meta?.pidCommand && !commandLooksLikeNitejar) {
    throw new Error(
      `PID ${pid} does not look like a Nitejar runtime process. Refusing to stop process. Remove stale ${paths.pidFile} if needed.`
    )
  }
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function rotateLogFile(logFile: string): void {
  if (!existsSync(logFile)) return

  const maxBytes = parsePositiveInt(process.env.NITEJAR_LOG_MAX_BYTES, 10 * 1024 * 1024)
  const maxFiles = parsePositiveInt(process.env.NITEJAR_LOG_MAX_FILES, 5)
  if (maxFiles < 1) return

  const stats = statSync(logFile)
  if (stats.size < maxBytes) return

  const oldestPath = `${logFile}.${maxFiles}`
  rmSync(oldestPath, { force: true })

  for (let index = maxFiles - 1; index >= 1; index -= 1) {
    const src = `${logFile}.${index}`
    const dest = `${logFile}.${index + 1}`
    if (existsSync(src)) {
      renameSync(src, dest)
    }
  }

  renameSync(logFile, `${logFile}.1`)
}

export async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (!isProcessRunning(pid)) return true
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return !isProcessRunning(pid)
}

export async function isPortAvailable(port: number, host = '127.0.0.1'): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const server = createServer()
    server.unref()
    server.once('error', () => {
      resolve(false)
    })
    server.listen(port, host, () => {
      server.close((error) => {
        if (error) {
          resolve(false)
          return
        }
        resolve(true)
      })
    })
  })
}

export async function resolveAutoPort(startPort = 3000, maxAttempts = 200): Promise<number> {
  for (let port = startPort; port < startPort + maxAttempts; port += 1) {
    if (await isPortAvailable(port)) {
      return port
    }
  }
  throw new Error(
    `Unable to find an open port in ${startPort}-${startPort + maxAttempts - 1}. Try --port <number>.`
  )
}

export async function ensurePortAvailable(port: number): Promise<void> {
  const available = await isPortAvailable(port)
  if (!available) {
    throw new Error(`Port ${port} is already in use. Re-run with --port <number> or --port auto.`)
  }
}

export async function stopRunningProcess(paths: Paths): Promise<void> {
  const pid = readPid(paths)
  if (!pid) return
  if (!isProcessRunning(pid)) {
    rmSync(paths.pidFile, { force: true })
    return
  }

  verifyManagedProcess(paths, pid)

  process.kill(pid, 'SIGTERM')
  const exited = await waitForExit(pid, 8000)
  if (!exited) {
    process.kill(pid, 'SIGKILL')
    await waitForExit(pid, 2000)
  }

  rmSync(paths.pidFile, { force: true })
  rmSync(paths.metaFile, { force: true })
}

export function getServerEntry(paths: Paths): string {
  const entry = path.join(paths.currentRuntimeLink, 'apps', 'web', 'server.js')
  if (!existsSync(entry)) {
    throw new Error(`Runtime entrypoint not found: ${entry}. Run 'nitejar up' to install runtime.`)
  }
  return entry
}

export function getRuntimeMigratorEntry(paths: Paths): string {
  const entry = path.join(
    paths.currentRuntimeLink,
    'packages',
    'database',
    'dist',
    'src',
    'runtime-migrate.js'
  )
  if (!existsSync(entry)) {
    throw new Error(
      `Runtime migrator not found: ${entry}. Ensure release bundle contains packages/database/dist/src/runtime-migrate.js`
    )
  }
  return entry
}

export function newestMigrationReceipt(paths: Paths): string | null {
  if (!existsSync(paths.migrationReceiptsDir)) return null
  const entries = readdirSync(paths.migrationReceiptsDir).filter((name) => name.endsWith('.json'))
  if (entries.length === 0) return null
  entries.sort()
  return path.join(paths.migrationReceiptsDir, entries[entries.length - 1] ?? '')
}

export async function waitForHealth(
  port: number,
  logFile: string,
  timeoutMs = 30000,
  pid?: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  const url = `http://127.0.0.1:${port}/`
  let consecutiveHealthyChecks = 0

  while (Date.now() < deadline) {
    if (pid != null && !isProcessRunning(pid)) {
      break
    }

    try {
      const res = await fetch(url)
      if (res.ok || (res.status >= 200 && res.status < 500)) {
        if (pid == null || isProcessRunning(pid)) {
          consecutiveHealthyChecks += 1
          if (consecutiveHealthyChecks >= 2) {
            return
          }
        } else {
          consecutiveHealthyChecks = 0
        }
      } else {
        consecutiveHealthyChecks = 0
      }
    } catch {
      consecutiveHealthyChecks = 0
      // Keep waiting until timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, 750))
  }

  if (existsSync(logFile)) {
    const logText = readFileSync(logFile, 'utf8')
    if (logText.includes('EADDRINUSE')) {
      throw new Error(
        `Port ${port} is already in use. Re-run with --port <number> or --port auto. Check logs at ${logFile}.`
      )
    }
  }

  if (pid != null && !isProcessRunning(pid)) {
    throw new Error(`Nitejar process exited before becoming healthy. Check logs at ${logFile}.`)
  }

  throw new Error(`Health check timed out for ${url}. Check logs at ${logFile}.`)
}

export function getStatus(paths: Paths): StatusPayload {
  const pid = readPid(paths)
  const running = pid != null && isProcessRunning(pid)
  const meta = readMeta(paths)
  return {
    running,
    pid,
    version: meta?.version ?? null,
    port: meta?.port ?? null,
    dbPath: path.join(paths.data, 'nitejar.db'),
    runtimePath: existsSync(paths.currentRuntimeLink) ? paths.currentRuntimeLink : null,
    envFile: paths.envFile,
    logFile: paths.logFile,
    lastMigrationReceipt: newestMigrationReceipt(paths),
  }
}

export async function readMigrationReceipt(receiptPath: string): Promise<MigrationReceipt | null> {
  if (!existsSync(receiptPath)) return null
  try {
    return JSON.parse(await readFile(receiptPath, 'utf8')) as MigrationReceipt
  } catch {
    return null
  }
}

export function renderStatus(status: StatusPayload): void {
  console.log(`running: ${status.running ? 'yes' : 'no'}`)
  console.log(`pid: ${status.pid ?? '-'}`)
  console.log(`version: ${status.version ?? '-'}`)
  console.log(`port: ${status.port ?? '-'}`)
  console.log(`db: ${status.dbPath}`)
  console.log(`runtime: ${status.runtimePath ?? '-'}`)
  console.log(`env: ${status.envFile}`)
  console.log(`logs: ${status.logFile}`)
  console.log(`last migration receipt: ${status.lastMigrationReceipt ?? '-'}`)
}

export function tailText(text: string, lines: number): string {
  const normalized = text.endsWith('\n') ? text.slice(0, -1) : text
  return normalized.split('\n').slice(-Math.max(lines, 1)).join('\n')
}

export function printLogTail(logFile: string, lines: number): void {
  if (!existsSync(logFile)) {
    console.log(`No log file yet at ${logFile}`)
    return
  }
  const text = readFileSync(logFile, 'utf8')
  process.stdout.write(`${tailText(text, lines)}\n`)
}

export async function followLogs(logFile: string, lines: number): Promise<void> {
  printLogTail(logFile, lines)
  const child = spawn('tail', ['-n', String(lines), '-f', logFile], { stdio: 'inherit' })
  await new Promise<void>((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', () => resolve())
  })
}

export function parsePort(value: string): number {
  const num = Number.parseInt(value, 10)
  if (!Number.isFinite(num) || num <= 0 || num > 65535) {
    throw new Error(`Invalid port: ${value}`)
  }
  return num
}

export async function startForeground(paths: Paths, env: Record<string, string>): Promise<never> {
  const entry = getServerEntry(paths)
  const child = spawn(process.execPath, [entry], {
    cwd: paths.currentRuntimeLink,
    env,
    argv0: 'nitejar-daemon',
    stdio: 'inherit',
  })
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => {
      process.exit(code ?? 0)
      resolve()
    })
  })
  throw new Error('unreachable')
}

export async function startDaemon(
  paths: Paths,
  env: Record<string, string>,
  version: string,
  port: number
): Promise<void> {
  const entry = getServerEntry(paths)
  rotateLogFile(paths.logFile)
  const out = openSync(paths.logFile, 'a')

  const child = spawn(process.execPath, [entry], {
    cwd: paths.currentRuntimeLink,
    env,
    argv0: 'nitejar-daemon',
    detached: true,
    stdio: ['ignore', out, out],
  })

  child.unref()
  const pid = child.pid
  if (!pid) {
    throw new Error('Failed to start daemon process.')
  }

  const snapshot = getProcessSnapshot(pid)

  writeFileSync(paths.pidFile, `${pid}\n`, 'utf8')
  writeMeta(paths, {
    pid,
    pidStartTime: snapshot?.startTime,
    pidCommand: snapshot?.command ?? entry,
    version,
    port,
    startedAt: new Date().toISOString(),
    dbPath: path.join(paths.data, 'nitejar.db'),
    runtimePath: paths.currentRuntimeLink,
  })

  try {
    const timeoutMs = Number.parseInt(process.env.NITEJAR_HEALTH_TIMEOUT_MS ?? '30000', 10)
    await waitForHealth(port, paths.logFile, Number.isFinite(timeoutMs) ? timeoutMs : 30000, pid)
  } catch (error) {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // ignore
    }
    throw error
  }
}
