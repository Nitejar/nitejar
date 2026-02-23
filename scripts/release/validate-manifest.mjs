#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

function parseArgs(argv = process.argv) {
  const args = {
    manifest: '',
    schema: path.resolve(process.cwd(), 'scripts/release/manifest.schema.json'),
    artifactsDir: '',
  }

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--manifest') {
      args.manifest = path.resolve(argv[i + 1] ?? '')
      i += 1
      continue
    }
    if (token === '--schema') {
      args.schema = path.resolve(argv[i + 1] ?? args.schema)
      i += 1
      continue
    }
    if (token === '--artifacts-dir') {
      args.artifactsDir = path.resolve(argv[i + 1] ?? '')
      i += 1
    }
  }

  if (!args.manifest) {
    throw new Error('Missing required --manifest path')
  }

  return args
}

function assertCondition(condition, message) {
  if (!condition) throw new Error(message)
}

function isIsoDateTime(value) {
  if (typeof value !== 'string' || value.length === 0) return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp)
}

function validateManifestShape(manifest) {
  assertCondition(typeof manifest === 'object' && manifest != null, 'Manifest must be an object')
  assertCondition(
    typeof manifest.version === 'string' && manifest.version.length > 0,
    'Manifest.version must be a non-empty string'
  )
  assertCondition(
    isIsoDateTime(manifest.releasedAt),
    'Manifest.releasedAt must be an ISO date-time string'
  )

  assertCondition(
    typeof manifest.artifacts === 'object' && manifest.artifacts != null,
    'Manifest.artifacts must be an object'
  )

  const entries = Object.entries(manifest.artifacts)
  assertCondition(entries.length > 0, 'Manifest.artifacts must contain at least one platform')

  for (const [platform, artifact] of entries) {
    assertCondition(
      typeof platform === 'string' && platform.length > 0,
      'Artifact platform key must be a non-empty string'
    )
    assertCondition(
      typeof artifact === 'object' && artifact != null,
      `Artifact ${platform} must be an object`
    )

    assertCondition(
      typeof artifact.url === 'string' && artifact.url.length > 0,
      `Artifact ${platform}.url must be a non-empty string`
    )
    assertCondition(
      typeof artifact.sha256 === 'string' && /^[a-f0-9]{64}$/.test(artifact.sha256),
      `Artifact ${platform}.sha256 must be a 64-char lowercase hex string`
    )
    assertCondition(
      Number.isInteger(artifact.size) && artifact.size > 0,
      `Artifact ${platform}.size must be a positive integer`
    )
  }
}

function verifyArtifactFiles(manifest, artifactsDir) {
  if (!artifactsDir) return

  for (const [platform, artifact] of Object.entries(manifest.artifacts)) {
    const fileName = path.basename(new URL(artifact.url, 'https://releases.nitejar.dev').pathname)
    const expectedPath = path.join(artifactsDir, fileName)
    assertCondition(
      existsSync(expectedPath),
      `Artifact for ${platform} points to ${fileName}, but file not found in ${artifactsDir}`
    )
  }
}

function main() {
  const args = parseArgs(process.argv)

  assertCondition(existsSync(args.schema), `Schema file not found: ${args.schema}`)
  assertCondition(existsSync(args.manifest), `Manifest file not found: ${args.manifest}`)

  const schema = JSON.parse(readFileSync(args.schema, 'utf8'))
  assertCondition(schema?.type === 'object', 'Manifest schema file is invalid')

  const manifest = JSON.parse(readFileSync(args.manifest, 'utf8'))
  validateManifestShape(manifest)
  verifyArtifactFiles(manifest, args.artifactsDir)

  console.log(`Manifest valid: ${args.manifest}`)
}

main()
