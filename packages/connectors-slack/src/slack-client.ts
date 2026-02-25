import { ErrorCode, WebClient } from '@slack/web-api'
import {
  getChannelInfo,
  getConversationHistory,
  getThreadReplies,
  listConversations,
  searchConversationHistory,
  type GetHistoryOptions,
  type ListChannelsOptions,
  type SearchInChannelOptions,
  type GetThreadOptions,
} from './conversations'
import { postSlackMessage, updateSlackMessage, type PostSlackMessageOptions } from './post-message'
import type {
  SlackApiErrorResponse,
  SlackApiInvoker,
  SlackAuthTestResponse,
  SlackChannelPage,
  SlackMessagePage,
  SlackResponseExportResult,
  SlackUser,
  SlackUserPage,
  SlackWorkspaceSearchResult,
} from './types'

export interface SlackClient {
  postMessage(channel: string, text: string, options?: PostSlackMessageOptions): Promise<string>
  updateMessage(
    channel: string,
    ts: string,
    text: string,
    options?: { mrkdwn?: boolean }
  ): Promise<void>
  getThread(
    channel: string,
    threadTs: string,
    options?: GetThreadOptions
  ): Promise<SlackMessagePage>
  getHistory(channel: string, options?: GetHistoryOptions): Promise<SlackMessagePage>
  listChannels(options?: ListChannelsOptions): Promise<SlackChannelPage>
  searchInChannel(
    channel: string,
    query: string,
    options?: SearchInChannelOptions
  ): Promise<SlackMessagePage>
  searchWorkspaceContext(
    query: string,
    options?: {
      limit?: number
      cursor?: string
      channelIds?: string[]
      actionToken?: string
    }
  ): Promise<SlackWorkspaceSearchResult>
  exportResponse(triggerId: string): Promise<SlackResponseExportResult>
  getChannelInfo(channel: string): Promise<import('./types').SlackChannel | null>
  listUsers(options?: { limit?: number; cursor?: string }): Promise<SlackUserPage>
  getUserInfo(userId: string): Promise<SlackUser | null>
  addReaction(channel: string, ts: string, emoji: string): Promise<void>
  removeReaction(channel: string, ts: string, emoji: string): Promise<void>
  authTest(): Promise<SlackAuthTestResponse>
}

export class SlackApiError extends Error {
  readonly method: string
  readonly status: number
  readonly code?: string

  constructor(params: { method: string; status: number; message: string; code?: string }) {
    super(params.message)
    this.name = 'SlackApiError'
    this.method = params.method
    this.status = params.status
    this.code = params.code
  }
}

export class SlackRateLimitError extends SlackApiError {
  readonly retryAfterSeconds: number

  constructor(method: string, retryAfterSeconds: number) {
    super({
      method,
      status: 429,
      message: `Slack API rate limited for ${retryAfterSeconds}s`,
      code: 'rate_limited',
    })
    this.name = 'SlackRateLimitError'
    this.retryAfterSeconds = retryAfterSeconds
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

function parseRetryAfterSeconds(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value)
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
  }

  return 1
}

function buildApiError(method: string, status: number, payload: unknown): SlackApiError {
  const body = payload as Partial<SlackApiErrorResponse> | null
  const code = typeof body?.error === 'string' ? body.error : undefined
  const message = code
    ? `Slack API ${method} failed: ${code}`
    : `Slack API ${method} failed with status ${status}`

  return new SlackApiError({
    method,
    status,
    message,
    code,
  })
}

function mapSlackWebApiError(method: string, error: unknown): SlackApiError {
  if (error instanceof SlackApiError) {
    return error
  }

  const record = asRecord(error)
  const code = typeof record?.code === 'string' ? record.code : undefined

  if (code === ErrorCode.RateLimitedError) {
    return new SlackRateLimitError(method, parseRetryAfterSeconds(record?.retryAfter))
  }

  if (code === ErrorCode.PlatformError) {
    const status = typeof record?.statusCode === 'number' ? record.statusCode : 400
    return buildApiError(method, status, record?.data)
  }

  if (record?.data) {
    const status = typeof record?.statusCode === 'number' ? record.statusCode : 500
    return buildApiError(method, status, record.data)
  }

  if (error instanceof Error) {
    return new SlackApiError({
      method,
      status: 500,
      message: error.message,
    })
  }

  return new SlackApiError({
    method,
    status: 500,
    message: String(error),
  })
}

export function createSlackClient(config: { botToken: string }): SlackClient {
  const clientsByToken = new Map<string, WebClient>()

  const getClient = (token: string): WebClient => {
    const existing = clientsByToken.get(token)
    if (existing) return existing

    const created = new WebClient(token)
    clientsByToken.set(token, created)
    return created
  }

  const makeInvoke =
    (tokenOverride?: string): SlackApiInvoker =>
    async <T>(method: string, body?: Record<string, unknown>) => {
      const token = tokenOverride ?? config.botToken
      const client = getClient(token)

      let result: unknown
      try {
        result = await client.apiCall(method, body ?? {})
      } catch (error) {
        throw mapSlackWebApiError(method, error)
      }

      const envelope = asRecord(result)
      if (!envelope) {
        throw new SlackApiError({
          method,
          status: 500,
          message: `Slack API ${method} returned non-object response`,
        })
      }

      if (envelope.ok !== true) {
        throw buildApiError(method, 200, envelope)
      }

      const { ok: _ignored, ...rest } = envelope
      return rest as T
    }

  const invoke = makeInvoke()

  return {
    postMessage: (channel, text, options) => postSlackMessage(invoke, channel, text, options),
    updateMessage: (channel, ts, text, options) =>
      updateSlackMessage(invoke, channel, ts, text, options),
    getThread: (channel, threadTs, options) => getThreadReplies(invoke, channel, threadTs, options),
    getHistory: (channel, options) => getConversationHistory(invoke, channel, options),
    listChannels: (options) => listConversations(invoke, options),
    searchInChannel: (channel, query, options) =>
      searchConversationHistory(invoke, channel, query, options),
    searchWorkspaceContext: async (query, options) => {
      const trimmed = query.trim()
      if (!trimmed) {
        return { query: trimmed, matches: [], total: 0 }
      }

      const actionToken = options?.actionToken?.trim()
      if (!actionToken) {
        throw new SlackApiError({
          method: 'assistant.search.context',
          status: 400,
          message: 'Slack workspace context search requires an action token from Slack context.',
          code: 'action_token_required',
        })
      }

      const invokeWithActionToken = makeInvoke(actionToken)
      const response = await invokeWithActionToken<{
        matches?: Array<{
          id?: string
          channel?: string
          ts?: string
          text?: string
          user?: string
        }>
        total?: number
        response_metadata?: { next_cursor?: string }
      }>('assistant.search.context', {
        query: trimmed,
        ...(typeof options?.limit === 'number'
          ? { limit: Math.max(1, Math.min(50, options.limit)) }
          : {}),
        ...(options?.cursor ? { cursor: options.cursor } : {}),
        ...(Array.isArray(options?.channelIds) && options.channelIds.length > 0
          ? { channel_ids: options.channelIds }
          : {}),
      })

      return {
        query: trimmed,
        total: typeof response.total === 'number' ? response.total : undefined,
        matches: Array.isArray(response.matches) ? response.matches : [],
        nextCursor: response.response_metadata?.next_cursor?.trim() || undefined,
      }
    },
    exportResponse: async (triggerId) => {
      const normalized = triggerId.trim()
      if (!normalized) {
        throw new SlackApiError({
          method: 'responses.export',
          status: 400,
          message: 'Slack responses.export requires a non-empty trigger ID.',
          code: 'trigger_id_required',
        })
      }

      const payload = await invoke<Record<string, unknown>>('responses.export', {
        trigger_id: normalized,
      })

      return {
        triggerId: normalized,
        payload,
      }
    },
    getChannelInfo: (channel) => getChannelInfo(invoke, channel),
    listUsers: async (options) => {
      const response = await invoke<{
        members?: SlackUser[]
        response_metadata?: { next_cursor?: string }
      }>('users.list', {
        ...(typeof options?.limit === 'number' ? { limit: options.limit } : {}),
        ...(options?.cursor ? { cursor: options.cursor } : {}),
      })

      const items = Array.isArray(response.members) ? response.members : []
      const nextCursor = response.response_metadata?.next_cursor?.trim() || undefined
      return {
        items,
        nextCursor,
        hasMore: Boolean(nextCursor),
      }
    },
    getUserInfo: async (userId) => {
      const trimmed = userId.trim()
      if (!trimmed) return null

      try {
        const response = await invoke<{ user?: SlackUser }>('users.info', { user: trimmed })
        return response.user ?? null
      } catch {
        return null
      }
    },
    addReaction: async (channel, ts, emoji) => {
      await invoke('reactions.add', { channel, timestamp: ts, name: emoji })
    },
    removeReaction: async (channel, ts, emoji) => {
      await invoke('reactions.remove', { channel, timestamp: ts, name: emoji })
    },
    authTest: () => invoke<SlackAuthTestResponse>('auth.test'),
  }
}
