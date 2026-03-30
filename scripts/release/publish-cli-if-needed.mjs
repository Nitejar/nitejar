#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..')
const cliPackageDir = path.join(repoRoot, 'packages', 'nitejar-cli')
const cliPackageJsonPath = path.join(cliPackageDir, 'package.json')

export function getCliPackageMetadata(packageJsonPath = cliPackageJsonPath) {
  const raw = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
  return {
    name: String(raw.name),
    version: String(raw.version),
  }
}

export function packageVersionExists(packageName, version, cwd = cliPackageDir) {
  const result = spawnSync('npm', ['view', `${packageName}@${version}`, 'version'], {
    cwd,
    encoding: 'utf8',
  })

  return result.status === 0 && result.stdout.trim() === version
}

export function publishCliIfNeeded({
  packageJsonPath = cliPackageJsonPath,
  cwd = cliPackageDir,
  exists = packageVersionExists,
  publish = (runCwd) =>
    spawnSync('npm', ['publish', '--access', 'public', '--provenance'], {
      cwd: runCwd,
      stdio: 'inherit',
    }),
} = {}) {
  const metadata = getCliPackageMetadata(packageJsonPath)

  if (exists(metadata.name, metadata.version, cwd)) {
    console.log(`Skipping npm publish for ${metadata.name}@${metadata.version}; version already exists.`)
    return { skipped: true, metadata }
  }

  const result = publish(cwd)
  if (result.status !== 0) {
    throw new Error(`npm publish failed for ${metadata.name}@${metadata.version}`)
  }

  console.log(`Published ${metadata.name}@${metadata.version}`)
  return { skipped: false, metadata }
}

const isDirectRun =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href

if (isDirectRun) {
  const result = publishCliIfNeeded()
  if (result.skipped) {
    process.exit(0)
  }
}
