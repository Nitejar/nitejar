import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

const tempDirs: string[] = []
const currentDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(currentDir, '../../../..')

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('manifest validator script', () => {
  it('accepts valid manifest and artifact contract', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'nitejar-manifest-validate-ok-'))
    tempDirs.push(dir)

    const artifactsDir = path.join(dir, 'artifacts')
    mkdirSync(artifactsDir, { recursive: true })
    writeFileSync(path.join(artifactsDir, 'nitejar-runtime-linux-x64.tar.gz'), 'artifact', 'utf8')

    const manifestPath = path.join(dir, 'manifest.json')
    writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          version: 'v1.0.0',
          releasedAt: '2026-02-22T00:00:00.000Z',
          artifacts: {
            'linux-x64': {
              url: 'https://releases.nitejar.dev/v1.0.0/nitejar-runtime-linux-x64.tar.gz',
              sha256: 'a'.repeat(64),
              size: 8,
            },
          },
        },
        null,
        2
      )
    )

    const run = spawnSync(
      'node',
      [
        path.join(repoRoot, 'scripts/release/validate-manifest.mjs'),
        '--manifest',
        manifestPath,
        '--schema',
        path.join(repoRoot, 'scripts/release/manifest.schema.json'),
        '--artifacts-dir',
        artifactsDir,
      ],
      {
        cwd: repoRoot,
        encoding: 'utf8',
      }
    )

    expect(run.status, run.stderr || run.stdout).toBe(0)
  })

  it('rejects invalid manifest shape', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'nitejar-manifest-validate-bad-'))
    tempDirs.push(dir)

    const manifestPath = path.join(dir, 'manifest.json')
    writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          version: '',
          releasedAt: 'not-a-date',
          artifacts: {},
        },
        null,
        2
      )
    )

    const run = spawnSync(
      'node',
      [
        path.join(repoRoot, 'scripts/release/validate-manifest.mjs'),
        '--manifest',
        manifestPath,
        '--schema',
        path.join(repoRoot, 'scripts/release/manifest.schema.json'),
      ],
      {
        cwd: repoRoot,
        encoding: 'utf8',
      }
    )

    expect(run.status).not.toBe(0)
    expect(run.stderr).toContain('Manifest.version must be a non-empty string')
  })
})
