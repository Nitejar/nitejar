import type { PluginInstanceRecord } from '@nitejar/database'
import { createSlackClient, verifySlackRequest, type SlackClient } from '@nitejar/connectors-slack'
import type {
  SlackEventEnvelope,
  SlackMessageEvent,
  SlackUrlVerificationPayload,
} from '@nitejar/connectors-slack'
import type { WebhookParseResult } from '../types'
import { parseSlackConfig } from './config'
import type { SlackConfig, SlackResponseContext } from './types'

const DEFAULT_POLICY: SlackConfig['inboundPolicy'] = 'mentions'
const SLACK_LOOKUP_TTL_SECONDS = 300
const slackUserIdentityCache = new Map<
  string,
  { identity: { displayName: string | null; username: string | null }; expiresAt: number }
>()
const slackChannelNameCache = new Map<string, { name: string | null; expiresAt: number }>()

function truncate(input: string, maxLength: number): string {
  if (input.length <= maxLength) return input
  return `${input.slice(0, maxLength - 1)}…`
}

function parseBody(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody) as unknown
  } catch {
    return null
  }
}

function normalizeUserFacingText(value: unknown, userId: string): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (!normalized) return null
  if (normalized === userId) return null
  if (/^U[A-Z0-9]{6,}$/i.test(normalized)) return null
  return normalized
}

async function resolveSlackSenderIdentity(
  client: SlackClient | null,
  userId: string | undefined
): Promise<{ displayName: string | null; username: string | null }> {
  if (!client || !userId) {
    return { displayName: null, username: null }
  }

  const now = Math.floor(Date.now() / 1000)
  const cached = slackUserIdentityCache.get(userId)
  if (cached && cached.expiresAt > now) {
    return cached.identity
  }

  try {
    const user = await client.getUserInfo(userId)
    if (!user) {
      return { displayName: null, username: null }
    }
    const profile =
      user.profile && typeof user.profile === 'object'
        ? (user.profile as Record<string, unknown>)
        : undefined

    const username = normalizeUserFacingText(user.name, userId)
    const displayName =
      normalizeUserFacingText(profile?.display_name_normalized, userId) ??
      normalizeUserFacingText(profile?.real_name_normalized, userId) ??
      normalizeUserFacingText(profile?.display_name, userId) ??
      normalizeUserFacingText(profile?.real_name, userId) ??
      normalizeUserFacingText(user.real_name, userId)

    const identity = { displayName, username }
    slackUserIdentityCache.set(userId, {
      identity,
      expiresAt: now + SLACK_LOOKUP_TTL_SECONDS,
    })
    return identity
  } catch {
    return { displayName: null, username: null }
  }
}

async function resolveSlackChannelName(
  client: SlackClient | null,
  channelId: string | undefined
): Promise<string | null> {
  if (!client || !channelId) return null

  const now = Math.floor(Date.now() / 1000)
  const cached = slackChannelNameCache.get(channelId)
  if (cached && cached.expiresAt > now) {
    return cached.name
  }

  try {
    const channel = await client.getChannelInfo(channelId)
    if (!channel) {
      slackChannelNameCache.set(channelId, {
        name: null,
        expiresAt: now + SLACK_LOOKUP_TTL_SECONDS,
      })
      return null
    }

    const name = typeof channel.name === 'string' ? channel.name : null

    slackChannelNameCache.set(channelId, { name, expiresAt: now + SLACK_LOOKUP_TTL_SECONDS })
    return name
  } catch {
    return null
  }
}

/**
 * Replace `<@USER_ID>` mentions in text with resolved display names.
 * Uses the same user identity cache as sender resolution.
 */
async function resolveUserMentions(client: SlackClient | null, text: string): Promise<string> {
  if (!client) return text
  const mentionPattern = /<@(U[A-Z0-9]+)>/g
  const matches = [...text.matchAll(mentionPattern)]
  if (matches.length === 0) return text

  // Resolve all unique user IDs in parallel
  const uniqueIds = [...new Set(matches.map((m) => m[1]))]
  const identities = await Promise.all(
    uniqueIds.map(async (userId) => {
      const identity = await resolveSlackSenderIdentity(client, userId)
      return { userId, name: identity.displayName ?? identity.username }
    })
  )

  let resolved = text
  for (const { userId, name } of identities) {
    if (name) {
      resolved = resolved.replaceAll(`<@${userId}>`, `@${name}`)
    }
  }
  return resolved
}

function isUrlVerification(payload: unknown): payload is SlackUrlVerificationPayload {
  if (!payload || typeof payload !== 'object') return false
  const record = payload as Record<string, unknown>
  return record.type === 'url_verification' && typeof record.challenge === 'string'
}

function isMessageEvent(event: unknown): event is SlackMessageEvent {
  if (!event || typeof event !== 'object') return false
  const record = event as Record<string, unknown>
  if (record.type !== 'message' && record.type !== 'app_mention') return false
  if (typeof record.channel !== 'string') return false
  if (typeof record.ts !== 'string') return false
  return true
}

function isEventEnvelope(payload: unknown): payload is SlackEventEnvelope {
  if (!payload || typeof payload !== 'object') return false
  const record = payload as Record<string, unknown>
  if (record.type !== 'event_callback') return false
  if (typeof record.event_id !== 'string') return false
  return isMessageEvent(record.event)
}

function parseCommand(text: string): string | undefined {
  const match = text.match(/^\/(\w+)/)
  return match ? match[1] : undefined
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function hasSlackBotMention(
  text: string,
  event: SlackMessageEvent,
  botUserId: string | undefined
): boolean {
  if (botUserId) {
    const pattern = new RegExp(`<@${escapeRegExp(botUserId)}(?:\\|[^>]+)?>`, 'i')
    return pattern.test(text)
  }
  return event.type === 'app_mention'
}

function stripLeadingSlackBotMention(text: string, botUserId: string | undefined): string {
  const original = text.trim()
  if (!original) return original

  const mentionPrefix = /^<@([A-Z0-9]+)(?:\|[^>]+)?>[\s,.:;!?-]*/i
  let normalized = original
  let stripped = false

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const match = normalized.match(mentionPrefix)
    if (!match) break

    const mentionedUserId = match[1]
    if (!mentionedUserId) break
    if (botUserId && mentionedUserId.toUpperCase() !== botUserId.toUpperCase()) {
      break
    }

    normalized = normalized.slice(match[0].length).trimStart()
    stripped = true

    // Without a known bot ID, only strip one leading mention.
    if (!botUserId) break
  }

  if (!stripped) return original
  return normalized.length > 0 ? normalized : original
}

function shouldIgnoreAsBot(event: SlackMessageEvent, config: SlackConfig): boolean {
  if (event.bot_id) return true
  if (event.subtype === 'bot_message') return true
  if (event.subtype === 'message_changed') return true
  if (event.subtype === 'message_deleted') return true
  if (config.botUserId && event.user === config.botUserId) return true
  return false
}

function passesInboundPolicy(event: SlackMessageEvent, config: SlackConfig, text: string): boolean {
  const policy = config.inboundPolicy ?? DEFAULT_POLICY
  if (policy === 'all') return true

  if (event.channel_type === 'im') return true
  if (event.type === 'app_mention') return true

  if (!config.botUserId) return false

  return text.includes(`<@${config.botUserId}>`)
}

export async function parseSlackWebhook(
  request: Request,
  pluginInstance: PluginInstanceRecord
): Promise<WebhookParseResult> {
  // Slack Event Subscriptions bootstrap sends a URL verification challenge.
  // Responding with the challenge token is required before full secret-based
  // webhook verification can succeed.
  const rawBody = await request.text()
  const bootstrapPayload = parseBody(rawBody)
  if (isUrlVerification(bootstrapPayload)) {
    return {
      shouldProcess: false,
      webhookResponse: { status: 200, body: { challenge: bootstrapPayload.challenge } },
    }
  }

  const config = parseSlackConfig(pluginInstance)
  if (!config) {
    console.warn('[slack] Failed to parse Slack plugin instance config')
    return {
      shouldProcess: false,
      ingressReasonCode: 'invalid_config',
      ingressReasonText: 'Failed to parse Slack plugin config.',
    }
  }

  if (!config.signingSecret) {
    return {
      shouldProcess: false,
      ingressReasonCode: 'missing_signing_secret',
      ingressReasonText: 'Slack signing secret is required for request verification.',
    }
  }

  const signature = request.headers.get('x-slack-signature') ?? ''
  const timestamp = request.headers.get('x-slack-request-timestamp') ?? ''

  if (!verifySlackRequest(rawBody, signature, timestamp, config.signingSecret)) {
    console.warn('[slack] Webhook signature verification failed')
    return {
      shouldProcess: false,
      ingressReasonCode: 'invalid_signature',
      ingressReasonText: 'Slack signature verification failed.',
    }
  }

  const payload = parseBody(rawBody)
  if (!payload) {
    console.warn('[slack] Failed to parse webhook JSON')
    return {
      shouldProcess: false,
      ingressReasonCode: 'invalid_json',
      ingressReasonText: 'Failed to parse webhook JSON body.',
    }
  }

  if (isUrlVerification(payload)) {
    return {
      shouldProcess: false,
      webhookResponse: { status: 200, body: { challenge: payload.challenge } },
    }
  }

  if (!isEventEnvelope(payload)) {
    return {
      shouldProcess: false,
      ingressReasonCode: 'unsupported_event',
      ingressReasonText: 'Unsupported Slack event envelope.',
    }
  }

  const event = payload.event
  const text = (typeof event.text === 'string' ? event.text : '').trim()
  if (!text) {
    return {
      shouldProcess: false,
      ingressEventId: payload.event_id,
      ingressReasonCode: 'empty_text',
      ingressReasonText: 'Slack message text was empty.',
    }
  }

  if (shouldIgnoreAsBot(event, config)) {
    return {
      shouldProcess: false,
      ingressEventId: payload.event_id,
      ingressReasonCode: 'bot_or_self_message',
      ingressReasonText: 'Ignored bot/self-authored Slack message.',
    }
  }

  if (Array.isArray(config.allowedChannels) && config.allowedChannels.length > 0) {
    if (!config.allowedChannels.includes(event.channel)) {
      return {
        shouldProcess: false,
        ingressEventId: payload.event_id,
        ingressReasonCode: 'disallowed_channel',
        ingressReasonText: `Channel ${event.channel} is not in allowedChannels.`,
      }
    }
  }

  if (!passesInboundPolicy(event, config, text)) {
    return {
      shouldProcess: false,
      ingressEventId: payload.event_id,
      ingressReasonCode: 'inbound_policy_filtered',
      ingressReasonText: 'Slack event did not pass inbound policy.',
    }
  }

  const threadTs = event.thread_ts ?? event.ts
  const commandInputText = stripLeadingSlackBotMention(text, config.botUserId)
  const slackBotMentioned = hasSlackBotMention(text, event, config.botUserId)
  const slackClient = config.botToken ? createSlackClient({ botToken: config.botToken }) : null
  const [senderIdentity, channelName, botIdentity, resolvedText] = await Promise.all([
    resolveSlackSenderIdentity(slackClient, event.user),
    resolveSlackChannelName(slackClient, event.channel),
    resolveSlackSenderIdentity(slackClient, config.botUserId),
    resolveUserMentions(slackClient, text),
  ])
  const senderUsername = senderIdentity.username ?? event.user ?? null
  const senderDisplayName = senderIdentity.displayName ?? senderIdentity.username ?? 'Slack member'
  const actionToken =
    typeof payload.action_token === 'string' && payload.action_token.trim().length > 0
      ? payload.action_token.trim()
      : undefined
  const responseContext: SlackResponseContext = {
    channel: event.channel,
    threadTs,
    messageTs: event.ts,
    ...(event.channel_type ? { channelType: event.channel_type } : {}),
    ...(payload.team_id ? { teamId: payload.team_id } : {}),
    eventType: event.type,
    ...(slackBotMentioned ? { slackBotMentioned: true } : {}),
    ...(actionToken ? { actionToken } : {}),
  }

  const command = parseCommand(commandInputText)
  const teamId =
    typeof payload.team_id === 'string' && payload.team_id.trim().length > 0
      ? payload.team_id.trim()
      : 'unknown'
  const canonicalDedupeKey = `slack:v1:msg:${teamId}:${event.channel}:${event.ts}`
  const aliasDuKey = `slack:event:${payload.event_id}`

  return {
    shouldProcess: true,
    workItem: {
      session_key: `slack:${event.channel}:${threadTs}`,
      source: 'slack',
      source_ref: `slack:${event.channel}:${event.ts}`,
      title: truncate(resolvedText, 120),
      payload: JSON.stringify({
        body: resolvedText,
        source: 'slack',
        senderName: senderDisplayName,
        ...(senderUsername ? { senderUsername } : {}),
        ...(event.user ? { senderId: event.user } : {}),
        actor: {
          kind: 'human',
          ...(senderUsername ? { handle: senderUsername } : {}),
          ...(event.user ? { externalId: event.user } : {}),
          displayName: senderDisplayName,
          source: 'slack',
        },
        channel: event.channel,
        ...(channelName ? { chatName: channelName } : {}),
        chatType: event.channel_type === 'im' ? 'private' : (event.channel_type ?? 'channel'),
        threadTs,
        messageTs: event.ts,
        channelType: event.channel_type,
        teamId: payload.team_id,
        eventType: event.type,
        ...(slackBotMentioned
          ? {
              slackBotMentioned: true,
              ...(config.botUserId ? { slackBotUserId: config.botUserId } : {}),
              ...(botIdentity.displayName ? { slackBotDisplayName: botIdentity.displayName } : {}),
              ...(botIdentity.username ? { slackBotHandle: botIdentity.username } : {}),
            }
          : {}),
        ...(actionToken ? { actionToken } : {}),
      }),
      status: 'NEW',
    },
    idempotencyKey: canonicalDedupeKey,
    idempotencyKeys: [canonicalDedupeKey, aliasDuKey],
    ingressEventId: payload.event_id,
    ingressMeta: {
      teamId,
      channel: event.channel,
      messageTs: event.ts,
      eventType: event.type,
    },
    responseContext,
    command,
  }
}
