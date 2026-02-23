import { describe, it, expect } from 'vitest'
import * as path from 'node:path'
import {
  validateNoPathTraversal,
  computeBufferChecksum,
  parseManifest,
  findManifestInDir,
  validatePluginEntry,
} from '../src/validation'

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'test-plugin')

describe('validateNoPathTraversal', () => {
  it('accepts paths within root', () => {
    expect(() => validateNoPathTraversal('/a/b/c', '/a/b')).not.toThrow()
  })

  it('rejects paths outside root', () => {
    expect(() => validateNoPathTraversal('/a/x/y', '/a/b')).toThrow('Path traversal detected')
  })

  it('rejects paths with ..', () => {
    expect(() => validateNoPathTraversal('/a/b/../x', '/a/b')).toThrow('Path traversal detected')
  })

  it('accepts the root itself', () => {
    expect(() => validateNoPathTraversal('/a/b', '/a/b')).not.toThrow()
  })
})

describe('computeBufferChecksum', () => {
  it('returns consistent sha256 hex string', () => {
    const buf = Buffer.from('hello world')
    const checksum = computeBufferChecksum(buf)
    expect(checksum).toMatch(/^[a-f0-9]{64}$/)
    // Same input always produces same output
    expect(computeBufferChecksum(buf)).toBe(checksum)
  })

  it('returns different checksums for different inputs', () => {
    const a = computeBufferChecksum(Buffer.from('a'))
    const b = computeBufferChecksum(Buffer.from('b'))
    expect(a).not.toBe(b)
  })
})

describe('parseManifest', () => {
  it('parses valid manifest JSON', () => {
    const manifest = parseManifest(
      JSON.stringify({
        schemaVersion: 1,
        id: 'test.plugin',
        name: 'Test',
        version: '1.0.0',
        entry: 'entry.js',
      })
    )
    expect(manifest).toEqual({
      schemaVersion: 1,
      id: 'test.plugin',
      name: 'Test',
      version: '1.0.0',
      entry: 'entry.js',
    })
  })

  it('returns null for invalid JSON', () => {
    expect(parseManifest('not json')).toBeNull()
  })

  it('returns null for null input', () => {
    expect(parseManifest(null)).toBeNull()
  })

  it('returns null if required fields missing', () => {
    expect(parseManifest(JSON.stringify({ id: 'x' }))).toBeNull()
    expect(parseManifest(JSON.stringify({ name: 'x', version: '1' }))).toBeNull()
  })
})

describe('findManifestInDir', () => {
  it('finds nitejar-plugin.json in test fixture', async () => {
    const manifest = await findManifestInDir(FIXTURE_DIR)
    expect(manifest).not.toBeNull()
    expect(manifest!.id).toBe('test.echo')
    expect(manifest!.entry).toBe('entry.js')
  })
})

describe('validatePluginEntry', () => {
  it('validates the test fixture entry', async () => {
    const manifest = await findManifestInDir(FIXTURE_DIR)
    expect(manifest).not.toBeNull()
    const entryPath = await validatePluginEntry(FIXTURE_DIR, manifest!)
    expect(entryPath).toContain('entry.js')
  })

  it('throws for missing entry file', async () => {
    await expect(
      validatePluginEntry(FIXTURE_DIR, {
        schemaVersion: 1,
        id: 'test',
        name: 'Test',
        version: '1.0.0',
        entry: 'nonexistent.js',
      })
    ).rejects.toThrow('Plugin entry file not found')
  })

  it('throws for invalid extension', async () => {
    await expect(
      validatePluginEntry(FIXTURE_DIR, {
        schemaVersion: 1,
        id: 'test',
        name: 'Test',
        version: '1.0.0',
        entry: 'nitejar-plugin.json',
      })
    ).rejects.toThrow('must be a .js, .mjs, or .cjs file')
  })

  it('throws for missing entry in manifest', async () => {
    await expect(
      validatePluginEntry(FIXTURE_DIR, {
        schemaVersion: 1,
        id: 'test',
        name: 'Test',
        version: '1.0.0',
      })
    ).rejects.toThrow('does not specify an entry point')
  })
})
