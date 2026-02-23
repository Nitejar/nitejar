import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { extract } from 'tar'
import type { InstallResult } from './types'
import type { PluginManifest } from './validation'
import { getPluginDir, ensurePluginDirs, swapCurrentSymlink } from './fs-layout'
import { validatePluginEntry, computeBufferChecksum, findManifestInDir } from './validation'
import { upsertPluginArtifact } from '@nitejar/database'

const execFile = promisify(execFileCb)

interface InstallMetadata {
  pluginId: string
  version: string
  sourceKind: string
  sourceRef: string | null
  checksum: string
  installedAt: number
}

/**
 * Handles fetching, extracting, validating, and storing plugin packages.
 */
export class PluginInstaller {
  private pluginDir: string

  constructor(pluginDir?: string) {
    this.pluginDir = pluginDir ?? getPluginDir()
  }

  /**
   * Install a plugin from npm registry.
   *
   * 1. `npm pack` to download the tgz
   * 2. Compute checksum
   * 3. Store tgz blob in DB (optional, for offline boot)
   * 4. Extract to plugin cache
   * 5. Validate manifest + entry
   * 6. Write .metadata.json
   * 7. Swap current symlink
   */
  async installFromNpm(
    packageName: string,
    version: string,
    pluginId: string
  ): Promise<InstallResult> {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nitejar-plugin-'))
    try {
      // 1. npm pack to download the tgz
      const { stdout } = await execFile(
        'npm',
        ['pack', `${packageName}@${version}`, '--pack-destination', tmpDir],
        {
          timeout: 60_000,
        }
      )

      // Find the tgz file (npm pack outputs the filename)
      const tgzName = stdout.trim().split('\n').pop()?.trim()
      if (!tgzName) {
        return { success: false, pluginId, error: 'npm pack did not output a filename' }
      }
      const tgzPath = path.join(tmpDir, tgzName)

      // 2. Compute checksum
      const tgzBuffer = await fs.readFile(tgzPath)
      const checksum = computeBufferChecksum(tgzBuffer)

      // 3. Store tgz blob in DB for offline boot
      await upsertPluginArtifact({
        pluginId,
        version,
        tgzBlob: tgzBuffer,
        sizeBytes: tgzBuffer.length,
        checksum,
      })

      // 4. Extract to plugin cache
      const versionDir = await ensurePluginDirs(pluginId, version)
      await extract({ file: tgzPath, cwd: versionDir })

      // 5. Validate manifest + entry
      const packageDir = path.join(versionDir, 'package')
      const manifest = await this.resolveManifest(packageDir, pluginId)

      if (manifest.entry) {
        await validatePluginEntry(packageDir, manifest)
      }

      // 6. Write .metadata.json
      await this.writeMetadata(versionDir, {
        pluginId,
        version,
        sourceKind: 'npm',
        sourceRef: `${packageName}@${version}`,
        checksum,
        installedAt: Date.now(),
      })

      // 7. Swap current symlink
      await swapCurrentSymlink(pluginId, version)

      return {
        success: true,
        pluginId,
        version,
        installPath: packageDir,
      }
    } catch (err) {
      return {
        success: false,
        pluginId,
        error: err instanceof Error ? err.message : String(err),
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  /**
   * Install a plugin from a tgz buffer (uploaded file).
   * The tgz blob is stored in the DB as the durable copy.
   */
  async installFromTgz(
    tgzBuffer: Buffer,
    pluginId: string,
    version: string
  ): Promise<InstallResult> {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nitejar-plugin-'))
    try {
      // 1. Compute checksum
      const checksum = computeBufferChecksum(tgzBuffer)

      // 2. Store tgz blob in DB (this is the durable copy)
      await upsertPluginArtifact({
        pluginId,
        version,
        tgzBlob: tgzBuffer,
        sizeBytes: tgzBuffer.length,
        checksum,
      })

      // 3. Write tgz to temp file for extraction
      const tgzPath = path.join(tmpDir, 'plugin.tgz')
      await fs.writeFile(tgzPath, tgzBuffer)

      // 4. Extract to plugin cache
      const versionDir = await ensurePluginDirs(pluginId, version)
      await extract({ file: tgzPath, cwd: versionDir })

      // 5. Validate manifest + entry
      const packageDir = path.join(versionDir, 'package')
      const manifest = await this.resolveManifest(packageDir, pluginId)

      if (manifest.entry) {
        await validatePluginEntry(packageDir, manifest)
      }

      // 6. Write .metadata.json
      await this.writeMetadata(versionDir, {
        pluginId,
        version,
        sourceKind: 'upload',
        sourceRef: null,
        checksum,
        installedAt: Date.now(),
      })

      // 7. Swap current symlink
      await swapCurrentSymlink(pluginId, version)

      return {
        success: true,
        pluginId,
        version,
        installPath: packageDir,
      }
    } catch (err) {
      return {
        success: false,
        pluginId,
        error: err instanceof Error ? err.message : String(err),
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  /**
   * Install a plugin from a local path (developer convenience).
   * No fetch, no extract, no artifact stored. Just validate.
   */
  async installFromLocal(localPath: string, pluginId: string): Promise<InstallResult> {
    try {
      const resolvedPath = path.resolve(localPath)

      // Verify the path exists
      try {
        await fs.access(resolvedPath)
      } catch {
        return {
          success: false,
          pluginId,
          error: `Local plugin path does not exist: ${resolvedPath}`,
        }
      }

      // Find and validate manifest
      const manifest = await this.resolveManifest(resolvedPath, pluginId)

      // Validate entry if specified
      if (manifest.entry) {
        await validatePluginEntry(resolvedPath, manifest)
      }

      return {
        success: true,
        pluginId,
        version: manifest.version,
        installPath: resolvedPath,
      }
    } catch (err) {
      return {
        success: false,
        pluginId,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  /**
   * Extract a tgz buffer to a target directory.
   * Used by boot cache hydration.
   */
  async extractTgzToDir(tgzBuffer: Buffer, destDir: string): Promise<void> {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nitejar-extract-'))
    try {
      const tgzPath = path.join(tmpDir, 'plugin.tgz')
      await fs.writeFile(tgzPath, tgzBuffer)
      await fs.mkdir(destDir, { recursive: true })
      await extract({ file: tgzPath, cwd: destDir })
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  private async resolveManifest(packageDir: string, _pluginId: string): Promise<PluginManifest> {
    const manifest = await findManifestInDir(packageDir)
    if (!manifest) {
      throw new Error(
        `No valid plugin manifest found in ${packageDir}. ` +
          'Expected nitejar-plugin.json or a "nitejar" key in package.json.'
      )
    }
    return manifest
  }

  private async writeMetadata(dir: string, metadata: InstallMetadata): Promise<void> {
    const metadataPath = path.join(dir, '.metadata.json')
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2))
  }
}
