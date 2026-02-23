import { createPublicKey, verify } from 'node:crypto'
import type { PluginInstanceRecord } from '@nitejar/database'
import type { WebhookParseResult } from '../types'
import {
  DISCORD_INTERACTION_TYPE,
  type DiscordApplicationCommandData,
  type DiscordApplicationCommandOption,
  type DiscordConfig,
  type DiscordInteraction,
  type DiscordMessage,
  type DiscordResponseContext,
  type DiscordMessageAttachment,
} from './types'

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

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

interface ParsedDiscordAttachment {
  type: 'image' | 'document' | 'audio' | 'video' | 'unknown'
  fileId?: string
  fileName?: string
  mimeType?: string
  fileSize?: number
  width?: number
  height?: number
  fileUrl?: string
}

function fromHex(input: string): Buffer | null {
  if (!/^[0-9a-fA-F]+$/.test(input) || input.length % 2 !== 0) {
    return null
  }

  try {
    return Buffer.from(input, 'hex')
  } catch {
    return null
  }
}

/**
 * Verify a Discord interaction request signature using Ed25519.
 */
export function verifyDiscordSignature(
  rawBody: string,
  signatureHex: string,
  timestamp: string,
  publicKeyHex: string
): boolean {
  const signature = fromHex(signatureHex)
  const publicKey = fromHex(publicKeyHex)
  if (!signature || !publicKey || publicKey.length !== 32 || signature.length !== 64) {
    return false
  }

  try {
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, publicKey]),
      format: 'der',
      type: 'spki',
    })

    const signedPayload = Buffer.from(`${timestamp}${rawBody}`, 'utf8')
    return verify(null, signedPayload, key, signature)
  } catch {
    return false
  }
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, Math.max(0, maxLength - 3)) + '...'
}

function isDiscordMessageEvent(payload: unknown): payload is DiscordMessage {
  if (!payload || typeof payload !== 'object') return false

  const record = payload as Record<string, unknown>
  if (typeof record.id !== 'string' || typeof record.channel_id !== 'string') return false
  if (
    record.application_id ||
    (typeof record.type === 'number' && [1, 2, 3, 4, 5].includes(record.type))
  )
    return false

  if (typeof record.content !== 'string' && !Array.isArray(record.attachments)) {
    return false
  }

  return true
}

function normalizeMessagePayload(payload: unknown): DiscordMessage | null {
  if (!payload || typeof payload !== 'object') return null

  if (
    typeof (payload as Record<string, unknown>).t === 'string' &&
    (payload as Record<string, unknown>).t === 'MESSAGE_CREATE' &&
    (payload as Record<string, unknown>).d != null
  ) {
    const nested = (payload as Record<string, unknown>).d
    return isDiscordMessageEvent(nested) ? nested : null
  }

  return isDiscordMessageEvent(payload) ? payload : null
}

function isLikelyImageAttachment(attachment: Partial<DiscordMessageAttachment>): boolean {
  if (typeof attachment.content_type === 'string') {
    return attachment.content_type.toLowerCase().startsWith('image/')
  }
  const fileName = attachment.filename?.toLowerCase()
  if (!fileName) return false
  return fileName.endsWith('.png') || fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')
}

function collectDiscordAttachments(attachments: unknown): ParsedDiscordAttachment[] {
  if (!Array.isArray(attachments) || attachments.length === 0) return []
  const collected: ParsedDiscordAttachment[] = []

  for (const attachment of attachments) {
    if (!attachment || typeof attachment !== 'object') continue

    const item = attachment as Record<string, unknown>
    const id = typeof item.id === 'string' ? item.id : undefined
    const fileName = typeof item.filename === 'string' ? item.filename : undefined
    const mimeType = typeof item.content_type === 'string' ? item.content_type : undefined
    const url = typeof item.url === 'string' ? item.url : undefined
    if (!url) continue

    const size = typeof item.size === 'number' ? item.size : undefined
    const width = typeof item.width === 'number' ? item.width : undefined
    const height = typeof item.height === 'number' ? item.height : undefined

    const typedAttachment: ParsedDiscordAttachment = {
      fileId: id,
      fileName,
      mimeType,
      fileSize: size,
      width,
      height,
      fileUrl: typeof item.proxy_url === 'string' ? item.proxy_url : url,
      type: isLikelyImageAttachment(item as Partial<DiscordMessageAttachment>)
        ? 'image'
        : 'document',
    }
    collected.push(typedAttachment)
  }

  return collected
}

function toIsoTimestamp(message: DiscordMessage): number {
  if (!message.timestamp) return Math.floor(Date.now() / 1000)
  const parsed = Date.parse(message.timestamp)
  if (Number.isNaN(parsed)) return Math.floor(Date.now() / 1000)
  return Math.floor(parsed / 1000)
}

function makeDiscordResponseContext(message: DiscordMessage): DiscordResponseContext {
  return {
    applicationId: undefined,
    guildId: message.guild_id,
    channelId: message.channel_id,
    messageId: message.id,
  }
}

function collectOptions(
  options: DiscordApplicationCommandOption[] | undefined
): DiscordApplicationCommandOption[] {
  if (!options || options.length === 0) return []

  const collected: DiscordApplicationCommandOption[] = []
  const walk = (nodes: DiscordApplicationCommandOption[]): void => {
    for (const node of nodes) {
      collected.push(node)
      if (node.options && node.options.length > 0) {
        walk(node.options)
      }
    }
  }

  walk(options)
  return collected
}

function extractCommandText(data: DiscordApplicationCommandData | undefined): string {
  if (!data) return ''

  const flattened = collectOptions(data.options)
  if (flattened.length === 0) {
    return ''
  }

  const preferredKeys = ['prompt', 'question', 'query', 'message', 'text']
  for (const key of preferredKeys) {
    const match = flattened.find((option) => option.name.toLowerCase() === key)
    if (typeof match?.value === 'string' && match.value.trim()) {
      return match.value.trim()
    }
  }

  const lines = flattened
    .filter((option) => option.value !== undefined)
    .map((option) => `${option.name}: ${String(option.value).trim()}`)
    .filter((line) => line.length > 0)

  return lines.join('\n')
}

/**
 * Parse a Discord interaction webhook.
 */
export async function parseDiscordWebhook(
  request: Request,
  pluginInstance: PluginInstanceRecord
): Promise<WebhookParseResult> {
  const config = parseConfig(pluginInstance)
  if (!config?.publicKey) {
    return { shouldProcess: false }
  }

  const rawBody = await request.text()
  const signature = request.headers.get('x-signature-ed25519')
  const timestamp = request.headers.get('x-signature-timestamp')

  let interaction: DiscordInteraction
  try {
    interaction = JSON.parse(rawBody) as DiscordInteraction
  } catch {
    return {
      shouldProcess: false,
      webhookResponse: { status: 400, body: { error: 'Invalid JSON payload' } },
    }
  }

  const fallbackMessage = normalizeMessagePayload(interaction)
  if (!signature || !timestamp) {
    if (fallbackMessage) {
      const actor = fallbackMessage.author
      if (!actor || actor.bot) {
        return { shouldProcess: false }
      }

      const bodyText = fallbackMessage.content?.trim() ?? ''
      const attachments = collectDiscordAttachments(fallbackMessage.attachments)
      if (!bodyText && attachments.length === 0) {
        return { shouldProcess: false }
      }

      const threadId = fallbackMessage.thread_id
      const guildId = fallbackMessage.guild_id ?? 'dm'
      const channelId = fallbackMessage.channel_id ?? 'unknown'
      const actorName =
        fallbackMessage.author?.global_name ?? fallbackMessage.author?.username ?? 'Unknown'
      const resolvedBodyText = bodyText || `Attachment from ${actorName}`
      const sessionKey = threadId
        ? `discord:${guildId}:${channelId}:thread:${threadId}`
        : `discord:${guildId}:${channelId}`
      const sourceRef = threadId
        ? `discord:${guildId}:${channelId}:thread:${threadId}:${fallbackMessage.id}`
        : `discord:${guildId}:${channelId}:${fallbackMessage.id}`

      const responseContext = makeDiscordResponseContext(fallbackMessage)

      return {
        shouldProcess: true,
        webhookResponse: { status: 200, body: {} },
        workItem: {
          session_key: sessionKey,
          source: 'discord',
          source_ref: sourceRef,
          title: truncate(resolvedBodyText, 100),
          payload: JSON.stringify({
            body: resolvedBodyText,
            source: 'discord',
            actor: {
              kind: 'human',
              externalId: actor.id,
              handle: actor.username,
              displayName: actorName,
              source: 'discord',
            },
            guildId: fallbackMessage.guild_id,
            channelId,
            messageId: fallbackMessage.id,
            ...(threadId ? { threadId } : {}),
            senderId: actor.id,
            senderUsername: actor.username,
            senderName: actorName,
            timestamp: toIsoTimestamp(fallbackMessage),
            ...(fallbackMessage.message_reference?.message_id
              ? { replyToMessageId: fallbackMessage.message_reference.message_id }
              : {}),
            ...(attachments.length > 0 ? { attachments } : {}),
          }),
          status: 'NEW',
        },
        responseContext,
      }
    }

    return {
      shouldProcess: false,
      webhookResponse: { status: 401, body: { error: 'Missing Discord signature headers' } },
    }
  }

  if (!verifyDiscordSignature(rawBody, signature, timestamp, config.publicKey)) {
    return {
      shouldProcess: false,
      webhookResponse: { status: 401, body: { error: 'Invalid Discord request signature' } },
    }
  }

  if (interaction.type === DISCORD_INTERACTION_TYPE.PING) {
    return {
      shouldProcess: false,
      webhookResponse: {
        status: 200,
        body: { type: 1 },
      },
    }
  }

  if (interaction.type === DISCORD_INTERACTION_TYPE.MESSAGE_COMPONENT) {
    return {
      shouldProcess: false,
      webhookResponse: {
        status: 200,
        body: { type: 6 },
      },
    }
  }

  if (interaction.type !== DISCORD_INTERACTION_TYPE.APPLICATION_COMMAND) {
    return {
      shouldProcess: false,
      webhookResponse: {
        status: 200,
        body: {
          type: 4,
          data: {
            content: 'Unsupported interaction type.',
            flags: 64,
          },
        },
      },
    }
  }

  const user = interaction.member?.user ?? interaction.user
  const senderName = interaction.member?.nick ?? user?.global_name ?? user?.username ?? 'Unknown'
  const guildId = interaction.guild_id ?? 'dm'
  const channelId = interaction.channel_id ?? 'unknown'
  const commandName = interaction.data?.name ?? 'command'
  const commandText = extractCommandText(interaction.data)
  const bodyText = commandText || `/${commandName}`

  const responseContext: DiscordResponseContext = {
    applicationId: interaction.application_id || config.applicationId,
    interactionId: interaction.id,
    interactionToken: interaction.token,
    guildId: interaction.guild_id,
    channelId: interaction.channel_id,
  }

  return {
    shouldProcess: true,
    webhookResponse: {
      status: 200,
      body: { type: 5 },
    },
    workItem: {
      session_key: `discord:${guildId}:${channelId}`,
      source: 'discord',
      source_ref: `discord:${guildId}:${channelId}:${interaction.id}`,
      title: truncate(bodyText, 100),
      payload: JSON.stringify({
        body: bodyText,
        source: 'discord',
        actor: {
          kind: 'human',
          externalId: user?.id,
          handle: user?.username,
          displayName: senderName,
          source: 'discord',
        },
        guildId: interaction.guild_id,
        channelId: interaction.channel_id,
        interactionId: interaction.id,
        commandName,
        commandId: interaction.data?.id,
        senderId: user?.id,
        senderUsername: user?.username,
        senderName,
        timestamp: Math.floor(Date.now() / 1000),
      }),
      status: 'NEW',
    },
    idempotencyKey: `discord:${interaction.id}`,
    responseContext,
  }
}
