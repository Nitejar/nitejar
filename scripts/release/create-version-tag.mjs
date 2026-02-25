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

async function dispatchReleaseWorkflow(tagName) {
  const repository = process.env.GITHUB_REPOSITORY
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN

  if (!repository || !token) {
    console.log(
      `Skipping release workflow dispatch for ${tagName}; missing GITHUB_REPOSITORY or GITHUB_TOKEN.`
    )
    return
  }

  const response = await fetch(
    `https://api.github.com/repos/${repository}/actions/workflows/release.yml/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        ref: 'main',
        inputs: {
          version: tagName,
        },
      }),
    }
  )

  if (!response.ok) {
    const body = await response.text()
    throw new Error(
      `Failed to dispatch release workflow for ${tagName}: ${response.status} ${response.statusText}\n${body}`
    )
  }

  console.log(`Dispatched release workflow for ${tagName}.`)
}

async function main() {
  const cliVersion = readCliVersion()
  const tagName = `v${cliVersion}`
  const dryRun = process.env.NITEJAR_TAG_DRY_RUN === '1'
  const forceDispatchExistingTag = process.env.NITEJAR_DISPATCH_IF_TAG_EXISTS === '1'

  const exists = tagExistsLocally(tagName) || tagExistsRemotely(tagName)

  if (exists) {
    console.log(`Tag ${tagName} already exists; skipping tag creation.`)
    if (!forceDispatchExistingTag) {
      console.log(
        `Skipping release workflow dispatch for ${tagName}; set NITEJAR_DISPATCH_IF_TAG_EXISTS=1 to force.`
      )
      return
    }
  } else if (dryRun) {
    console.log(`[dry-run] Would create and push tag ${tagName}.`)
    return
  } else {
    runGit(['tag', tagName], { stdio: 'inherit' })
    runGit(['push', 'origin', tagName], { stdio: 'inherit' })
    console.log(`Created and pushed ${tagName}.`)
  }

  if (dryRun) {
    console.log(`[dry-run] Would dispatch release workflow for ${tagName}.`)
    return
  }

  await dispatchReleaseWorkflow(tagName)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
