import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { buildWebWithIsolatedDb } from '../../../../scripts/build/build-web-with-isolated-db.mjs'

const tempDirs = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('build-web-with-isolated-db script', () => {
  it('migrates an isolated database before building the web workspace', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'nitejar-web-build-'))
    const dbPath = path.join(root, '.tmp', 'build-databases', 'web-build.sqlite')
    const calls = []
    tempDirs.push(root)

    buildWebWithIsolatedDb(root, dbPath, (...args) => {
      calls.push(args)
    })

    expect(calls).toEqual([
      ['pnpm', ['--filter', '@nitejar/database', 'db:migrate'], root, { DATABASE_URL: dbPath }],
      [
        'pnpm',
        ['exec', 'turbo', 'run', 'build', '--filter=@nitejar/web'],
        root,
        {
          DATABASE_URL: dbPath,
          ENCRYPTION_KEY: '0000000000000000000000000000000000000000000000000000000000000000',
        },
      ],
    ])
  })
})
