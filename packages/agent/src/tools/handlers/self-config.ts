import type Anthropic from '@anthropic-ai/sdk'
import { findAgentById, getDb, listAgentSandboxes, listMemories } from '@nitejar/database'
import { parseAgentConfig } from '../../config'
import type { ToolHandler } from '../types'

export const getSelfConfigDefinition: Anthropic.Tool = {
  name: 'get_self_config',
  description: 'View your own agent configuration, status, and statistics.',
  input_schema: {
    type: 'object' as const,
    properties: {},
  },
}

export const getSelfConfigTool: ToolHandler = async (_input, context) => {
  if (!context.agentId) {
    return { success: false, error: 'Missing agent identity.' }
  }

  const agent = await findAgentById(context.agentId)
  if (!agent) {
    return { success: false, error: 'Agent not found.' }
  }

  const memories = await listMemories(context.agentId, 0)
  const sandboxes = await listAgentSandboxes(context.agentId)

  const db = getDb()
  const pluginInstances = await db
    .selectFrom('agent_plugin_instances')
    .select(['plugin_instance_id'])
    .where('agent_id', '=', context.agentId)
    .execute()

  const parsed = parseAgentConfig(agent.config)
  const model = parsed.model ?? 'default'
  const temperature = parsed.temperature ?? 'default'
  const maxTokens = parsed.maxTokens ?? 'default'
  const ephemeralCreationEnabled = parsed.allowEphemeralSandboxCreation === true
  const routineManagementEnabled = parsed.allowRoutineManagement === true
  const dangerousModeEnabled = parsed.dangerouslyUnrestricted === true

  const lines = [
    `Handle: @${agent.handle}`,
    `Name: ${agent.name}`,
    `Status: ${agent.status}`,
    `Model: ${model}`,
    `Temperature: ${temperature}`,
    `Max Tokens: ${maxTokens}`,
    `Memories: ${memories.length}`,
    `Connected Plugins: ${pluginInstances.length}`,
    `Sandboxes: ${sandboxes.length}`,
    'Start Sandbox: home',
    `Ephemeral Sandbox Creation: ${ephemeralCreationEnabled ? 'enabled' : 'disabled'}`,
    `Routine Management: ${routineManagementEnabled ? 'enabled' : 'disabled'}`,
    `Dangerously Unrestricted: ${dangerousModeEnabled ? 'enabled' : 'disabled'}`,
    `Sprite: ${agent.sprite_id ?? 'none'}`,
    `Created: ${new Date(agent.created_at * 1000).toISOString()}`,
  ]

  return { success: true, output: lines.join('\n') }
}
