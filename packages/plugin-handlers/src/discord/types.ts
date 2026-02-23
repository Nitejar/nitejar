/**
 * Discord plugin instance configuration.
 */
export interface DiscordConfig {
  /** Discord application ID for interaction/webhook endpoints. */
  applicationId: string
  /** Discord interaction public key (hex) used to verify Ed25519 signatures. */
  publicKey: string
  /** Discord bot token for bot-authenticated REST endpoints. */
  botToken: string
  /** Guild ID where slash commands should be registered. */
  guildId: string
}

/**
 * Context needed to send interaction follow-up messages.
 */
export interface DiscordResponseContext {
  applicationId?: string
  interactionId?: string
  interactionToken?: string
  guildId?: string
  channelId?: string
  messageId?: string
}

export const DISCORD_INTERACTION_TYPE = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
  APPLICATION_COMMAND_AUTOCOMPLETE: 4,
  MODAL_SUBMIT: 5,
} as const

export type DiscordInteractionType =
  (typeof DISCORD_INTERACTION_TYPE)[keyof typeof DISCORD_INTERACTION_TYPE]

export interface DiscordUser {
  id: string
  username: string
  global_name?: string | null
  discriminator?: string
  bot?: boolean
}

export interface DiscordMember {
  user?: DiscordUser
  nick?: string | null
  roles?: string[]
}

export interface DiscordApplicationCommandOption {
  name: string
  type: number
  value?: string | number | boolean
  options?: DiscordApplicationCommandOption[]
}

export interface DiscordApplicationCommandData {
  id: string
  name: string
  type: number
  options?: DiscordApplicationCommandOption[]
}

export interface DiscordInteraction {
  id: string
  application_id: string
  type: DiscordInteractionType
  token: string
  guild_id?: string
  channel_id?: string
  data?: DiscordApplicationCommandData
  member?: DiscordMember
  user?: DiscordUser
}

export interface DiscordMessageAttachment {
  id: string
  filename: string
  content_type?: string
  size?: number
  width?: number
  height?: number
  url: string
  proxy_url?: string
}

export interface DiscordMessage {
  id: string
  guild_id?: string
  channel_id: string
  content?: string
  timestamp?: string
  edited_timestamp?: string | null
  author?: DiscordUser
  attachments?: DiscordMessageAttachment[]
  message_reference?: {
    message_id?: string
  }
  thread_id?: string
}
