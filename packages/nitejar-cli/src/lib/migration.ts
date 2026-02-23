import { closeSync, openSync, rmSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'

import { getRuntimeMigratorEntry } from './process.js'
import type { Paths } from './types.js'

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

export function runMigrations(paths: Paths, envFromFile: Record<string, string>): string {
  const migrator = getRuntimeMigratorEntry(paths)
  const receiptPath = path.join(paths.migrationReceiptsDir, `${Date.now()}.json`)
  const lockFd = acquireMigrationLock(paths)

  try {
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
