import { describe, expect, it } from 'vitest'
import { buildGitHubManifestRegistrationUrl, buildManifest } from './github'

describe('github manifest helpers', () => {
  it('includes webhook hook_attributes for public base URLs', () => {
    const manifest = buildManifest({
      baseUrl: 'https://example.com',
      name: 'Nitejar QA',
      permissions: {
        metadata: 'read',
        issues: 'write',
      },
      pluginInstanceId: 'plugin-123',
    })

    expect(manifest.hook_attributes).toEqual({
      url: 'https://example.com/api/webhooks/plugins/github/plugin-123',
      active: true,
    })
    expect(manifest.default_events).toContain('issues')
    expect(manifest.redirect_url).toBe('https://example.com/plugins/github/callback')
  })

  it('omits hook_attributes for local base URLs', () => {
    const manifest = buildManifest({
      baseUrl: 'http://localhost:3000',
      name: 'Nitejar QA',
      permissions: {
        metadata: 'read',
        issues: 'write',
      },
      pluginInstanceId: 'plugin-123',
    }) as Record<string, unknown>

    expect(manifest.hook_attributes).toBeUndefined()
    expect(manifest.default_events).toContain('issues')
  })

  it('builds personal account registration url by default', () => {
    expect(buildGitHubManifestRegistrationUrl({ ownerType: 'personal' })).toBe(
      'https://github.com/settings/apps/new'
    )
  })

  it('builds organization registration url when org ownership is selected', () => {
    expect(
      buildGitHubManifestRegistrationUrl({
        ownerType: 'organization',
        ownerSlug: 'nitejar',
      })
    ).toBe('https://github.com/organizations/nitejar/settings/apps/new')
  })
})
