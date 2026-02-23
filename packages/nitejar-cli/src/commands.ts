import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { ensureBaseEnv, readEnv } from './lib/env.js'
import { runMigrations } from './lib/migration.js'
import { resolvePaths, ensureDirs } from './lib/paths.js'
import {
  ensurePortAvailable,
  followLogs,
  getStatus,
  parsePort,
  printLogTail,
  readMigrationReceipt,
  renderStatus,
  resolveAutoPort,
  resolvePlatformKey,
  startDaemon,
  startForeground,
  stopRunningProcess,
} from './lib/index.js'
import { ensureRuntimeRelease } from './lib/runtime.js'
import { shouldRunWizard, runWizard } from './lib/wizard.js'
import type { WizardResult } from './lib/wizard.js'

function buildRuntimeEnv(
  baseEnv: Record<string, string>,
  dataPath: string,
  port: number,
  runtimePath: string
): Record<string, string> {
  const appBaseUrl = baseEnv.APP_BASE_URL ?? `http://localhost:${port}`
  const runtimeDatabaseNodeModules = path.join(runtimePath, 'packages', 'database', 'node_modules')
  const nodePath = [runtimeDatabaseNodeModules, process.env.NODE_PATH]
    .filter((segment): segment is string => typeof segment === 'string' && segment.length > 0)
    .join(path.delimiter)

  return {
    ...process.env,
    ...baseEnv,
    PORT: String(port),
    HOSTNAME: '0.0.0.0',
    NODE_ENV: 'production',
    DATABASE_URL: path.join(dataPath, 'nitejar.db'),
    APP_BASE_URL: appBaseUrl,
    APP_URL: appBaseUrl,
    NEXTAUTH_URL: appBaseUrl,
    NEXT_PUBLIC_APP_URL: appBaseUrl,
    NODE_PATH: nodePath,
  }
}

export async function commandUp(options: {
  version?: string
  port?: string
  foreground?: boolean
  dataDir?: string
  noWizard?: boolean
}): Promise<void> {
  const version = options.version ?? 'latest'
  let requestedPort = options.port ?? '3000'
  let fixedPort = requestedPort === 'auto' ? null : parsePort(requestedPort)

  const paths = resolvePaths(options.dataDir)
  ensureDirs(paths)

  let wizardResult: WizardResult | undefined
  if (
    shouldRunWizard(
      existsSync(paths.envFile),
      options.noWizard ?? false,
      Boolean(process.stdout.isTTY)
    )
  ) {
    const defaultPort = fixedPort ?? 3000
    const result = await runWizard(defaultPort)
    if (result === null) {
      process.exitCode = 0
      return
    }
    wizardResult = result
    if (!options.port) {
      requestedPort = String(result.port)
      fixedPort = result.port
    }
  }

  const resolveSelectedPort = async (): Promise<number> => {
    if (fixedPort != null) return fixedPort
    return await resolveAutoPort()
  }

  const platform = resolvePlatformKey()
  const release = await ensureRuntimeRelease(paths, platform, version)
  console.log(`Runtime ready: ${release.version} (${platform})`)

  if (options.foreground) {
    const port = await resolveSelectedPort()
    await ensurePortAvailable(port)
    if (requestedPort === 'auto') {
      console.log(`Selected open port: ${port}`)
    }
    const envFromFile = ensureBaseEnv(paths, port, wizardResult)
    runMigrations(paths, envFromFile)
    const env = buildRuntimeEnv(envFromFile, paths.data, port, paths.currentRuntimeLink)
    await startForeground(paths, env)
    return
  }

  await stopRunningProcess(paths)
  let port = await resolveSelectedPort()
  await ensurePortAvailable(port)
  if (requestedPort === 'auto') {
    console.log(`Selected open port: ${port}`)
  }
  const envFromFile = ensureBaseEnv(paths, port, wizardResult)
  const receiptPath = runMigrations(paths, envFromFile)
  const receipt = await readMigrationReceipt(receiptPath)

  const maxStartAttempts = requestedPort === 'auto' ? 4 : 1
  let lastStartError: unknown

  for (let attempt = 1; attempt <= maxStartAttempts; attempt += 1) {
    if (attempt > 1) {
      port = await resolveSelectedPort()
      await ensurePortAvailable(port)
      console.log(`Port became unavailable. Retrying with port: ${port}`)
    }

    const startEnvFile = ensureBaseEnv(paths, port, wizardResult)
    const env = buildRuntimeEnv(startEnvFile, paths.data, port, paths.currentRuntimeLink)

      try {
        await startDaemon(paths, env, release.version, port)
        console.log(`Nitejar is running at ${env.APP_BASE_URL ?? `http://localhost:${port}`}`)
        console.log(`Logs: ${paths.logFile}`)
        if (receipt) {
          console.log(
          `Migration status: ${receipt.migrationStatus}, cutover: ${receipt.cutoverStatus}`
        )
      }
      return
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const isPortInUse = /Port \d+ is already in use/.test(message)
      if (requestedPort === 'auto' && isPortInUse && attempt < maxStartAttempts) {
        lastStartError = error
        continue
      }
      throw error
    }
  }

  throw lastStartError instanceof Error
    ? lastStartError
    : new Error('Failed to start Nitejar daemon after auto-port retries.')
}

export async function commandDown(options: { dataDir?: string }): Promise<void> {
  const paths = resolvePaths(options.dataDir)
  ensureDirs(paths)
  const status = getStatus(paths)
  if (!status.pid || !status.running) {
    console.log('Nitejar is not running.')
    return
  }
  await stopRunningProcess(paths)
  console.log('Nitejar stopped.')
}

export function commandStatus(options: { json?: boolean; dataDir?: string }): void {
  const paths = resolvePaths(options.dataDir)
  ensureDirs(paths)
  const status = getStatus(paths)
  if (options.json) {
    console.log(JSON.stringify(status, null, 2))
    return
  }
  renderStatus(status)
}

export async function commandLogs(options: {
  follow?: boolean
  lines?: string
  dataDir?: string
}): Promise<void> {
  const paths = resolvePaths(options.dataDir)
  ensureDirs(paths)
  const lines = options.lines ? Number.parseInt(options.lines, 10) : 100
  if (!Number.isFinite(lines) || lines <= 0) {
    throw new Error(`Invalid --lines value: ${options.lines}`)
  }
  if (options.follow) {
    await followLogs(paths.logFile, lines)
    return
  }
  printLogTail(paths.logFile, lines)
}

export function commandMigrate(options: { dataDir?: string }): void {
  const paths = resolvePaths(options.dataDir)
  ensureDirs(paths)
  if (!existsSync(paths.currentRuntimeLink)) {
    throw new Error(`No runtime installed at ${paths.currentRuntimeLink}. Run 'nitejar up' first.`)
  }
  const envFromFile = ensureBaseEnv(paths, 3000)
  const receipt = runMigrations(paths, envFromFile)
  console.log(`Migration receipt: ${receipt}`)
}

export function commandDoctor(options: { dataDir?: string }): void {
  const paths = resolvePaths(options.dataDir)
  ensureDirs(paths)
  const env = readEnv(paths)
  const status = getStatus(paths)
  const checks = [
    {
      name: 'platform support',
      ok: (() => {
        try {
          resolvePlatformKey()
          return true
        } catch {
          return false
        }
      })(),
      detail: `${process.platform}/${process.arch}`,
    },
    {
      name: 'env file',
      ok: existsSync(paths.envFile),
      detail: paths.envFile,
    },
    {
      name: 'encryption key',
      ok: typeof env.ENCRYPTION_KEY === 'string' && env.ENCRYPTION_KEY.length === 64,
      detail: env.ENCRYPTION_KEY ? 'set' : 'missing',
    },
    {
      name: 'auth secret',
      ok: typeof env.BETTER_AUTH_SECRET === 'string' && env.BETTER_AUTH_SECRET.length > 0,
      detail: env.BETTER_AUTH_SECRET ? 'set' : 'missing',
    },
    {
      name: 'runtime link',
      ok: existsSync(paths.currentRuntimeLink),
      detail: paths.currentRuntimeLink,
    },
    {
      name: 'database path',
      ok: existsSync(path.join(paths.data, 'nitejar.db')),
      detail: path.join(paths.data, 'nitejar.db'),
    },
    {
      name: 'daemon status',
      ok: status.running,
      detail: status.running ? `pid ${status.pid}` : 'not running',
    },
  ]

  let failures = 0
  for (const check of checks) {
    console.log(`${check.ok ? 'ok ' : 'bad'} ${check.name}: ${check.detail}`)
    if (!check.ok) failures += 1
  }
  if (failures > 0) {
    process.exitCode = 1
  }
}
