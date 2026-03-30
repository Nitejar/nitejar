#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..')
const WEB_BUILD_ENCRYPTION_KEY =
  '0000000000000000000000000000000000000000000000000000000000000000'

export function parseArgs(argv = process.argv, env = process.env, defaultRoot = repoRoot) {
  const args = {
    root: defaultRoot,
    dbPath: env.DATABASE_URL ?? path.join(defaultRoot, '.tmp', 'build-databases', 'web-build.sqlite'),
  }

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--repo-root') {
      args.root = path.resolve(argv[i + 1] ?? args.root)
      i += 1
      continue
    }
    if (token === '--db-path') {
      args.dbPath = path.resolve(argv[i + 1] ?? args.dbPath)
      i += 1
    }
  }

  return args
}

export function runCommand(cmd, args, cwd, env = undefined) {
  execFileSync(cmd, args, {
    cwd,
    stdio: 'inherit',
    env: env ? { ...process.env, ...env } : process.env,
  })
}

export function buildWebWithIsolatedDb(root, dbPath, run = runCommand) {
  mkdirSync(path.dirname(dbPath), { recursive: true })
  rmSync(dbPath, { force: true })

  run('pnpm', ['--filter', '@nitejar/database', 'db:migrate'], root, {
    DATABASE_URL: dbPath,
  })
  run('pnpm', ['exec', 'turbo', 'run', 'build', '--filter=@nitejar/web'], root, {
    DATABASE_URL: dbPath,
    ENCRYPTION_KEY: WEB_BUILD_ENCRYPTION_KEY,
  })
}

export function runCli(argv = process.argv) {
  const args = parseArgs(argv)
  buildWebWithIsolatedDb(args.root, args.dbPath)
}

const isDirectRun =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href

if (isDirectRun) {
  runCli(process.argv)
}
