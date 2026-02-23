import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { resolvePaths, resolvePlatformKey } from '../../src/lib/index.js'
import { buildCliSync, runCli } from '../helpers/cli-process.js'
import { createStandardReleaseRoutes, startReleaseServer } from '../helpers/release-server.js'
import { createRuntimeFixtureArchive } from '../helpers/runtime-fixture.js'

const tempDirs: string[] = []
const serverClosers: Array<() => Promise<void>> = []

beforeAll(() => {
  buildCliSync()
})

afterEach(async () => {
  for (const close of serverClosers.splice(0)) {
    await close()
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

async function setupRuntimeServer(options?: {
  fixtureOptions?: Parameters<typeof createRuntimeFixtureArchive>[2]
  sha256Override?: string
  includeVersionManifest?: boolean
  latestManifestStatus?: number
  versionManifestStatus?: number
  manifestArtifacts?: Record<string, { url: string; sha256: string; size: number }>
}): Promise<{ dataDir: string; releaseBaseUrl: string; paths: ReturnType<typeof resolvePaths> }> {
  const root = mkdtempSync(path.join(tmpdir(), 'nitejar-cli-failure-'))
  const artifactDir = path.join(root, 'artifacts')
  mkdirSync(artifactDir, { recursive: true })
  tempDirs.push(root)

  const platform = resolvePlatformKey()
  const version = 'v1.0.0'
  const archiveName = `nitejar-runtime-${platform}.tar.gz`
  const fixture = await createRuntimeFixtureArchive(
    artifactDir,
    archiveName,
    options?.fixtureOptions
  )

  const routes =
    options?.manifestArtifacts != null
      ? {
          '/manifest.json': {
            status: options.latestManifestStatus,
            body: {
              version,
              releasedAt: new Date().toISOString(),
              artifacts: options.manifestArtifacts,
            },
          },
          [`/${version}/manifest.json`]: {
            status: options.versionManifestStatus,
            body: {
              version,
              releasedAt: new Date().toISOString(),
              artifacts: options.manifestArtifacts,
            },
          },
        }
      : createStandardReleaseRoutes({
          version,
          platform,
          artifactPath: fixture.archivePath,
          sha256: options?.sha256Override ?? fixture.sha256,
          size: fixture.size,
          includeVersionManifest: options?.includeVersionManifest,
          latestManifestStatus: options?.latestManifestStatus,
          versionManifestStatus: options?.versionManifestStatus,
        })

  const server = await startReleaseServer(routes)
  serverClosers.push(async () => {
    await server.close()
    fixture.cleanup()
  })

  const dataDir = path.join(root, 'data-dir')
  const paths = resolvePaths(dataDir)

  return {
    dataDir,
    releaseBaseUrl: server.baseUrl,
    paths,
  }
}

describe('cli integration failure paths', () => {
  it('fails when manifest fetch errors', async () => {
    const fixture = await setupRuntimeServer({ latestManifestStatus: 500 })

    const result = await runCli(['up', '--data-dir', fixture.dataDir], {
      env: {
        NITEJAR_RELEASES_BASE_URL: fixture.releaseBaseUrl,
      },
    })

    expect(result.code).toBe(1)
    expect(result.stderr).toContain('Failed to fetch release manifest')
  })

  it('fails when platform artifact is missing in manifest', async () => {
    const currentPlatform = resolvePlatformKey()
    const otherPlatform = currentPlatform === 'darwin-arm64' ? 'linux-x64' : 'darwin-arm64'
    const fixture = await setupRuntimeServer({
      manifestArtifacts: {
        [otherPlatform]: {
          url: `/v1.0.0/nitejar-runtime-${otherPlatform}.tar.gz`,
          sha256: 'abc',
          size: 1,
        },
      },
    })

    const result = await runCli(['up', '--data-dir', fixture.dataDir], {
      env: {
        NITEJAR_RELEASES_BASE_URL: fixture.releaseBaseUrl,
      },
    })

    expect(result.code).toBe(1)
    expect(result.stderr).toContain('No runtime artifact')
  })

  it('fails on checksum mismatch', async () => {
    const fixture = await setupRuntimeServer({ sha256Override: 'deadbeef' })

    const result = await runCli(['up', '--data-dir', fixture.dataDir], {
      env: {
        NITEJAR_RELEASES_BASE_URL: fixture.releaseBaseUrl,
      },
    })

    expect(result.code).toBe(1)
    expect(result.stderr).toContain('Checksum mismatch')
  })

  it('fails on corrupted archive', async () => {
    const fixture = await setupRuntimeServer({ fixtureOptions: { breakArchive: true } })

    const result = await runCli(['up', '--data-dir', fixture.dataDir], {
      env: {
        NITEJAR_RELEASES_BASE_URL: fixture.releaseBaseUrl,
      },
    })

    expect(result.code).toBe(1)
    expect(result.stderr).toContain('error:')
  })

  it('fails when bundled migrator is missing', async () => {
    const fixture = await setupRuntimeServer({ fixtureOptions: { missingMigrator: true } })

    const result = await runCli(['up', '--data-dir', fixture.dataDir], {
      env: {
        NITEJAR_RELEASES_BASE_URL: fixture.releaseBaseUrl,
      },
      timeoutMs: 20_000,
    })

    expect(result.code).toBe(1)
    expect(result.stderr).toContain('Runtime migrator not found')
  })

  it('blocks startup when migrations fail and writes a failure receipt', async () => {
    const fixture = await setupRuntimeServer()

    const result = await runCli(['up', '--data-dir', fixture.dataDir], {
      env: {
        NITEJAR_RELEASES_BASE_URL: fixture.releaseBaseUrl,
        NITEJAR_TEST_MIGRATION_FAIL: '1',
      },
    })

    expect(result.code).toBe(1)
    expect(result.stderr).toContain('Migration preflight failed')
    const receiptRun = await runCli(['status', '--json', '--data-dir', fixture.dataDir], {
      env: {
        NITEJAR_RELEASES_BASE_URL: fixture.releaseBaseUrl,
      },
    })
    const status = JSON.parse(receiptRun.stdout) as { lastMigrationReceipt: string | null }
    expect(status.lastMigrationReceipt).toBeTruthy()
  })

  it('blocks migrate when migration lock already exists', async () => {
    const fixture = await setupRuntimeServer()

    const up = await runCli(['up', '--data-dir', fixture.dataDir], {
      env: {
        NITEJAR_RELEASES_BASE_URL: fixture.releaseBaseUrl,
      },
      timeoutMs: 20_000,
    })
    expect(up.code).toBe(0)

    writeFileSync(fixture.paths.migrateLockFile, 'lock', 'utf8')

    const migrate = await runCli(['migrate', '--data-dir', fixture.dataDir], {
      env: {
        NITEJAR_RELEASES_BASE_URL: fixture.releaseBaseUrl,
      },
    })

    expect(migrate.code).toBe(1)
    expect(migrate.stderr).toContain('Migration lock is held')

    await runCli(['down', '--data-dir', fixture.dataDir], {
      env: {
        NITEJAR_RELEASES_BASE_URL: fixture.releaseBaseUrl,
      },
    })
  })

  it('surfaces log path when health check times out', async () => {
    const fixture = await setupRuntimeServer()

    const result = await runCli(['up', '--data-dir', fixture.dataDir, '--port', '32999'], {
      env: {
        NITEJAR_RELEASES_BASE_URL: fixture.releaseBaseUrl,
        NITEJAR_TEST_SERVER_MODE: 'hang',
        NITEJAR_HEALTH_TIMEOUT_MS: '1200',
      },
      timeoutMs: 10_000,
    })

    expect(result.code).toBe(1)
    expect(result.stderr).toContain('Health check timed out')
    expect(result.stderr).toContain(fixture.paths.logFile)
  })

  it('fails fast with actionable error when requested port is in use', async () => {
    const fixture = await setupRuntimeServer()
    const blocker = createServer((_req, res) => {
      res.statusCode = 200
      res.end('busy')
    })
    await new Promise<void>((resolve, reject) => {
      blocker.once('error', reject)
      blocker.listen(0, '127.0.0.1', () => resolve())
    })

    const address = blocker.address()
    if (!address || typeof address === 'string') {
      throw new Error('Failed to resolve blocker port')
    }

    try {
      const result = await runCli(
        ['up', '--data-dir', fixture.dataDir, '--port', String(address.port)],
        {
          env: {
            NITEJAR_RELEASES_BASE_URL: fixture.releaseBaseUrl,
          },
          timeoutMs: 10_000,
        }
      )

      expect(result.code).toBe(1)
      expect(result.stderr).toContain(`Port ${address.port} is already in use`)
      expect(result.stderr).toContain('--port auto')
    } finally {
      await new Promise<void>((resolve, reject) => {
        blocker.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
    }
  })

  it('refuses to stop when pid identity does not match metadata', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'nitejar-cli-mismatch-'))
    tempDirs.push(root)
    const dataDir = path.join(root, 'data-dir')
    const paths = resolvePaths(dataDir)

    mkdirSync(paths.runDir, { recursive: true })
    writeFileSync(paths.pidFile, `${process.pid}\n`, 'utf8')
    writeFileSync(
      paths.metaFile,
      `${JSON.stringify(
        {
          pid: process.pid,
          pidStartTime: 'Mon Jan 01 00:00:00 2001',
          pidCommand: 'definitely-not-nitejar',
          version: 'v0',
          port: 3000,
          startedAt: new Date().toISOString(),
          dbPath: path.join(paths.data, 'nitejar.db'),
          runtimePath: '/tmp/nowhere',
        },
        null,
        2
      )}\n`,
      'utf8'
    )

    const down = await runCli(['down', '--data-dir', dataDir])
    expect(down.code).toBe(1)
    expect(down.stderr).toContain('daemon identity')
  })
})
