export type PlatformKey = 'darwin-arm64' | 'darwin-x64' | 'linux-x64' | 'linux-arm64'

export type ManifestArtifact = {
  url: string
  sha256: string
  size: number
}

export type ReleaseManifest = {
  version: string
  releasedAt: string
  artifacts: Record<string, ManifestArtifact>
}

export type Paths = {
  root: string
  data: string
  configDir: string
  envFile: string
  releases: string
  runtimeDir: string
  currentRuntimeLink: string
  runDir: string
  pidFile: string
  metaFile: string
  migrateLockFile: string
  logsDir: string
  logFile: string
  receiptsDir: string
  migrationReceiptsDir: string
}

export type RuntimeMeta = {
  pid: number
  pidStartTime?: string
  pidCommand?: string
  version: string
  port: number
  startedAt: string
  dbPath: string
  runtimePath: string
}

export type MigrationReceipt = {
  startedAt: string
  finishedAt: string
  dbPath: string
  migrationStatus: 'ok' | 'error'
  cutoverStatus: 'completed' | 'skipped' | 'failed'
  cutoverReason?: string
  error?: string
}

export type StatusPayload = {
  running: boolean
  pid: number | null
  version: string | null
  port: number | null
  dbPath: string
  runtimePath: string | null
  envFile: string
  logFile: string
  lastMigrationReceipt: string | null
}
