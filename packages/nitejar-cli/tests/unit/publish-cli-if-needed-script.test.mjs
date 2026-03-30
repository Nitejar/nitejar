import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { publishCliIfNeeded } from '../../../../scripts/release/publish-cli-if-needed.mjs'

const tempDirs = []

afterEach(() => {
  vi.restoreAllMocks()
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function writePackageJson(root, version = '0.3.1') {
  const packageJsonPath = path.join(root, 'package.json')
  writeFileSync(
    packageJsonPath,
    JSON.stringify({
      name: '@nitejar/cli',
      version,
    }),
    'utf8'
  )
  return packageJsonPath
}

describe('publish-cli-if-needed script', () => {
  it('skips publish when the exact cli version already exists on npm', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'nitejar-cli-publish-skip-'))
    tempDirs.push(root)
    const packageJsonPath = writePackageJson(root)
    const publish = vi.fn()

    const result = publishCliIfNeeded({
      packageJsonPath,
      cwd: root,
      exists: () => true,
      publish,
    })

    expect(result).toEqual({
      skipped: true,
      metadata: { name: '@nitejar/cli', version: '0.3.1' },
    })
    expect(publish).not.toHaveBeenCalled()
  })

  it('publishes when the cli version is not on npm yet', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'nitejar-cli-publish-run-'))
    tempDirs.push(root)
    const packageJsonPath = writePackageJson(root, '0.3.2')
    const publish = vi.fn(() => ({ status: 0 }))

    const result = publishCliIfNeeded({
      packageJsonPath,
      cwd: root,
      exists: () => false,
      publish,
    })

    expect(result).toEqual({
      skipped: false,
      metadata: { name: '@nitejar/cli', version: '0.3.2' },
    })
    expect(publish).toHaveBeenCalledWith(root)
  })
})
