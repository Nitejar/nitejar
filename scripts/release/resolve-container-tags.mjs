#!/usr/bin/env node

// @ts-check

import process from 'node:process'

const semverPattern = /^v?(\d+)\.(\d+)\.(\d+)$/

/**
 * @typedef {Object} NormalizedReleaseVersion
 * @property {string} raw
 * @property {string} semver
 * @property {string} majorMinor
 */

/**
 * @typedef {Object} ResolveContainerReleaseTagsInput
 * @property {string} eventName
 * @property {string} ref
 * @property {string} versionInput
 */

/**
 * @typedef {Object} ResolveContainerReleaseTagsResult
 * @property {NormalizedReleaseVersion | null} normalized
 * @property {string[]} metadataTagLines
 * @property {string[]} expectedPublishedTags
 */

/**
 * @param {string | null | undefined} version
 * @returns {NormalizedReleaseVersion}
 */
export function normalizeReleaseVersion(version) {
  const value = String(version ?? '').trim()
  const match = semverPattern.exec(value)

  if (!match) {
    throw new Error(
      `Expected a release version like "v0.3.1" or "0.3.1", received "${value || '<empty>'}".`
    )
  }

  const [, major, minor, patch] = match
  return {
    raw: `v${major}.${minor}.${patch}`,
    semver: `${major}.${minor}.${patch}`,
    majorMinor: `${major}.${minor}`,
  }
}

function isTagReleaseRef(ref) {
  return typeof ref === 'string' && ref.startsWith('refs/tags/v')
}

function versionFromRef(ref) {
  if (!isTagReleaseRef(ref)) {
    return null
  }

  return ref.replace(/^refs\/tags\//, '')
}

/**
 * @param {ResolveContainerReleaseTagsInput} input
 * @returns {ResolveContainerReleaseTagsResult}
 */
export function resolveContainerReleaseTags({ eventName, ref, versionInput }) {
  const tagVersion = versionFromRef(ref)
  /** @type {NormalizedReleaseVersion | null} */
  const normalized =
    eventName === 'workflow_dispatch'
      ? normalizeReleaseVersion(versionInput)
      : tagVersion
        ? normalizeReleaseVersion(tagVersion)
        : null

  const metadataTagLines = []
  if (eventName === 'workflow_dispatch') {
    metadataTagLines.push(
      'type=raw,value=latest,enable=true',
      `type=raw,value=${normalized.raw},enable=true`,
      `type=raw,value=${normalized.semver},enable=true`,
      `type=raw,value=${normalized.majorMinor},enable=true`
    )
  } else if (normalized) {
    metadataTagLines.push('type=raw,value=latest,enable=true')
  }

  const expectedPublishedTags = normalized
    ? ['latest', normalized.raw, normalized.semver, normalized.majorMinor]
    : []

  return {
    normalized,
    metadataTagLines,
    expectedPublishedTags,
  }
}

/**
 * @param {ResolveContainerReleaseTagsResult} result
 * @returns {string}
 */
export function formatGitHubOutput(result) {
  const lines = [
    'tags<<__NITEJAR_TAGS__',
    ...result.metadataTagLines,
    '__NITEJAR_TAGS__',
    'expected_tags<<__NITEJAR_EXPECTED_TAGS__',
    ...result.expectedPublishedTags,
    '__NITEJAR_EXPECTED_TAGS__',
    `version=${result.normalized?.raw ?? ''}`,
    `semver=${result.normalized?.semver ?? ''}`,
    `major_minor=${result.normalized?.majorMinor ?? ''}`,
  ]

  return `${lines.join('\n')}\n`
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {void}
 */
function runCli(env = process.env) {
  const result = resolveContainerReleaseTags({
    eventName: env.RELEASE_EVENT_NAME ?? '',
    ref: env.RELEASE_REF ?? '',
    versionInput: env.RELEASE_VERSION_INPUT ?? '',
  })

  process.stdout.write(formatGitHubOutput(result))
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  runCli()
}
