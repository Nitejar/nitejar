import type {
  SlackApiInvoker,
  SlackChannel,
  SlackChannelPage,
  SlackChannelType,
  SlackMessage,
  SlackMessagePage,
  SlackResponseMetadata,
} from './types'

export interface GetThreadOptions {
  limit?: number
  latest?: string
  oldest?: string
  cursor?: string
}

export interface GetHistoryOptions {
  limit?: number
  latest?: string
  oldest?: string
  cursor?: string
  inclusive?: boolean
}

export interface ListChannelsOptions {
  cursor?: string
  limit?: number
  types?: SlackChannelType[]
}

export interface SearchInChannelOptions {
  /** Maximum matched messages to return (default 20, max 100). */
  limit?: number
  /** Cursor from a previous search result page. */
  cursor?: string
  /** Restrict scan window to messages newer than this ts. */
  oldest?: string
  /** Restrict scan window to messages older than this ts. */
  latest?: string
  /** Maximum messages to scan per request (default 200, max 1000). */
  scanLimit?: number
}

interface SlackPagedEnvelope<TItem> {
  messages?: TItem[]
  channels?: TItem[]
  has_more?: boolean
  response_metadata?: SlackResponseMetadata
}

function getNextCursor(metadata: SlackResponseMetadata | undefined): string | undefined {
  const raw = metadata?.next_cursor?.trim()
  return raw ? raw : undefined
}

function buildPage<T>(
  items: T[],
  envelope: SlackPagedEnvelope<unknown>
): {
  items: T[]
  nextCursor?: string
  hasMore: boolean
} {
  const nextCursor = getNextCursor(envelope.response_metadata)
  return {
    items,
    nextCursor,
    hasMore: envelope.has_more === true || Boolean(nextCursor),
  }
}

export async function getChannelInfo(
  invoke: SlackApiInvoker,
  channel: string
): Promise<SlackChannel | null> {
  try {
    const response = await invoke<{ channel?: SlackChannel }>('conversations.info', { channel })
    return response.channel ?? null
  } catch {
    return null
  }
}

export async function getThreadReplies(
  invoke: SlackApiInvoker,
  channel: string,
  threadTs: string,
  options?: GetThreadOptions
): Promise<SlackMessagePage> {
  const response = await invoke<SlackPagedEnvelope<SlackMessage>>('conversations.replies', {
    channel,
    ts: threadTs,
    ...(typeof options?.limit === 'number' ? { limit: options.limit } : {}),
    ...(options?.latest ? { latest: options.latest } : {}),
    ...(options?.oldest ? { oldest: options.oldest } : {}),
    ...(options?.cursor ? { cursor: options.cursor } : {}),
  })

  const items = Array.isArray(response.messages) ? response.messages : []
  return buildPage(items, response)
}

export async function getConversationHistory(
  invoke: SlackApiInvoker,
  channel: string,
  options?: GetHistoryOptions
): Promise<SlackMessagePage> {
  const response = await invoke<SlackPagedEnvelope<SlackMessage>>('conversations.history', {
    channel,
    ...(typeof options?.limit === 'number' ? { limit: options.limit } : {}),
    ...(options?.latest ? { latest: options.latest } : {}),
    ...(options?.oldest ? { oldest: options.oldest } : {}),
    ...(options?.cursor ? { cursor: options.cursor } : {}),
    ...(typeof options?.inclusive === 'boolean' ? { inclusive: options.inclusive } : {}),
  })

  const items = Array.isArray(response.messages) ? response.messages : []
  return buildPage(items, response)
}

export async function listConversations(
  invoke: SlackApiInvoker,
  options?: ListChannelsOptions
): Promise<SlackChannelPage> {
  const response = await invoke<SlackPagedEnvelope<SlackChannel>>('conversations.list', {
    ...(typeof options?.limit === 'number' ? { limit: options.limit } : {}),
    ...(options?.cursor ? { cursor: options.cursor } : {}),
    ...(Array.isArray(options?.types) && options.types.length > 0
      ? { types: options.types.join(',') }
      : {}),
    exclude_archived: true,
  })

  const items = Array.isArray(response.channels) ? response.channels : []
  return buildPage(items, response)
}

export async function searchConversationHistory(
  invoke: SlackApiInvoker,
  channel: string,
  query: string,
  options?: SearchInChannelOptions
): Promise<SlackMessagePage> {
  const trimmedQuery = query.trim()
  if (!trimmedQuery) {
    return { items: [], hasMore: false, matchedCount: 0, scannedCount: 0 }
  }

  const scanLimit =
    typeof options?.scanLimit === 'number' ? Math.max(1, Math.min(1000, options.scanLimit)) : 200
  const resultLimit =
    typeof options?.limit === 'number' ? Math.max(1, Math.min(100, options.limit)) : 20

  const page = await getConversationHistory(invoke, channel, {
    limit: scanLimit,
    cursor: options?.cursor,
    latest: options?.latest,
    oldest: options?.oldest,
    inclusive: true,
  })

  const needle = trimmedQuery.toLowerCase()
  const matches = page.items.filter((message) => {
    const text = message.text?.toLowerCase()
    return Boolean(text && text.includes(needle))
  })

  const boundedMatches = matches.slice(0, resultLimit)
  return {
    items: boundedMatches,
    nextCursor: page.nextCursor,
    hasMore: page.hasMore || matches.length > boundedMatches.length,
    scannedCount: page.items.length,
    matchedCount: matches.length,
  }
}
