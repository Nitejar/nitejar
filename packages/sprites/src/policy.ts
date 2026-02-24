import type { NetworkPolicy } from '@fly/sprites'
import { getSprite } from './client'

export type NetworkPolicyPresetId = 'unrestricted' | 'github-only' | 'development'

const PRESET_POLICIES: Record<NetworkPolicyPresetId, NetworkPolicy> = {
  unrestricted: {
    rules: [{ include: 'defaults' }, { domain: '*', action: 'allow' }],
  },
  'github-only': {
    rules: [
      { include: 'defaults' },
      { domain: 'github.com', action: 'allow' },
      { domain: '*.github.com', action: 'allow' },
      { domain: 'api.github.com', action: 'allow' },
      { domain: 'codeload.github.com', action: 'allow' },
      { domain: 'raw.githubusercontent.com', action: 'allow' },
      { domain: '*.githubusercontent.com', action: 'allow' },
      { domain: 'objects.githubusercontent.com', action: 'allow' },
      { domain: '*', action: 'deny' },
    ],
  },
  development: {
    rules: [
      { include: 'defaults' },
      { domain: 'github.com', action: 'allow' },
      { domain: '*.github.com', action: 'allow' },
      { domain: 'api.github.com', action: 'allow' },
      { domain: 'codeload.github.com', action: 'allow' },
      { domain: 'raw.githubusercontent.com', action: 'allow' },
      { domain: '*.githubusercontent.com', action: 'allow' },
      { domain: 'objects.githubusercontent.com', action: 'allow' },
      { domain: 'registry.npmjs.org', action: 'allow' },
      { domain: '*.npmjs.org', action: 'allow' },
      { domain: 'pypi.org', action: 'allow' },
      { domain: '*.pypi.org', action: 'allow' },
      { domain: 'files.pythonhosted.org', action: 'allow' },
      { domain: 'crates.io', action: 'allow' },
      { domain: '*.crates.io', action: 'allow' },
      { domain: 'archive.ubuntu.com', action: 'allow' },
      { domain: 'security.ubuntu.com', action: 'allow' },
      { domain: '*', action: 'deny' },
    ],
  },
}

function clonePolicy(policy: NetworkPolicy): NetworkPolicy {
  return {
    rules: policy.rules.map((rule) => ({ ...rule })),
  }
}

export function getNetworkPolicyPreset(preset: NetworkPolicyPresetId): NetworkPolicy {
  return clonePolicy(PRESET_POLICIES[preset])
}

export async function getSpriteNetworkPolicy(spriteName: string): Promise<NetworkPolicy> {
  const sprite = await getSprite(spriteName)
  return sprite.getNetworkPolicy()
}

export async function setSpriteNetworkPolicy(
  spriteName: string,
  policy: NetworkPolicy
): Promise<void> {
  const sprite = await getSprite(spriteName)
  await sprite.updateNetworkPolicy(policy)
}

export async function syncAgentNetworkPolicy(
  spriteName: string | null,
  policy: NetworkPolicy
): Promise<{ synced: boolean; error?: string }> {
  if (!spriteName) {
    return { synced: false, error: 'No sprite assigned to agent' }
  }

  try {
    console.log(`[NetworkPolicy] Syncing policy for sprite ${spriteName}`, {
      ruleCount: policy.rules.length,
    })
    await setSpriteNetworkPolicy(spriteName, policy)
    console.log(`[NetworkPolicy] Synced policy for sprite ${spriteName}`)
    return { synced: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[NetworkPolicy] Failed to sync policy for sprite ${spriteName}`, error)
    return { synced: false, error: message || 'Failed to sync policy' }
  }
}

export interface RefreshSpriteNetworkPolicyResult {
  policy: NetworkPolicy
  source: 'preset' | 'existing' | 'fallback'
  preset?: NetworkPolicyPresetId
}

export interface RefreshSpriteNetworkPolicyOptions {
  preset?: NetworkPolicyPresetId
  fallbackPreset?: NetworkPolicyPresetId
}

export async function refreshSpriteNetworkPolicy(
  spriteName: string,
  options?: RefreshSpriteNetworkPolicyOptions
): Promise<RefreshSpriteNetworkPolicyResult> {
  if (options?.preset) {
    const policy = getNetworkPolicyPreset(options.preset)
    await setSpriteNetworkPolicy(spriteName, policy)
    return { policy, source: 'preset', preset: options.preset }
  }

  try {
    const current = await getSpriteNetworkPolicy(spriteName)
    if (current.rules.length > 0) {
      await setSpriteNetworkPolicy(spriteName, current)
      return { policy: current, source: 'existing' }
    }
  } catch {
    // Fallback below.
  }

  const fallbackPreset = options?.fallbackPreset ?? 'development'
  const fallback = getNetworkPolicyPreset(fallbackPreset)
  await setSpriteNetworkPolicy(spriteName, fallback)
  return { policy: fallback, source: 'fallback', preset: fallbackPreset }
}
