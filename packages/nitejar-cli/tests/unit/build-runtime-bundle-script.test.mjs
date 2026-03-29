import { describe, expect, it } from 'vitest'

import { buildRuntimeAssets } from '../../../../scripts/release/build-runtime-bundle.mjs'

describe('build-runtime-bundle script', () => {
  it('builds workspace dependencies through turbo before deploying the database package', () => {
    const calls = []
    buildRuntimeAssets('/repo', '/repo/.tmp/release-stage/deployed-database/linux-x64', (...args) => {
      calls.push(args)
    })

    expect(calls).toEqual([
      ['pnpm', ['exec', 'turbo', 'run', 'build', '--filter=@nitejar/database'], '/repo'],
      ['pnpm', ['exec', 'turbo', 'run', 'build', '--filter=@nitejar/web'], '/repo'],
      [
        'pnpm',
        [
          '--filter',
          '@nitejar/database',
          'deploy',
          '--prod',
          '/repo/.tmp/release-stage/deployed-database/linux-x64',
          '--force',
        ],
        '/repo',
      ],
    ])
  })
})
