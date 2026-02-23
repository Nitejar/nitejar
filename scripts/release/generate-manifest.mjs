#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..')

export function parseArgs(argv = process.argv, env = process.env, root = repoRoot) {
  const defaultBaseUrl = 'https://github.com/nitejar/nitejar/releases/download'
  const version = env.NITEJAR_VERSION ?? env.GITHUB_REF_NAME ?? 'dev'
  const envBaseUrl = env.NITEJAR_RELEASES_BASE_URL
  let baseUrlLocked = typeof envBaseUrl === 'string' && envBaseUrl.length > 0
  const args = {
    version,
    artifactsDir: path.resolve(root, 'dist', 'release'),
    baseUrl: envBaseUrl ?? defaultBaseUrl,
    output: path.resolve(root, 'dist', 'release', 'manifest.json'),
  }

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--version') {
      args.version = argv[i + 1] ?? args.version
      i += 1
      continue
    }
    if (token === '--artifacts-dir') {
      args.artifactsDir = path.resolve(root, argv[i + 1] ?? args.artifactsDir)
      i += 1
      continue
    }
    if (token === '--base-url') {
      args.baseUrl = argv[i + 1] ?? args.baseUrl
      baseUrlLocked = true
      i += 1
      continue
    }
    if (token === '--output') {
      args.output = path.resolve(root, argv[i + 1] ?? args.output)
      i += 1
    }
  }

  return args
}

export function sha256(filePath) {
  const hash = createHash('sha256')
  hash.update(readFileSync(filePath))
  return hash.digest('hex')
}

export function collectArtifacts(artifactsDir, baseUrl, version) {
  const files = readdirSync(artifactsDir)
  const records = []

  for (const fileName of files) {
    const match = fileName.match(/^nitejar-runtime-([a-z0-9-]+)\.tar\.gz$/i)
    if (!match) continue

    const platform = match[1]
    const filePath = path.join(artifactsDir, fileName)
    records.push({
      platform,
      url: `${baseUrl.replace(/\/$/, '')}/${version}/${fileName}`,
      sha256: sha256(filePath),
      size: statSync(filePath).size,
    })
  }

  records.sort((a, b) => a.platform.localeCompare(b.platform))

  return Object.fromEntries(
    records.map((record) => [
      record.platform,
      {
        url: record.url,
        sha256: record.sha256,
        size: record.size,
      },
    ])
  )
}

export function generateManifest(options) {
  return {
    version: options.version,
    releasedAt: options.releasedAt ?? new Date().toISOString(),
    artifacts: collectArtifacts(options.artifactsDir, options.baseUrl, options.version),
  }
}

export function writeManifest(manifest, outputPath) {
  writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

export function runGenerateManifest(argv = process.argv) {
  const { version, artifactsDir, baseUrl, output } = parseArgs(argv)
  const manifest = generateManifest({ version, artifactsDir, baseUrl })
  writeManifest(manifest, output)
  console.log(`Wrote manifest: ${output}`)
}

const isDirectRun =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href

if (isDirectRun) {
  runGenerateManifest(process.argv)
}
