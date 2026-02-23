import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  artifactAbsoluteUrl,
  ensurePortAvailable,
  downloadFile,
  ensureBaseEnv,
  ensureDirs,
  fetchManifest,
  getStatus,
  resolveAutoPort,
  parseEnvFile,
  parsePort,
  resolvePaths,
  resolvePlatformKey,
  serializeEnvFile,
  tailText,
} from '../../src/lib/index.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('env helpers', () => {
  it('parses and serializes env values round-trip', () => {
    const source = [
      '# ignored',
      '',
      'DATABASE_URL=/tmp/db.sqlite',
      'APP_BASE_URL=http://localhost:3000',
    ].join('\n')

    const parsed = parseEnvFile(source)
    const serialized = serializeEnvFile(parsed)

    expect(parsed).toEqual({
      DATABASE_URL: '/tmp/db.sqlite',
      APP_BASE_URL: 'http://localhost:3000',
    })
    expect(parseEnvFile(serialized)).toEqual(parsed)
  })

  it('ensures env file with secure permissions and generated key', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'nitejar-cli-env-'))
    tempDirs.push(dir)
    const paths = resolvePaths(dir)
    ensureDirs(paths)

    const env = ensureBaseEnv(paths, 3011)

    expect(env.ENCRYPTION_KEY).toMatch(/^[a-f0-9]{64}$/)
    expect(env.BETTER_AUTH_SECRET).toBeTruthy()
    expect(env.BETTER_AUTH_SECRET.length).toBeGreaterThan(0)
    expect(env.DATABASE_URL).toBe(path.join(paths.data, 'nitejar.db'))
    expect(env.APP_BASE_URL).toBe('http://localhost:3011')
    expect(existsSync(paths.envFile)).toBe(true)

    chmodSync(paths.envFile, 0o600)
    const text = readFileSync(paths.envFile, 'utf8')
    expect(text).toContain('ENCRYPTION_KEY=')
    expect(text).toContain('BETTER_AUTH_SECRET=')
  })

  it('does not overwrite APP_BASE_URL on subsequent boots', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'nitejar-cli-env-'))
    tempDirs.push(dir)
    const paths = resolvePaths(dir)
    ensureDirs(paths)

    const customUrl = 'https://my-tunnel.ngrok-free.app'
    writeFileSync(
      paths.envFile,
      `APP_BASE_URL=${customUrl}\nENCRYPTION_KEY=${'a'.repeat(64)}\n`,
      'utf8'
    )

    const env = ensureBaseEnv(paths, 3011)

    expect(env.APP_BASE_URL).toBe(customUrl)
  })

  it('applies wizard result to env file', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'nitejar-cli-env-'))
    tempDirs.push(dir)
    const paths = resolvePaths(dir)
    ensureDirs(paths)

    const wizardResult = {
      appBaseUrl: 'https://wizard.example.com',
      port: 4000,
      encryptionKey: 'b'.repeat(64),
      betterAuthSecret: 'wizard-secret-value',
      openRouterApiKey: 'sk-or-test',
    }

    const env = ensureBaseEnv(paths, 4000, wizardResult)

    expect(env.ENCRYPTION_KEY).toBe(wizardResult.encryptionKey)
    expect(env.BETTER_AUTH_SECRET).toBe(wizardResult.betterAuthSecret)
    expect(env.APP_BASE_URL).toBe(wizardResult.appBaseUrl)
    expect(env.OPENROUTER_API_KEY).toBe('sk-or-test')
  })
})

describe('platform and parsing helpers', () => {
  it('resolves supported platform tuples', () => {
    expect(resolvePlatformKey('darwin', 'arm64')).toBe('darwin-arm64')
    expect(resolvePlatformKey('darwin', 'x64')).toBe('darwin-x64')
    expect(resolvePlatformKey('linux', 'x64')).toBe('linux-x64')
    expect(resolvePlatformKey('linux', 'arm64')).toBe('linux-arm64')
  })

  it('throws for unsupported platform tuples', () => {
    expect(() => resolvePlatformKey('win32', 'x64')).toThrow(/Unsupported platform\/arch/)
  })

  it('validates port values', () => {
    expect(parsePort('3000')).toBe(3000)
    expect(() => parsePort('0')).toThrow(/Invalid port/)
    expect(() => parsePort('70000')).toThrow(/Invalid port/)
    expect(() => parsePort('abc')).toThrow(/Invalid port/)
  })

  it('finds a free port when auto selection starts on an occupied one', async () => {
    const blocker = createServer()
    await new Promise<void>((resolve, reject) => {
      blocker.once('error', reject)
      blocker.listen(0, '127.0.0.1', () => resolve())
    })
    const address = blocker.address()
    if (!address || typeof address === 'string') {
      throw new Error('failed to get blocker port')
    }
    const blockedPort = address.port

    try {
      const selected = await resolveAutoPort(blockedPort, 50)
      expect(selected).not.toBe(blockedPort)
      expect(selected).toBeGreaterThan(blockedPort)
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

  it('fails fast when requested port is already in use', async () => {
    const blocker = createServer()
    await new Promise<void>((resolve, reject) => {
      blocker.once('error', reject)
      blocker.listen(0, '127.0.0.1', () => resolve())
    })
    const address = blocker.address()
    if (!address || typeof address === 'string') {
      throw new Error('failed to get blocker port')
    }

    try {
      await expect(ensurePortAvailable(address.port)).rejects.toThrow(/Port .* is already in use/)
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

  it('tails text safely', () => {
    expect(tailText('a\nb\nc', 2)).toBe('b\nc')
    expect(tailText('a\nb\nc', 0)).toBe('c')
  })

  it('resolves relative and absolute artifact urls', () => {
    expect(artifactAbsoluteUrl('/v1/a.tar.gz', 'https://example.com/releases')).toBe(
      'https://example.com/v1/a.tar.gz'
    )
    expect(
      artifactAbsoluteUrl('https://cdn.example.com/a.tar.gz', 'https://example.com/releases')
    ).toBe('https://cdn.example.com/a.tar.gz')
  })
})

describe('manifest fetch behavior', () => {
  it('resolves pinned manifest URL from GitHub latest/download base', async () => {
    const calls: string[] = []
    const fetchImpl = ((input: string | URL) => {
      const url = String(input)
      calls.push(url)
      return Promise.resolve(
        new Response(
          JSON.stringify({
            version: 'v1.2.3',
            releasedAt: '2026-01-01T00:00:00.000Z',
            artifacts: {},
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }
        )
      )
    }) as typeof fetch

    const result = await fetchManifest('1.2.3', {
      baseUrl: 'https://github.com/nitejar/nitejar/releases/latest/download',
      fetchImpl,
    })

    expect(calls).toEqual(['https://github.com/nitejar/nitejar/releases/download/v1.2.3/manifest.json'])
    expect(result.manifestUrl).toBe('https://github.com/nitejar/nitejar/releases/download/v1.2.3/manifest.json')
    expect(result.manifest.version).toBe('v1.2.3')
  })

  it('falls back to latest manifest for pinned version when version path is missing', async () => {
    const calls: string[] = []
    const fetchImpl = ((input: string | URL) => {
      const url = String(input)
      calls.push(url)
      if (url.endsWith('/v1.2.3/manifest.json')) {
        return Promise.resolve(new Response('not found', { status: 404, statusText: 'Not Found' }))
      }

      return Promise.resolve(
        new Response(
          JSON.stringify({
            version: 'v1.2.3',
            releasedAt: '2026-01-01T00:00:00.000Z',
            artifacts: {},
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }
        )
      )
    }) as typeof fetch

    const result = await fetchManifest('v1.2.3', {
      baseUrl: 'https://releases.example.com',
      fetchImpl,
    })

    expect(calls).toEqual([
      'https://releases.example.com/v1.2.3/manifest.json',
      'https://releases.example.com/manifest.json',
    ])
    expect(result.manifestUrl).toBe('https://releases.example.com/manifest.json')
    expect(result.manifest.version).toBe('v1.2.3')
  })

  it('accepts semver pin when fallback manifest uses v-prefixed version', async () => {
    const fetchImpl = ((input: string | URL) => {
      const url = String(input)
      if (url.endsWith('/1.2.3/manifest.json')) {
        return Promise.resolve(new Response('not found', { status: 404, statusText: 'Not Found' }))
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            version: 'v1.2.3',
            releasedAt: '2026-01-01T00:00:00.000Z',
            artifacts: {},
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }
        )
      )
    }) as typeof fetch

    const result = await fetchManifest('1.2.3', {
      baseUrl: 'https://releases.example.com',
      fetchImpl,
    })

    expect(result.manifest.version).toBe('v1.2.3')
  })

  it('errors when fallback manifest version does not match requested pin', async () => {
    const fetchImpl = ((input: string | URL) => {
      const url = String(input)
      if (url.endsWith('/v2.0.0/manifest.json')) {
        return Promise.resolve(new Response('not found', { status: 404, statusText: 'Not Found' }))
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            version: 'v1.0.0',
            releasedAt: '2026-01-01T00:00:00.000Z',
            artifacts: {},
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }
        )
      )
    }) as typeof fetch

    await expect(
      fetchManifest('v2.0.0', {
        baseUrl: 'https://releases.example.com',
        fetchImpl,
      })
    ).rejects.toThrow(/Requested version v2.0.0 but release manifest version is v1.0.0/)
  })

  it('errors when latest manifest fetch fails', async () => {
    const fetchImpl = (() =>
      Promise.resolve(
        new Response('boom', { status: 503, statusText: 'Unavailable' })
      )) as typeof fetch

    await expect(
      fetchManifest('latest', {
        baseUrl: 'https://releases.example.com',
        fetchImpl,
      })
    ).rejects.toThrow(/Failed to fetch release manifest/)
  })

  it('errors when download returns non-2xx', async () => {
    const fetchImpl = (() =>
      Promise.resolve(new Response('boom', { status: 500, statusText: 'Bad' }))) as typeof fetch

    await expect(
      downloadFile('https://releases.example.com/runtime.tar.gz', '/tmp/nope.tar.gz', { fetchImpl })
    ).rejects.toThrow(/Download failed/)
  })
})

describe('status payload shape', () => {
  it('returns stable status object keys when runtime has not started', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'nitejar-cli-status-'))
    tempDirs.push(dir)
    const paths = resolvePaths(dir)
    ensureDirs(paths)

    writeFileSync(paths.pidFile, '999999\n', 'utf8')

    const status = getStatus(paths)

    expect(Object.keys(status).sort()).toEqual(
      [
        'dbPath',
        'envFile',
        'lastMigrationReceipt',
        'logFile',
        'pid',
        'port',
        'running',
        'runtimePath',
        'version',
      ].sort()
    )
    expect(status.running).toBe(false)
    expect(status.pid).toBe(999999)
    expect(status.dbPath).toBe(path.join(paths.data, 'nitejar.db'))
  })
})
