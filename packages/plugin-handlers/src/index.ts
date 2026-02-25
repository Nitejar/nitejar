// Types (new names + deprecated aliases)
export type {
  PluginHandler,
  PluginType,
  PluginCategory,
  IntegrationHandler,
  IntegrationType,
  IntegrationCategory,
  ResponseMode,
  WebhookParseResult,
  WebhookImmediateResponse,
  PostResponseResult,
  ConfigValidationResult,
  TestConnectionResult,
  InboundActorEnvelope,
  InboundActorKind,
  QueueConfig,
  QueueMode,
  SetupField,
  SetupConfig,
} from './types'
export { DEFAULT_QUEUE_CONFIG } from './types'
export type { CredentialEnvelope, ICredentialProvider } from './credential-provider'

// Session Queue
export {
  queueManager,
  QueueManager,
  SessionQueue,
  coalesceMessages,
  CollectModeHandler,
} from './session-queue'
export type {
  QueuedMessage,
  QueueModeHandler,
  QueueAction,
  ActiveRunInfo,
  SessionQueueCallbacks,
} from './session-queue'

// Registry (new names + deprecated aliases)
export {
  pluginHandlerRegistry,
  registerPluginHandler,
  integrationRegistry,
  registerIntegration,
} from './registry'

// Router
export {
  routeWebhook,
  getPluginInstanceWithConfig,
  getIntegrationWithConfig,
  type WebhookRouterResult,
  type WebhookHooks,
} from './router'

// Plugin handlers
export {
  telegramHandler,
  sendMessage,
  sendApprovalPrompt,
  sendTypingIndicator,
  sendChatAction,
  sendPhoto,
  sendDocument,
  inferMimeType,
  createForumTopic,
  getFile,
  downloadTelegramFileAsDataUrl,
  downloadTelegramFile,
  type TelegramConfig,
  type TelegramResponseContext,
  type TelegramDownloadResult,
  type ForumTopic,
} from './telegram'
export {
  githubHandler,
  getGitHubAppConfig,
  saveGitHubAppConfig,
  type GitHubConfig,
  type GitHubResponseContext,
} from './github'
export {
  discordHandler,
  sendFollowUpMessage,
  editOriginalResponse,
  registerGuildCommands,
  sendChannelMessage,
  getChannelMessages,
  splitDiscordMessage,
  getCurrentBotUser,
  parseDiscordWebhook,
  verifyDiscordSignature,
  type DiscordConfig,
  type DiscordResponseContext,
  type DiscordInteraction,
  type DiscordInteractionType,
  type DiscordMessage,
  type DiscordApplicationCommandDefinition,
  type DiscordApplicationCommandOptionDefinition,
} from './discord'
export {
  slackHandler,
  parseSlackConfig,
  parseSlackWebhook,
  createSlackClient,
  markdownToSlackMrkdwn,
  SlackApiError,
  SlackRateLimitError,
  type SlackChannel,
  type SlackChannelType,
  type SlackMessage,
  type SlackMessagePage,
  type SlackWorkspaceSearchResult,
  type SlackActionKey,
  type SlackAssignmentPolicy,
  type SlackConfig,
  type SlackResponseContext,
} from './slack'
export {
  GitHubCredentialProvider,
  type GitHubCredentialRequest,
} from './github/credential-provider'
export { createAppAuth } from '@octokit/auth-app'

// Auto-register built-in handlers
import { pluginHandlerRegistry } from './registry'
import { telegramHandler } from './telegram'
import { githubHandler } from './github'
import { discordHandler } from './discord'
import { slackHandler } from './slack'

pluginHandlerRegistry.register(telegramHandler)
pluginHandlerRegistry.register(githubHandler)
pluginHandlerRegistry.register(discordHandler)
pluginHandlerRegistry.register(slackHandler)
