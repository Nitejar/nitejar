import type Anthropic from '@anthropic-ai/sdk'
import {
  decryptConfig,
  findPluginInstanceById,
  getAgentPluginInstanceAssignment,
} from '@nitejar/database'
import {
  createSlackClient,
  slackHandler,
  SlackApiError,
  type SlackActionKey,
  type SlackAssignmentPolicy,
  type SlackChannel,
  type SlackChannelType,
  type SlackConfig,
  type SlackMessage,
  type SlackMessagePage,
  type SlackResponseContext,
  type SlackWorkspaceSearchResult,
} from '@nitejar/plugin-handlers'
import type { ToolHandler } from '../tools/types'
import { registerIntegrationProvider } from './registry'

const SLACK_PLATFORM_PROMPT = `Platform: Slack
You are replying in Slack. Your main final response is delivered automatically by the runtime.

Slack behavior rules:
- Reply in-thread unless explicitly asked to post elsewhere.
- Keep messages concise and readable in channel context.
- Use Slack mrkdwn-compatible formatting.
- Mention users with <@USER_ID> when needed.
- Use Slack retrieval/search tools before summarizing long thread or channel history.
- Avoid dumping long logs; summarize key findings with timestamps and authors.`

const SLACK_CHANNEL_TYPES = ['public_channel', 'private_channel', 'mpim', 'im'] as const
const MAX_TOOL_LINES = 50
const MAX_TEXT_CHARS = 350
const UNSUPPORTED_SLACK_TOKEN_CODES = new Set([
  'not_allowed_token_type',
  'token_type_not_allowed',
  'missing_scope',
  'invalid_auth',
  'account_inactive',
  'trigger_id_required',
])

const slackGetThreadDefinition: Anthropic.Tool = {
  name: 'slack_get_thread',
  description: 'Read recent messages from a Slack thread with optional pagination/time windows.',
  input_schema: {
    type: 'object' as const,
    properties: {
      channel: {
        type: 'string',
        description: 'Slack channel ID. Defaults to current channel when available.',
      },
      thread_ts: {
        type: 'string',
        description: 'Slack thread timestamp. Defaults to current thread when available.',
      },
      limit: {
        type: 'integer',
        description: 'Maximum messages to return (default 30, max 100).',
      },
      cursor: {
        type: 'string',
        description: 'Pagination cursor from a prior result page.',
      },
      oldest: {
        type: 'string',
        description: 'Only include messages newer than this Slack ts.',
      },
      latest: {
        type: 'string',
        description: 'Only include messages older than this Slack ts.',
      },
    },
  },
}

const slackGetChannelHistoryDefinition: Anthropic.Tool = {
  name: 'slack_get_channel_history',
  description: 'Read recent messages from a Slack channel with pagination/time windows.',
  input_schema: {
    type: 'object' as const,
    properties: {
      channel: {
        type: 'string',
        description: 'Slack channel ID. Defaults to current channel when available.',
      },
      limit: {
        type: 'integer',
        description: 'Maximum messages to return (default 20, max 100).',
      },
      cursor: {
        type: 'string',
        description: 'Pagination cursor from a prior result page.',
      },
      oldest: {
        type: 'string',
        description: 'Only include messages newer than this Slack ts.',
      },
      latest: {
        type: 'string',
        description: 'Only include messages older than this Slack ts.',
      },
    },
  },
}

const slackListChannelsDefinition: Anthropic.Tool = {
  name: 'slack_list_channels',
  description: 'List Slack conversations the bot can currently access.',
  input_schema: {
    type: 'object' as const,
    properties: {
      limit: {
        type: 'integer',
        description: 'Maximum channels to return (default 25, max 100).',
      },
      cursor: {
        type: 'string',
        description: 'Pagination cursor from a prior result page.',
      },
      types: {
        type: 'array',
        items: {
          type: 'string',
          enum: [...SLACK_CHANNEL_TYPES],
        },
        description: 'Restrict channel types (public_channel, private_channel, mpim, im).',
      },
    },
  },
}

const slackSearchChannelMessagesDefinition: Anthropic.Tool = {
  name: 'slack_search_channel_messages',
  description: 'Search for keyword matches within a Slack channel using bounded history scanning.',
  input_schema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'Keyword query to match in message text.',
      },
      channel: {
        type: 'string',
        description: 'Slack channel ID. Defaults to current channel when available.',
      },
      limit: {
        type: 'integer',
        description: 'Maximum matched messages to return (default 20, max 100).',
      },
      scan_limit: {
        type: 'integer',
        description: 'Maximum messages to scan from channel history page (default 200, max 1000).',
      },
      cursor: {
        type: 'string',
        description: 'Pagination cursor from a prior result page.',
      },
      oldest: {
        type: 'string',
        description: 'Only scan messages newer than this Slack ts.',
      },
      latest: {
        type: 'string',
        description: 'Only scan messages older than this Slack ts.',
      },
    },
    required: ['query'],
  },
}

const slackGetChannelInfoDefinition: Anthropic.Tool = {
  name: 'slack_get_channel_info',
  description: 'Get metadata about a Slack channel (name, topic, purpose, type, member count).',
  input_schema: {
    type: 'object' as const,
    properties: {
      channel: {
        type: 'string',
        description: 'Slack channel ID. Defaults to current channel when available.',
      },
    },
  },
}

const slackSearchWorkspaceContextDefinition: Anthropic.Tool = {
  name: 'slack_search_workspace_context',
  description:
    'Search workspace context via Slack assistant.search.context when an action token is available in current context.',
  input_schema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'Search query text.',
      },
      limit: {
        type: 'integer',
        description: 'Maximum matches to return (default 10, max 50).',
      },
      cursor: {
        type: 'string',
        description: 'Pagination cursor from a prior result page.',
      },
      channel_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional channel IDs to constrain search scope.',
      },
    },
    required: ['query'],
  },
}

const slackExportResponseDefinition: Anthropic.Tool = {
  name: 'slack_export_response',
  description:
    'Export structured response data for a Slack trigger via responses.export. Best-effort read tool for workflow/trigger outputs.',
  input_schema: {
    type: 'object' as const,
    properties: {
      trigger_id: {
        type: 'string',
        description: 'Slack trigger ID to export response data for.',
      },
    },
    required: ['trigger_id'],
  },
}

async function resolveSlackConfig(
  pluginInstanceId: string
): Promise<
  | { config: SlackConfig & { botToken: string }; error?: undefined }
  | { config?: undefined; error: string }
> {
  const pluginInstance = await findPluginInstanceById(pluginInstanceId)
  if (!pluginInstance || pluginInstance.type !== 'slack') {
    return { error: 'Slack plugin instance not found.' }
  }
  if (!pluginInstance.config) {
    return { error: 'Slack plugin instance has no config.' }
  }

  let parsed: SlackConfig
  try {
    parsed =
      typeof pluginInstance.config === 'string'
        ? (JSON.parse(pluginInstance.config) as SlackConfig)
        : (pluginInstance.config as SlackConfig)
  } catch {
    return { error: 'Failed to parse Slack config.' }
  }

  const decrypted = decryptConfig(
    parsed as unknown as Record<string, unknown>,
    Array.from(slackHandler.sensitiveFields)
  ) as unknown as SlackConfig

  if (!decrypted.botToken) {
    return { error: 'Slack bot token not configured.' }
  }

  return { config: { ...decrypted, botToken: decrypted.botToken } }
}

interface SlackRuntimeContext extends SlackResponseContext {
  channelType?: string
  teamId?: string
  eventType?: string
  actionToken?: string
}

function normalizeSlackAssignmentPolicy(raw: string | null): {
  mode: 'allow_all' | 'allow_list'
  allowedActions: Set<SlackActionKey>
} {
  if (!raw) {
    return {
      mode: 'allow_all',
      allowedActions: new Set<SlackActionKey>(),
    }
  }

  try {
    const parsed = JSON.parse(raw) as SlackAssignmentPolicy
    const mode = parsed.mode === 'allow_list' ? 'allow_list' : 'allow_all'
    const allowedActions = new Set<SlackActionKey>(
      Array.isArray(parsed.allowedActions)
        ? parsed.allowedActions.filter(
            (value): value is SlackActionKey => typeof value === 'string'
          )
        : []
    )

    return { mode, allowedActions }
  } catch {
    return {
      mode: 'allow_all',
      allowedActions: new Set<SlackActionKey>(),
    }
  }
}

async function denyIfSlackActionBlocked(
  context: Parameters<ToolHandler>[1],
  action: SlackActionKey
): Promise<{ blocked: boolean; error?: string }> {
  if (!context.agentId || !context.pluginInstanceId) {
    return { blocked: false }
  }

  const assignment = await getAgentPluginInstanceAssignment({
    pluginInstanceId: context.pluginInstanceId,
    agentId: context.agentId,
  })
  const policy = normalizeSlackAssignmentPolicy(assignment?.policy_json ?? null)
  if (policy.mode !== 'allow_list') {
    return { blocked: false }
  }

  if (policy.allowedActions.has(action)) {
    return { blocked: false }
  }

  return {
    blocked: true,
    error: `Slack action "${action}" is disabled by this agent-plugin assignment policy. Ask an admin to allow it in plugin assignment settings.`,
  }
}

function parseResponseContext(raw: unknown): SlackRuntimeContext | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  if (
    typeof record.channel !== 'string' ||
    typeof record.threadTs !== 'string' ||
    typeof record.messageTs !== 'string'
  ) {
    return null
  }

  return {
    channel: record.channel,
    threadTs: record.threadTs,
    messageTs: record.messageTs,
    ...(typeof record.channelType === 'string' ? { channelType: record.channelType } : {}),
    ...(typeof record.teamId === 'string' ? { teamId: record.teamId } : {}),
    ...(typeof record.eventType === 'string' ? { eventType: record.eventType } : {}),
    ...(typeof record.actionToken === 'string' ? { actionToken: record.actionToken } : {}),
  }
}

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return fallback
  return Math.max(min, Math.min(max, raw))
}

function asSlackTs(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : undefined
}

function asCursor(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : undefined
}

function formatSlackTimestamp(ts: string): string {
  const millis = Number.parseFloat(ts) * 1000
  if (!Number.isFinite(millis)) return ts
  return new Date(millis).toISOString()
}

function truncateText(input: string, max = MAX_TEXT_CHARS): string {
  if (input.length <= max) return input
  return `${input.slice(0, max - 1)}…`
}

function messageLine(message: SlackMessage): string {
  const who = message.user ?? message.bot_id ?? 'unknown'
  const text = truncateText(message.text?.trim() || '[no text]')
  return `[${formatSlackTimestamp(message.ts)}] ${who}: ${text}`
}

function formatMessagePage(label: string, page: SlackMessagePage, requestedLimit: number): string {
  const lineLimit = Math.min(MAX_TOOL_LINES, requestedLimit)
  const visible = page.items.slice(0, lineLimit)
  const lines = visible.map(messageLine)

  const meta = {
    type: label,
    returned: page.items.length,
    displayed: visible.length,
    has_more: page.hasMore,
    next_cursor: page.nextCursor ?? null,
    scanned_count: page.scannedCount ?? null,
    matched_count: page.matchedCount ?? null,
  }

  if (lines.length === 0) {
    return `meta=${JSON.stringify(meta)}\n(no messages)`
  }

  const suffix =
    page.items.length > visible.length
      ? `\n... ${page.items.length - visible.length} more omitted`
      : ''
  return `meta=${JSON.stringify(meta)}\n${lines.join('\n')}${suffix}`
}

function channelTypeLabel(channel: SlackChannel): string {
  if (channel.is_im) return 'im'
  if (channel.is_mpim) return 'mpim'
  if (channel.is_private || channel.is_group) return 'private'
  return 'public'
}

function formatChannelsPage(page: {
  items: SlackChannel[]
  nextCursor?: string
  hasMore: boolean
}): string {
  const visible = page.items.slice(0, MAX_TOOL_LINES)
  const lines = visible.map((channel) => {
    const name = channel.name?.trim() || '(unnamed)'
    const type = channelTypeLabel(channel)
    const member = channel.is_member === true ? ' member' : ''
    return `${channel.id} | ${name} | ${type}${member}`
  })

  const meta = {
    type: 'channels',
    returned: page.items.length,
    displayed: visible.length,
    has_more: page.hasMore,
    next_cursor: page.nextCursor ?? null,
  }

  if (lines.length === 0) {
    return `meta=${JSON.stringify(meta)}\n(no channels)`
  }

  const suffix =
    page.items.length > visible.length
      ? `\n... ${page.items.length - visible.length} more omitted`
      : ''
  return `meta=${JSON.stringify(meta)}\n${lines.join('\n')}${suffix}`
}

function formatWorkspaceSearchResult(result: SlackWorkspaceSearchResult): string {
  const visible = result.matches.slice(0, MAX_TOOL_LINES)
  const lines = visible.map((match) => {
    const channel = match.channel ?? 'unknown-channel'
    const ts = match.ts ? formatSlackTimestamp(match.ts) : 'unknown-time'
    const who = match.user ?? 'unknown'
    const text = truncateText(match.text?.trim() || '[no text]')
    return `[${ts}] ${channel} ${who}: ${text}`
  })

  const meta = {
    type: 'workspace_context_search',
    query: result.query,
    total: result.total ?? null,
    returned: result.matches.length,
    displayed: visible.length,
    next_cursor: result.nextCursor ?? null,
  }

  if (lines.length === 0) {
    return `meta=${JSON.stringify(meta)}\n(no matches)`
  }

  const suffix =
    result.matches.length > visible.length
      ? `\n... ${result.matches.length - visible.length} more omitted`
      : ''
  return `meta=${JSON.stringify(meta)}\n${lines.join('\n')}${suffix}`
}

function formatResponseExportResult(result: {
  triggerId: string
  payload: Record<string, unknown>
}): string {
  return `meta=${JSON.stringify({ type: 'response_export', trigger_id: result.triggerId })}\n${JSON.stringify(
    result.payload,
    null,
    2
  )}`
}

const slackGetThreadHandler: ToolHandler = async (input, context) => {
  if (!context.pluginInstanceId) {
    return { success: false, error: 'No plugin instance context available.' }
  }

  const resolved = await resolveSlackConfig(context.pluginInstanceId)
  if (!resolved.config) {
    return { success: false, error: resolved.error ?? 'Failed to resolve Slack config.' }
  }
  const gate = await denyIfSlackActionBlocked(context, 'read_thread')
  if (gate.blocked) {
    return { success: false, error: gate.error ?? 'Slack action blocked by assignment policy.' }
  }

  const responseContext = parseResponseContext(context.responseContext)
  const channel = typeof input.channel === 'string' ? input.channel : responseContext?.channel
  const threadTs =
    typeof input.thread_ts === 'string' ? input.thread_ts : (responseContext?.threadTs ?? undefined)

  if (!channel || !threadTs) {
    return { success: false, error: 'channel and thread_ts are required.' }
  }

  const requestedLimit = clampInt(input.limit, 30, 1, 100)
  const client = createSlackClient({ botToken: resolved.config.botToken })
  const page = await client.getThread(channel, threadTs, {
    limit: requestedLimit,
    cursor: asCursor(input.cursor),
    oldest: asSlackTs(input.oldest),
    latest: asSlackTs(input.latest),
  })

  return {
    success: true,
    output: formatMessagePage('thread_messages', page, requestedLimit),
  }
}

const slackGetChannelHistoryHandler: ToolHandler = async (input, context) => {
  if (!context.pluginInstanceId) {
    return { success: false, error: 'No plugin instance context available.' }
  }

  const resolved = await resolveSlackConfig(context.pluginInstanceId)
  if (!resolved.config) {
    return { success: false, error: resolved.error ?? 'Failed to resolve Slack config.' }
  }
  const gate = await denyIfSlackActionBlocked(context, 'read_channel_history')
  if (gate.blocked) {
    return { success: false, error: gate.error ?? 'Slack action blocked by assignment policy.' }
  }

  const responseContext = parseResponseContext(context.responseContext)
  const channel = typeof input.channel === 'string' ? input.channel : responseContext?.channel
  if (!channel) {
    return { success: false, error: 'channel is required.' }
  }

  const requestedLimit = clampInt(input.limit, 20, 1, 100)
  const client = createSlackClient({ botToken: resolved.config.botToken })
  const page = await client.getHistory(channel, {
    limit: requestedLimit,
    cursor: asCursor(input.cursor),
    oldest: asSlackTs(input.oldest),
    latest: asSlackTs(input.latest),
  })

  return {
    success: true,
    output: formatMessagePage('channel_history', page, requestedLimit),
  }
}

const slackListChannelsHandler: ToolHandler = async (input, context) => {
  if (!context.pluginInstanceId) {
    return { success: false, error: 'No plugin instance context available.' }
  }

  const resolved = await resolveSlackConfig(context.pluginInstanceId)
  if (!resolved.config) {
    return { success: false, error: resolved.error ?? 'Failed to resolve Slack config.' }
  }
  const gate = await denyIfSlackActionBlocked(context, 'list_channels')
  if (gate.blocked) {
    return { success: false, error: gate.error ?? 'Slack action blocked by assignment policy.' }
  }

  let types: SlackChannelType[] | undefined
  if (Array.isArray(input.types)) {
    types = input.types
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter((value): value is SlackChannelType =>
        (SLACK_CHANNEL_TYPES as readonly string[]).includes(value)
      )
  }

  const client = createSlackClient({ botToken: resolved.config.botToken })
  const page = await client.listChannels({
    limit: clampInt(input.limit, 25, 1, 100),
    cursor: asCursor(input.cursor),
    ...(types && types.length > 0 ? { types } : {}),
  })

  return { success: true, output: formatChannelsPage(page) }
}

const slackSearchChannelMessagesHandler: ToolHandler = async (input, context) => {
  if (!context.pluginInstanceId) {
    return { success: false, error: 'No plugin instance context available.' }
  }

  const query = typeof input.query === 'string' ? input.query.trim() : ''
  if (!query) {
    return { success: false, error: 'query is required.' }
  }

  const resolved = await resolveSlackConfig(context.pluginInstanceId)
  if (!resolved.config) {
    return { success: false, error: resolved.error ?? 'Failed to resolve Slack config.' }
  }
  const gate = await denyIfSlackActionBlocked(context, 'search_channel_messages')
  if (gate.blocked) {
    return { success: false, error: gate.error ?? 'Slack action blocked by assignment policy.' }
  }

  const responseContext = parseResponseContext(context.responseContext)
  const channel = typeof input.channel === 'string' ? input.channel : responseContext?.channel
  if (!channel) {
    return { success: false, error: 'channel is required.' }
  }

  const requestedLimit = clampInt(input.limit, 20, 1, 100)
  const client = createSlackClient({ botToken: resolved.config.botToken })
  const page = await client.searchInChannel(channel, query, {
    limit: requestedLimit,
    scanLimit: clampInt(input.scan_limit, 200, 1, 1000),
    cursor: asCursor(input.cursor),
    oldest: asSlackTs(input.oldest),
    latest: asSlackTs(input.latest),
  })

  return {
    success: true,
    output: formatMessagePage('channel_search', page, requestedLimit),
  }
}

const slackGetChannelInfoHandler: ToolHandler = async (input, context) => {
  if (!context.pluginInstanceId) {
    return { success: false, error: 'No plugin instance context available.' }
  }

  const resolved = await resolveSlackConfig(context.pluginInstanceId)
  if (!resolved.config) {
    return { success: false, error: resolved.error ?? 'Failed to resolve Slack config.' }
  }
  const gate = await denyIfSlackActionBlocked(context, 'read_channel_info')
  if (gate.blocked) {
    return { success: false, error: gate.error ?? 'Slack action blocked by assignment policy.' }
  }

  const responseContext = parseResponseContext(context.responseContext)
  const channel = typeof input.channel === 'string' ? input.channel : responseContext?.channel
  if (!channel) {
    return { success: false, error: 'channel is required.' }
  }

  const client = createSlackClient({ botToken: resolved.config.botToken })
  const info = await client.getChannelInfo(channel)
  if (!info) {
    return { success: false, error: `Could not retrieve info for channel ${channel}.` }
  }

  const type = channelTypeLabel(info)
  const lines = [
    `id: ${info.id}`,
    `name: ${info.name ?? '(unnamed)'}`,
    `type: ${type}`,
    ...(info.topic?.value ? [`topic: ${truncateText(info.topic.value)}`] : []),
    ...(info.purpose?.value ? [`purpose: ${truncateText(info.purpose.value)}`] : []),
    ...(typeof info.num_members === 'number' ? [`members: ${info.num_members}`] : []),
    ...(info.is_member === true ? ['bot_is_member: true'] : ['bot_is_member: false']),
  ]

  return { success: true, output: lines.join('\n') }
}

const slackSearchWorkspaceContextHandler: ToolHandler = async (input, context) => {
  if (!context.pluginInstanceId) {
    return { success: false, error: 'No plugin instance context available.' }
  }

  const query = typeof input.query === 'string' ? input.query.trim() : ''
  if (!query) {
    return { success: false, error: 'query is required.' }
  }

  const resolved = await resolveSlackConfig(context.pluginInstanceId)
  if (!resolved.config) {
    return { success: false, error: resolved.error ?? 'Failed to resolve Slack config.' }
  }
  const gate = await denyIfSlackActionBlocked(context, 'search_workspace_context')
  if (gate.blocked) {
    return { success: false, error: gate.error ?? 'Slack action blocked by assignment policy.' }
  }

  const responseContext = parseResponseContext(context.responseContext)
  const actionToken = responseContext?.actionToken?.trim()
  if (!actionToken) {
    return {
      success: true,
      output:
        'Slack workspace context search is unavailable in this message context (no action token). Use slack_search_channel_messages or slack_get_channel_history instead.',
    }
  }

  const channelIds = Array.isArray(input.channel_ids)
    ? input.channel_ids
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    : undefined

  try {
    const client = createSlackClient({ botToken: resolved.config.botToken })
    const result = await client.searchWorkspaceContext(query, {
      limit: clampInt(input.limit, 10, 1, 50),
      cursor: asCursor(input.cursor),
      actionToken,
      ...(channelIds && channelIds.length > 0 ? { channelIds } : {}),
    })

    return {
      success: true,
      output: formatWorkspaceSearchResult(result),
    }
  } catch (error) {
    if (error instanceof SlackApiError && error.code === 'action_token_required') {
      return {
        success: true,
        output:
          'Slack workspace context search requires an action token from Slack context. Use slack_search_channel_messages instead for bot-token searches.',
      }
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

const slackExportResponseHandler: ToolHandler = async (input, context) => {
  if (!context.pluginInstanceId) {
    return { success: false, error: 'No plugin instance context available.' }
  }

  const triggerId = typeof input.trigger_id === 'string' ? input.trigger_id.trim() : ''
  if (!triggerId) {
    return { success: false, error: 'trigger_id is required.' }
  }

  const resolved = await resolveSlackConfig(context.pluginInstanceId)
  if (!resolved.config) {
    return { success: false, error: resolved.error ?? 'Failed to resolve Slack config.' }
  }
  const gate = await denyIfSlackActionBlocked(context, 'export_response')
  if (gate.blocked) {
    return { success: false, error: gate.error ?? 'Slack action blocked by assignment policy.' }
  }

  try {
    const client = createSlackClient({ botToken: resolved.config.botToken })
    const result = await client.exportResponse(triggerId)
    return {
      success: true,
      output: formatResponseExportResult(result),
    }
  } catch (error) {
    if (
      error instanceof SlackApiError &&
      typeof error.code === 'string' &&
      UNSUPPORTED_SLACK_TOKEN_CODES.has(error.code)
    ) {
      return {
        success: true,
        output:
          `responses.export is unavailable for this Slack token/context (${error.code}). ` +
          'This is a capability constraint, not a model failure. Use a token with required Slack scope/token type and retry.',
      }
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

registerIntegrationProvider({
  integrationType: 'slack',
  toolDefinitions: [
    slackGetThreadDefinition,
    slackGetChannelHistoryDefinition,
    slackGetChannelInfoDefinition,
    slackListChannelsDefinition,
    slackSearchChannelMessagesDefinition,
    slackSearchWorkspaceContextDefinition,
    slackExportResponseDefinition,
  ],
  toolHandlers: {
    slack_get_thread: slackGetThreadHandler,
    slack_get_channel_history: slackGetChannelHistoryHandler,
    slack_get_channel_info: slackGetChannelInfoHandler,
    slack_list_channels: slackListChannelsHandler,
    slack_search_channel_messages: slackSearchChannelMessagesHandler,
    slack_search_workspace_context: slackSearchWorkspaceContextHandler,
    slack_export_response: slackExportResponseHandler,
  },
  getSystemPromptSections: () =>
    Promise.resolve([
      {
        id: 'slack:platform',
        content: SLACK_PLATFORM_PROMPT,
        priority: 5,
      },
    ]),
})
