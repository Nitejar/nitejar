import type { TelegramConfig, TelegramMessage } from './types'

const TELEGRAM_API_BASE = 'https://api.telegram.org/bot'
const TELEGRAM_FILE_BASE = 'https://api.telegram.org/file/bot'

interface TelegramApiResponse<T = unknown> {
  ok: boolean
  result?: T
  description?: string
  error_code?: number
}

interface TelegramFileInfo {
  file_id: string
  file_unique_id: string
  file_size?: number
  file_path?: string
}

interface DownloadTelegramFileOptions {
  maxBytes?: number
}

/**
 * Send a message via Telegram Bot API
 */
export async function sendMessage(
  config: TelegramConfig,
  chatId: number,
  text: string,
  options?: {
    replyToMessageId?: number
    messageThreadId?: number
    parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2'
    disableNotification?: boolean
  }
): Promise<TelegramMessage> {
  const url = `${TELEGRAM_API_BASE}${config.botToken}/sendMessage`

  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
  }

  if (options?.replyToMessageId) {
    body.reply_to_message_id = options.replyToMessageId
  }

  if (options?.messageThreadId) {
    body.message_thread_id = options.messageThreadId
  }

  if (options?.parseMode) {
    body.parse_mode = options.parseMode
  }

  if (options?.disableNotification) {
    body.disable_notification = true
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const result = (await response.json()) as TelegramApiResponse<TelegramMessage>

  if (!result.ok) {
    throw new Error(`Telegram API error: ${result.description || 'Unknown error'}`)
  }

  return result.result!
}

/**
 * Send an approval prompt message
 */
export async function sendApprovalPrompt(
  config: TelegramConfig,
  chatId: number,
  message: string
): Promise<TelegramMessage> {
  return sendMessage(config, chatId, message)
}

/**
 * Send a "typing" action to indicate the bot is processing
 */
export async function sendChatAction(
  config: TelegramConfig,
  chatId: number,
  action: 'typing' | 'upload_document' | 'upload_photo' = 'typing',
  options?: {
    messageThreadId?: number
  }
): Promise<void> {
  const url = `${TELEGRAM_API_BASE}${config.botToken}/sendChatAction`

  const body: Record<string, unknown> = {
    chat_id: chatId,
    action,
  }

  if (options?.messageThreadId) {
    body.message_thread_id = options.messageThreadId
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const result = (await response.json()) as TelegramApiResponse

  if (!result.ok) {
    console.warn(`Failed to send chat action: ${result.description}`)
  }
}

/**
 * Get bot info to verify the token is valid
 */
interface BotInfo {
  id: number
  username: string
  first_name: string
  has_topics_enabled?: boolean
  allows_users_to_create_topics?: boolean
}

export async function getMe(config: TelegramConfig): Promise<BotInfo> {
  const url = `${TELEGRAM_API_BASE}${config.botToken}/getMe`

  const response = await fetch(url)
  const result = (await response.json()) as TelegramApiResponse<BotInfo>

  if (!result.ok) {
    throw new Error(`Telegram API error: ${result.description || 'Unknown error'}`)
  }

  return result.result!
}

/**
 * Set the webhook URL for the bot
 */
export async function setWebhook(
  config: TelegramConfig,
  webhookUrl: string,
  options?: {
    secretToken?: string
    allowedUpdates?: string[]
  }
): Promise<void> {
  const url = `${TELEGRAM_API_BASE}${config.botToken}/setWebhook`

  const body: Record<string, unknown> = {
    url: webhookUrl,
  }

  if (options?.secretToken) {
    body.secret_token = options.secretToken
  }

  if (options?.allowedUpdates) {
    body.allowed_updates = options.allowedUpdates
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const result = (await response.json()) as TelegramApiResponse

  if (!result.ok) {
    throw new Error(`Telegram API error: ${result.description || 'Unknown error'}`)
  }
}

/**
 * Delete the webhook
 */
export async function deleteWebhook(config: TelegramConfig): Promise<void> {
  const url = `${TELEGRAM_API_BASE}${config.botToken}/deleteWebhook`

  const response = await fetch(url, {
    method: 'POST',
  })

  const result = (await response.json()) as TelegramApiResponse

  if (!result.ok) {
    throw new Error(`Telegram API error: ${result.description || 'Unknown error'}`)
  }
}

export interface ForumTopic {
  message_thread_id: number
  name: string
  icon_color: number
  icon_custom_emoji_id?: string
}

/**
 * Create a forum topic in a chat.
 * Supported by Telegram in private chats with bots when topic mode is enabled.
 */
export async function createForumTopic(
  config: TelegramConfig,
  chatId: number,
  name: string,
  options?: {
    iconColor?: number
    iconCustomEmojiId?: string
  }
): Promise<ForumTopic> {
  const url = `${TELEGRAM_API_BASE}${config.botToken}/createForumTopic`

  const body: Record<string, unknown> = {
    chat_id: chatId,
    name,
  }

  if (options?.iconColor) {
    body.icon_color = options.iconColor
  }

  if (options?.iconCustomEmojiId) {
    body.icon_custom_emoji_id = options.iconCustomEmojiId
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const result = (await response.json()) as TelegramApiResponse<ForumTopic>

  if (!result.ok || !result.result) {
    throw new Error(`Telegram API error: ${result.description || 'Unknown error'}`)
  }

  return result.result
}

/**
 * Bot command definition for setMyCommands
 */
export interface BotCommand {
  command: string
  description: string
}

/**
 * Set the bot's command menu
 */
export async function setMyCommands(config: TelegramConfig, commands: BotCommand[]): Promise<void> {
  const url = `${TELEGRAM_API_BASE}${config.botToken}/setMyCommands`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ commands }),
  })

  const result = (await response.json()) as TelegramApiResponse

  if (!result.ok) {
    throw new Error(`Telegram API error: ${result.description || 'Unknown error'}`)
  }
}

/**
 * Set a reaction on a message
 * Use emoji like "👀", "👍", "✅", etc.
 * Pass null or empty array to remove reactions
 */
export async function setMessageReaction(
  config: TelegramConfig,
  chatId: number,
  messageId: number,
  emoji: string | null
): Promise<void> {
  const url = `${TELEGRAM_API_BASE}${config.botToken}/setMessageReaction`

  const reaction = emoji ? [{ type: 'emoji', emoji }] : []

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      reaction,
    }),
  })

  const result = (await response.json()) as TelegramApiResponse

  if (!result.ok) {
    console.warn(`Failed to set reaction: ${result.description}`)
  }
}

/**
 * Resolve a Telegram file ID to its file path on Telegram CDN.
 */
export async function getFile(config: TelegramConfig, fileId: string): Promise<TelegramFileInfo> {
  const url = `${TELEGRAM_API_BASE}${config.botToken}/getFile`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file_id: fileId }),
  })

  const result = (await response.json()) as TelegramApiResponse<TelegramFileInfo>
  if (!result.ok || !result.result) {
    throw new Error(`Telegram API error: ${result.description || 'Unknown error'}`)
  }

  return result.result
}

/**
 * Download a Telegram file and return it as a data URL suitable for multimodal prompts.
 */
export async function downloadTelegramFileAsDataUrl(
  config: TelegramConfig,
  filePath: string,
  options?: DownloadTelegramFileOptions
): Promise<string> {
  const maxBytes = options?.maxBytes ?? 2 * 1024 * 1024
  const url = `${TELEGRAM_FILE_BASE}${config.botToken}/${filePath}`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to download Telegram file: HTTP ${response.status}`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length > maxBytes) {
    throw new Error(
      `Telegram file too large for inline image input (${buffer.length} bytes > ${maxBytes} bytes)`
    )
  }

  const responseContentType = response.headers.get('content-type')
  const inferredFromPath = inferImageMimeType(filePath)
  const inferredFromBuffer = inferImageMimeTypeFromBuffer(buffer)
  const contentType =
    normalizeImageMimeType(responseContentType) ||
    inferredFromPath ||
    inferredFromBuffer ||
    'image/jpeg'
  const base64 = buffer.toString('base64')
  return `data:${contentType};base64,${base64}`
}

/**
 * Download a Telegram file and return the raw buffer with metadata.
 */
export interface TelegramDownloadResult {
  buffer: Buffer
  mimeType: string
  filePath: string
  fileSize: number
}

export async function downloadTelegramFile(
  config: TelegramConfig,
  filePath: string,
  options?: { maxBytes?: number }
): Promise<TelegramDownloadResult> {
  const maxBytes = options?.maxBytes ?? 20 * 1024 * 1024
  const url = `${TELEGRAM_FILE_BASE}${config.botToken}/${filePath}`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to download Telegram file: HTTP ${response.status}`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length > maxBytes) {
    throw new Error(`Telegram file too large (${buffer.length} bytes > ${maxBytes} bytes limit)`)
  }

  const responseContentType = response.headers.get('content-type')
  const mimeType =
    normalizeMimeType(responseContentType) || inferMimeType(filePath) || 'application/octet-stream'

  return {
    buffer,
    mimeType,
    filePath,
    fileSize: buffer.length,
  }
}

function normalizeMimeType(contentType: string | null): string | null {
  if (!contentType) return null
  const normalized = contentType.toLowerCase().split(';')[0]?.trim() ?? ''
  if (!normalized || normalized === 'application/octet-stream') return null
  return normalized
}

export function inferMimeType(filePath: string): string | null {
  const lower = filePath.toLowerCase()
  // Images
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.bmp')) return 'image/bmp'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  // Audio
  if (lower.endsWith('.mp3')) return 'audio/mpeg'
  if (lower.endsWith('.ogg') || lower.endsWith('.oga')) return 'audio/ogg'
  if (lower.endsWith('.wav')) return 'audio/wav'
  if (lower.endsWith('.flac')) return 'audio/flac'
  if (lower.endsWith('.m4a')) return 'audio/mp4'
  // Video
  if (lower.endsWith('.mp4')) return 'video/mp4'
  if (lower.endsWith('.webm')) return 'video/webm'
  if (lower.endsWith('.avi')) return 'video/x-msvideo'
  if (lower.endsWith('.mkv')) return 'video/x-matroska'
  if (lower.endsWith('.mov')) return 'video/quicktime'
  // Documents
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.zip')) return 'application/zip'
  if (lower.endsWith('.gz') || lower.endsWith('.tgz')) return 'application/gzip'
  if (lower.endsWith('.tar')) return 'application/x-tar'
  // Text
  if (lower.endsWith('.txt')) return 'text/plain'
  if (lower.endsWith('.csv')) return 'text/csv'
  if (lower.endsWith('.json')) return 'application/json'
  if (lower.endsWith('.xml')) return 'application/xml'
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html'
  if (lower.endsWith('.css')) return 'text/css'
  if (lower.endsWith('.js') || lower.endsWith('.mjs')) return 'text/javascript'
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'text/typescript'
  if (lower.endsWith('.md')) return 'text/markdown'
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'text/yaml'
  if (lower.endsWith('.py')) return 'text/x-python'
  if (lower.endsWith('.rb')) return 'text/x-ruby'
  if (lower.endsWith('.sh') || lower.endsWith('.bash')) return 'text/x-shellscript'
  if (lower.endsWith('.sql')) return 'text/x-sql'
  return null
}

function inferImageMimeType(filePath: string): string | null {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.bmp')) return 'image/bmp'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  return null
}

function normalizeImageMimeType(contentType: string | null): string | null {
  if (!contentType) return null
  const normalized = contentType.toLowerCase().split(';')[0]?.trim() ?? ''
  if (!normalized || normalized === 'application/octet-stream') return null
  if (!normalized.startsWith('image/')) return null
  return normalized
}

// ---------------------------------------------------------------------------
// Outbound file uploads
// ---------------------------------------------------------------------------

interface SendFileOptions {
  caption?: string
  parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2'
  messageThreadId?: number
  disableNotification?: boolean
}

/**
 * Send a photo to a Telegram chat via multipart/form-data upload.
 * Telegram limit: 10 MB for photos.
 */
export async function sendPhoto(
  config: TelegramConfig,
  chatId: number,
  photo: Buffer,
  fileName: string,
  options?: SendFileOptions
): Promise<TelegramMessage> {
  const url = `${TELEGRAM_API_BASE}${config.botToken}/sendPhoto`

  const mimeType = inferMimeType(fileName) || 'image/png'
  const formData = new FormData()
  formData.append('chat_id', String(chatId))
  formData.append('photo', new Blob([new Uint8Array(photo)], { type: mimeType }), fileName)

  if (options?.caption) formData.append('caption', options.caption)
  if (options?.parseMode) formData.append('parse_mode', options.parseMode)
  if (options?.messageThreadId)
    formData.append('message_thread_id', String(options.messageThreadId))
  if (options?.disableNotification) formData.append('disable_notification', 'true')

  const response = await fetch(url, { method: 'POST', body: formData })
  const result = (await response.json()) as TelegramApiResponse<TelegramMessage>

  if (!result.ok) {
    throw new Error(`Telegram API error: ${result.description || 'Unknown error'}`)
  }

  return result.result!
}

/**
 * Send a document to a Telegram chat via multipart/form-data upload.
 * Telegram limit: 50 MB for documents.
 */
export async function sendDocument(
  config: TelegramConfig,
  chatId: number,
  document: Buffer,
  fileName: string,
  options?: SendFileOptions
): Promise<TelegramMessage> {
  const url = `${TELEGRAM_API_BASE}${config.botToken}/sendDocument`

  const formData = new FormData()
  formData.append('chat_id', String(chatId))
  formData.append('document', new Blob([new Uint8Array(document)]), fileName)

  if (options?.caption) formData.append('caption', options.caption)
  if (options?.parseMode) formData.append('parse_mode', options.parseMode)
  if (options?.messageThreadId)
    formData.append('message_thread_id', String(options.messageThreadId))
  if (options?.disableNotification) formData.append('disable_notification', 'true')

  const response = await fetch(url, { method: 'POST', body: formData })
  const result = (await response.json()) as TelegramApiResponse<TelegramMessage>

  if (!result.ok) {
    throw new Error(`Telegram API error: ${result.description || 'Unknown error'}`)
  }

  return result.result!
}

function inferImageMimeTypeFromBuffer(buffer: Buffer): string | null {
  // JPEG: FF D8 FF
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg'
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png'
  }
  // GIF: GIF87a / GIF89a
  if (
    buffer.length >= 6 &&
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38 &&
    (buffer[4] === 0x37 || buffer[4] === 0x39) &&
    buffer[5] === 0x61
  ) {
    return 'image/gif'
  }
  // WEBP: RIFF....WEBP
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return 'image/webp'
  }
  return null
}
