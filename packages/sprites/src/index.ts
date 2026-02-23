// Client
export {
  getSpritesClient,
  getOrCreateSprite,
  getSpriteByName,
  getSprite,
  listSprites,
  deleteSprite,
} from './client'
export type { SpriteCommand } from '@fly/sprites'

// Command execution
export {
  spriteExec,
  spriteExecHttp,
  spriteExecOnSprite,
  spriteExecMultiple,
  type ExecResult,
  type ExecOptions,
  type ExecWithSessionOptions,
} from './exec'

// Session management
export {
  SpriteSessionManager,
  getSpriteSessionManager,
  closeSpriteSessionForConversation,
  sanitizeSessionOutput,
  extractMarkerOutput,
  type ISpriteSession,
  type SessionOptions,
} from './session'

// Provisioning
export {
  provisionSprite,
  deprovisionSprite,
  ensureSprite,
  getSpriteName,
  type ProvisionOptions,
} from './provision'

// Filesystem operations
export {
  readFile,
  writeFile,
  appendFile,
  fileExists,
  isDirectory,
  mkdir,
  remove,
  listDir,
  stat,
  gitClone,
  type FileInfo,
} from './filesystem'

// Network policy operations
export {
  getNetworkPolicyPreset,
  getSpriteNetworkPolicy,
  setSpriteNetworkPolicy,
  syncAgentNetworkPolicy,
  refreshSpriteNetworkPolicy,
  type NetworkPolicyPresetId,
  type RefreshSpriteNetworkPolicyOptions,
  type RefreshSpriteNetworkPolicyResult,
} from './policy'

// Service management
export {
  createSpriteService,
  listSpriteServices,
  deleteSpriteService,
  startSpriteService,
  stopSpriteService,
  getSpriteUrl,
  setSpriteUrlPublic,
  type ServiceStartResult,
} from './services'

// Background task sessions
export {
  spawnDetachableBackgroundTask,
  attachBackgroundTaskSession,
  isBackgroundTaskSessionActive,
  killBackgroundTaskSession,
  closeSpriteCommandSocket,
  type SpawnBackgroundTaskOptions,
  type SpawnBackgroundTaskResult,
} from './background-tasks'
