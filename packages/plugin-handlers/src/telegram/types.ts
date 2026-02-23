/**
 * Telegram Bot API types (subset of what we need)
 */

export interface TelegramUser {
  id: number
  is_bot: boolean
  first_name: string
  last_name?: string
  username?: string
  language_code?: string
}

export interface TelegramChat {
  id: number
  type: 'private' | 'group' | 'supergroup' | 'channel'
  title?: string
  username?: string
  first_name?: string
  last_name?: string
}

export interface TelegramMessage {
  message_id: number
  message_thread_id?: number
  from?: TelegramUser
  sender_chat?: TelegramChat
  date: number
  chat: TelegramChat
  forward_origin?: unknown
  text?: string
  caption?: string
  photo?: TelegramPhotoSize[]
  document?: TelegramDocument
  audio?: TelegramAudio
  voice?: TelegramVoice
  video?: TelegramVideo
  video_note?: TelegramVideoNote
  animation?: TelegramAnimation
  sticker?: TelegramSticker
  entities?: TelegramMessageEntity[]
  reply_to_message?: TelegramMessage
}

export interface TelegramMessageEntity {
  type: string
  offset: number
  length: number
  url?: string
  user?: TelegramUser
  language?: string
  custom_emoji_id?: string
}

export interface TelegramPhotoSize {
  file_id: string
  file_unique_id: string
  width: number
  height: number
  file_size?: number
}

export interface TelegramDocument {
  file_id: string
  file_unique_id: string
  file_name?: string
  mime_type?: string
  file_size?: number
}

export interface TelegramAudio {
  file_id: string
  file_unique_id: string
  duration: number
  performer?: string
  title?: string
  file_name?: string
  mime_type?: string
  file_size?: number
}

export interface TelegramVoice {
  file_id: string
  file_unique_id: string
  duration: number
  mime_type?: string
  file_size?: number
}

export interface TelegramVideo {
  file_id: string
  file_unique_id: string
  width: number
  height: number
  duration: number
  file_name?: string
  mime_type?: string
  file_size?: number
}

export interface TelegramVideoNote {
  file_id: string
  file_unique_id: string
  length: number
  duration: number
  file_size?: number
}

export interface TelegramAnimation {
  file_id: string
  file_unique_id: string
  width: number
  height: number
  duration: number
  file_name?: string
  mime_type?: string
  file_size?: number
}

export interface TelegramSticker {
  file_id: string
  file_unique_id: string
  type: string
  width: number
  height: number
  is_animated: boolean
  is_video: boolean
  emoji?: string
  file_size?: number
}

export interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
  edited_message?: TelegramMessage
  channel_post?: TelegramMessage
  edited_channel_post?: TelegramMessage
  callback_query?: {
    id: string
    from: TelegramUser
    chat_instance: string
    message?: TelegramMessage
    data?: string
  }
}

export interface TelegramConfig {
  /** Bot token from @BotFather */
  botToken: string
  /** Optional webhook secret for verification */
  webhookSecret?: string
  /** Optional allowed chat IDs (if empty, all chats allowed) */
  allowedChatIds?: number[]
  /** Whether to route replies through Telegram message threads when available (default: true) */
  useMessageThreads?: boolean
}

export interface TelegramResponseContext {
  chatId: number
  messageId: number
  replyToMessageId?: number
  messageThreadId?: number
}
