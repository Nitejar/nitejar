import type { DiscordUser } from './types'

const DISCORD_API_BASE = 'https://discord.com/api/v10'
const DISCORD_MAX_MESSAGE_LENGTH = 2000

export interface DiscordMessage {
  id: string
  channel_id: string
  content: string
  timestamp?: string
  author?: {
    id: string
    username: string
    global_name?: string | null
    bot?: boolean
  }
}

export interface DiscordApplicationCommandOptionDefinition {
  type: number
  name: string
  description: string
  required?: boolean
}

export interface DiscordApplicationCommandDefinition {
  type?: number
  name: string
  description: string
  options?: DiscordApplicationCommandOptionDefinition[]
}

function formatDiscordApiError(status: number, bodyText: string): string {
  try {
    const parsed = JSON.parse(bodyText) as { message?: string; code?: number }
    if (parsed.message) {
      return `Discord API error (${status}${parsed.code ? `/${parsed.code}` : ''}): ${parsed.message}`
    }
  } catch {
    // Ignore parse failure and use raw text below.
  }

  const trimmed = bodyText.trim()
  if (trimmed) {
    return `Discord API error (${status}): ${trimmed}`
  }

  return `Discord API error (${status})`
}

async function readDiscordResponse<T>(response: Response): Promise<T> {
  const text = await response.text()
  if (!response.ok) {
    throw new Error(formatDiscordApiError(response.status, text))
  }

  if (!text) {
    return {} as T
  }

  return JSON.parse(text) as T
}

function botAuthHeaders(botToken: string): Record<string, string> {
  return {
    Authorization: `Bot ${botToken}`,
    'Content-Type': 'application/json',
  }
}

/**
 * Split long content into Discord-safe message chunks.
 */
export function splitDiscordMessage(content: string): string[] {
  const normalized = content.trim()
  if (!normalized) return []
  if (normalized.length <= DISCORD_MAX_MESSAGE_LENGTH) return [normalized]

  const chunks: string[] = []
  let current = ''

  const flush = (): void => {
    const trimmed = current.trim()
    if (trimmed) chunks.push(trimmed)
    current = ''
  }

  for (const line of normalized.split('\n')) {
    const candidate = current ? `${current}\n${line}` : line

    if (candidate.length <= DISCORD_MAX_MESSAGE_LENGTH) {
      current = candidate
      continue
    }

    if (current) flush()

    if (line.length <= DISCORD_MAX_MESSAGE_LENGTH) {
      current = line
      continue
    }

    for (let i = 0; i < line.length; i += DISCORD_MAX_MESSAGE_LENGTH) {
      const part = line.slice(i, i + DISCORD_MAX_MESSAGE_LENGTH).trim()
      if (part) chunks.push(part)
    }
  }

  if (current) flush()
  return chunks
}

/**
 * Post a follow-up interaction message.
 */
export async function sendFollowUpMessage(
  applicationId: string,
  interactionToken: string,
  content: string
): Promise<DiscordMessage> {
  const response = await fetch(
    `${DISCORD_API_BASE}/webhooks/${applicationId}/${interactionToken}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content }),
    }
  )

  return readDiscordResponse<DiscordMessage>(response)
}

/**
 * Edit the original deferred interaction response.
 */
export async function editOriginalResponse(
  applicationId: string,
  interactionToken: string,
  content: string
): Promise<DiscordMessage> {
  const response = await fetch(
    `${DISCORD_API_BASE}/webhooks/${applicationId}/${interactionToken}/messages/@original`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content }),
    }
  )

  return readDiscordResponse<DiscordMessage>(response)
}

/**
 * Register slash commands for a guild.
 */
export async function registerGuildCommands(
  applicationId: string,
  botToken: string,
  guildId: string,
  commands: DiscordApplicationCommandDefinition[]
): Promise<DiscordApplicationCommandDefinition[]> {
  const response = await fetch(
    `${DISCORD_API_BASE}/applications/${applicationId}/guilds/${guildId}/commands`,
    {
      method: 'PUT',
      headers: botAuthHeaders(botToken),
      body: JSON.stringify(commands),
    }
  )

  return readDiscordResponse<DiscordApplicationCommandDefinition[]>(response)
}

/**
 * Send a message to a channel.
 */
export async function sendChannelMessage(
  botToken: string,
  channelId: string,
  content: string,
  replyTo?: string
): Promise<DiscordMessage> {
  const body: Record<string, unknown> = { content }
  if (replyTo) {
    body.message_reference = {
      message_id: replyTo,
    }
  }

  const response = await fetch(`${DISCORD_API_BASE}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: botAuthHeaders(botToken),
    body: JSON.stringify(body),
  })

  return readDiscordResponse<DiscordMessage>(response)
}

/**
 * Read recent channel messages.
 */
export async function getChannelMessages(
  botToken: string,
  channelId: string,
  limit = 20
): Promise<DiscordMessage[]> {
  const boundedLimit = Math.max(1, Math.min(100, limit))
  const response = await fetch(
    `${DISCORD_API_BASE}/channels/${channelId}/messages?limit=${boundedLimit}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bot ${botToken}`,
      },
    }
  )

  return readDiscordResponse<DiscordMessage[]>(response)
}

/**
 * Validate bot token by fetching the bot user.
 */
export async function getCurrentBotUser(botToken: string): Promise<DiscordUser> {
  const response = await fetch(`${DISCORD_API_BASE}/users/@me`, {
    method: 'GET',
    headers: {
      Authorization: `Bot ${botToken}`,
    },
  })

  return readDiscordResponse<DiscordUser>(response)
}
