import type { PluginInstanceRecord } from '@nitejar/database'
import type {
  TelegramUpdate,
  TelegramConfig,
  TelegramResponseContext,
  TelegramMessage,
  TelegramPhotoSize,
} from './types'
import type { WebhookParseResult } from '../types'
import { sendChatAction } from './client'

/**
 * Parse a Telegram webhook update
 */
export async function parseTelegramWebhook(
  request: Request,
  pluginInstance: PluginInstanceRecord
): Promise<WebhookParseResult> {
  // Parse config - it may be a JSON string or already parsed
  let config: TelegramConfig | null = null
  if (typeof pluginInstance.config === 'string') {
    try {
      config = JSON.parse(pluginInstance.config) as TelegramConfig
    } catch {
      console.warn('Failed to parse Telegram plugin instance config')
    }
  } else {
    config = pluginInstance.config as TelegramConfig | null
  }

  // Verify webhook secret if configured
  if (config?.webhookSecret) {
    const secretHeader = request.headers.get('x-telegram-bot-api-secret-token')
    if (secretHeader !== config.webhookSecret) {
      console.warn('Telegram webhook secret mismatch')
      return { shouldProcess: false }
    }
  }

  // Parse the update
  let update: TelegramUpdate
  try {
    update = (await request.json()) as TelegramUpdate
  } catch {
    console.warn('Failed to parse Telegram webhook body')
    return { shouldProcess: false }
  }

  // We only handle messages for now
  const message = update.message ?? update.edited_message
  if (!message) {
    return { shouldProcess: false }
  }

  // Explicit guard: never ingest bot-authored messages as new work items.
  // Prevents plugin-instance-level echo loops regardless of provider behavior.
  if (message.from?.is_bot) {
    return { shouldProcess: false }
  }

  const attachments = extractAttachments(message)
  const text = (message.text ?? message.caption ?? '').trim()

  // Only handle text or messages with attachments
  if (!text && attachments.length === 0) {
    return { shouldProcess: false }
  }

  // Check allowed chat IDs if configured
  if (config?.allowedChatIds && config.allowedChatIds.length > 0) {
    if (!config.allowedChatIds.includes(message.chat.id)) {
      console.log(`Chat ${message.chat.id} not in allowed list`)
      return { shouldProcess: false }
    }
  }

  // Build response context
  const useMessageThreads = config?.useMessageThreads !== false
  const messageThreadId = useMessageThreads ? message.message_thread_id : undefined
  const hasMessageThreadId = messageThreadId !== undefined

  const responseContext: TelegramResponseContext = {
    chatId: message.chat.id,
    messageId: message.message_id,
    replyToMessageId: message.reply_to_message?.message_id ?? message.message_id,
    ...(hasMessageThreadId ? { messageThreadId } : {}),
  }

  // Detect bot commands (e.g., /reset, /new)
  const commandMatch = message.text ? message.text.match(/^\/(\w+)/) : null
  const command = commandMatch ? commandMatch[1] : undefined

  // Build work item
  const senderName = message.from
    ? `${message.from.first_name}${message.from.last_name ? ' ' + message.from.last_name : ''}`
    : 'Unknown'

  const chatName = message.chat.title || message.chat.username || `Chat ${message.chat.id}`

  const titleSource = text
    ? text
    : attachments.length > 0
      ? `${attachments[0]!.type} from ${chatName}`
      : `Message from ${chatName}`
  const title = truncate(titleSource, 100)

  return {
    shouldProcess: true,
    workItem: {
      session_key: hasMessageThreadId
        ? `telegram:${message.chat.id}:thread:${messageThreadId}`
        : `telegram:${message.chat.id}`,
      source: 'telegram',
      source_ref: hasMessageThreadId
        ? `telegram:${message.chat.id}:${messageThreadId}:${message.message_id}`
        : `telegram:${message.chat.id}:${message.message_id}`,
      title,
      payload: JSON.stringify({
        ...(text ? { body: text } : {}),
        source: 'telegram',
        actor: {
          kind: 'human',
          externalId: message.from?.id != null ? String(message.from.id) : undefined,
          handle: message.from?.username,
          displayName: senderName,
          source: 'telegram',
        },
        chatId: message.chat.id,
        chatType: message.chat.type,
        chatName,
        messageId: message.message_id,
        ...(hasMessageThreadId ? { messageThreadId } : {}),
        senderId: message.from?.id,
        senderName,
        senderUsername: message.from?.username,
        timestamp: message.date,
        replyToMessageId: message.reply_to_message?.message_id,
        replyToMessageText: message.reply_to_message?.text,
        ...(attachments.length > 0 ? { attachments } : {}),
      }),
      status: 'NEW',
    },
    idempotencyKey: `telegram:${update.update_id}`,
    responseContext,
    command,
  }
}

interface TelegramAttachment {
  type:
    | 'photo'
    | 'document'
    | 'image'
    | 'audio'
    | 'voice'
    | 'video'
    | 'video_note'
    | 'animation'
    | 'sticker'
  fileId?: string
  fileUniqueId?: string
  fileName?: string
  mimeType?: string
  width?: number
  height?: number
  fileSize?: number
  caption?: string
  duration?: number
  performer?: string
  title?: string
  emoji?: string
  isAnimated?: boolean
  isVideo?: boolean
}

function extractAttachments(message: TelegramMessage): TelegramAttachment[] {
  const attachments: TelegramAttachment[] = []

  // Photos — existing behavior, pick best resolution
  if (message.photo && message.photo.length > 0) {
    const bestPhoto = pickBestPhoto(message.photo)
    attachments.push({
      type: 'photo',
      fileId: bestPhoto.file_id,
      fileUniqueId: bestPhoto.file_unique_id,
      width: bestPhoto.width,
      height: bestPhoto.height,
      fileSize: bestPhoto.file_size,
      caption: message.caption,
    })
  }

  // Documents — capture ALL documents (not just images)
  if (message.document) {
    const doc = message.document
    attachments.push({
      type: 'document',
      fileId: doc.file_id,
      fileUniqueId: doc.file_unique_id,
      fileName: doc.file_name,
      mimeType: doc.mime_type,
      fileSize: doc.file_size,
      caption: message.caption,
    })
  }

  // Audio
  if (message.audio) {
    const audio = message.audio
    attachments.push({
      type: 'audio',
      fileId: audio.file_id,
      fileUniqueId: audio.file_unique_id,
      fileName: audio.file_name,
      mimeType: audio.mime_type,
      fileSize: audio.file_size,
      duration: audio.duration,
      performer: audio.performer,
      title: audio.title,
      caption: message.caption,
    })
  }

  // Voice
  if (message.voice) {
    const voice = message.voice
    attachments.push({
      type: 'voice',
      fileId: voice.file_id,
      fileUniqueId: voice.file_unique_id,
      mimeType: voice.mime_type,
      fileSize: voice.file_size,
      duration: voice.duration,
    })
  }

  // Video
  if (message.video) {
    const video = message.video
    attachments.push({
      type: 'video',
      fileId: video.file_id,
      fileUniqueId: video.file_unique_id,
      fileName: video.file_name,
      mimeType: video.mime_type,
      fileSize: video.file_size,
      width: video.width,
      height: video.height,
      duration: video.duration,
      caption: message.caption,
    })
  }

  // Video note (circular video messages)
  if (message.video_note) {
    const vn = message.video_note
    attachments.push({
      type: 'video_note',
      fileId: vn.file_id,
      fileUniqueId: vn.file_unique_id,
      fileSize: vn.file_size,
      width: vn.length,
      height: vn.length,
      duration: vn.duration,
    })
  }

  // Animation (GIFs)
  if (message.animation) {
    const anim = message.animation
    attachments.push({
      type: 'animation',
      fileId: anim.file_id,
      fileUniqueId: anim.file_unique_id,
      fileName: anim.file_name,
      mimeType: anim.mime_type,
      fileSize: anim.file_size,
      width: anim.width,
      height: anim.height,
      duration: anim.duration,
      caption: message.caption,
    })
  }

  // Sticker
  if (message.sticker) {
    const sticker = message.sticker
    attachments.push({
      type: 'sticker',
      fileId: sticker.file_id,
      fileUniqueId: sticker.file_unique_id,
      fileSize: sticker.file_size,
      width: sticker.width,
      height: sticker.height,
      emoji: sticker.emoji,
      isAnimated: sticker.is_animated,
      isVideo: sticker.is_video,
    })
  }

  return attachments
}

function pickBestPhoto(photos: TelegramPhotoSize[]): TelegramPhotoSize {
  return photos.reduce((best, current) => {
    const bestArea = best.width * best.height
    const currentArea = current.width * current.height

    if (currentArea > bestArea) return current
    if (currentArea < bestArea) return best

    const bestSize = best.file_size ?? 0
    const currentSize = current.file_size ?? 0
    return currentSize > bestSize ? current : best
  }, photos[0]!)
}

/**
 * Send a typing indicator for a Telegram chat.
 * Used by the session queue to signal that a queued message was received.
 */
export async function sendTypingIndicator(
  config: TelegramConfig,
  chatId: number,
  messageThreadId?: number
): Promise<void> {
  try {
    await sendChatAction(config, chatId, 'typing', { messageThreadId })
  } catch (err) {
    console.warn('[telegram] Failed to send typing indicator:', err)
  }
}

/**
 * Truncate a string to a maximum length
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str
  }
  return str.slice(0, maxLength - 3) + '...'
}
