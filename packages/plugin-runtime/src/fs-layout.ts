import * as fs from 'node:fs/promises'
import * as path from 'node:path'

/**
 * Get the root plugin directory.
 * Uses SLOPBOT_PLUGIN_DIR env var or defaults to data/plugins/ relative to cwd.
 */
export function getPluginDir(): string {
  return process.env.SLOPBOT_PLUGIN_DIR || path.join(process.cwd(), 'data', 'plugins')
}

/**
 * Get the path to a specific plugin version directory.
 */
export function getPluginVersionDir(pluginId: string, version: string): string {
  return path.join(getPluginDir(), pluginId, version)
}

/**
 * Get the path to the "current" symlink for a plugin.
 * Returns null if the symlink doesn't exist.
 */
export async function getCurrentPath(pluginId: string): Promise<string | null> {
  const currentLink = path.join(getPluginDir(), pluginId, 'current')
  try {
    const target = await fs.readlink(currentLink)
    // Resolve relative to the symlink's parent directory
    const resolved = path.resolve(path.dirname(currentLink), target)
    // Verify the target exists
    await fs.access(resolved)
    return resolved
  } catch {
    return null
  }
}

/**
 * Ensure the directory structure exists for a plugin version.
 * Creates: <pluginDir>/<pluginId>/<version>/
 */
export async function ensurePluginDirs(pluginId: string, version: string): Promise<string> {
  const versionDir = getPluginVersionDir(pluginId, version)
  await fs.mkdir(versionDir, { recursive: true })
  return versionDir
}

/**
 * Atomically swap the "current" symlink to point to a new version directory.
 * Uses rename for atomicity on POSIX systems.
 */
export async function swapCurrentSymlink(pluginId: string, version: string): Promise<void> {
  const pluginRoot = path.join(getPluginDir(), pluginId)
  const currentLink = path.join(pluginRoot, 'current')
  const tmpLink = path.join(pluginRoot, `.current-${Date.now()}.tmp`)

  // Create a temporary symlink pointing to the version dir
  await fs.symlink(version, tmpLink)
  // Atomically replace the current symlink
  await fs.rename(tmpLink, currentLink)
}

/**
 * Remove a plugin's directory from the cache.
 */
export async function removePluginDir(pluginId: string): Promise<void> {
  const pluginRoot = path.join(getPluginDir(), pluginId)
  await fs.rm(pluginRoot, { recursive: true, force: true })
}
