import { z } from 'zod'
import type { PluginInstanceRecord } from '@nitejar/database'
import type {
  ConfigValidationResult,
  PluginHandler,
  PostResponseResult,
  WebhookParseResult,
} from '../types'
import type { DiscordConfig, DiscordResponseContext } from './types'
import { parseDiscordWebhook } from './webhook'
import {
  type DiscordApplicationCommandDefinition,
  getCurrentBotUser,
  registerGuildCommands,
  sendChannelMessage,
  sendFollowUpMessage,
  splitDiscordMessage,
} from './client'

const discordConfigSchema = z.object({
  applicationId: z.string().min(1, 'Application ID is required'),
  publicKey: z.string().min(1, 'Public key is required'),
  botToken: z.string().min(1, 'Bot token is required'),
  guildId: z.string().min(1, 'Guild ID is required'),
})

function parseConfig(pluginInstance: PluginInstanceRecord): DiscordConfig | null {
  if (!pluginInstance.config) return null

  if (typeof pluginInstance.config === 'string') {
    try {
      return JSON.parse(pluginInstance.config) as DiscordConfig
    } catch {
      return null
    }
  }

  return pluginInstance.config as DiscordConfig
}

const DEFAULT_GUILD_COMMANDS: DiscordApplicationCommandDefinition[] = [
  {
    name: 'ask',
    description: 'Ask your agent a question',
    options: [
      {
        type: 3,
        name: 'prompt',
        description: 'What do you want help with?',
        required: true,
      },
    ],
  },
]

export const discordHandler: PluginHandler<DiscordConfig> = {
  type: 'discord',
  displayName: 'Discord',
  description: 'Connect a Discord bot to handle slash commands and respond in your server.',
  icon: 'brand-discord',
  category: 'messaging',
  responseMode: 'final',
  sensitiveFields: ['botToken'],
  setupConfig: {
    fields: [
      {
        key: 'applicationId',
        label: 'Application ID',
        type: 'text',
        required: true,
        placeholder: '123456789012345678',
        helpText: "Found in your app's General Information page on the Discord Developer Portal.",
      },
      {
        key: 'publicKey',
        label: 'Interaction Public Key',
        type: 'text',
        required: true,
        placeholder: 'hex-encoded-ed25519-public-key',
        helpText:
          "The PUBLIC KEY field on your app's General Information page. Used to verify webhook signatures.",
      },
      {
        key: 'botToken',
        label: 'Bot Token',
        type: 'password',
        required: true,
        placeholder: 'Bot token from Discord developer portal',
        helpText: 'Go to your app\'s Bot page and click "Reset Token" to generate one.',
      },
      {
        key: 'guildId',
        label: 'Guild (Server) ID',
        type: 'text',
        required: true,
        placeholder: '987654321098765432',
        helpText:
          'Right-click your server in Discord and select "Copy Server ID". Requires Developer Mode enabled in Discord settings.',
      },
    ],
    credentialHelpUrl: 'https://discord.com/developers/applications',
    credentialHelpLabel: 'Open Discord Developer Portal',
    supportsTestBeforeSave: true,
  },

  validateConfig(config: unknown): ConfigValidationResult {
    const result = discordConfigSchema.safeParse(config)
    if (result.success) {
      return { valid: true }
    }

    return {
      valid: false,
      errors: result.error.errors.map((error) => `${error.path.join('.')}: ${error.message}`),
    }
  },

  async parseWebhook(
    request: Request,
    pluginInstance: PluginInstanceRecord
  ): Promise<WebhookParseResult> {
    return parseDiscordWebhook(request, pluginInstance)
  },

  async postResponse(
    pluginInstance: PluginInstanceRecord,
    _workItemId: string,
    content: string,
    responseContext?: unknown,
    _options?: { hitLimit?: boolean; idempotencyKey?: string }
  ): Promise<PostResponseResult> {
    const config = parseConfig(pluginInstance)
    if (!config) {
      return { success: false, error: 'Failed to parse Discord configuration' }
    }

    const context = responseContext as DiscordResponseContext | undefined
    const applicationId = context?.applicationId || config.applicationId
    const interactionToken = context?.interactionToken
    const channelId = context?.channelId
    const messageId = context?.messageId
    const canUseInteractionResponse = Boolean(interactionToken && applicationId)

    if (!canUseInteractionResponse && !channelId) {
      if (interactionToken && !applicationId) {
        return {
          success: false,
          error: 'Missing Discord application ID in response context/config.',
        }
      }
      return { success: false, error: 'Missing Discord response channel or interaction context' }
    }

    const chunks = splitDiscordMessage(content)
    if (chunks.length === 0) {
      return { success: true, outcome: 'sent' }
    }

    try {
      if (canUseInteractionResponse) {
        const appId = applicationId
        const token = interactionToken
        if (!appId || !token) {
          return {
            success: false,
            error: 'Missing Discord interaction response context.',
          }
        }
        for (const chunk of chunks) {
          await sendFollowUpMessage(appId, token, chunk)
        }
      } else {
        if (!channelId) {
          return { success: false, error: 'Missing Discord channel ID in response context' }
        }
        for (const [index, chunk] of chunks.entries()) {
          await sendChannelMessage(
            config.botToken,
            channelId,
            chunk,
            index === 0 ? messageId : undefined
          )
        }
      }

      return { success: true, outcome: 'sent' }
    } catch (error) {
      return {
        success: false,
        outcome: 'failed',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  },

  async testConnection(
    config: DiscordConfig
  ): Promise<{ ok: boolean; error?: string; message?: string }> {
    // Step 1: Validate the bot token
    let botUsername: string
    try {
      const botUser = await getCurrentBotUser(config.botToken)
      botUsername = botUser.username
      console.log(`[discord] Connected as ${botUser.username} (${botUser.id})`)
    } catch (error) {
      return {
        ok: false,
        error: `Invalid bot token: ${error instanceof Error ? error.message : String(error)}`,
      }
    }

    // Step 2: Register slash commands (requires bot in the server with correct scopes)
    const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${config.applicationId}&scope=bot+applications.commands&permissions=0`
    try {
      await registerGuildCommands(
        config.applicationId,
        config.botToken,
        config.guildId,
        DEFAULT_GUILD_COMMANDS
      )
      console.log('[discord] Registered slash commands: /ask')
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      if (msg.includes('50001') || msg.includes('Missing Access')) {
        return {
          ok: false,
          error: `Bot "${botUsername}" is not in this server or is missing the applications.commands scope. Invite it: ${inviteUrl}`,
        }
      }
      return {
        ok: false,
        error: `Token valid (bot: ${botUsername}), but command registration failed: ${msg}`,
      }
    }

    return {
      ok: true,
      message: `Connected as ${botUsername}. Registered /ask command in your server.`,
    }
  },
}

export type {
  DiscordConfig,
  DiscordResponseContext,
  DiscordInteraction,
  DiscordInteractionType,
} from './types'
export {
  sendFollowUpMessage,
  editOriginalResponse,
  registerGuildCommands,
  sendChannelMessage,
  getChannelMessages,
  splitDiscordMessage,
  getCurrentBotUser,
  type DiscordMessage,
  type DiscordApplicationCommandDefinition,
  type DiscordApplicationCommandOptionDefinition,
} from './client'
export { parseDiscordWebhook, verifyDiscordSignature } from './webhook'
