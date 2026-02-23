import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const BetterSqlite3 = require('better-sqlite3') as new (path: string) => {
  prepare: (sql: string) => {
    get: (...params: unknown[]) => Record<string, unknown> | undefined
  }
  close: () => void
}

const tempDirs: string[] = []

afterAll(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('runtime-migrate dist executable', () => {
  it('runs dist/src/runtime-migrate.js against sqlite and writes receipt', () => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    const repoRoot = path.resolve(currentDir, '..', '..', '..')
    const build = spawnSync('pnpm', ['--filter', '@nitejar/database', 'build'], {
      cwd: repoRoot,
      encoding: 'utf8',
    })

    expect(build.status, build.stderr || build.stdout).toBe(0)

    const dir = mkdtempSync(path.join(tmpdir(), 'nitejar-runtime-migrate-dist-'))
    tempDirs.push(dir)

    const dbPath = path.join(dir, 'nitejar.db')
    const receiptPath = path.join(dir, 'receipt.json')

    const run = spawnSync('node', ['packages/database/dist/src/runtime-migrate.js'], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        DATABASE_URL: dbPath,
        MIGRATION_RECEIPT_PATH: receiptPath,
        NITEJAR_AUTO_CUTOVER: '0',
      },
    })

    expect(run.status, run.stderr || run.stdout).toBe(0)

    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as {
      migrationStatus: string
      cutoverStatus: string
    }

    expect(receipt.migrationStatus).toBe('ok')
    expect(receipt.cutoverStatus).toBe('skipped')

    const db = new BetterSqlite3(dbPath)
    const migrationTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='kysely_migration'")
      .get() as { name: string } | undefined

    expect(migrationTable?.name).toBe('kysely_migration')
    db.close()
  })
})
