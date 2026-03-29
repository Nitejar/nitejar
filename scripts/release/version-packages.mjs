#!/usr/bin/env node
// @ts-check

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * @typedef {{ name?: string | undefined; type?: string | undefined; oldVersion?: string | undefined; newVersion?: string | undefined }} ChangesetRelease
 * @typedef {{ releases?: ChangesetRelease[] | undefined }} ChangesetStatus
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const repoRoot = path.resolve(__dirname, '..', '..')
export const generatedChangesetPath = path.join(repoRoot, '.changeset', 'runtime-release-sync.md')
const statusOutputPath = path.join(repoRoot, 'tmp', 'changeset-status.json')

export const runtimeReleaseExclusions = new Set([
  '@nitejar/cli',
  '@nitejar/docs',
  '@nitejar/eslint-config',
  '@nitejar/integration-tests',
  '@nitejar/marketing',
  '@nitejar/plugin-sdk',
  '@nitejar/typescript-config',
  'create-nitejar-plugin',
])

/**
 * @param {string[]} args
 * @param {import('node:child_process').ExecFileSyncOptions} [options]
 */
function runPnpm(args, options = {}) {
  execFileSync('pnpm', args, {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    ...options,
  })
}

/**
 * @param {ChangesetStatus} status
 */
export function shouldSyncCliRelease(status) {
  const releases = Array.isArray(status?.releases) ? status.releases : []
  const hasRuntimeRelease = releases.some(
    (release) => release?.name && !runtimeReleaseExclusions.has(release.name)
  )
  const hasCliRelease = releases.some((release) => release?.name === '@nitejar/cli')
  return hasRuntimeRelease && !hasCliRelease
}

export function buildSyntheticCliChangeset() {
  return `---\n'@nitejar/cli': patch\n---\n\nKeep the CLI release version aligned with runtime bundle releases.\n`
}

/** @returns {ChangesetStatus} */
export function readChangesetStatus() {
  mkdirSync(path.dirname(statusOutputPath), { recursive: true })
  try {
    runPnpm(
      ['exec', 'changeset', 'status', `--output=${path.relative(repoRoot, statusOutputPath)}`],
      {
        stdio: 'inherit',
      }
    )
  } finally {
    // Keep the status file around for the current run; clean it once we're done.
  }

  return /** @type {ChangesetStatus} */ (JSON.parse(readFileSync(statusOutputPath, 'utf8')))
}

/**
 * @param {ChangesetStatus} status
 */
export function ensureSyntheticCliChangeset(status) {
  const needsSync = shouldSyncCliRelease(status)

  if (!needsSync) {
    if (existsSync(generatedChangesetPath)) {
      rmSync(generatedChangesetPath, { force: true })
    }
    return false
  }

  writeFileSync(generatedChangesetPath, buildSyntheticCliChangeset(), 'utf8')
  return true
}

export function cleanupVersionArtifacts() {
  rmSync(statusOutputPath, { force: true })
}

export function runVersionPackages() {
  const status = readChangesetStatus()
  const injected = ensureSyntheticCliChangeset(status)

  try {
    runPnpm(['exec', 'changeset', 'version'], { stdio: 'inherit' })
  } finally {
    cleanupVersionArtifacts()
    if (injected && existsSync(generatedChangesetPath)) {
      rmSync(generatedChangesetPath, { force: true })
    }
  }
}

const isDirectRun =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href

if (isDirectRun) {
  try {
    runVersionPackages()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
