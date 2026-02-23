export interface PluginManifestPermissions {
  network?: string[]
  secrets?: string[]
  filesystemRead?: string[]
  filesystemWrite?: string[]
  allowProcessSpawn?: boolean
}

export interface PluginManifest {
  schemaVersion: number
  id: string
  name: string
  version: string
  description?: string
  entry?: string
  permissions?: PluginManifestPermissions
}

export interface DeclaredCapability {
  permission: string
  scope: string | null
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim())
}

export function parsePluginManifest(raw: string | null): PluginManifest | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<PluginManifest>
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.id !== 'string' || !parsed.id.trim()) return null
    if (typeof parsed.name !== 'string' || !parsed.name.trim()) return null
    if (typeof parsed.version !== 'string' || !parsed.version.trim()) return null

    const permissions: PluginManifestPermissions | undefined = parsed.permissions
      ? {
          network: asStringArray((parsed.permissions as Record<string, unknown>).network),
          secrets: asStringArray((parsed.permissions as Record<string, unknown>).secrets),
          filesystemRead: asStringArray(
            (parsed.permissions as Record<string, unknown>).filesystemRead
          ),
          filesystemWrite: asStringArray(
            (parsed.permissions as Record<string, unknown>).filesystemWrite
          ),
          allowProcessSpawn: Boolean(
            (parsed.permissions as Record<string, unknown>).allowProcessSpawn
          ),
        }
      : undefined

    return {
      schemaVersion: typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : 1,
      id: parsed.id.trim(),
      name: parsed.name.trim(),
      version: parsed.version.trim(),
      description: typeof parsed.description === 'string' ? parsed.description : undefined,
      entry: typeof parsed.entry === 'string' ? parsed.entry : undefined,
      permissions,
    }
  } catch {
    return null
  }
}

export function buildDeclaredCapabilities(
  permissions: PluginManifestPermissions | undefined
): DeclaredCapability[] {
  if (!permissions) return []

  const caps: DeclaredCapability[] = []
  for (const host of permissions.network ?? []) {
    if (host) caps.push({ permission: 'network', scope: host })
  }
  for (const key of permissions.secrets ?? []) {
    if (key) caps.push({ permission: 'secret', scope: key })
  }
  for (const path of permissions.filesystemRead ?? []) {
    if (path) caps.push({ permission: 'filesystem_read', scope: path })
  }
  for (const path of permissions.filesystemWrite ?? []) {
    if (path) caps.push({ permission: 'filesystem_write', scope: path })
  }
  if (permissions.allowProcessSpawn) {
    caps.push({ permission: 'process_spawn', scope: null })
  }
  return caps
}

export function capabilityKey(permission: string, scope: string | null): string {
  return `${permission}::${scope ?? ''}`
}

export function hostEnforcedControls(): string[] {
  return [
    'Declared-disclosure review checks at plugin enable time.',
    'Host-managed plugin instance outbound actions.',
    'Host-managed secret access APIs.',
    'Host-managed file and process helper APIs.',
  ]
}
