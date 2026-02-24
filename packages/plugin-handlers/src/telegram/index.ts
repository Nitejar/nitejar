import { z } from 'zod'
import type { PluginInstanceRecord } from '@nitejar/database'
import type {
  PluginHandler,
  WebhookParseResult,
  PostResponseResult,
  ConfigValidationResult,
} from '../types'
import type { TelegramConfig, TelegramResponseContext } from './types'
import { parseTelegramWebhook } from './webhook'
import { sendMessage, sendChatAction, getMe, setMessageReaction, setMyCommands } from './client'
import { markdownToTelegramHtml } from './format'

const telegramConfigSchema = z.object({
  botToken: z.string().min(1, 'Bot token is required'),
  webhookSecret: z.string().optional(),
  allowedChatIds: z.array(z.number()).optional(),
  useMessageThreads: z.boolean().optional(),
})

/** Track which bots have had commands registered this session */
const registeredBots = new Set<string>()

/**
 * Ensure bot commands are registered (idempotent, runs once per bot per process)
 */
async function ensureCommandsRegistered(config: TelegramConfig): Promise<void> {
  if (registeredBots.has(config.botToken)) return

  try {
    await setMyCommands(config, [
      { command: 'clear', description: 'Clear conversation history and start fresh' },
    ])
    registeredBots.add(config.botToken)
    console.log('[telegram] Registered bot command: /clear')
  } catch (error) {
    // Don't fail the request if command registration fails
    console.warn('[telegram] Failed to register commands:', error)
  }
}

/**
 * Parse plugin instance config to TelegramConfig
 */
function parseConfig(pluginInstance: PluginInstanceRecord): TelegramConfig | null {
  if (typeof pluginInstance.config === 'string') {
    try {
      return JSON.parse(pluginInstance.config) as TelegramConfig
    } catch {
      return null
    }
  }
  return pluginInstance.config as TelegramConfig | null
}

/**
 * Telegram plugin handler
 */
export const telegramHandler: PluginHandler<TelegramConfig> = {
  type: 'telegram',
  displayName: 'Telegram',
  description: 'Receive messages from Telegram bots and respond in real-time.',
  icon: 'brand-telegram',
  category: 'messaging',
  sensitiveFields: ['botToken', 'webhookSecret'],
  setupConfig: {
    fields: [
      {
        key: 'botToken',
        label: 'Bot Token',
        type: 'password',
        required: true,
        placeholder: '123456789:ABCdefGHI...',
      },
    ],
    credentialHelpUrl: 'https://t.me/BotFather',
    credentialHelpLabel: 'Get a token from @BotFather',
    supportsTestBeforeSave: true,
  },

  validateConfig(config: unknown): ConfigValidationResult {
    const result = telegramConfigSchema.safeParse(config)
    if (result.success) {
      return { valid: true }
    }
    return {
      valid: false,
      errors: result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`),
    }
  },

  async parseWebhook(
    request: Request,
    pluginInstance: PluginInstanceRecord
  ): Promise<WebhookParseResult> {
    // Ensure commands are registered (idempotent, once per process)
    const config = parseConfig(pluginInstance)
    if (config) {
      ensureCommandsRegistered(config).catch(() => {}) // Fire and forget
    }

    return parseTelegramWebhook(request, pluginInstance)
  },

  async postResponse(
    pluginInstance: PluginInstanceRecord,
    workItemId: string,
    content: string,
    responseContext?: unknown,
    options?: { hitLimit?: boolean; idempotencyKey?: string }
  ): Promise<PostResponseResult> {
    const config = parseConfig(pluginInstance)
    if (!config?.botToken) {
      return { success: false, error: 'Bot token not configured' }
    }

    const context = responseContext as TelegramResponseContext | undefined
    if (!context?.chatId) {
      return { success: false, error: 'No chat ID in response context' }
    }

    try {
      // Send typing indicator first
      await sendChatAction(config, context.chatId, 'typing', {
        messageThreadId: context.messageThreadId,
      })

      // Convert markdown to Telegram HTML and send
      const html = markdownToTelegramHtml(content)
      try {
        await sendMessage(config, context.chatId, html, {
          parseMode: 'HTML',
          messageThreadId: context.messageThreadId,
        })
      } catch {
        // Fallback to plain text if HTML parsing fails
        await sendMessage(config, context.chatId, content, {
          messageThreadId: context.messageThreadId,
        })
      }

      // Update reaction based on result
      if (context.messageId) {
        if (options?.hitLimit) {
          // Show warning emoji when hit limit
          await setMessageReaction(config, context.chatId, context.messageId, '🤷')
        } else {
          // Remove the "looking" reaction now that we've responded
          await setMessageReaction(config, context.chatId, context.messageId, null)
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

  async testConnection(config: TelegramConfig): Promise<{ ok: boolean; error?: string }> {
    try {
      const botInfo = await getMe(config)
      console.log(`Connected to Telegram bot: @${botInfo.username}`)

      // Register bot commands
      await setMyCommands(config, [
        { command: 'clear', description: 'Clear conversation history and start fresh' },
      ])
      console.log('Registered bot command: /clear')

      return { ok: true }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  },

  async acknowledgeReceipt(
    pluginInstance: PluginInstanceRecord,
    responseContext?: unknown
  ): Promise<void> {
    const config = parseConfig(pluginInstance)
    if (!config?.botToken) return

    const context = responseContext as TelegramResponseContext | undefined
    if (!context?.chatId || !context?.messageId) return

    // React with eyes emoji to show we're looking at it
    await setMessageReaction(config, context.chatId, context.messageId, '👀')
  },

  async dismissReceipt(
    pluginInstance: PluginInstanceRecord,
    responseContext?: unknown
  ): Promise<void> {
    const config = parseConfig(pluginInstance)
    if (!config?.botToken) return

    const context = responseContext as TelegramResponseContext | undefined
    if (!context?.chatId || !context?.messageId) return

    // Clear the eyes reaction since no agent responded
    await setMessageReaction(config, context.chatId, context.messageId, null)
  },
}

// Re-export webhook utilities
export { sendTypingIndicator } from './webhook'

// Re-export types
export type { TelegramConfig, TelegramResponseContext } from './types'
export {
  sendMessage,
  sendApprovalPrompt,
  sendChatAction,
  getMe,
  createForumTopic,
  setWebhook,
  deleteWebhook,
  setMessageReaction,
  setMyCommands,
  getFile,
  downloadTelegramFileAsDataUrl,
  downloadTelegramFile,
  sendPhoto,
  sendDocument,
  inferMimeType,
} from './client'
export type { BotCommand, TelegramDownloadResult, ForumTopic } from './client'
