import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { ensureDirs, ensureRuntimeRelease, resolvePaths } from '../../src/lib/index.js'
import { createStandardReleaseRoutes, startReleaseServer } from '../helpers/release-server.js'
import { createRuntimeFixtureArchive } from '../helpers/runtime-fixture.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('runtime release download and extraction', () => {
  it('downloads and extracts runtime for a platform', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'nitejar-runtime-ok-'))
    const artifactDir = path.join(dir, 'artifact')
    mkdirSync(artifactDir, { recursive: true })
    tempDirs.push(dir)

    const fixture = await createRuntimeFixtureArchive(
      artifactDir,
      'nitejar-runtime-linux-x64.tar.gz'
    )

    const server = await startReleaseServer(
      createStandardReleaseRoutes({
        version: 'v1.0.0',
        platform: 'linux-x64',
        artifactPath: fixture.archivePath,
        sha256: fixture.sha256,
        size: fixture.size,
      })
    )

    const paths = resolvePaths(path.join(dir, 'data-dir'))
    ensureDirs(paths)

    const release = await ensureRuntimeRelease(paths, 'linux-x64', 'latest', {
      baseUrl: server.baseUrl,
    })

    expect(release.version).toBe('v1.0.0')
    expect(release.runtimePath).toContain(path.join('releases', 'v1.0.0', 'linux-x64', 'runtime'))

    await server.close()
    fixture.cleanup()
  })

  it('fails when manifest does not include requested platform artifact', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'nitejar-runtime-missing-platform-'))
    tempDirs.push(dir)

    const server = await startReleaseServer({
      '/manifest.json': {
        body: {
          version: 'v1.0.0',
          releasedAt: '2026-01-01T00:00:00.000Z',
          artifacts: { 'darwin-arm64': { url: '/x.tar.gz', sha256: 'abc', size: 1 } },
        },
      },
    })

    const paths = resolvePaths(path.join(dir, 'data-dir'))
    ensureDirs(paths)

    await expect(
      ensureRuntimeRelease(paths, 'linux-x64', 'latest', { baseUrl: server.baseUrl })
    ).rejects.toThrow(/No runtime artifact for linux-x64/)

    await server.close()
  })

  it('fails hard on checksum mismatch', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'nitejar-runtime-checksum-'))
    const artifactDir = path.join(dir, 'artifact')
    mkdirSync(artifactDir, { recursive: true })
    tempDirs.push(dir)

    const fixture = await createRuntimeFixtureArchive(
      artifactDir,
      'nitejar-runtime-linux-x64.tar.gz'
    )

    const server = await startReleaseServer(
      createStandardReleaseRoutes({
        version: 'v1.0.0',
        platform: 'linux-x64',
        artifactPath: fixture.archivePath,
        sha256: 'deadbeef',
        size: fixture.size,
      })
    )

    const paths = resolvePaths(path.join(dir, 'data-dir'))
    ensureDirs(paths)

    await expect(
      ensureRuntimeRelease(paths, 'linux-x64', 'latest', {
        baseUrl: server.baseUrl,
      })
    ).rejects.toThrow(/Checksum mismatch/)

    await server.close()
    fixture.cleanup()
  })

  it('fails on corrupted archive extraction', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'nitejar-runtime-corrupt-'))
    const artifactDir = path.join(dir, 'artifact')
    mkdirSync(artifactDir, { recursive: true })
    tempDirs.push(dir)

    const fixture = await createRuntimeFixtureArchive(
      artifactDir,
      'nitejar-runtime-linux-x64.tar.gz',
      { breakArchive: true }
    )

    const server = await startReleaseServer(
      createStandardReleaseRoutes({
        version: 'v1.0.0',
        platform: 'linux-x64',
        artifactPath: fixture.archivePath,
        sha256: fixture.sha256,
        size: fixture.size,
      })
    )

    const paths = resolvePaths(path.join(dir, 'data-dir'))
    ensureDirs(paths)

    await expect(
      ensureRuntimeRelease(paths, 'linux-x64', 'latest', {
        baseUrl: server.baseUrl,
      })
    ).rejects.toThrow()

    await server.close()
    fixture.cleanup()
  })

  it('re-downloads when cached archive hash is stale and replaces non-symlink runtime link', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'nitejar-runtime-redownload-'))
    const artifactDir = path.join(dir, 'artifact')
    mkdirSync(artifactDir, { recursive: true })
    tempDirs.push(dir)

    const fixture = await createRuntimeFixtureArchive(
      artifactDir,
      'nitejar-runtime-linux-x64.tar.gz'
    )

    const server = await startReleaseServer(
      createStandardReleaseRoutes({
        version: 'v1.0.0',
        platform: 'linux-x64',
        artifactPath: fixture.archivePath,
        sha256: fixture.sha256,
        size: fixture.size,
      })
    )

    const paths = resolvePaths(path.join(dir, 'data-dir'))
    ensureDirs(paths)

    const archivePath = path.join(paths.releases, 'v1.0.0', 'linux-x64', 'runtime.tar.gz')
    mkdirSync(path.dirname(archivePath), { recursive: true })
    writeFileSync(archivePath, 'stale', 'utf8')
    mkdirSync(paths.currentRuntimeLink, { recursive: true })
    writeFileSync(path.join(paths.currentRuntimeLink, 'temp.txt'), 'temp', 'utf8')

    await ensureRuntimeRelease(paths, 'linux-x64', 'latest', {
      baseUrl: server.baseUrl,
    })

    expect(existsSync(archivePath)).toBe(true)
    expect(lstatSync(paths.currentRuntimeLink).isSymbolicLink()).toBe(true)

    await server.close()
    fixture.cleanup()
  })

  it('re-extracts runtime when same version has a new artifact sha', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'nitejar-runtime-reextract-'))
    const artifactDir = path.join(dir, 'artifact')
    mkdirSync(artifactDir, { recursive: true })
    tempDirs.push(dir)

    const firstFixture = await createRuntimeFixtureArchive(
      artifactDir,
      'nitejar-runtime-linux-x64-first.tar.gz',
      { contentTag: 'first' }
    )
    const secondFixture = await createRuntimeFixtureArchive(
      artifactDir,
      'nitejar-runtime-linux-x64-second.tar.gz',
      { contentTag: 'second' }
    )

    const paths = resolvePaths(path.join(dir, 'data-dir'))
    ensureDirs(paths)

    const firstServer = await startReleaseServer(
      createStandardReleaseRoutes({
        version: 'v1.0.0',
        platform: 'linux-x64',
        artifactPath: firstFixture.archivePath,
        sha256: firstFixture.sha256,
        size: firstFixture.size,
      })
    )

    await ensureRuntimeRelease(paths, 'linux-x64', 'latest', {
      baseUrl: firstServer.baseUrl,
    })

    const runtimeServerEntry = path.join(
      paths.releases,
      'v1.0.0',
      'linux-x64',
      'runtime',
      'apps/web/server.js'
    )
    const markerPath = path.join(paths.releases, 'v1.0.0', 'linux-x64', '.nitejar.sha256')
    expect(readFileSync(runtimeServerEntry, 'utf8')).toContain('first')
    expect(readFileSync(markerPath, 'utf8').trim()).toBe(firstFixture.sha256)
    await firstServer.close()

    const secondServer = await startReleaseServer(
      createStandardReleaseRoutes({
        version: 'v1.0.0',
        platform: 'linux-x64',
        artifactPath: secondFixture.archivePath,
        sha256: secondFixture.sha256,
        size: secondFixture.size,
      })
    )

    await ensureRuntimeRelease(paths, 'linux-x64', 'latest', {
      baseUrl: secondServer.baseUrl,
    })

    expect(readFileSync(runtimeServerEntry, 'utf8')).toContain('second')
    expect(readFileSync(runtimeServerEntry, 'utf8')).not.toContain('first')
    expect(readFileSync(markerPath, 'utf8').trim()).toBe(secondFixture.sha256)

    await secondServer.close()
    firstFixture.cleanup()
    secondFixture.cleanup()
  })
})
