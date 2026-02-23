import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { resolvePaths, resolvePlatformKey } from '../../src/lib/index.js'
import { buildCliSync, runCli, spawnCliLongRunning } from '../helpers/cli-process.js'
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

async function getFreePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to resolve open port'))
        return
      }
      const port = address.port
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve(port)
      })
    })
  })
}

async function createFixtureRelease(options?: {
  version?: string
  latestVersion?: string
  fixtureOptions?: Parameters<typeof createRuntimeFixtureArchive>[2]
  includeVersionManifest?: boolean
  latestManifestStatus?: number
  versionManifestStatus?: number
  artifactStatus?: number
}): Promise<{
  dataDir: string
  releaseBaseUrl: string
  paths: ReturnType<typeof resolvePaths>
  version: string
}> {
  const root = mkdtempSync(path.join(tmpdir(), 'nitejar-cli-integration-'))
  const artifactDir = path.join(root, 'artifacts')
  mkdirSync(artifactDir, { recursive: true })
  tempDirs.push(root)

  const platform = resolvePlatformKey()
  const version = options?.version ?? 'v1.0.0'
  const archiveName = `nitejar-runtime-${platform}.tar.gz`
  const fixture = await createRuntimeFixtureArchive(
    artifactDir,
    archiveName,
    options?.fixtureOptions
  )

  const routes = createStandardReleaseRoutes({
    version,
    latestVersion: options?.latestVersion,
    platform,
    artifactPath: fixture.archivePath,
    sha256: fixture.sha256,
    size: fixture.size,
    includeVersionManifest: options?.includeVersionManifest,
    latestManifestStatus: options?.latestManifestStatus,
    versionManifestStatus: options?.versionManifestStatus,
    artifactStatus: options?.artifactStatus,
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
    version,
  }
}

describe('cli integration happy paths', () => {
  it('fresh up creates runtime layout and status json', async () => {
    const fixture = await createFixtureRelease()
    const port = await getFreePort()

    const up = await runCli(['up', '--data-dir', fixture.dataDir, '--port', String(port)], {
      env: {
        NITEJAR_RELEASES_BASE_URL: fixture.releaseBaseUrl,
      },
      timeoutMs: 20_000,
    })

    expect(up.code).toBe(0)
    expect(up.stdout).toContain('Nitejar is running.')
    expect(up.stdout).toContain(`Open: http://localhost:${port}`)

    expect(existsSync(path.join(fixture.paths.data, 'nitejar.db'))).toBe(false)
    expect(existsSync(fixture.paths.envFile)).toBe(true)
    expect(statSync(fixture.paths.envFile).mode & 0o777).toBe(0o600)
    expect(existsSync(fixture.paths.currentRuntimeLink)).toBe(true)

    const status = await runCli(['status', '--json', '--data-dir', fixture.dataDir], {
      env: {
        NITEJAR_RELEASES_BASE_URL: fixture.releaseBaseUrl,
      },
    })
    expect(status.code).toBe(0)
    const payload = JSON.parse(status.stdout) as {
      running: boolean
      version: string
      dbPath: string
      lastMigrationReceipt: string
    }
    expect(payload.running).toBe(true)
    expect(payload.version).toBe('v1.0.0')
    expect(payload.dbPath).toBe(path.join(fixture.paths.data, 'nitejar.db'))
    expect(payload.lastMigrationReceipt).toContain(path.join('receipts', 'migrations'))

    const down = await runCli(['down', '--data-dir', fixture.dataDir], {
      env: {
        NITEJAR_RELEASES_BASE_URL: fixture.releaseBaseUrl,
      },
    })
    expect(down.code).toBe(0)
    expect(down.stdout).toContain('Nitejar stopped.')
  })

  it('supports --port auto and prints the selected url', async () => {
    const fixture = await createFixtureRelease()

    const up = await runCli(['up', '--data-dir', fixture.dataDir, '--port', 'auto'], {
      env: {
        NITEJAR_RELEASES_BASE_URL: fixture.releaseBaseUrl,
      },
      timeoutMs: 20_000,
    })
    expect(up.code).toBe(0)
    expect(up.stdout).toContain('Selected open port:')

    const status = await runCli(['status', '--json', '--data-dir', fixture.dataDir], {
      env: {
        NITEJAR_RELEASES_BASE_URL: fixture.releaseBaseUrl,
      },
    })
    expect(status.code).toBe(0)

    const payload = JSON.parse(status.stdout) as { running: boolean; port: number | null }
    expect(payload.running).toBe(true)
    expect(payload.port).toBeTypeOf('number')
    expect(payload.port).toBeGreaterThan(0)
    expect(up.stdout).toContain('Nitejar is running.')
    expect(up.stdout).toContain(`Open: http://localhost:${payload.port}`)

    const down = await runCli(['down', '--data-dir', fixture.dataDir], {
      env: {
        NITEJAR_RELEASES_BASE_URL: fixture.releaseBaseUrl,
      },
    })
    expect(down.code).toBe(0)
  })

  it('repeated up is idempotent and replaces stale pid', async () => {
    const fixture = await createFixtureRelease()
    const port = await getFreePort()

    mkdirSync(path.dirname(fixture.paths.pidFile), { recursive: true })
    writeFileSync(fixture.paths.pidFile, '999999\n', 'utf8')

    const first = await runCli(['up', '--data-dir', fixture.dataDir, '--port', String(port)], {
      env: {
        NITEJAR_RELEASES_BASE_URL: fixture.releaseBaseUrl,
      },
      timeoutMs: 20_000,
    })
    expect(first.code).toBe(0)

    const firstPid = Number.parseInt(readFileSync(fixture.paths.pidFile, 'utf8').trim(), 10)

    const second = await runCli(['up', '--data-dir', fixture.dataDir, '--port', String(port)], {
      env: {
        NITEJAR_RELEASES_BASE_URL: fixture.releaseBaseUrl,
      },
      timeoutMs: 20_000,
    })
    expect(second.code).toBe(0)

    const secondPid = Number.parseInt(readFileSync(fixture.paths.pidFile, 'utf8').trim(), 10)
    expect(secondPid).not.toBe(999999)
    expect(secondPid).not.toBe(firstPid)

    const down = await runCli(['down', '--data-dir', fixture.dataDir], {
      env: {
        NITEJAR_RELEASES_BASE_URL: fixture.releaseBaseUrl,
      },
    })
    expect(down.code).toBe(0)
  })

  it('prints local open url even when APP_BASE_URL points elsewhere', async () => {
    const fixture = await createFixtureRelease()
    const port = await getFreePort()

    mkdirSync(path.dirname(fixture.paths.envFile), { recursive: true })
    writeFileSync(fixture.paths.envFile, 'APP_BASE_URL=http://localhost:4000\n', 'utf8')

    const up = await runCli(['up', '--data-dir', fixture.dataDir, '--port', String(port)], {
      env: {
        NITEJAR_RELEASES_BASE_URL: fixture.releaseBaseUrl,
      },
      timeoutMs: 20_000,
    })

    expect(up.code).toBe(0)
    expect(up.stdout).toContain(`Open: http://localhost:${port}`)
    expect(up.stdout).toContain('Configured APP_BASE_URL: http://localhost:4000')

    const down = await runCli(['down', '--data-dir', fixture.dataDir], {
      env: {
        NITEJAR_RELEASES_BASE_URL: fixture.releaseBaseUrl,
      },
    })
    expect(down.code).toBe(0)
  })

  it('supports logs tail and logs follow', async () => {
    const fixture = await createFixtureRelease()
    const port = await getFreePort()

    const up = await runCli(['up', '--data-dir', fixture.dataDir, '--port', String(port)], {
      env: {
        NITEJAR_RELEASES_BASE_URL: fixture.releaseBaseUrl,
      },
      timeoutMs: 20_000,
    })
    expect(up.code).toBe(0)

    writeFileSync(fixture.paths.logFile, 'line-1\nline-2\nline-3\n', 'utf8')

    const logs = await runCli(['logs', '--data-dir', fixture.dataDir, '--lines', '2'], {
      env: {
        NITEJAR_RELEASES_BASE_URL: fixture.releaseBaseUrl,
      },
    })
    expect(logs.code).toBe(0)
    expect(logs.stdout).toContain('line-2')
    expect(logs.stdout).toContain('line-3')

    const follower = spawnCliLongRunning(
      ['logs', '--follow', '--data-dir', fixture.dataDir, '--lines', '1'],
      {
        env: {
          NITEJAR_RELEASES_BASE_URL: fixture.releaseBaseUrl,
        },
      }
    )

    await follower.waitForOutput(/line-3/)
    appendFileSync(fixture.paths.logFile, 'line-4\n', 'utf8')
    await follower.waitForOutput(/line-4/)
    await follower.stop()

    const down = await runCli(['down', '--data-dir', fixture.dataDir], {
      env: {
        NITEJAR_RELEASES_BASE_URL: fixture.releaseBaseUrl,
      },
    })
    expect(down.code).toBe(0)
  })

  it('down is a no-op when daemon is stopped', async () => {
    const fixture = await createFixtureRelease()
    const down = await runCli(['down', '--data-dir', fixture.dataDir], {
      env: {
        NITEJAR_RELEASES_BASE_URL: fixture.releaseBaseUrl,
      },
    })
    expect(down.code).toBe(0)
    expect(down.stdout).toContain('Nitejar is not running.')
  })

  it('respects version pinning', async () => {
    const fixture = await createFixtureRelease({
      version: 'v1.5.0',
      latestVersion: 'v9.9.9',
      includeVersionManifest: true,
    })
    const port = await getFreePort()

    const up = await runCli(
      ['up', '--data-dir', fixture.dataDir, '--port', String(port), '--version', 'v1.5.0'],
      {
        env: {
          NITEJAR_RELEASES_BASE_URL: fixture.releaseBaseUrl,
        },
        timeoutMs: 20_000,
      }
    )

    expect(up.code).toBe(0)
    expect(up.stdout).toContain('Runtime ready: v1.5.0')

    const status = await runCli(['status', '--json', '--data-dir', fixture.dataDir], {
      env: {
        NITEJAR_RELEASES_BASE_URL: fixture.releaseBaseUrl,
      },
    })

    const payload = JSON.parse(status.stdout) as { version: string }
    expect(payload.version).toBe('v1.5.0')

    await runCli(['down', '--data-dir', fixture.dataDir], {
      env: {
        NITEJAR_RELEASES_BASE_URL: fixture.releaseBaseUrl,
      },
    })
  })

  it('rotates and cleans old log files on daemon start', async () => {
    const fixture = await createFixtureRelease()
    const port = await getFreePort()

    mkdirSync(path.dirname(fixture.paths.logFile), { recursive: true })
    writeFileSync(fixture.paths.logFile, 'main-old-log-content\n', 'utf8')
    writeFileSync(`${fixture.paths.logFile}.1`, 'backup-one\n', 'utf8')
    writeFileSync(`${fixture.paths.logFile}.2`, 'backup-two\n', 'utf8')

    const up = await runCli(['up', '--data-dir', fixture.dataDir, '--port', String(port)], {
      env: {
        NITEJAR_RELEASES_BASE_URL: fixture.releaseBaseUrl,
        NITEJAR_LOG_MAX_BYTES: '1',
        NITEJAR_LOG_MAX_FILES: '2',
      },
      timeoutMs: 20_000,
    })

    expect(up.code).toBe(0)
    expect(existsSync(`${fixture.paths.logFile}.1`)).toBe(true)
    expect(existsSync(`${fixture.paths.logFile}.2`)).toBe(true)
    expect(readFileSync(`${fixture.paths.logFile}.1`, 'utf8')).toContain('main-old-log-content')
    expect(readFileSync(`${fixture.paths.logFile}.2`, 'utf8')).toContain('backup-one')
    expect(existsSync(`${fixture.paths.logFile}.3`)).toBe(false)

    const down = await runCli(['down', '--data-dir', fixture.dataDir], {
      env: {
        NITEJAR_RELEASES_BASE_URL: fixture.releaseBaseUrl,
      },
    })
    expect(down.code).toBe(0)
  })
})
