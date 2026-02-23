import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import * as tar from 'tar'

import {
  artifactAbsoluteUrl,
  downloadFile,
  fetchManifest,
  getReleasesBaseUrl,
  sha256File,
} from './manifest.js'
import type { Paths, PlatformKey } from './types.js'

export async function ensureRuntimeRelease(
  paths: Paths,
  platform: PlatformKey,
  requestedVersion: string,
  options?: {
    fetchImpl?: typeof fetch
    baseUrl?: string
  }
): Promise<{ version: string; runtimePath: string }> {
  const { manifest, manifestUrl } = await fetchManifest(requestedVersion, options)
  const artifact = manifest.artifacts[platform]
  if (!artifact) {
    throw new Error(`No runtime artifact for ${platform} in manifest ${manifestUrl}`)
  }

  const version = manifest.version
  const releaseDir = path.join(paths.releases, version, platform)
  const archivePath = path.join(releaseDir, 'runtime.tar.gz')
  const runtimePath = path.join(releaseDir, 'runtime')
  const runtimeShaMarkerPath = path.join(releaseDir, '.nitejar.sha256')
  const tmpDownload = `${archivePath}.tmp`

  mkdirSync(releaseDir, { recursive: true })

  let needsDownload = true
  if (existsSync(archivePath)) {
    const hash = sha256File(archivePath)
    needsDownload = hash !== artifact.sha256
    if (needsDownload) unlinkSync(archivePath)
  }

  if (needsDownload) {
    const url = artifactAbsoluteUrl(artifact.url, options?.baseUrl ?? getReleasesBaseUrl())
    await downloadFile(url, tmpDownload, options)
    const hash = sha256File(tmpDownload)
    if (hash !== artifact.sha256) {
      rmSync(tmpDownload, { force: true })
      throw new Error(
        `Checksum mismatch for runtime artifact: expected ${artifact.sha256}, got ${hash}`
      )
    }
    rmSync(archivePath, { force: true })
    renameSync(tmpDownload, archivePath)
    rmSync(tmpDownload, { force: true })
  }

  const serverEntryPath = path.join(runtimePath, 'apps', 'web', 'server.js')
  const extractedSha = existsSync(runtimeShaMarkerPath)
    ? readFileSync(runtimeShaMarkerPath, 'utf8').trim()
    : null
  const needsExtract = !existsSync(serverEntryPath) || extractedSha !== artifact.sha256

  if (needsExtract) {
    rmSync(runtimePath, { recursive: true, force: true })
    mkdirSync(runtimePath, { recursive: true })
    await tar.x({
      file: archivePath,
      cwd: runtimePath,
    })
    writeFileSync(runtimeShaMarkerPath, `${artifact.sha256}\n`, 'utf8')
  }

  if (existsSync(paths.currentRuntimeLink)) {
    const stat = lstatSync(paths.currentRuntimeLink)
    if (stat.isSymbolicLink() || stat.isFile()) {
      unlinkSync(paths.currentRuntimeLink)
    } else {
      rmSync(paths.currentRuntimeLink, { recursive: true, force: true })
    }
  }
  symlinkSync(runtimePath, paths.currentRuntimeLink)

  return { version, runtimePath }
}
