import type { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { ensureBetterSqlite3Compatibility, ensureDirs, resolvePaths } from '../../src/lib/index.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function makePaths() {
  const dir = mkdtempSync(path.join(tmpdir(), 'nitejar-cli-migration-'))
  tempDirs.push(dir)
  const paths = resolvePaths(dir)
  ensureDirs(paths)
  return paths
}

function createRuntimeDatabase(paths: ReturnType<typeof resolvePaths>, withBetterSqlite3 = true): void {
  const databaseDir = path.join(paths.currentRuntimeLink, 'packages', 'database')
  mkdirSync(databaseDir, { recursive: true })
  if (withBetterSqlite3) {
    mkdirSync(path.join(databaseDir, 'node_modules', 'better-sqlite3'), { recursive: true })
  }
}

describe('ensureBetterSqlite3Compatibility', () => {
  it('skips probing when runtime better-sqlite3 is not packaged', () => {
    const paths = makePaths()
    createRuntimeDatabase(paths, false)
    let calls = 0

    const spawn = (() => {
      calls += 1
      return { status: 0, stdout: '', stderr: '' }
    }) as unknown as typeof spawnSync

    ensureBetterSqlite3Compatibility(paths, {}, spawn)
    expect(calls).toBe(0)
  })

  it('rebuilds better-sqlite3 when probe reports ABI mismatch', () => {
    const paths = makePaths()
    createRuntimeDatabase(paths, true)

    const calls: string[] = []
    const commandArgs: string[][] = []
    const responses = [
      {
        status: 1,
        stdout: '',
        stderr:
          'The module was compiled against NODE_MODULE_VERSION 137. This version of Node.js requires NODE_MODULE_VERSION 127.',
      },
      { status: 0, stdout: '', stderr: '' },
      { status: 0, stdout: '', stderr: '' },
    ]

    const spawn = ((command: string, args: string[] = []) => {
      calls.push(command)
      commandArgs.push(args)
      const next = responses.shift()
      if (!next) return { status: 0, stdout: '', stderr: '' }
      return next
    }) as unknown as typeof spawnSync

    ensureBetterSqlite3Compatibility(paths, {}, spawn)

    expect(calls).toHaveLength(3)
    expect(calls[0]).toContain('node')
    expect(calls[1]).toBe('npm')
    expect(calls[2]).toContain('node')
    expect(commandArgs[0]?.[1]).toContain("new Database(':memory:')")
  })

  it('throws when rebuild fails', () => {
    const paths = makePaths()
    createRuntimeDatabase(paths, true)

    const responses = [
      {
        status: 1,
        stdout: '',
        stderr:
          'The module was compiled against NODE_MODULE_VERSION 137. This version of Node.js requires NODE_MODULE_VERSION 127.',
      },
      { status: 1, stdout: '', stderr: '' },
    ]

    const spawn = (() => {
      const next = responses.shift()
      if (!next) return { status: 0, stdout: '', stderr: '' }
      return next
    }) as unknown as typeof spawnSync

    expect(() => ensureBetterSqlite3Compatibility(paths, {}, spawn)).toThrow(
      /Automatic rebuild of better-sqlite3 failed/
    )
  })

  it('throws original probe error when failure is not ABI mismatch', () => {
    const paths = makePaths()
    createRuntimeDatabase(paths, true)

    const spawn = (() => {
      return { status: 1, stdout: '', stderr: 'Error: dlopen failed for unknown reason' }
    }) as unknown as typeof spawnSync

    expect(() => ensureBetterSqlite3Compatibility(paths, {}, spawn)).toThrow(
      /Failed to load runtime dependency 'better-sqlite3'/
    )
  })
})
