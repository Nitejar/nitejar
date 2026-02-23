import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

function sha256(filePath: string): string {
  const hash = createHash('sha256')
  hash.update(readFileSync(filePath))
  return hash.digest('hex')
}

describe('generate-manifest script', () => {
  it('defaults base URL to GitHub release download path for the selected version', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'nitejar-release-manifest-default-'))
    const artifactsDir = path.join(dir, 'artifacts')
    const output = path.join(dir, 'manifest.json')
    mkdirSync(artifactsDir, { recursive: true })
    tempDirs.push(dir)

    const linuxArtifact = path.join(artifactsDir, 'nitejar-runtime-linux-x64.tar.gz')
    writeFileSync(linuxArtifact, 'linux-runtime', 'utf8')

    const run = spawnSync(
      'node',
      [
        path.join(repoRoot, 'scripts/release/generate-manifest.mjs'),
        '--version',
        'v2.3.4',
        '--artifacts-dir',
        artifactsDir,
        '--output',
        output,
      ],
      {
        cwd: repoRoot,
        encoding: 'utf8',
      }
    )

    expect(run.status, run.stderr || run.stdout).toBe(0)

    const manifest = JSON.parse(readFileSync(output, 'utf8')) as {
      artifacts: Record<string, { url: string }>
    }

    expect(manifest.artifacts['linux-x64']?.url).toBe(
      'https://github.com/nitejar/nitejar/releases/download/v2.3.4/nitejar-runtime-linux-x64.tar.gz'
    )
  })

  it('produces schema-compatible manifest with deterministic platform ordering', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'nitejar-release-manifest-'))
    const artifactsDir = path.join(dir, 'artifacts')
    const output = path.join(dir, 'manifest.json')
    mkdirSync(artifactsDir, { recursive: true })
    tempDirs.push(dir)

    const linuxArtifact = path.join(artifactsDir, 'nitejar-runtime-linux-x64.tar.gz')
    const darwinArtifact = path.join(artifactsDir, 'nitejar-runtime-darwin-arm64.tar.gz')

    writeFileSync(linuxArtifact, 'linux-runtime', 'utf8')
    writeFileSync(darwinArtifact, 'darwin-runtime', 'utf8')

    const run = spawnSync(
      'node',
      [
        path.join(repoRoot, 'scripts/release/generate-manifest.mjs'),
        '--version',
        'v2.3.4',
        '--artifacts-dir',
        artifactsDir,
        '--base-url',
        'https://releases.nitejar.dev',
        '--output',
        output,
      ],
      {
        cwd: repoRoot,
        encoding: 'utf8',
      }
    )

    expect(run.status, run.stderr || run.stdout).toBe(0)

    const manifest = JSON.parse(readFileSync(output, 'utf8')) as {
      version: string
      releasedAt: string
      artifacts: Record<string, { url: string; sha256: string; size: number }>
    }

    expect(manifest.version).toBe('v2.3.4')
    expect(typeof manifest.releasedAt).toBe('string')
    expect(Object.keys(manifest.artifacts)).toEqual(['darwin-arm64', 'linux-x64'])

    expect(manifest.artifacts['linux-x64']).toEqual({
      url: 'https://releases.nitejar.dev/v2.3.4/nitejar-runtime-linux-x64.tar.gz',
      sha256: sha256(linuxArtifact),
      size: Buffer.byteLength('linux-runtime'),
    })
  })
})

describe('build-runtime-bundle script', () => {
  it('packs required runtime files into tarball', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'nitejar-release-build-'))
    tempDirs.push(root)

    const standalone = path.join(root, 'apps/web/.next/standalone/apps/web')
    const staticDir = path.join(root, 'apps/web/.next/static')
    const publicDir = path.join(root, 'apps/web/public')
    const dbDistDir = path.join(root, 'packages/database/dist/src')
    const migrationsDir = path.join(root, 'packages/database/migrations')

    mkdirSync(standalone, { recursive: true })
    mkdirSync(staticDir, { recursive: true })
    mkdirSync(publicDir, { recursive: true })
    mkdirSync(dbDistDir, { recursive: true })
    mkdirSync(migrationsDir, { recursive: true })

    writeFileSync(path.join(standalone, 'server.js'), 'console.log("server")\n', 'utf8')
    writeFileSync(path.join(staticDir, 'asset.txt'), 'asset', 'utf8')
    writeFileSync(path.join(publicDir, 'favicon.ico'), 'icon', 'utf8')
    writeFileSync(path.join(dbDistDir, 'runtime-migrate.js'), 'console.log("migrate")\n', 'utf8')
    writeFileSync(path.join(migrationsDir, '0000_init.sql'), '-- migration', 'utf8')

    const output = path.join(root, 'dist/release/nitejar-runtime-linux-x64.tar.gz')

    const run = spawnSync(
      'node',
      [
        path.join(repoRoot, 'scripts/release/build-runtime-bundle.mjs'),
        '--platform',
        'linux-x64',
        '--version',
        'v1.2.3',
        '--output',
        output,
        '--repo-root',
        root,
        '--skip-build',
      ],
      {
        cwd: repoRoot,
        encoding: 'utf8',
      }
    )

    expect(run.status, run.stderr || run.stdout).toBe(0)

    const listing = spawnSync('tar', ['-tzf', output], {
      encoding: 'utf8',
    })

    expect(listing.status).toBe(0)
    expect(listing.stdout).toContain('./apps/web/server.js')
    expect(listing.stdout).toContain('./packages/database/dist/src/runtime-migrate.js')
    expect(listing.stdout).toContain('./packages/database/migrations/0000_init.sql')
  })
})
