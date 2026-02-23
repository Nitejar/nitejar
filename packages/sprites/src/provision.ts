import { getOrCreateSprite, deleteSprite } from './client'
import { updateAgent, type Agent } from '@nitejar/database'
import type { NetworkPolicy } from '@fly/sprites'
import { syncAgentNetworkPolicy } from './policy'

/**
 * Options for sprite provisioning
 */
export interface ProvisionOptions {
  /** RAM in MB (default: 512) */
  ramMB?: number
  /** Number of CPUs (default: 1) */
  cpus?: number
  /** Region (default: ord) */
  region?: string
  /** Optional network policy to apply after provisioning */
  networkPolicy?: NetworkPolicy
}

/**
 * Get the sprite name for an agent
 */
export function getSpriteName(agent: Agent): string {
  return `nitejar-${agent.id}`
}

/**
 * Provision a sprite for an agent
 * Creates the sprite and updates the agent record with the sprite name
 */
export async function provisionSprite(agent: Agent, options?: ProvisionOptions): Promise<Agent> {
  if (agent.sprite_id) {
    console.log(`Agent ${agent.name} already has sprite ${agent.sprite_id}`)
    return agent
  }

  // Create sprite with agent-specific name
  const spriteName = getSpriteName(agent)
  const sprite = await getOrCreateSprite(spriteName, {
    ramMB: options?.ramMB ?? 512,
    cpus: options?.cpus ?? 1,
    region: options?.region ?? 'ord',
  })

  // Update agent with sprite name (used as identifier)
  const updated = await updateAgent(agent.id, { sprite_id: sprite.name })
  if (!updated) {
    throw new Error(`Failed to update agent ${agent.id} with sprite name`)
  }

  if (options?.networkPolicy) {
    const sync = await syncAgentNetworkPolicy(sprite.name, options.networkPolicy)
    if (!sync.synced) {
      console.warn(`Failed to sync network policy for sprite ${sprite.name}: ${sync.error}`)
    }
  }

  console.log(`Provisioned sprite ${sprite.name} for agent ${agent.name}`)
  return updated
}

/**
 * Deprovision a sprite for an agent
 * Deletes the sprite and clears the sprite ID from the agent record
 */
export async function deprovisionSprite(agent: Agent): Promise<Agent> {
  if (!agent.sprite_id) {
    console.log(`Agent ${agent.name} has no sprite to deprovision`)
    return agent
  }

  // Delete the sprite
  await deleteSprite(agent.sprite_id)

  // Clear sprite ID from agent
  const updated = await updateAgent(agent.id, { sprite_id: null })
  if (!updated) {
    throw new Error(`Failed to clear sprite ID from agent ${agent.id}`)
  }

  console.log(`Deprovisioned sprite for agent ${agent.name}`)
  return updated
}

/**
 * Ensure an agent has a provisioned sprite
 * Provisions one if needed, returns the agent with sprite ID
 */
export async function ensureSprite(agent: Agent, options?: ProvisionOptions): Promise<Agent> {
  if (agent.sprite_id) {
    return agent
  }
  return provisionSprite(agent, options)
}
