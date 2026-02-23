// Core types — all self-contained, no workspace dependencies
export type {
  PluginInstance,
  NewWorkItemData,
  InboundActorKind,
  InboundActorEnvelope,
  WebhookParseResult,
  PostResponseResult,
  ConfigValidationResult,
  IntegrationCategory,
  PluginCategory,
  ResponseMode,
  SetupField,
  SetupConfig,
  PluginHandler,
  IntegrationHandler,
  PluginProvider,
  PluginExport,
  HookName,
  HookContext,
  HookResult,
  HookHandler,
} from './types'

// Plugin definition helper
export { definePlugin } from './define-plugin'

// Testing utilities
export {
  testHandler,
  createMockPluginInstance,
  createMockRequest,
  type TestHandlerResult,
} from './testing'
