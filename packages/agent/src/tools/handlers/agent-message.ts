import type Anthropic from '@anthropic-ai/sdk'
import {
  findAgentById,
  findAgentByHandle,
  createAgentMessage,
  createWorkItem,
} from '@nitejar/database'
import type { ToolHandler } from '../types'

export const sendAgentMessageDefinition: Anthropic.Tool = {
  name: 'send_agent_message',
  description:
    'Send a private message to another agent. Not visible to users. ' +
    'The message is delivered immediately and triggers the target agent to process it.',
  input_schema: {
    type: 'object' as const,
    properties: {
      to_handle: {
        type: 'string',
        description: 'Handle of the target agent (without @). Example: "scout"',
      },
      message: {
        type: 'string',
        description: 'The private message to send to the other agent.',
      },
    },
    required: ['to_handle', 'message'],
  },
}

export const sendAgentMessageTool: ToolHandler = async (input, context) => {
  const toHandle = (input as { to_handle: string; message: string }).to_handle
  const message = (input as { to_handle: string; message: string }).message

  if (!toHandle || !message) {
    return { success: false, error: 'Both to_handle and message are required.' }
  }

  // Look up target agent by handle
  const targetAgent = await findAgentByHandle(toHandle)
  if (!targetAgent) {
    return { success: false, error: `Agent with handle "${toHandle}" not found.` }
  }

  const fromAgentId = context.agentId
  if (!fromAgentId) {
    return { success: false, error: 'Agent context is missing.' }
  }

  if (targetAgent.id === fromAgentId) {
    return { success: false, error: 'Cannot send a message to yourself.' }
  }

  // Look up sender agent to get handle
  const senderAgent = await findAgentById(fromAgentId)
  const fromHandle = senderAgent?.handle ?? 'unknown'

  // Create the agent_messages record
  const dmSessionKey = `agent_dm:${fromAgentId}:${targetAgent.id}`
  const agentMsg = await createAgentMessage({
    from_agent_id: fromAgentId,
    to_agent_id: targetAgent.id,
    session_key: dmSessionKey,
    content: message,
  })

  // Create a synthetic work item to trigger the target agent's runner
  await createWorkItem({
    plugin_instance_id: context.pluginInstanceId ?? null,
    session_key: dmSessionKey,
    source: 'agent_dm',
    source_ref: `agent_dm:${fromHandle}→@${toHandle}:${agentMsg.id}`,
    title: `Private message from @${fromHandle}`,
    payload: JSON.stringify({
      source_type: 'agent_dm',
      from_handle: fromHandle,
      from_agent_id: fromAgentId,
      actor: {
        kind: 'agent',
        agentId: fromAgentId,
        handle: fromHandle,
        displayName: senderAgent?.name,
        source: 'agent_dm',
      },
      body: message,
      agent_message_id: agentMsg.id,
    }),
  })

  return {
    success: true,
    output: `Message sent to @${toHandle}. They will receive and process it.`,
  }
}
