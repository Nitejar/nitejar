import { describe, expect, it } from 'vitest'
import { buildSlackManifest, buildSlackManifestCreateUrl } from './slack'

describe('slack manifest helpers', () => {
  it('builds a manifest with expected events and webhook URL', () => {
    const manifest = buildSlackManifest({
      appName: 'Slopbot QA',
      requestUrl: 'https://example.com/api/webhooks/plugins/slack/pi_123',
    })

    expect(manifest.settings.event_subscriptions.request_url).toBe(
      'https://example.com/api/webhooks/plugins/slack/pi_123'
    )
    expect(manifest.settings.event_subscriptions.bot_events).toContain('app_mention')
    expect(manifest.oauth_config.scopes.bot).toContain('chat:write')
    expect(manifest.oauth_config.scopes.bot).toContain('groups:read')
    expect(manifest.oauth_config.scopes.bot).toContain('im:read')
    expect(manifest.oauth_config.scopes.bot).toContain('mpim:read')
    expect(manifest.oauth_config.scopes.bot).toContain('emoji:read')
    expect(manifest.oauth_config.scopes.bot).toContain('triggers:read')
  })

  it('builds an app-creation URL with encoded manifest JSON', () => {
    const manifest = buildSlackManifest({
      appName: 'Slopbot QA',
      requestUrl: 'https://example.com/api/webhooks/plugins/slack/pi_123',
    })
    const createUrl = buildSlackManifestCreateUrl(manifest as Record<string, unknown>)

    expect(createUrl.startsWith('https://api.slack.com/apps?new_app=1&manifest_json=')).toBe(true)
    expect(decodeURIComponent(createUrl.split('manifest_json=')[1] ?? '')).toContain(
      '"event_subscriptions"'
    )
  })
})
