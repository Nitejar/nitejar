import { createHash } from 'node:crypto'
import {
  createAgentSandbox,
  deleteAgentSandbox,
  findAgentById,
  findAgentSandboxByName,
  findAgentSandboxBySpriteName,
  listAgentSandboxes,
  touchAgentSandboxLastUsed,
  updateAgentSandbox,
  type Agent,
  type AgentSandbox,
} from '@nitejar/database'
import {
  deleteSprite,
  getOrCreateSprite,
  getSpriteName,
  syncAgentNetworkPolicy,
} from '@nitejar/sprites'
import { parseAgentConfig } from './config'
import { toSpriteNetworkPolicy } from './network-policy'

const SANDBOX_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/
export const SANDBOX_STALE_SECONDS = 7 * 24 * 60 * 60

export type AgentSandboxKind = 'home' | 'ephemeral'

export interface AgentSandboxView extends AgentSandbox {
  stale: boolean
}

export interface CreateEphemeralSandboxInput {
  name: string
  description: string
  createdBy: 'admin' | 'agent'
  ramMB?: number
  cpus?: number
  region?: string
}

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function normalizeName(name: string): string {
  return name.trim()
}

function assertValidSandboxName(name: string): void {
  if (!SANDBOX_NAME_REGEX.test(name)) {
    throw new Error(
      'Sandbox name must be 1-63 chars and use only letters, numbers, hyphens, and underscores.'
    )
  }
}

function assertValidSandboxDescription(description: string): void {
  if (!description.trim()) {
    throw new Error('Sandbox description is required.')
  }
}

function buildEphemeralSpriteName(agentId: string, sandboxName: string): string {
  const agentToken =
    agentId
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 10) || 'agent'
  const sandboxToken =
    sandboxName
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 32) || 'sandbox'
  const suffix = createHash('sha1').update(`${agentId}:${sandboxName}`).digest('hex').slice(0, 10)

  // Sprites API enforces a 63-character max sprite name.
  return `nitejar-${agentToken}-${sandboxToken}-${suffix}`.slice(0, 63).replace(/-+$/, '')
}

function withStaleFlag(sandbox: AgentSandbox, staleAfterSeconds: number): AgentSandboxView {
  const stale = sandbox.kind === 'ephemeral' && now() - sandbox.last_used_at > staleAfterSeconds
  return { ...sandbox, stale }
}

async function getAgentOrThrow(agentId: string): Promise<Agent> {
  const agent = await findAgentById(agentId)
  if (!agent) {
    throw new Error('Agent not found')
  }
  return agent
}

export async function listAgentSandboxesWithStale(
  agentId: string,
  staleAfterSeconds = SANDBOX_STALE_SECONDS
): Promise<AgentSandboxView[]> {
  const rows = await listAgentSandboxes(agentId)
  const views = rows.map((row) => withStaleFlag(row, staleAfterSeconds))
  return views.sort((a, b) => {
    if (a.name === 'home') return -1
    if (b.name === 'home') return 1
    return a.name.localeCompare(b.name)
  })
}

export async function ensureHomeSandboxForAgent(agent: Agent): Promise<AgentSandbox> {
  const desiredSpriteName = agent.sprite_id ?? getSpriteName(agent)
  const existing = await findAgentSandboxByName(agent.id, 'home')
  if (existing) {
    if (
      existing.sprite_name !== desiredSpriteName ||
      existing.kind !== 'home' ||
      existing.description !== 'Persistent home sandbox'
    ) {
      const updated = await updateAgentSandbox(existing.id, {
        sprite_name: desiredSpriteName,
        kind: 'home',
        description: 'Persistent home sandbox',
      })
      if (updated) return updated
    }
    return existing
  }

  return createAgentSandbox({
    agent_id: agent.id,
    name: 'home',
    description: 'Persistent home sandbox',
    sprite_name: desiredSpriteName,
    kind: 'home',
    created_by: 'system',
  })
}

export async function createEphemeralSandboxForAgent(
  agentId: string,
  input: CreateEphemeralSandboxInput
): Promise<AgentSandbox> {
  const name = normalizeName(input.name)
  const description = input.description.trim()
  assertValidSandboxName(name)
  assertValidSandboxDescription(description)

  const agent = await getAgentOrThrow(agentId)
  const existing = await findAgentSandboxByName(agent.id, name)
  if (existing) {
    throw new Error(`Sandbox "${name}" already exists.`)
  }
  if (name === 'home') {
    throw new Error('Sandbox name "home" is reserved.')
  }

  const spriteName = buildEphemeralSpriteName(agent.id, name)

  await getOrCreateSprite(spriteName, {
    ramMB: input.ramMB ?? 512,
    cpus: input.cpus ?? 1,
    region: input.region ?? 'ord',
  })

  const config = parseAgentConfig(agent.config)
  const maybePolicy = config.networkPolicy ? toSpriteNetworkPolicy(config.networkPolicy) : null
  if (maybePolicy) {
    const sync = await syncAgentNetworkPolicy(spriteName, maybePolicy)
    if (!sync.synced) {
      throw new Error(`Sandbox created, but failed to sync network policy: ${sync.error}`)
    }
  }

  return createAgentSandbox({
    agent_id: agent.id,
    name,
    description,
    sprite_name: spriteName,
    kind: 'ephemeral',
    created_by: input.createdBy,
  })
}

export async function touchSandboxByName(agentId: string, name: string): Promise<void> {
  const sandbox = await findAgentSandboxByName(agentId, name)
  if (!sandbox) return
  await touchAgentSandboxLastUsed(sandbox.id)
}

export async function touchSandboxBySpriteName(agentId: string, spriteName: string): Promise<void> {
  const sandbox = await findAgentSandboxBySpriteName(agentId, spriteName)
  if (!sandbox) return
  await touchAgentSandboxLastUsed(sandbox.id)
}

export async function deleteAgentSandboxByName(
  agentId: string,
  sandboxName: string
): Promise<AgentSandbox> {
  const sandbox = await findAgentSandboxByName(agentId, sandboxName)
  if (!sandbox) {
    throw new Error(`Sandbox "${sandboxName}" not found.`)
  }
  if (sandbox.kind === 'home' || sandbox.name === 'home') {
    throw new Error('The home sandbox cannot be deleted.')
  }

  await deleteSprite(sandbox.sprite_name)
  await deleteAgentSandbox(sandbox.id)
  return sandbox
}

export async function resolveAgentSandboxByName(
  agentId: string,
  sandboxName: string
): Promise<AgentSandbox | null> {
  return findAgentSandboxByName(agentId, normalizeName(sandboxName))
}
