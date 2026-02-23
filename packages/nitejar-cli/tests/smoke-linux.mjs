#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:http'
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

function fail(message) {
  console.error(message)
  process.exit(1)
}

function getPlatformKey() {
  if (process.platform === 'linux' && process.arch === 'x64') return 'linux-x64'
  if (process.platform === 'linux' && process.arch === 'arm64') return 'linux-arm64'
  if (process.platform === 'darwin' && process.arch === 'x64') return 'darwin-x64'
  if (process.platform === 'darwin' && process.arch === 'arm64') return 'darwin-arm64'
  fail(`Unsupported platform for smoke test: ${process.platform}/${process.arch}`)
}

function createFixtureArchive(repoRoot, platform, tempRoot) {
  const fixtureRoot = path.join(repoRoot, 'packages/nitejar-cli/tests/fixtures/runtime')
  const stage = path.join(tempRoot, 'runtime-stage')
  mkdirSync(stage, { recursive: true })
  cpSync(fixtureRoot, stage, { recursive: true, force: true })

  const archiveName = `nitejar-runtime-${platform}.tar.gz`
  const archivePath = path.join(tempRoot, archiveName)
  execFileSync('tar', ['-czf', archivePath, '-C', stage, '.'])

  const data = readFileSync(archivePath)
  return {
    archivePath,
    archiveName,
    sha256: createHash('sha256').update(data).digest('hex'),
    size: data.length,
  }
}

async function startReleaseServer(manifest, archiveName, archivePath) {
  const archiveData = readFileSync(archivePath)
  const server = createServer((req, res) => {
    if (req.url === '/manifest.json') {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(manifest))
      return
    }
    if (req.url === `/${manifest.version}/${archiveName}`) {
      res.setHeader('content-type', 'application/gzip')
      res.end(archiveData)
      return
    }
    res.statusCode = 404
    res.end('not found')
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') {
    fail('Unable to determine release server address')
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise((resolve) => server.close(resolve))
    },
  }
}

async function runCli(repoRoot, args, env) {
  const child = spawn('node', ['packages/nitejar-cli/dist/index.js', ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString('utf8')
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf8')
  })

  return await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => {
      resolve({ status: code ?? 1, stdout, stderr })
    })
  })
}

function ensureCliBuilt(repoRoot) {
  const distEntry = path.join(repoRoot, 'packages/nitejar-cli/dist/index.js')
  if (existsSync(distEntry)) return
  execFileSync('pnpm', ['--filter', '@nitejar/cli', 'build'], {
    cwd: repoRoot,
    stdio: 'inherit',
  })
}

async function main() {
  const repoRoot = process.cwd()
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'nitejar-cli-smoke-'))
  const platform = getPlatformKey()

  try {
    ensureCliBuilt(repoRoot)

    const artifact = createFixtureArchive(repoRoot, platform, tempRoot)
    const version = 'v0.0.0-smoke'

    const manifest = {
      version,
      releasedAt: new Date().toISOString(),
      artifacts: {
        [platform]: {
          url: `/${version}/${artifact.archiveName}`,
          sha256: artifact.sha256,
          size: artifact.size,
        },
      },
    }

    const releaseServer = await startReleaseServer(
      manifest,
      artifact.archiveName,
      artifact.archivePath
    )
    const dataDir = path.join(tempRoot, 'data')
    const port = '33123'

    try {
      const up = await runCli(repoRoot, ['up', '--data-dir', dataDir, '--port', port], {
        NITEJAR_RELEASES_BASE_URL: releaseServer.baseUrl,
      })
      if (up.status !== 0) {
        fail(`smoke up failed:\n${up.stdout}\n${up.stderr}`)
      }

      const status = await runCli(repoRoot, ['status', '--json', '--data-dir', dataDir], {
        NITEJAR_RELEASES_BASE_URL: releaseServer.baseUrl,
      })
      if (status.status !== 0) {
        fail(`smoke status failed:\n${status.stdout}\n${status.stderr}`)
      }

      const parsed = JSON.parse(status.stdout)
      if (!parsed.running) {
        fail(`smoke status expected running=true but got: ${status.stdout}`)
      }

      const receiptsDir = path.join(dataDir, 'receipts', 'migrations')
      const receipts = statSync(receiptsDir).isDirectory() ? readdirSync(receiptsDir) : []
      if (receipts.length === 0) {
        fail(`smoke expected migration receipt in ${receiptsDir}`)
      }

      const down = await runCli(repoRoot, ['down', '--data-dir', dataDir], {
        NITEJAR_RELEASES_BASE_URL: releaseServer.baseUrl,
      })
      if (down.status !== 0) {
        fail(`smoke down failed:\n${down.stdout}\n${down.stderr}`)
      }
    } finally {
      await releaseServer.close()
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)))
