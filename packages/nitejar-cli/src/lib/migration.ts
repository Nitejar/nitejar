import { closeSync, existsSync, openSync, rmSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'

import { getRuntimeMigratorEntry } from './process.js'
import type { Paths } from './types.js'

const BETTER_SQLITE3_ABI_MISMATCH = /NODE_MODULE_VERSION/i
const BETTER_SQLITE3_MISSING_EXIT_CODE = 101

const betterSqlite3ProbeScript = `
try {
  const Database = require('better-sqlite3')
  const db = new Database(':memory:')
  db.close()
  process.exit(0)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'MODULE_NOT_FOUND' &&
    message.includes("Cannot find module 'better-sqlite3'")
  ) {
    process.exit(${BETTER_SQLITE3_MISSING_EXIT_CODE})
  }
  const details = error instanceof Error ? (error.stack ?? message) : message
  console.error(details)
  process.exit(1)
}
`

type SpawnSyncImpl = typeof spawnSync

export function acquireMigrationLock(paths: Paths): number {
  try {
    return openSync(paths.migrateLockFile, 'wx')
  } catch {
    throw new Error(
      `Migration lock is held (${paths.migrateLockFile}). If no migration is running, remove the lock file and retry.`
    )
  }
}

export function releaseMigrationLock(paths: Paths, fd: number): void {
  try {
    closeSync(fd)
  } finally {
    rmSync(paths.migrateLockFile, { force: true })
  }
}

function runtimeDatabaseDir(paths: Paths): string {
  return path.join(paths.currentRuntimeLink, 'packages', 'database')
}

function runtimeDatabaseNodeModules(paths: Paths): string {
  return path.join(runtimeDatabaseDir(paths), 'node_modules')
}

function buildRuntimeNodePath(paths: Paths): string {
  return [runtimeDatabaseNodeModules(paths), process.env.NODE_PATH]
    .filter((segment): segment is string => typeof segment === 'string' && segment.length > 0)
    .join(path.delimiter)
}

function probeBetterSqlite3(
  paths: Paths,
  envFromFile: Record<string, string>,
  spawnSyncImpl: SpawnSyncImpl
): { status: number | null; output: string } {
  const env = {
    ...process.env,
    ...envFromFile,
    NODE_PATH: buildRuntimeNodePath(paths),
  }
  const run = spawnSyncImpl(process.execPath, ['-e', betterSqlite3ProbeScript], {
    cwd: runtimeDatabaseDir(paths),
    env,
    stdio: 'pipe',
    encoding: 'utf8',
  })
  const output = `${run.stdout ?? ''}\n${run.stderr ?? ''}`.trim()
  return { status: run.status, output }
}

export function ensureBetterSqlite3Compatibility(
  paths: Paths,
  envFromFile: Record<string, string>,
  spawnSyncImpl: SpawnSyncImpl = spawnSync
): void {
  const databaseDir = runtimeDatabaseDir(paths)
  const betterSqlite3Path = path.join(runtimeDatabaseNodeModules(paths), 'better-sqlite3')

  // Test fixtures intentionally omit packaged dependencies.
  if (!existsSync(databaseDir) || !existsSync(betterSqlite3Path)) {
    return
  }

  const firstProbe = probeBetterSqlite3(paths, envFromFile, spawnSyncImpl)
  if (firstProbe.status === 0 || firstProbe.status === BETTER_SQLITE3_MISSING_EXIT_CODE) {
    return
  }

  if (!BETTER_SQLITE3_ABI_MISMATCH.test(firstProbe.output)) {
    const details = firstProbe.output ? `\n${firstProbe.output}` : ''
    throw new Error(`Failed to load runtime dependency 'better-sqlite3'.${details}`)
  }

  console.log('Detected Node ABI mismatch for better-sqlite3. Rebuilding native module...')
  const rebuild = spawnSyncImpl(
    'npm',
    ['rebuild', 'better-sqlite3', '--no-audit', '--no-fund', '--silent'],
    {
      cwd: databaseDir,
      env: {
        ...process.env,
        ...envFromFile,
        NODE_PATH: buildRuntimeNodePath(paths),
        npm_config_update_notifier: 'false',
      },
      stdio: 'inherit',
    }
  )

  if (rebuild.error) {
    throw new Error(
      `Failed to rebuild better-sqlite3 automatically: ${rebuild.error.message}. Run "npm rebuild better-sqlite3" in ${databaseDir} and retry.`
    )
  }
  if (rebuild.status !== 0) {
    throw new Error(
      `Automatic rebuild of better-sqlite3 failed with exit code ${rebuild.status ?? 1}. Run "npm rebuild better-sqlite3" in ${databaseDir} and retry.`
    )
  }

  const secondProbe = probeBetterSqlite3(paths, envFromFile, spawnSyncImpl)
  if (secondProbe.status !== 0) {
    const details = secondProbe.output ? `\n${secondProbe.output}` : ''
    throw new Error(`Rebuilt better-sqlite3 but it still failed to load.${details}`)
  }
}

export function runMigrations(paths: Paths, envFromFile: Record<string, string>): string {
  const migrator = getRuntimeMigratorEntry(paths)
  const receiptPath = path.join(paths.migrationReceiptsDir, `${Date.now()}.json`)
  const lockFd = acquireMigrationLock(paths)

  try {
    ensureBetterSqlite3Compatibility(paths, envFromFile)
    const env = {
      ...process.env,
      ...envFromFile,
      DATABASE_URL: path.join(paths.data, 'nitejar.db'),
      MIGRATION_RECEIPT_PATH: receiptPath,
      NITEJAR_AUTO_CUTOVER: '1',
      NITEJAR_CUTOVER_BACKUP_MODE: 'file-copy',
    }
    const run = spawnSync(process.execPath, [migrator], {
      cwd: paths.currentRuntimeLink,
      env,
      stdio: 'inherit',
    })
    if (run.status !== 0) {
      throw new Error(`Migration preflight failed with exit code ${run.status ?? 1}`)
    }
    return receiptPath
  } finally {
    releaseMigrationLock(paths, lockFd)
  }
}
