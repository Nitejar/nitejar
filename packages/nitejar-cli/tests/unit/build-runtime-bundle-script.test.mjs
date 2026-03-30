import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { buildRuntimeAssets } from '../../../../scripts/release/build-runtime-bundle.mjs'

const tempDirs = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('build-runtime-bundle script', () => {
  it('builds workspace dependencies through turbo with an isolated web-build database before deploying the database package', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'nitejar-release-build-assets-'))
    tempDirs.push(root)
    const calls = []
    buildRuntimeAssets(
      root,
      path.join(root, '.tmp/release-stage/deployed-database/linux-x64'),
      'linux-x64',
      (...args) => {
        calls.push(args)
      }
    )

    expect(calls).toEqual([
      ['pnpm', ['exec', 'turbo', 'run', 'build', '--filter=@nitejar/database'], root],
      [
        'pnpm',
        ['--filter', '@nitejar/database', 'db:migrate'],
        root,
        { DATABASE_URL: path.join(root, '.tmp/release-stage/build-databases/web-build-linux-x64.sqlite') },
      ],
      [
        'pnpm',
        ['exec', 'turbo', 'run', 'build', '--filter=@nitejar/web'],
        root,
        {
          DATABASE_URL: path.join(root, '.tmp/release-stage/build-databases/web-build-linux-x64.sqlite'),
          ENCRYPTION_KEY: '0000000000000000000000000000000000000000000000000000000000000000',
        },
      ],
      [
        'pnpm',
        [
          '--filter',
          '@nitejar/database',
          'deploy',
          '--prod',
          path.join(root, '.tmp/release-stage/deployed-database/linux-x64'),
          '--force',
        ],
        root,
      ],
    ])
  })
})
