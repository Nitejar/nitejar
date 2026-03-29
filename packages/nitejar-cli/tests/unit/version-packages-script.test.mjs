import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import {
  buildSyntheticCliChangeset,
  ensureSyntheticCliChangeset,
  generatedChangesetPath,
  shouldSyncCliRelease,
} from '../../../../scripts/release/version-packages.mjs'

const createdFiles = []

afterEach(() => {
  for (const filePath of createdFiles.splice(0)) {
    rmSync(filePath, { force: true })
  }
})

describe('version-packages release sync logic', () => {
  it('requests a CLI sync when runtime packages release without a CLI release', () => {
    expect(
      shouldSyncCliRelease({
        releases: [
          { name: '@nitejar/web', newVersion: '0.1.0' },
          { name: '@nitejar/agent', newVersion: '0.2.0' },
        ],
      })
    ).toBe(true)
  })

  it('skips the CLI sync for non-runtime releases', () => {
    expect(
      shouldSyncCliRelease({
        releases: [
          { name: '@nitejar/integration-tests', newVersion: '0.0.2' },
          { name: '@nitejar/docs', newVersion: '0.0.1' },
        ],
      })
    ).toBe(false)
  })

  it('skips the CLI sync when the CLI is already in the release plan', () => {
    expect(
      shouldSyncCliRelease({
        releases: [
          { name: '@nitejar/web', newVersion: '0.1.0' },
          { name: '@nitejar/cli', newVersion: '0.3.1' },
        ],
      })
    ).toBe(false)
  })

  it('writes a synthetic CLI changeset when a runtime release needs one', () => {
    createdFiles.push(generatedChangesetPath)
    rmSync(generatedChangesetPath, { force: true })

    const injected = ensureSyntheticCliChangeset({
      releases: [{ name: '@nitejar/web', newVersion: '0.1.0' }],
    })

    expect(injected).toBe(true)
    expect(existsSync(generatedChangesetPath)).toBe(true)
    expect(readFileSync(generatedChangesetPath, 'utf8')).toBe(buildSyntheticCliChangeset())
  })

  it('removes a stale synthetic CLI changeset when it is not needed', () => {
    writeFileSync(generatedChangesetPath, buildSyntheticCliChangeset(), 'utf8')
    createdFiles.push(generatedChangesetPath)

    const injected = ensureSyntheticCliChangeset({
      releases: [{ name: '@nitejar/integration-tests', newVersion: '0.0.2' }],
    })

    expect(injected).toBe(false)
    expect(existsSync(generatedChangesetPath)).toBe(false)
  })
})
