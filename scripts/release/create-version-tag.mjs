#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..')
const cliPackagePath = path.join(repoRoot, 'packages', 'nitejar-cli', 'package.json')

function runGit(args, options = {}) {
  const output = execFileSync('git', args, {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    ...options,
  })
  return typeof output === 'string' ? output.trim() : ''
}

function tagExistsLocally(tagName) {
  try {
    runGit(['rev-parse', '--verify', `refs/tags/${tagName}`])
    return true
  } catch {
    return false
  }
}

function tagExistsRemotely(tagName) {
  const output = runGit(['ls-remote', '--tags', 'origin', tagName])
  return output.length > 0
}

function readCliVersion() {
  const data = JSON.parse(readFileSync(cliPackagePath, 'utf8'))
  if (typeof data.version !== 'string' || data.version.trim().length === 0) {
    throw new Error(`Invalid CLI version in ${cliPackagePath}`)
  }
  return data.version
}

function main() {
  const cliVersion = readCliVersion()
  const tagName = `v${cliVersion}`
  const dryRun = process.env.NITEJAR_TAG_DRY_RUN === '1'

  if (tagExistsLocally(tagName) || tagExistsRemotely(tagName)) {
    console.log(`Tag ${tagName} already exists; skipping tag creation.`)
    return
  }

  if (dryRun) {
    console.log(`[dry-run] Would create and push tag ${tagName}.`)
    return
  }

  runGit(['tag', tagName], { stdio: 'inherit' })
  runGit(['push', 'origin', tagName], { stdio: 'inherit' })
  console.log(`Created and pushed ${tagName}.`)
}

main()
