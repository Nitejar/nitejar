import type Anthropic from '@anthropic-ai/sdk'
import {
  decryptConfig,
  findPluginInstanceById,
  listMessagesBySession,
  listTelegramSessionsForAgent,
} from '@nitejar/database'
import {
  sendMessage,
  sendPhoto,
  sendDocument,
  sendChatAction,
  inferMimeType,
  telegramHandler,
  type TelegramConfig,
} from '@nitejar/plugin-handlers'
import { spriteExec } from '@nitejar/sprites'
import type { ToolHandler } from '../tools/types'
import { registerIntegrationProvider, type PromptSection } from './registry'

// ---------------------------------------------------------------------------
// Prompt constant
// ---------------------------------------------------------------------------

const TELEGRAM_PLATFORM_PROMPT = `Platform: Telegram
You are responding in a Telegram chat. Your final text response is delivered automatically as a message — do not call send_telegram_message for your main reply.
To send additional messages, files, or reach other threads, use your Telegram tools (send_telegram_message, send_file, list_telegram_threads, read_telegram_thread).

Response formatting rules:
- Use standard markdown formatting (bold, italic, code, links) - it will be converted automatically
- Do NOT use markdown tables - they render poorly on mobile. Use labeled lists instead
- Do NOT use images or horizontal rules - they are not supported
- Keep responses concise and readable on mobile
- Use line breaks for readability, not long paragraphs
- When replying, keep in mind users can only see your messages and not tool results. Provide status updates only as needed.`

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const sendTelegramMessageDefinition: Anthropic.Tool = {
  name: 'send_telegram_message',
  description:
    'Send a message to a Telegram chat. When chat_id and thread_id are omitted, the message is sent to the current conversation.',
  input_schema: {
    type: 'object' as const,
    properties: {
      message: {
        type: 'string',
        description: 'The message text to send.',
      },
      chat_id: {
        type: 'number',
        description: 'Telegram chat ID. Omit to send to the current conversation.',
      },
      thread_id: {
        type: 'number',
        description: 'Telegram forum topic / thread ID. Omit for the current thread.',
      },
    },
    required: ['message'],
  },
}

const listTelegramThreadsDefinition: Anthropic.Tool = {
  name: 'list_telegram_threads',
  description:
    'List Telegram threads (conversations) this agent has participated in. Returns session keys, chat IDs, thread IDs, and last activity times.',
  input_schema: {
    type: 'object' as const,
    properties: {
      limit: {
        type: 'integer',
        description: 'Maximum number of threads to return (default: 20).',
      },
    },
  },
}

const readTelegramThreadDefinition: Anthropic.Tool = {
  name: 'read_telegram_thread',
  description:
    'Read recent messages from a specific Telegram thread by session key. Use list_telegram_threads to discover available session keys.',
  input_schema: {
    type: 'object' as const,
    properties: {
      session_key: {
        type: 'string',
        description: 'The session key to read (e.g. "telegram:12345" or "telegram:12345:678").',
      },
      limit: {
        type: 'integer',
        description: 'Maximum number of messages to return (default: 30, max: 100).',
      },
    },
    required: ['session_key'],
  },
}

const sendFileDefinition: Anthropic.Tool = {
  name: 'send_file',
  description:
    'Send a file that already exists on your sprite filesystem to a Telegram chat. The file must be saved to disk first (e.g. via bash, write_file, or download_attachment) — then pass the path here. Do NOT pass file contents or base64 data. Images (PNG, JPG, GIF, WEBP) are sent as inline photos; other files are sent as documents. Use send_as to override auto-detection.',
  input_schema: {
    type: 'object' as const,
    properties: {
      file_path: {
        type: 'string',
        description:
          'Absolute path to the file on the sprite filesystem (e.g. "/tmp/screenshot.png"). The file must already exist — write it first if needed.',
      },
      caption: {
        type: 'string',
        description: 'Optional caption to accompany the file (max 1024 chars for photos).',
      },
      send_as: {
        type: 'string',
        enum: ['photo', 'document'],
        description:
          'Force send method. "photo" sends as an inline image, "document" sends as a file attachment. Auto-detects from file extension if omitted.',
      },
      chat_id: {
        type: 'number',
        description: 'Telegram chat ID. Omit to send to the current conversation.',
      },
      thread_id: {
        type: 'number',
        description: 'Telegram forum topic / thread ID. Omit for the current thread.',
      },
    },
    required: ['file_path'],
  },
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ResponseContext {
  chatId?: number
  messageThreadId?: number
}

function parseResponseContext(raw: unknown): ResponseContext | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  return {
    chatId: typeof obj.chatId === 'number' ? obj.chatId : undefined,
    messageThreadId: typeof obj.messageThreadId === 'number' ? obj.messageThreadId : undefined,
  }
}

async function resolveTelegramConfig(
  pluginInstanceId: string
): Promise<{ config: TelegramConfig; error?: undefined } | { config?: undefined; error: string }> {
  const pluginInstance = await findPluginInstanceById(pluginInstanceId)
  if (!pluginInstance || pluginInstance.type !== 'telegram') {
    return { error: 'Telegram plugin instance not found.' }
  }
  if (!pluginInstance.config) {
    return { error: 'Telegram plugin instance has no config.' }
  }

  let parsed: TelegramConfig
  try {
    parsed =
      typeof pluginInstance.config === 'string'
        ? (JSON.parse(pluginInstance.config) as TelegramConfig)
        : (pluginInstance.config as TelegramConfig)
  } catch {
    return { error: 'Failed to parse Telegram config.' }
  }

  const decrypted = decryptConfig(
    parsed as unknown as Record<string, unknown>,
    Array.from(telegramHandler.sensitiveFields)
  ) as unknown as TelegramConfig

  if (!decrypted.botToken) {
    return { error: 'Telegram bot token not configured.' }
  }

  return { config: decrypted }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

const sendTelegramMessageHandler: ToolHandler = async (input, context) => {
  const message = typeof input.message === 'string' ? input.message.trim() : ''
  if (!message) {
    return { success: false, error: 'message is required.' }
  }

  if (!context.pluginInstanceId) {
    return { success: false, error: 'No plugin instance context available.' }
  }

  const resolved = await resolveTelegramConfig(context.pluginInstanceId)
  if (!resolved.config) {
    return { success: false, error: resolved.error ?? 'Failed to resolve Telegram config.' }
  }

  // Determine chat_id and thread_id
  const responseCtx = parseResponseContext(context.responseContext)
  const chatId =
    typeof input.chat_id === 'number' ? input.chat_id : (responseCtx?.chatId ?? undefined)
  const threadId =
    typeof input.thread_id === 'number'
      ? input.thread_id
      : (responseCtx?.messageThreadId ?? undefined)

  if (!chatId) {
    return {
      success: false,
      error:
        'No chat_id provided and could not determine from conversation context. Specify chat_id explicitly.',
    }
  }

  await sendMessage(resolved.config, chatId, message, {
    messageThreadId: threadId,
  })

  return { success: true, output: 'Telegram message sent.' }
}

const listTelegramThreadsHandler: ToolHandler = async (input, context) => {
  if (!context.agentId) {
    return { success: false, error: 'Missing agent identity.' }
  }

  const limit =
    typeof input.limit === 'number' && Number.isInteger(input.limit)
      ? Math.max(1, Math.min(50, input.limit))
      : 20

  const sessions = await listTelegramSessionsForAgent(context.agentId, { limit })

  if (sessions.length === 0) {
    return { success: true, output: 'No Telegram threads found for this agent.' }
  }

  const lines = sessions.map((s) => {
    const header = s.chatName
      ? `${s.chatName}${s.threadId ? ` (thread ${s.threadId})` : ''}`
      : s.sessionKey
    const meta = [
      `session_key: ${s.sessionKey}`,
      s.chatId ? `chat_id: ${s.chatId}` : null,
      s.threadId ? `thread_id: ${s.threadId}` : null,
      `last_activity: ${new Date(s.lastMessageTime * 1000).toISOString()}`,
    ]
      .filter(Boolean)
      .join(' | ')
    const preview = s.lastMessagePreview
      ? `  Last: ${s.lastSender ? `[${s.lastSender}] ` : ''}${s.lastMessagePreview}`
      : ''
    return `${header}\n  ${meta}${preview ? '\n' + preview : ''}`
  })

  return { success: true, output: lines.join('\n\n') }
}

const readTelegramThreadHandler: ToolHandler = async (input, context) => {
  if (!context.agentId) {
    return { success: false, error: 'Missing agent identity.' }
  }

  const sessionKey = typeof input.session_key === 'string' ? input.session_key.trim() : ''
  if (!sessionKey) {
    return { success: false, error: 'session_key is required.' }
  }

  // Security: validate session key format
  if (!sessionKey.startsWith('telegram:')) {
    return { success: false, error: 'session_key must start with "telegram:".' }
  }

  const limit =
    typeof input.limit === 'number' && Number.isInteger(input.limit)
      ? Math.max(1, Math.min(100, input.limit))
      : 30

  const messages = await listMessagesBySession(sessionKey, {
    agentId: context.agentId,
    limit,
  })

  // Filter to user and assistant messages (skip system prompts and tool calls)
  const conversationMessages = messages.filter(
    (msg) => msg.role === 'user' || msg.role === 'assistant'
  )

  if (conversationMessages.length === 0) {
    return { success: true, output: 'No messages found for this session.' }
  }

  const lines = conversationMessages.map((msg) => {
    const time = new Date(msg.created_at * 1000).toISOString()
    let text = ''
    if (msg.content) {
      try {
        const parsed = JSON.parse(msg.content) as Record<string, unknown>
        // User messages store text in .text, assistant messages may also use .text
        text = typeof parsed.text === 'string' ? parsed.text : ''
        // If it has tool_calls but no text, summarize
        if (!text && Array.isArray(parsed.tool_calls)) {
          text = `[used ${(parsed.tool_calls as unknown[]).length} tool(s)]`
        }
      } catch {
        text = msg.content
      }
    }
    if (!text) return null
    // Truncate long messages
    const maxLen = 500
    const truncated = text.length > maxLen ? text.slice(0, maxLen) + '...' : text
    return `[${time}] ${msg.role}: ${truncated}`
  })

  return { success: true, output: lines.filter(Boolean).join('\n') }
}

const PHOTO_MAX_BYTES = 10 * 1024 * 1024 // 10 MB
const DOCUMENT_MAX_BYTES = 50 * 1024 * 1024 // 50 MB

const sendFileHandler: ToolHandler = async (input, context) => {
  const filePath = typeof input.file_path === 'string' ? input.file_path.trim() : ''
  if (!filePath) {
    return { success: false, error: 'file_path is required.' }
  }

  if (!context.pluginInstanceId) {
    return { success: false, error: 'No plugin instance context available.' }
  }

  const resolved = await resolveTelegramConfig(context.pluginInstanceId)
  if (!resolved.config) {
    return { success: false, error: resolved.error ?? 'Failed to resolve Telegram config.' }
  }

  // Determine chat_id and thread_id
  const responseCtx = parseResponseContext(context.responseContext)
  const chatId =
    typeof input.chat_id === 'number' ? input.chat_id : (responseCtx?.chatId ?? undefined)
  const threadId =
    typeof input.thread_id === 'number'
      ? input.thread_id
      : (responseCtx?.messageThreadId ?? undefined)

  if (!chatId) {
    return {
      success: false,
      error:
        'No chat_id provided and could not determine from conversation context. Specify chat_id explicitly.',
    }
  }

  // Read file from sprite as base64.
  // Deliberately bypass the session — use stateless HTTP exec for clean stdout
  // without session markers, heartbeat bytes, or sanitization that can corrupt binary data.
  const readResult = await spriteExec(context.spriteName, `base64 -w0 "${filePath}"`)
  if (readResult.exitCode !== 0) {
    const stderr = readResult.stderr || ''
    if (stderr.includes('No such file') || stderr.includes('not found')) {
      return { success: false, error: `File not found: ${filePath}` }
    }
    return { success: false, error: `Failed to read file: ${stderr || 'unknown error'}` }
  }

  const fileBuffer = Buffer.from(readResult.stdout.trim(), 'base64')
  const fileName = filePath.split('/').pop() || 'file'

  // Determine send method
  const sendAs =
    typeof input.send_as === 'string' && ['photo', 'document'].includes(input.send_as)
      ? (input.send_as as 'photo' | 'document')
      : null

  const mime = inferMimeType(filePath)
  const isImage = mime !== null && mime.startsWith('image/')
  const usePhoto = sendAs === 'photo' || (sendAs === null && isImage)

  // Validate file size
  const maxBytes = usePhoto ? PHOTO_MAX_BYTES : DOCUMENT_MAX_BYTES
  if (fileBuffer.length > maxBytes) {
    const sizeMb = (fileBuffer.length / (1024 * 1024)).toFixed(1)
    const limitMb = (maxBytes / (1024 * 1024)).toFixed(0)
    return {
      success: false,
      error: `File too large (${sizeMb} MB). Telegram ${usePhoto ? 'photo' : 'document'} limit is ${limitMb} MB.`,
    }
  }

  const caption = typeof input.caption === 'string' ? input.caption : undefined
  const fileOptions = { caption, messageThreadId: threadId }

  // Send chat action (best-effort)
  sendChatAction(resolved.config, chatId, usePhoto ? 'upload_photo' : 'upload_document', {
    messageThreadId: threadId,
  }).catch(() => {})

  try {
    if (usePhoto) {
      await sendPhoto(resolved.config, chatId, fileBuffer, fileName, fileOptions)
    } else {
      await sendDocument(resolved.config, chatId, fileBuffer, fileName, fileOptions)
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }

  const sizeKb = (fileBuffer.length / 1024).toFixed(1)
  return {
    success: true,
    output: `Sent ${fileName} (${sizeKb} KB) as ${usePhoto ? 'photo' : 'document'}.`,
  }
}

// ---------------------------------------------------------------------------
// Register unified provider (tools + context)
// ---------------------------------------------------------------------------

registerIntegrationProvider({
  integrationType: 'telegram',

  // Tool contributions
  toolDefinitions: [
    sendTelegramMessageDefinition,
    listTelegramThreadsDefinition,
    readTelegramThreadDefinition,
    sendFileDefinition,
  ],
  toolHandlers: {
    send_telegram_message: sendTelegramMessageHandler,
    list_telegram_threads: listTelegramThreadsHandler,
    read_telegram_thread: readTelegramThreadHandler,
    send_file: sendFileHandler,
  },

  // Context contributions
  getSystemPromptSections(): Promise<PromptSection[]> {
    return Promise.resolve([
      {
        id: 'telegram:platform',
        content: TELEGRAM_PLATFORM_PROMPT,
        priority: 5,
      },
    ])
  },

  // No preamble, no directory hint for Telegram
})
