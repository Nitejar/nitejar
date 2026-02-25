export type SlackInboundPolicy = 'mentions' | 'all'

export type SlackActionKey =
  | 'read_thread'
  | 'read_channel_history'
  | 'read_channel_info'
  | 'list_channels'
  | 'search_channel_messages'
  | 'search_workspace_context'
  | 'export_response'

export interface SlackAssignmentPolicy {
  mode?: 'allow_all' | 'allow_list'
  allowedActions?: SlackActionKey[]
}

export interface SlackConfig {
  /** Indicates the initial app-registration flow is still in progress */
  manifestPending?: boolean
  /** Bot token from Slack app credentials (xoxb-...) */
  botToken?: string
  /** Signing secret for X-Slack-Signature verification */
  signingSecret?: string
  /** Bot user ID (U...) used for mention/self filtering */
  botUserId?: string
  /** Optional allowed channel IDs; empty or omitted means all */
  allowedChannels?: string[]
  /** Which messages should create work items */
  inboundPolicy?: SlackInboundPolicy
}

export const SLACK_SENSITIVE_FIELDS = ['botToken', 'signingSecret'] as const

export interface SlackResponseContext {
  channel: string
  threadTs: string
  messageTs: string
  channelType?: string
  teamId?: string
  eventType?: string
  /**
   * Optional token from Slack interaction context (not persisted secrets).
   * Used for APIs like assistant.search.context when Slack provides it.
   */
  actionToken?: string
}
