#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process'
import { cpSync, createReadStream, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..')

function resolvePlatformKey() {
  if (process.platform === 'darwin' && process.arch === 'arm64') return 'darwin-arm64'
  if (process.platform === 'darwin' && process.arch === 'x64') return 'darwin-x64'
  if (process.platform === 'linux' && process.arch === 'x64') return 'linux-x64'
  if (process.platform === 'linux' && process.arch === 'arm64') return 'linux-arm64'
  throw new Error(
    `Unsupported platform/arch for local runtime bundle: ${process.platform}/${process.arch}`
  )
}

function run(cmd, args, cwd = repoRoot, extraEnv = {}) {
  execFileSync(cmd, args, {
    cwd,
    stdio: 'inherit',
    env: {
      ...process.env,
      ...extraEnv,
    },
  })
}

function createStaticServer(rootDir) {
  const server = createServer((req, res) => {
    const rawUrl = req.url ?? '/'
    const urlPath = rawUrl.split('?')[0] ?? '/'
    const normalized = path.normalize(urlPath).replace(/^(\.\.(\/|\\|$))+/, '')
    const relative = normalized === '/' ? 'manifest.json' : normalized.slice(1)
    const filePath = path.join(rootDir, relative)

    if (!existsSync(filePath)) {
      res.statusCode = 404
      res.end('not found')
      return
    }

    if (filePath.endsWith('.json')) {
      res.setHeader('content-type', 'application/json')
    } else if (filePath.endsWith('.tar.gz')) {
      res.setHeader('content-type', 'application/gzip')
    } else {
      res.setHeader('content-type', 'application/octet-stream')
    }

    createReadStream(filePath).pipe(res)
  })

  return server
}

async function listen(server, host = '127.0.0.1', port = 0) {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => resolve(undefined))
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Failed to determine local release server address')
  }
  return address.port
}

async function closeServer(server) {
  await new Promise((resolve) => {
    server.close(() => resolve(undefined))
  })
}

async function main() {
  const rawArgs = process.argv.slice(2)
  const normalizedArgs = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs
  const fullRuntime = normalizedArgs.includes('--full-runtime')
  const passthroughArgs = normalizedArgs.filter((arg) => arg !== '--full-runtime')
  const version = process.env.NITEJAR_LOCAL_VERSION ?? 'dev-local'
  const platform = resolvePlatformKey()
  const bundleName = `nitejar-runtime-${platform}.tar.gz`
  const distReleaseDir = path.join(repoRoot, 'dist', 'release')
  const bundleOutput = path.join(distReleaseDir, bundleName)
  const versionDir = path.join(distReleaseDir, version)
  const versionBundlePath = path.join(versionDir, bundleName)

  console.log(`Preparing local runtime bundle for ${platform} (${version})...`)
  run('pnpm', ['--filter', '@nitejar/cli', 'build'])

  if (fullRuntime) {
    console.log('Mode: full runtime (builds @nitejar/web and @nitejar/database)')
    run('node', [
      path.join('scripts', 'release', 'build-runtime-bundle.mjs'),
      '--platform',
      platform,
      '--version',
      version,
      '--output',
      path.join('dist', 'release', bundleName),
    ])
  } else {
    console.log('Mode: fixture runtime (installer smoke path)')
    const fixtureRoot = path.join(
      repoRoot,
      'packages',
      'nitejar-cli',
      'tests',
      'fixtures',
      'runtime'
    )
    if (!existsSync(fixtureRoot)) {
      throw new Error(`Fixture runtime not found: ${fixtureRoot}`)
    }
    mkdirSync(distReleaseDir, { recursive: true })
    run('tar', ['-czf', bundleOutput, '-C', fixtureRoot, '.'])
  }

  mkdirSync(versionDir, { recursive: true })
  cpSync(bundleOutput, versionBundlePath, { force: true })

  const server = createStaticServer(distReleaseDir)
  const port = await listen(server)
  const baseUrl = `http://127.0.0.1:${port}`

  try {
    run('node', [
      path.join('scripts', 'release', 'generate-manifest.mjs'),
      '--version',
      version,
      '--artifacts-dir',
      path.join('dist', 'release'),
      '--base-url',
      baseUrl,
      '--output',
      path.join('dist', 'release', 'manifest.json'),
    ])

    const manifestPath = path.join(distReleaseDir, 'manifest.json')
    const manifestText = readFileSync(manifestPath, 'utf8')
    if (!manifestText.includes(version)) {
      throw new Error(`Generated manifest does not contain expected version ${version}`)
    }

    console.log(`Using local release server: ${baseUrl}`)
    console.log(`Starting CLI with args: up ${passthroughArgs.join(' ')}`)

    const child = spawn(
      process.execPath,
      [path.join('packages', 'nitejar-cli', 'dist', 'index.js'), 'up', ...passthroughArgs],
      {
        cwd: repoRoot,
        stdio: 'inherit',
        env: {
          ...process.env,
          NITEJAR_RELEASES_BASE_URL: baseUrl,
        },
      }
    )

    const exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code) => resolve(code ?? 1))
    })

    process.exitCode = exitCode
  } finally {
    await closeServer(server)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
