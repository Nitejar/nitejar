import type Anthropic from '@anthropic-ai/sdk'
import {
  createSpriteService,
  deleteSpriteService,
  getSpriteUrl,
  listSpriteServices,
  setSpriteUrlPublic,
  startSpriteService,
  stopSpriteService,
} from '@nitejar/sprites'
import type { ToolHandler } from '../types'

export const serviceDefinitions: Anthropic.Tool[] = [
  {
    name: 'create_service',
    description:
      'Create a managed long-running service on the sprite. Services persist beyond command execution and are automatically restarted if they crash. Use this for web servers, APIs, dev servers, background workers, etc.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'A short name for the service (e.g. "web", "api", "worker").',
        },
        cmd: {
          type: 'string',
          description: 'The command to run (e.g. "node", "python", "nginx").',
        },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'Arguments for the command (e.g. ["server.js", "--port", "3000"]).',
        },
        http_port: {
          type: 'integer',
          description:
            'HTTP port the service listens on. Set this to enable HTTP routing through the sprite URL.',
        },
        make_public: {
          type: 'boolean',
          description:
            'If true, make the sprite URL publicly accessible (no authentication required).',
        },
      },
      required: ['name', 'cmd'],
    },
  },
  {
    name: 'list_services',
    description:
      'List all managed services on the sprite with their current status, PID, and configuration.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'manage_service',
    description: 'Start, stop, or delete an existing managed service on the sprite.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'The name of the service to manage.',
        },
        action: {
          type: 'string',
          enum: ['start', 'stop', 'delete'],
          description: 'The action to perform: start, stop, or delete the service.',
        },
      },
      required: ['name', 'action'],
    },
  },
  {
    name: 'get_sprite_url',
    description:
      'Get the public URL for the sprite. If the sprite has services with an http_port, this URL routes to them. Optionally make the URL publicly accessible.',
    input_schema: {
      type: 'object' as const,
      properties: {
        make_public: {
          type: 'boolean',
          description:
            'If true, make the sprite URL publicly accessible (no authentication required).',
        },
      },
    },
  },
]

export const createServiceTool: ToolHandler = async (input, context) => {
  const serviceName = typeof input.name === 'string' ? input.name.trim() : ''
  const cmd = typeof input.cmd === 'string' ? input.cmd.trim() : ''
  if (!serviceName) return { success: false, error: 'name is required.' }
  if (!cmd) return { success: false, error: 'cmd is required.' }

  const args = Array.isArray(input.args) ? (input.args as unknown[]).map(String) : undefined
  const httpPort = typeof input.http_port === 'number' ? input.http_port : undefined
  const makePublic = input.make_public === true

  let result: Awaited<ReturnType<typeof createSpriteService>>
  try {
    result = await createSpriteService(context.spriteName, serviceName, {
      cmd,
      ...(args ? { args } : {}),
      ...(httpPort ? { httpPort } : {}),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      error: `Failed to create service "${serviceName}": ${msg}`,
    }
  }

  if (result.error) {
    return {
      success: false,
      error:
        `Service "${serviceName}" failed to start: ${result.error}` +
        (result.logs.length > 0 ? `\n\nLogs:\n${result.logs.join('\n')}` : ''),
    }
  }

  let url: string | undefined
  if (makePublic && httpPort) {
    try {
      url = await setSpriteUrlPublic(context.spriteName)
    } catch (urlError) {
      const urlMsg = urlError instanceof Error ? urlError.message : String(urlError)
      return {
        success: true,
        output:
          `Service "${serviceName}" created and started.` +
          ` Warning: failed to make URL public: ${urlMsg}`,
      }
    }
  } else if (httpPort) {
    url = (await getSpriteUrl(context.spriteName)) ?? undefined
  }

  const parts = [`Service "${serviceName}" created and started.`]
  if (url) parts.push(`URL: ${url}`)
  if (result.logs.length > 0) parts.push(`Startup logs:\n${result.logs.join('\n')}`)
  return { success: true, output: parts.join('\n') }
}

export const listServicesTool: ToolHandler = async (_input, context) => {
  const services = await listSpriteServices(context.spriteName)

  if (services.length === 0) {
    return { success: true, output: 'No services configured.' }
  }

  const lines = services.map((svc) => {
    const status = svc.state?.status ?? 'unknown'
    const parts = [`- ${svc.name}: ${status}`]
    if (svc.state?.pid) parts.push(`pid=${svc.state.pid}`)
    if (svc.httpPort) parts.push(`http_port=${svc.httpPort}`)
    if (svc.state?.error) parts.push(`error="${svc.state.error}"`)
    if (svc.state?.restartCount) parts.push(`restarts=${svc.state.restartCount}`)
    return parts.join(' ')
  })

  return { success: true, output: lines.join('\n') }
}

export const manageServiceTool: ToolHandler = async (input, context) => {
  const serviceName = typeof input.name === 'string' ? input.name.trim() : ''
  const action = typeof input.action === 'string' ? input.action.trim() : ''
  if (!serviceName) return { success: false, error: 'name is required.' }
  if (!action) return { success: false, error: 'action is required.' }

  switch (action) {
    case 'start': {
      const result = await startSpriteService(context.spriteName, serviceName)
      if (result.error) {
        return {
          success: false,
          error:
            `Failed to start "${serviceName}": ${result.error}` +
            (result.logs.length > 0 ? `\n\nLogs:\n${result.logs.join('\n')}` : ''),
        }
      }
      return {
        success: true,
        output:
          `Service "${serviceName}" started.` +
          (result.logs.length > 0 ? `\n${result.logs.join('\n')}` : ''),
      }
    }
    case 'stop': {
      const result = await stopSpriteService(context.spriteName, serviceName)
      if (result.error) {
        return {
          success: false,
          error: `Failed to stop "${serviceName}": ${result.error}`,
        }
      }
      return { success: true, output: `Service "${serviceName}" stopped.` }
    }
    case 'delete': {
      await deleteSpriteService(context.spriteName, serviceName)
      return { success: true, output: `Service "${serviceName}" deleted.` }
    }
    default:
      return {
        success: false,
        error: `Invalid action "${action}". Use one of: start, stop, delete.`,
      }
  }
}

export const getSpriteUrlTool: ToolHandler = async (input, context) => {
  const makePublic = input.make_public === true

  if (makePublic) {
    const url = await setSpriteUrlPublic(context.spriteName)
    return { success: true, output: url }
  }

  const url = await getSpriteUrl(context.spriteName)
  if (!url) {
    return {
      success: true,
      output: 'No URL available. Create a service with http_port to enable URL routing.',
    }
  }
  return { success: true, output: url }
}
