import { execFile as execFileCb } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { promisify } from 'node:util'
import { NextResponse } from 'next/server'
import { findPluginById } from '@nitejar/database'
import {
  parsePluginManifest,
  type PluginManifestPermissions,
} from '@/server/services/plugins/manifest'
import { storeUpload } from './cache'

const execFile = promisify(execFileCb)

/**
 * Derive a plugin ID when the manifest is missing one.
 *
 * Priority:
 *  1. manifest.name — strip "nitejar-plugin-" prefix, normalize
 *  2. package.json name — strip @scope/, strip prefix
 *  3. uploaded filename — strip extension and version patterns
 */
function derivePluginId(
  manifest: Record<string, unknown>,
  packageJson: Record<string, unknown> | null,
  uploadedFilename: string
): string {
  // 1. manifest.name
  if (typeof manifest.name === 'string' && manifest.name.trim()) {
    return normalizeId(manifest.name.trim())
  }

  // 2. package.json name
  if (packageJson && typeof packageJson.name === 'string' && packageJson.name.trim()) {
    return normalizeId(packageJson.name.trim())
  }

  // 3. filename
  return normalizeId(uploadedFilename)
}

function normalizeId(raw: string): string {
  let id = raw
  // strip @scope/
  id = id.replace(/^@[^/]+\//, '')
  // strip nitejar-plugin- prefix
  id = id.replace(/^nitejar-plugin-/, '')
  // strip file extensions and version patterns
  id = id.replace(/\.(tgz|tar\.gz|zip)$/i, '')
  id = id.replace(/-\d+\.\d+\.\d+.*$/, '')
  // normalize to lowercase kebab-case
  id = id
    .replace(/[^a-zA-Z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return id.toLowerCase() || 'unknown-plugin'
}

/**
 * POST /api/admin/plugins/upload
 *
 * Accepts a multipart form upload of a plugin .tgz, .tar.gz, or .zip file.
 * Validates the manifest and stores the tgz buffer in an in-memory cache.
 * Returns an uploadToken that the frontend passes to installFromUpload.
 *
 * Does NOT write to the database — the tRPC mutation handles that.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let extractDir: string | null = null
  try {
    const formData = await request.formData()
    const file = formData.get('file')

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: 'No file provided. Upload a .tgz or .zip plugin package.' },
        { status: 400 }
      )
    }

    const isZip = file.name.endsWith('.zip')
    const isTgz = file.name.endsWith('.tgz') || file.name.endsWith('.tar.gz')
    if (!isTgz && !isZip) {
      return NextResponse.json(
        { error: 'File must be a .tgz, .tar.gz, or .zip archive.' },
        { status: 400 }
      )
    }

    const arrayBuffer = await file.arrayBuffer()
    const rawBuffer = Buffer.from(arrayBuffer)

    // Extract to a temp directory for validation
    extractDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nitejar-upload-'))

    let tgzBuffer: Buffer
    if (isZip) {
      // Extract zip, then re-pack as tgz for installFromTgz compatibility
      const zipPath = path.join(extractDir, 'plugin.zip')
      await fs.writeFile(zipPath, rawBuffer)
      await execFile('unzip', ['-o', zipPath, '-d', extractDir], { timeout: 30_000 })
      await fs.unlink(zipPath)

      // Find the content root (may be a subdirectory)
      const contentDir = await findContentRoot(extractDir)

      // Re-pack as tgz with "package/" prefix for installFromTgz
      const repackDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nitejar-repack-'))
      const packageDir = path.join(repackDir, 'package')
      await fs.cp(contentDir, packageDir, { recursive: true })
      const tgzPath = path.join(repackDir, 'plugin.tgz')
      await execFile('tar', ['czf', tgzPath, '-C', repackDir, 'package'], { timeout: 30_000 })
      tgzBuffer = await fs.readFile(tgzPath)
      await fs.rm(repackDir, { recursive: true, force: true }).catch(() => {})
    } else {
      tgzBuffer = rawBuffer
      // Extract for validation
      const tgzPath = path.join(extractDir, 'plugin.tgz')
      await fs.writeFile(tgzPath, rawBuffer)
      await execFile('tar', ['xzf', tgzPath, '-C', extractDir], { timeout: 30_000 })
      await fs.unlink(tgzPath)
    }

    // The tgz typically extracts to a "package" subdirectory
    const packageDir = path.join(extractDir, 'package')
    let manifestDir = extractDir
    try {
      await fs.access(packageDir)
      manifestDir = packageDir
    } catch {
      // flat tgz — manifest is in extractDir directly
    }

    // Read manifest and optionally package.json for ID derivation
    let manifest: Record<string, unknown> | null = null
    let packageJson: Record<string, unknown> | null = null
    for (const filename of ['nitejar-plugin.json', 'package.json']) {
      try {
        const content = await fs.readFile(path.join(manifestDir, filename), 'utf-8')
        const parsed = JSON.parse(content) as Record<string, unknown>
        if (filename === 'package.json') packageJson = parsed
        manifest = parsed
        break
      } catch {
        continue
      }
    }

    if (!manifest) {
      return NextResponse.json(
        {
          error:
            "This package doesn't look like a Nitejar plugin — no nitejar-plugin.json or package.json found.",
        },
        { status: 400 }
      )
    }

    // Derive ID if missing
    let pluginId = typeof manifest.id === 'string' ? manifest.id.trim() : ''
    if (!pluginId) {
      pluginId = derivePluginId(manifest, packageJson, file.name)
      // Inject derived ID so downstream parsePluginManifest succeeds
      manifest.id = pluginId
    }

    // Ensure name is set (parsePluginManifest requires it)
    if (typeof manifest.name !== 'string' || !manifest.name.trim()) {
      manifest.name = pluginId.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    }

    const entry = typeof manifest.entry === 'string' ? manifest.entry : null
    if (!entry) {
      return NextResponse.json(
        {
          error:
            'Plugin manifest is missing an "entry" field. The manifest must specify the JS entry point (e.g. "dist/index.js").',
        },
        { status: 400 }
      )
    }

    // Verify the entry file exists
    try {
      await fs.access(path.join(manifestDir, entry))
    } catch {
      return NextResponse.json(
        {
          error: `Plugin entry file "${entry}" not found in the package. Did you build the plugin before packing?`,
        },
        { status: 400 }
      )
    }

    const version = typeof manifest.version === 'string' ? manifest.version : '1.0.0'
    if (!manifest.version) manifest.version = version
    const name = typeof manifest.name === 'string' ? manifest.name : pluginId
    const description = typeof manifest.description === 'string' ? manifest.description : ''

    // Extract permissions from manifest for preview
    const manifestJsonStr = JSON.stringify(manifest)
    const parsedManifest = parsePluginManifest(manifestJsonStr)
    const permissions = parsedManifest ? parsedManifest.permissions : undefined

    // Check DB for existing plugin
    let isUpdate = false
    let existingPlugin:
      | {
          name: string
          version: string
          description: string
          permissions: PluginManifestPermissions | undefined
        }
      | undefined

    const existing = await findPluginById(pluginId)
    if (existing) {
      isUpdate = true
      const existingManifest = parsePluginManifest(existing.manifest_json)
      existingPlugin = {
        name: existing.name,
        version: existing.current_version ?? '0.0.0',
        description: existingManifest ? (existingManifest.description ?? '') : '',
        permissions: existingManifest ? existingManifest.permissions : undefined,
      }
    }

    // Store in cache and return token
    const manifestJson = JSON.stringify(manifest)
    const uploadToken = storeUpload({
      tgzBuffer,
      manifestJson,
      pluginId,
      version,
      name,
      description,
      isUpdate,
    })

    return NextResponse.json({
      ok: true,
      uploadToken,
      pluginId,
      version,
      name,
      description,
      permissions,
      isUpdate,
      existingPlugin,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Upload failed.' },
      { status: 500 }
    )
  } finally {
    if (extractDir) {
      await fs.rm(extractDir, { recursive: true, force: true }).catch(() => {})
    }
  }
}

/**
 * Find the actual content root inside an extracted zip.
 * Zips may wrap everything in a single top-level directory.
 */
async function findContentRoot(dir: string): Promise<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  // Filter out macOS metadata and hidden files
  const meaningful = entries.filter((e) => !e.name.startsWith('.') && e.name !== '__MACOSX')

  // If there's exactly one subdirectory (common zip pattern), descend into it
  const single = meaningful.length === 1 ? meaningful[0] : undefined
  if (single?.isDirectory()) {
    return path.join(dir, single.name)
  }

  return dir
}
