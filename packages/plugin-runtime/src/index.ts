// Types
export type {
  PluginExport,
  PluginProvider,
  LoadResult,
  BootResult,
  InstallResult,
  HandlerRegistry,
  ProviderRegistry,
} from './types'

// Filesystem layout
export {
  getPluginDir,
  getPluginVersionDir,
  getCurrentPath,
  ensurePluginDirs,
  swapCurrentSymlink,
  removePluginDir,
} from './fs-layout'

// Validation
export {
  validatePluginEntry,
  validateNoPathTraversal,
  computeFileChecksum,
  computeBufferChecksum,
  parseManifest,
  findManifestInDir,
  type PluginManifest,
} from './validation'

// Installer
export { PluginInstaller } from './installer'

// Loader
export { PluginLoader } from './loader'

// Boot
export { bootPlugins, type BootOptions } from './boot'

// Catalog
export { PLUGIN_CATALOG, type CatalogEntry } from './catalog'

// Hook system
export {
  HookRegistry,
  HookDispatcher,
  initHookSystem,
  getHookRegistry,
  getHookDispatcher,
  _resetHookSystemForTest,
  type HookName,
  type HookContext,
  type HookResult,
  type HookHandler,
  type HookReceipt,
  type HookRegistration,
  HOOK_NAMES,
} from './hooks'

// Crash guard
export { CrashGuard, initCrashGuard, getCrashGuard, _resetCrashGuardForTest } from './crash-guard'
