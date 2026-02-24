export type SlackApiInvoker = <T>(method: string, body?: Record<string, unknown>) => Promise<T>

export interface SlackMessage {
  type: string
  user?: string
  bot_id?: string
  text?: string
  ts: string
  thread_ts?: string
  subtype?: string
  channel?: string
  channel_type?: string
}

export interface SlackResponseMetadata {
  next_cursor?: string
}

export interface SlackPagedResult<T> {
  items: T[]
  nextCursor?: string
  hasMore: boolean
}

export interface SlackMessagePage extends SlackPagedResult<SlackMessage> {
  scannedCount?: number
  matchedCount?: number
}

export interface SlackChannel {
  id: string
  name?: string
  is_channel?: boolean
  is_group?: boolean
  is_im?: boolean
  is_mpim?: boolean
  is_private?: boolean
  is_member?: boolean
  topic?: { value?: string }
  purpose?: { value?: string }
  num_members?: number
}

export type SlackChannelType = 'public_channel' | 'private_channel' | 'mpim' | 'im'

export interface SlackChannelPage extends SlackPagedResult<SlackChannel> {}

export interface SlackUser {
  id: string
  name?: string
  real_name?: string
  profile?: {
    display_name?: string
    display_name_normalized?: string
    real_name?: string
    real_name_normalized?: string
  }
}

export interface SlackWorkspaceSearchMatch {
  id?: string
  channel?: string
  ts?: string
  text?: string
  user?: string
}

export interface SlackWorkspaceSearchResult {
  query: string
  total?: number
  matches: SlackWorkspaceSearchMatch[]
  nextCursor?: string
}

export interface SlackResponseExportResult {
  triggerId: string
  payload: Record<string, unknown>
}

export interface SlackMessageEvent {
  type: 'message' | 'app_mention'
  user?: string
  bot_id?: string
  text?: string
  ts: string
  thread_ts?: string
  channel: string
  channel_type?: string
  subtype?: string
}

export interface SlackEventEnvelope {
  type: 'event_callback'
  team_id?: string
  api_app_id?: string
  event_id: string
  event_time?: number
  event_context?: string
  action_token?: string
  event: SlackMessageEvent
}

export interface SlackUrlVerificationPayload {
  type: 'url_verification'
  challenge: string
}

export interface SlackAuthTestResponse {
  user_id?: string
  bot_id?: string
  team?: string
  url?: string
}

export interface SlackUserPage extends SlackPagedResult<SlackUser> {}

export interface SlackApiErrorResponse {
  ok: false
  error?: string
  warning?: string
  needed?: string
  provided?: string
}
