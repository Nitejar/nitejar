import { describe, expect, it } from 'vitest'
import {
  buildDeclaredCapabilities,
  capabilityKey,
  parsePluginManifest,
  hostEnforcedControls,
} from './manifest'

describe('parsePluginManifest', () => {
  it('parses a valid plugin manifest', () => {
    const raw = JSON.stringify({
      schemaVersion: 1,
      id: 'com.example.plugin',
      name: 'Example Plugin',
      version: '1.2.3',
      permissions: {
        network: ['api.example.com'],
        secrets: ['example.token'],
        filesystemRead: ['/tmp'],
        filesystemWrite: ['/var/tmp'],
        allowProcessSpawn: true,
      },
    })

    const parsed = parsePluginManifest(raw)
    expect(parsed).not.toBeNull()
    expect(parsed?.id).toBe('com.example.plugin')
    expect(parsed?.permissions?.network).toEqual(['api.example.com'])
    expect(parsed?.permissions?.allowProcessSpawn).toBe(true)
  })

  it('returns null for invalid manifests', () => {
    expect(parsePluginManifest('not-json')).toBeNull()
    expect(parsePluginManifest(JSON.stringify({ id: 'missing-name-and-version' }))).toBeNull()
  })
})

describe('buildDeclaredCapabilities', () => {
  it('normalizes manifest permissions to declared capability records', () => {
    const capabilities = buildDeclaredCapabilities({
      network: ['api.example.com'],
      secrets: ['example.token'],
      filesystemRead: ['/tmp'],
      filesystemWrite: ['/var/tmp'],
      allowProcessSpawn: true,
    })

    expect(capabilities).toEqual(
      expect.arrayContaining([
        { permission: 'network', scope: 'api.example.com' },
        { permission: 'secret', scope: 'example.token' },
        { permission: 'filesystem_read', scope: '/tmp' },
        { permission: 'filesystem_write', scope: '/var/tmp' },
        { permission: 'process_spawn', scope: null },
      ])
    )
  })
})

describe('manifest helpers', () => {
  it('builds stable capability keys', () => {
    expect(capabilityKey('network', 'api.example.com')).toBe('network::api.example.com')
    expect(capabilityKey('process_spawn', null)).toBe('process_spawn::')
  })

  it('lists host enforced controls', () => {
    expect(hostEnforcedControls().length).toBeGreaterThan(0)
  })
})
