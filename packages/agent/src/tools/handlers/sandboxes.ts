import type Anthropic from '@anthropic-ai/sdk'
import { findAgentById } from '@nitejar/database'
import { parseAgentConfig } from '../../config'
import {
  createEphemeralSandboxForAgent,
  deleteAgentSandboxByName,
  listAgentSandboxesWithStale,
  resolveAgentSandboxByName,
} from '../../sandboxes'
import type { ToolHandler } from '../types'

export const sandboxDefinitions: Anthropic.Tool[] = [
  {
    name: 'list_sandboxes',
    description:
      'List all sandboxes available to you. Shows the name, kind (home or ephemeral), sprite name, description, and whether the sandbox is stale.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'switch_sandbox',
    description:
      'Switch the active sandbox. This resets your shell session and changes the sprite you are executing commands on. Use list_sandboxes first to see available sandboxes.',
    input_schema: {
      type: 'object' as const,
      properties: {
        sandbox_name: {
          type: 'string',
          description: 'The name of the sandbox to switch to.',
        },
      },
      required: ['sandbox_name'],
    },
  },
  {
    name: 'create_ephemeral_sandbox',
    description:
      'Create a temporary ephemeral sandbox with its own isolated sprite. Useful for risky operations, experiments, or parallel workstreams. The sandbox is automatically provisioned with your network policy.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description:
            'A short name for the sandbox (1-63 chars, letters/numbers/hyphens/underscores). Must not be "home".',
        },
        description: {
          type: 'string',
          description: 'A brief description of what this sandbox is for.',
        },
        switch_to: {
          type: 'boolean',
          description: 'Whether to switch to the new sandbox immediately (default: true).',
        },
      },
      required: ['name', 'description'],
    },
  },
  {
    name: 'delete_sandbox',
    description:
      'Delete an ephemeral sandbox and destroy its sprite. The home sandbox cannot be deleted. If the deleted sandbox is currently active, you will be switched back to the home sandbox.',
    input_schema: {
      type: 'object' as const,
      properties: {
        sandbox_name: {
          type: 'string',
          description: 'The name of the sandbox to delete.',
        },
      },
      required: ['sandbox_name'],
    },
  },
]

export const listSandboxesTool: ToolHandler = async (_input, context) => {
  if (!context.agentId) {
    return { success: false, error: 'Missing agent identity.' }
  }

  const sandboxes = await listAgentSandboxesWithStale(context.agentId)
  const lines = sandboxes.map((sandbox) => {
    const tags = [
      `kind=${sandbox.kind}`,
      sandbox.stale ? 'stale=true' : null,
      context.activeSandboxName === sandbox.name ? 'active=true' : null,
    ]
      .filter(Boolean)
      .join(', ')

    return `- ${sandbox.name} (${tags})\n  sprite=${sandbox.sprite_name}\n  description=${sandbox.description}`
  })

  if (lines.length === 0) {
    return { success: true, output: 'No sandboxes found.' }
  }

  return { success: true, output: lines.join('\n') }
}

export const switchSandboxTool: ToolHandler = async (input, context) => {
  if (!context.agentId) {
    return { success: false, error: 'Missing agent identity.' }
  }

  const sandboxName = typeof input.sandbox_name === 'string' ? input.sandbox_name.trim() : ''
  if (!sandboxName) {
    return { success: false, error: 'sandbox_name is required.' }
  }

  const sandbox = await resolveAgentSandboxByName(context.agentId, sandboxName)
  if (!sandbox) {
    return { success: false, error: `Sandbox "${sandboxName}" not found.` }
  }

  if (context.activeSandboxName === sandbox.name) {
    return {
      success: true,
      output: `Sandbox "${sandbox.name}" is already active.`,
      _meta: {
        sandboxSwitch: {
          sandboxName: sandbox.name,
          spriteName: sandbox.sprite_name,
        },
      },
    }
  }

  return {
    success: true,
    output: `Switched active sandbox to "${sandbox.name}" (${sandbox.description}).`,
    _meta: {
      sandboxSwitch: {
        sandboxName: sandbox.name,
        spriteName: sandbox.sprite_name,
      },
    },
  }
}

export const createEphemeralSandboxTool: ToolHandler = async (input, context) => {
  if (!context.agentId) {
    return { success: false, error: 'Missing agent identity.' }
  }

  const agent = await findAgentById(context.agentId)
  if (!agent) {
    return { success: false, error: 'Agent not found.' }
  }

  const config = parseAgentConfig(agent.config)
  if (config.allowEphemeralSandboxCreation !== true && config.dangerouslyUnrestricted !== true) {
    return {
      success: false,
      error: 'Ephemeral sandbox creation is disabled for this agent.',
    }
  }

  const name = typeof input.name === 'string' ? input.name : ''
  const description = typeof input.description === 'string' ? input.description : ''
  const switchTo = input.switch_to !== false

  try {
    const sandbox = await createEphemeralSandboxForAgent(context.agentId, {
      name,
      description,
      createdBy: 'agent',
    })

    return {
      success: true,
      output:
        `Created ephemeral sandbox "${sandbox.name}" (${sandbox.description}).` +
        (switchTo ? ` Active sandbox switched to "${sandbox.name}".` : ''),
      ...(switchTo
        ? {
            _meta: {
              sandboxSwitch: {
                sandboxName: sandbox.name,
                spriteName: sandbox.sprite_name,
              },
            },
          }
        : {}),
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create sandbox.',
    }
  }
}

export const deleteSandboxTool: ToolHandler = async (input, context) => {
  if (!context.agentId) {
    return { success: false, error: 'Missing agent identity.' }
  }

  const sandboxName = typeof input.sandbox_name === 'string' ? input.sandbox_name.trim() : ''
  if (!sandboxName) {
    return { success: false, error: 'sandbox_name is required.' }
  }

  try {
    const deleted = await deleteAgentSandboxByName(context.agentId, sandboxName)
    const shouldSwitchHome = context.activeSandboxName === deleted.name

    if (!shouldSwitchHome) {
      return {
        success: true,
        output: `Deleted sandbox "${deleted.name}".`,
      }
    }

    const home = await resolveAgentSandboxByName(context.agentId, 'home')
    if (!home) {
      return {
        success: true,
        output: `Deleted sandbox "${deleted.name}". Active sandbox reset is required.`,
      }
    }

    return {
      success: true,
      output: `Deleted sandbox "${deleted.name}". Switched active sandbox to "home".`,
      _meta: {
        sandboxSwitch: {
          sandboxName: home.name,
          spriteName: home.sprite_name,
        },
      },
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete sandbox.',
    }
  }
}
