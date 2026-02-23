import { mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { Paths } from './types.js'

export function resolvePaths(dataDir?: string): Paths {
  const root = dataDir ? path.resolve(dataDir) : path.join(os.homedir(), '.nitejar')
  return {
    root,
    data: path.join(root, 'data'),
    configDir: path.join(root, 'config'),
    envFile: path.join(root, 'config', 'env'),
    releases: path.join(root, 'releases'),
    runtimeDir: path.join(root, 'runtime'),
    currentRuntimeLink: path.join(root, 'runtime', 'current'),
    runDir: path.join(root, 'run'),
    pidFile: path.join(root, 'run', 'nitejar.pid'),
    metaFile: path.join(root, 'run', 'meta.json'),
    migrateLockFile: path.join(root, 'run', 'migrate.lock'),
    logsDir: path.join(root, 'logs'),
    logFile: path.join(root, 'logs', 'server.log'),
    receiptsDir: path.join(root, 'receipts'),
    migrationReceiptsDir: path.join(root, 'receipts', 'migrations'),
  }
}

export function ensureDirs(paths: Paths): void {
  const dirs = [
    paths.root,
    paths.data,
    paths.configDir,
    paths.releases,
    paths.runtimeDir,
    paths.runDir,
    paths.logsDir,
    paths.receiptsDir,
    paths.migrationReceiptsDir,
  ]
  for (const dir of dirs) {
    mkdirSync(dir, { recursive: true })
  }
}
