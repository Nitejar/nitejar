import type Anthropic from '@anthropic-ai/sdk'
import { decryptConfig, findPluginInstanceById } from '@nitejar/database'
import {
  discordHandler,
  getChannelMessages,
  sendChannelMessage,
  splitDiscordMessage,
  type DiscordConfig,
} from '@nitejar/plugin-handlers'
import type { ToolHandler } from '../tools/types'
import { registerIntegrationProvider, type PromptSection } from './registry'

const DISCORD_PLATFORM_PROMPT = `Platform: Discord
You are responding in a Discord context.
Your final text response is posted automatically by the Discord plugin handler, so do not call send_discord_message for your main reply.

Discord formatting rules:
- Use Discord markdown only (bold, italic, inline code, fenced code, links)
- Mention users/channels/roles with Discord syntax: <@user_id>, <#channel_id>, <@&role_id>
- Keep each message under 2000 characters; split long content into multiple messages
- If you need embeds, remember key limits: title <= 256 chars, description <= 4096 chars
- Prefer short paragraphs and clear headings for chat readability`

const sendDiscordMessageDefinition: Anthropic.Tool = {
  name: 'send_discord_message',
  description:
    'Send a Discord message to a channel. When channel_id is omitted, the current conversation channel is used.',
  input_schema: {
    type: 'object' as const,
    properties: {
      channel_id: {
        type: 'string',
        description: 'Target channel ID. Omit to use the current Discord channel.',
      },
      content: {
        type: 'string',
        description: 'Message content to send.',
      },
      reply_to: {
        type: 'string',
        description: 'Optional message ID to reply to.',
      },
    },
    required: ['content'],
  },
}

const readDiscordChannelDefinition: Anthropic.Tool = {
  name: 'read_discord_channel',
  description:
    'Read recent messages from a Discord channel. When channel_id is omitted, the current conversation channel is used.',
  input_schema: {
    type: 'object' as const,
    properties: {
      channel_id: {
        type: 'string',
        description: 'Target channel ID. Omit to use the current Discord channel.',
      },
      limit: {
        type: 'integer',
        description: 'Maximum messages to read (default 20, max 100).',
      },
    },
  },
}

interface DiscordToolResponseContext {
  channelId?: string
}

function parseResponseContext(raw: unknown): DiscordToolResponseContext | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  return {
    channelId: typeof obj.channelId === 'string' ? obj.channelId : undefined,
  }
}

async function resolveDiscordConfig(
  pluginInstanceId: string
): Promise<{ config: DiscordConfig; error?: undefined } | { config?: undefined; error: string }> {
  const pluginInstance = await findPluginInstanceById(pluginInstanceId)
  if (!pluginInstance || pluginInstance.type !== 'discord') {
    return { error: 'Discord plugin instance not found.' }
  }

  if (!pluginInstance.config) {
    return { error: 'Discord plugin instance has no config.' }
  }

  let parsed: DiscordConfig
  try {
    parsed =
      typeof pluginInstance.config === 'string'
        ? (JSON.parse(pluginInstance.config) as DiscordConfig)
        : (pluginInstance.config as DiscordConfig)
  } catch {
    return { error: 'Failed to parse Discord config.' }
  }

  const decrypted = decryptConfig(
    parsed as unknown as Record<string, unknown>,
    Array.from(discordHandler.sensitiveFields)
  ) as unknown as DiscordConfig

  if (!decrypted.botToken) {
    return { error: 'Discord bot token not configured.' }
  }

  return { config: decrypted }
}

const sendDiscordMessageHandler: ToolHandler = async (input, context) => {
  const content = typeof input.content === 'string' ? input.content.trim() : ''
  if (!content) {
    return { success: false, error: 'content is required.' }
  }

  if (!context.pluginInstanceId) {
    return { success: false, error: 'No plugin instance context available.' }
  }

  const resolved = await resolveDiscordConfig(context.pluginInstanceId)
  if (!resolved.config) {
    return { success: false, error: resolved.error ?? 'Failed to resolve Discord config.' }
  }

  const responseCtx = parseResponseContext(context.responseContext)
  const channelId =
    typeof input.channel_id === 'string' && input.channel_id.trim().length > 0
      ? input.channel_id.trim()
      : (responseCtx?.channelId ?? undefined)

  if (!channelId) {
    return {
      success: false,
      error:
        'No channel_id provided and could not determine from conversation context. Specify channel_id explicitly.',
    }
  }

  const replyTo =
    typeof input.reply_to === 'string' && input.reply_to.trim().length > 0
      ? input.reply_to.trim()
      : undefined

  const chunks = splitDiscordMessage(content)
  if (chunks.length === 0) {
    return { success: false, error: 'content is required.' }
  }

  for (const [index, chunk] of chunks.entries()) {
    await sendChannelMessage(
      resolved.config.botToken,
      channelId,
      chunk,
      index === 0 ? replyTo : undefined
    )
  }

  return {
    success: true,
    output: `Sent ${chunks.length} Discord message${chunks.length === 1 ? '' : 's'} to channel ${channelId}.`,
  }
}

const readDiscordChannelHandler: ToolHandler = async (input, context) => {
  if (!context.pluginInstanceId) {
    return { success: false, error: 'No plugin instance context available.' }
  }

  const resolved = await resolveDiscordConfig(context.pluginInstanceId)
  if (!resolved.config) {
    return { success: false, error: resolved.error ?? 'Failed to resolve Discord config.' }
  }

  const responseCtx = parseResponseContext(context.responseContext)
  const channelId =
    typeof input.channel_id === 'string' && input.channel_id.trim().length > 0
      ? input.channel_id.trim()
      : (responseCtx?.channelId ?? undefined)

  if (!channelId) {
    return {
      success: false,
      error:
        'No channel_id provided and could not determine from conversation context. Specify channel_id explicitly.',
    }
  }

  const limit =
    typeof input.limit === 'number' && Number.isInteger(input.limit)
      ? Math.max(1, Math.min(100, input.limit))
      : 20

  const messages = await getChannelMessages(resolved.config.botToken, channelId, limit)
  if (messages.length === 0) {
    return { success: true, output: 'No messages found in that Discord channel.' }
  }

  const lines = [...messages].reverse().map((message) => {
    const author =
      message.author?.global_name ?? message.author?.username ?? message.author?.id ?? 'unknown'
    const timestamp = message.timestamp ? `[${message.timestamp}] ` : ''
    const text = message.content.trim() || '[no text content]'
    return `${timestamp}${author}: ${text}`
  })

  return {
    success: true,
    output: lines.join('\n'),
  }
}

registerIntegrationProvider({
  integrationType: 'discord',

  toolDefinitions: [sendDiscordMessageDefinition, readDiscordChannelDefinition],
  toolHandlers: {
    send_discord_message: sendDiscordMessageHandler,
    read_discord_channel: readDiscordChannelHandler,
  },

  getSystemPromptSections(): Promise<PromptSection[]> {
    return Promise.resolve([
      {
        id: 'discord:platform',
        content: DISCORD_PLATFORM_PROMPT,
        priority: 5,
      },
    ])
  },
})
