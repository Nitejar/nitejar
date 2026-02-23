import type Anthropic from '@anthropic-ai/sdk'
import { refreshSpriteNetworkPolicy, type NetworkPolicyPresetId } from '@nitejar/sprites'
import type { ToolHandler } from '../types'

export const refreshNetworkPolicyDefinition: Anthropic.Tool = {
  name: 'refresh_network_policy',
  description:
    'Refresh the sprite network policy. Re-applies current policy if present; if empty, applies the development preset. Optionally pass preset (unrestricted, github-only, development).',
  input_schema: {
    type: 'object' as const,
    properties: {
      preset: {
        type: 'string',
        description: 'Optional preset override: unrestricted, github-only, or development.',
      },
    },
  },
}

function parsePolicyPreset(value: unknown): NetworkPolicyPresetId | null {
  if (value === 'unrestricted' || value === 'github-only' || value === 'development') {
    return value
  }
  return null
}

export const refreshNetworkPolicyTool: ToolHandler = async (input, context) => {
  const preset = parsePolicyPreset(input.preset)
  if (input.preset !== undefined && !preset) {
    return {
      success: false,
      error: 'Invalid preset. Use one of: unrestricted, github-only, development.',
    }
  }

  const refreshed = await refreshSpriteNetworkPolicy(context.spriteName, {
    ...(preset ? { preset } : {}),
    fallbackPreset: 'development',
  })

  return {
    success: true,
    output:
      `Network policy refreshed (source: ${refreshed.source}` +
      `${refreshed.preset ? `, preset: ${refreshed.preset}` : ''}` +
      `, rules: ${refreshed.policy.rules.length}).`,
  }
}
