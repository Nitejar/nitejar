import type { PluginInstanceRecord } from '@nitejar/database'
import {
  createSlackClient,
  markdownToSlackMrkdwn,
  SlackRateLimitError,
  type SlackClient,
  type SlackUser,
} from '@nitejar/connectors-slack'
import { z } from 'zod'
import type {
  ConfigValidationResult,
  PluginHandler,
  PostResponseResult,
  WebhookParseResult,
} from '../types'
import { parseSlackConfig, validateSlackConfig } from './config'
import { parseSlackWebhook } from './parse-webhook'
import type { SlackConfig, SlackResponseContext } from './types'
import { SLACK_SENSITIVE_FIELDS } from './types'

const connectionConfigSchema = z.object({
  botToken: z.string().min(1),
  signingSecret: z.string().min(1),
})

const SLACK_LOOKUP_TTL_MS = 5 * 60 * 1000
const SLACK_LOOKUP_MAX_PAGES = 5

interface SlackMentionLookup {
  expiresAt: number
  userIdsByHandle: Map<string, string>
  channelIdsByName: Map<string, string>
}

const slackMentionLookupCache = new Map<string, SlackMentionLookup>()

function normalizeHandleCandidate(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const normalized = raw.trim().toLowerCase().replace(/^@+/, '')
  if (!normalized) return null
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(normalized)) return null
  return normalized
}

function normalizeChannelCandidate(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const normalized = raw.trim().toLowerCase().replace(/^#+/, '')
  if (!normalized) return null
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(normalized)) return null
  return normalized
}

function collectUserHandleCandidates(user: SlackUser): string[] {
  return [
    user.name,
    user.real_name,
    user.profile?.display_name,
    user.profile?.display_name_normalized,
    user.profile?.real_name,
    user.profile?.real_name_normalized,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
}

async function buildSlackMentionLookup(
  pluginInstanceId: string,
  client: SlackClient,
  config: SlackConfig
): Promise<SlackMentionLookup> {
  const userIdsByHandle = new Map<string, string>()
  const channelIdsByName = new Map<string, string>()

  let channelCursor: string | undefined
  for (let page = 0; page < SLACK_LOOKUP_MAX_PAGES; page += 1) {
    const channelPage = await client.listChannels({
      limit: 200,
      cursor: channelCursor,
      types: ['public_channel', 'private_channel'],
    })
    for (const channel of channelPage.items) {
      const normalized = normalizeChannelCandidate(channel.name)
      if (!normalized) continue
      if (!channelIdsByName.has(normalized)) {
        channelIdsByName.set(normalized, channel.id)
      }
    }
    if (!channelPage.hasMore || !channelPage.nextCursor) break
    channelCursor = channelPage.nextCursor
  }

  let userCursor: string | undefined
  for (let page = 0; page < SLACK_LOOKUP_MAX_PAGES; page += 1) {
    const userPage = await client.listUsers({
      limit: 200,
      cursor: userCursor,
    })

    for (const user of userPage.items) {
      for (const candidate of collectUserHandleCandidates(user)) {
        const normalized = normalizeHandleCandidate(candidate)
        if (!normalized) continue
        if (!userIdsByHandle.has(normalized)) {
          userIdsByHandle.set(normalized, user.id)
        }
      }
    }

    if (!userPage.hasMore || !userPage.nextCursor) break
    userCursor = userPage.nextCursor
  }

  if (config.botUserId) {
    const botUser = await client.getUserInfo(config.botUserId)
    if (botUser) {
      for (const candidate of collectUserHandleCandidates(botUser)) {
        const normalized = normalizeHandleCandidate(candidate)
        if (!normalized) continue
        if (!userIdsByHandle.has(normalized)) {
          userIdsByHandle.set(normalized, botUser.id)
        }
      }
    }
  }

  const lookup: SlackMentionLookup = {
    expiresAt: Date.now() + SLACK_LOOKUP_TTL_MS,
    userIdsByHandle,
    channelIdsByName,
  }
  slackMentionLookupCache.set(pluginInstanceId, lookup)
  return lookup
}

async function getSlackMentionLookup(
  pluginInstanceId: string,
  client: SlackClient,
  config: SlackConfig
): Promise<SlackMentionLookup> {
  const cached = slackMentionLookupCache.get(pluginInstanceId)
  if (cached && cached.expiresAt > Date.now()) {
    return cached
  }
  return buildSlackMentionLookup(pluginInstanceId, client, config)
}

function protectCodeSegments(text: string): {
  text: string
  codeBlocks: string[]
  inlineCodes: string[]
} {
  const codeBlocks: string[] = []
  const inlineCodes: string[] = []

  let protectedText = text.replace(
    /```([\w-]*)\n([\s\S]*?)```/g,
    (_match, lang: string, body: string) => {
      const label = typeof lang === 'string' && lang.trim().length > 0 ? `${lang.trim()}\n` : ''
      codeBlocks.push(`\`\`\`${label}${body.trimEnd()}\`\`\``)
      return `@@SLOPBOT_SLACK_OUT_CODE_BLOCK_${codeBlocks.length - 1}@@`
    }
  )

  protectedText = protectedText.replace(/`([^`\n]+)`/g, (_match, code: string) => {
    inlineCodes.push(`\`${code}\``)
    return `@@SLOPBOT_SLACK_OUT_INLINE_${inlineCodes.length - 1}@@`
  })

  return { text: protectedText, codeBlocks, inlineCodes }
}

function restoreCodeSegments(text: string, codeBlocks: string[], inlineCodes: string[]): string {
  let restored = text.replace(
    /@@SLOPBOT_SLACK_OUT_CODE_BLOCK_(\d+)@@/g,
    (_match, idx: string) => codeBlocks[Number.parseInt(idx, 10)] ?? ''
  )

  restored = restored.replace(
    /@@SLOPBOT_SLACK_OUT_INLINE_(\d+)@@/g,
    (_match, idx: string) => inlineCodes[Number.parseInt(idx, 10)] ?? ''
  )

  return restored
}

async function normalizeOutboundSlackMentions(
  pluginInstanceId: string,
  client: SlackClient,
  config: SlackConfig,
  mrkdwn: string
): Promise<string> {
  if (!mrkdwn.includes('@') && !mrkdwn.includes('#')) {
    return mrkdwn
  }

  let lookup: SlackMentionLookup
  try {
    lookup = await getSlackMentionLookup(pluginInstanceId, client, config)
  } catch {
    return mrkdwn
  }

  const { text, codeBlocks, inlineCodes } = protectCodeSegments(mrkdwn)

  const mentionBoundary = '(^|[\\s([{"\':])'
  let normalized = text.replace(
    new RegExp(`${mentionBoundary}@(here|channel|everyone)\\b`, 'gi'),
    (_match, prefix: string, keyword: string) => `${prefix}<!${keyword.toLowerCase()}>`
  )

  normalized = normalized.replace(
    new RegExp(`${mentionBoundary}@([a-z0-9][a-z0-9._-]{0,79})\\b`, 'gi'),
    (match, prefix: string, rawHandle: string) => {
      const handle = normalizeHandleCandidate(rawHandle)
      if (!handle) return match
      const userId = lookup.userIdsByHandle.get(handle)
      if (!userId) return match
      return `${prefix}<@${userId}>`
    }
  )

  normalized = normalized.replace(
    new RegExp(`${mentionBoundary}#([a-z0-9][a-z0-9._-]{0,79})\\b`, 'gi'),
    (match, prefix: string, rawChannel: string) => {
      const channel = normalizeChannelCandidate(rawChannel)
      if (!channel) return match
      const channelId = lookup.channelIdsByName.get(channel)
      if (!channelId) return match
      return `${prefix}<#${channelId}|${channel}>`
    }
  )

  return restoreCodeSegments(normalized, codeBlocks, inlineCodes)
}

export const slackHandler: PluginHandler<SlackConfig> = {
  type: 'slack',
  displayName: 'Slack',
  description: 'Receive Slack channel messages and respond in thread context.',
  icon: 'brand-slack',
  category: 'messaging',
  responseMode: 'final',
  sensitiveFields: [...SLACK_SENSITIVE_FIELDS],
  setupConfig: {
    fields: [
      {
        key: 'inboundPolicy',
        label: 'Listen for',
        type: 'select',
        required: false,
        options: [
          { label: 'Mentions only (recommended)', value: 'mentions' },
          { label: 'All messages in allowed channels', value: 'all' },
        ],
      },
    ],
    usesRedirectFlow: true,
    registrationUrl: 'https://api.slack.com/apps?new_app=1',
    credentialHelpUrl: 'https://api.slack.com/apps',
    credentialHelpLabel: 'Create a Slack app',
  },

  validateConfig(config: unknown): ConfigValidationResult {
    return validateSlackConfig(config)
  },

  async parseWebhook(
    request: Request,
    pluginInstance: PluginInstanceRecord
  ): Promise<WebhookParseResult> {
    return parseSlackWebhook(request, pluginInstance)
  },

  async postResponse(
    pluginInstance: PluginInstanceRecord,
    _workItemId: string,
    content: string,
    responseContext?: unknown,
    _options?: { hitLimit?: boolean; idempotencyKey?: string }
  ): Promise<PostResponseResult> {
    const config = parseSlackConfig(pluginInstance)
    if (!config?.botToken) {
      return { success: false, outcome: 'failed', error: 'Slack bot token is not configured' }
    }

    const context = responseContext as SlackResponseContext | undefined
    if (!context?.channel || !context.threadTs) {
      return { success: false, outcome: 'failed', error: 'Missing Slack response context' }
    }

    const client = createSlackClient({ botToken: config.botToken })
    const mrkdwn = markdownToSlackMrkdwn(content)
    const text = await normalizeOutboundSlackMentions(pluginInstance.id, client, config, mrkdwn)

    try {
      const messageTs = await client.postMessage(context.channel, text, {
        threadTs: context.threadTs,
        mrkdwn: true,
      })

      // Remove receipt reaction once we have replied.
      await client.removeReaction(context.channel, context.messageTs, 'eyes').catch(() => {})

      return {
        success: true,
        outcome: 'sent',
        providerRef: `${context.channel}:${messageTs}`,
      }
    } catch (error) {
      if (error instanceof SlackRateLimitError) {
        return {
          success: false,
          outcome: 'failed',
          retryable: true,
          error: error.message,
        }
      }

      return {
        success: false,
        outcome: 'failed',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  },

  async testConnection(config: SlackConfig) {
    const parsed = connectionConfigSchema.safeParse(config)
    if (!parsed.success) {
      return { ok: false, error: parsed.error.errors.map((entry) => entry.message).join(', ') }
    }

    try {
      const client = createSlackClient({ botToken: parsed.data.botToken })
      const auth = await client.authTest()
      const botUserId = auth.user_id
      return {
        ok: true,
        ...(botUserId
          ? {
              configUpdates: {
                botUserId,
              },
            }
          : {}),
      }
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
    const config = parseSlackConfig(pluginInstance)
    if (!config?.botToken) return

    const context = responseContext as SlackResponseContext | undefined
    if (!context?.channel || !context.messageTs) return

    const client = createSlackClient({ botToken: config.botToken })
    await client.addReaction(context.channel, context.messageTs, 'eyes').catch(() => {})
  },

  async dismissReceipt(
    pluginInstance: PluginInstanceRecord,
    responseContext?: unknown
  ): Promise<void> {
    const config = parseSlackConfig(pluginInstance)
    if (!config?.botToken) return

    const context = responseContext as SlackResponseContext | undefined
    if (!context?.channel || !context.messageTs) return

    const client = createSlackClient({ botToken: config.botToken })
    await client.removeReaction(context.channel, context.messageTs, 'eyes').catch(() => {})
  },
}

export { parseSlackWebhook } from './parse-webhook'
export { parseSlackConfig } from './config'
export type {
  SlackActionKey,
  SlackAssignmentPolicy,
  SlackConfig,
  SlackResponseContext,
} from './types'
export {
  createSlackClient,
  SlackApiError,
  markdownToSlackMrkdwn,
  SlackRateLimitError,
  type SlackChannel,
  type SlackChannelType,
  type SlackMessage,
  type SlackMessagePage,
  type SlackWorkspaceSearchResult,
} from '@nitejar/connectors-slack'
