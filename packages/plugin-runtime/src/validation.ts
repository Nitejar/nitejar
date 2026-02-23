import * as crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

export interface PluginManifest {
  schemaVersion: number
  id: string
  name: string
  version: string
  description?: string
  entry?: string
  permissions?: {
    network?: string[]
    secrets?: string[]
    filesystemRead?: string[]
    filesystemWrite?: string[]
    allowProcessSpawn?: boolean
  }
  activation?: {
    onStartup?: boolean
    onIntegrationTypes?: string[]
    onHooks?: string[]
  }
  contributes?: {
    integrations?: string[]
    hooks?: string[]
    skills?: string[]
  }
}

/**
 * Validate that a plugin entry file exists and is a valid JS module.
 * Returns the resolved absolute path to the entry file.
 */
export async function validatePluginEntry(
  installPath: string,
  manifest: PluginManifest
): Promise<string> {
  if (!manifest.entry) {
    throw new Error(`Plugin manifest for "${manifest.id}" does not specify an entry point`)
  }

  const entryPath = path.resolve(installPath, manifest.entry)

  // Security: prevent path traversal
  validateNoPathTraversal(entryPath, installPath)

  // Check the file exists
  try {
    await fs.access(entryPath)
  } catch {
    throw new Error(`Plugin entry file not found: ${manifest.entry} (resolved to ${entryPath})`)
  }

  // Validate extension
  const ext = path.extname(entryPath).toLowerCase()
  if (!['.js', '.mjs', '.cjs'].includes(ext)) {
    throw new Error(`Plugin entry must be a .js, .mjs, or .cjs file, got: ${ext}`)
  }

  return entryPath
}

/**
 * Ensure a path does not escape outside the allowed root directory.
 * Throws if the resolved path is outside the root.
 */
export function validateNoPathTraversal(targetPath: string, rootPath: string): void {
  const resolvedTarget = path.resolve(targetPath)
  const resolvedRoot = path.resolve(rootPath)

  if (!resolvedTarget.startsWith(resolvedRoot + path.sep) && resolvedTarget !== resolvedRoot) {
    throw new Error(`Path traversal detected: "${targetPath}" escapes root "${rootPath}"`)
  }
}

/**
 * Compute SHA-256 checksum of a file.
 */
export async function computeFileChecksum(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath)
  return computeBufferChecksum(content)
}

/**
 * Compute SHA-256 checksum of a buffer.
 */
export function computeBufferChecksum(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

/**
 * Parse a plugin manifest from a JSON string.
 * Returns null if parsing fails.
 */
export function parseManifest(raw: string | null): PluginManifest | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as PluginManifest
    if (!parsed.id || !parsed.name || !parsed.version) return null
    return parsed
  } catch {
    return null
  }
}

/**
 * Find and read a plugin manifest from an extracted package directory.
 * Checks for nitejar-plugin.json first, then falls back to package.json fields.
 */
export async function findManifestInDir(packageDir: string): Promise<PluginManifest | null> {
  // Read package.json once (used as fallback for version and nitejar key)
  let pkg: Record<string, unknown> | null = null
  try {
    const pkgPath = path.join(packageDir, 'package.json')
    const pkgRaw = await fs.readFile(pkgPath, 'utf-8')
    pkg = JSON.parse(pkgRaw) as Record<string, unknown>
  } catch {
    // No package.json
  }

  // Try nitejar-plugin.json first
  try {
    const manifestPath = path.join(packageDir, 'nitejar-plugin.json')
    const raw = await fs.readFile(manifestPath, 'utf-8')
    // If version is missing, backfill from package.json before parsing
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!parsed.version && pkg && typeof pkg.version === 'string') {
      parsed.version = pkg.version
    }
    const manifest = parseManifest(JSON.stringify(parsed))
    if (manifest) return manifest
  } catch {
    // Fall through to package.json
  }

  // Try "nitejar" key in package.json
  if (pkg) {
    const nitejarConfig = pkg['nitejar'] as Record<string, unknown> | undefined
    if (nitejarConfig) {
      // Backfill version from package.json root if missing
      if (!nitejarConfig.version && typeof pkg.version === 'string') {
        nitejarConfig.version = pkg.version
      }
      return parseManifest(JSON.stringify(nitejarConfig))
    }
  }

  return null
}
