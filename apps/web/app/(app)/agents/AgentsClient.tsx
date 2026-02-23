import { parseAgentConfig } from '@nitejar/agent/config'
import { getPolicyStatus } from '@nitejar/agent/network-policy'
import { listAgents, getAgentIdsWithActiveJobs } from '@nitejar/database'
import { AgentsTable } from './AgentsTable'

export type AgentStatus = 'idle' | 'busy' | 'offline'

export interface AgentData {
  id: string
  handle: string // @mention ID
  name: string // Display name
  status: AgentStatus
  spriteId: string | null
  title: string | null // Role
  emoji: string | null
  avatarUrl: string | null
  policyStatus: {
    label: string
    type: 'unrestricted' | 'preset' | 'custom' | 'none'
  }
}

export async function AgentsClient() {
  const [agents, activeAgentIds] = await Promise.all([listAgents(), getAgentIdsWithActiveJobs()])

  const agentData: AgentData[] = agents.map((agent) => {
    const config = parseAgentConfig(agent.config)
    // Derive effective status: if agent has running/pending jobs, show as busy
    const dbStatus = agent.status as AgentStatus
    const effectiveStatus =
      dbStatus !== 'offline' && activeAgentIds.has(agent.id) ? 'busy' : dbStatus
    return {
      id: agent.id,
      handle: agent.handle,
      name: agent.name,
      status: effectiveStatus,
      spriteId: agent.sprite_id,
      title: config.title ?? null,
      emoji: config.emoji ?? null,
      avatarUrl: config.avatarUrl ?? null,
      policyStatus: getPolicyStatus(config.networkPolicy),
    }
  })

  return <AgentsTable agents={agentData} />
}
