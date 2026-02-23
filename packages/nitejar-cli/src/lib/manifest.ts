import { createHash } from 'node:crypto'
import { createWriteStream, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import process from 'node:process'

import type { ReleaseManifest } from './types.js'

export const DEFAULT_RELEASES_BASE_URL = 'https://releases.nitejar.dev'

export function getReleasesBaseUrl(): string {
  return process.env.NITEJAR_RELEASES_BASE_URL ?? DEFAULT_RELEASES_BASE_URL
}

export function sha256File(filePath: string): string {
  const hash = createHash('sha256')
  hash.update(readFileSync(filePath))
  return hash.digest('hex')
}

export function artifactAbsoluteUrl(url: string, baseUrl: string): string {
  if (url.startsWith('https://') || url.startsWith('http://')) return url
  return new URL(url, `${baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`}`).toString()
}

export async function fetchManifest(
  version: string,
  options?: {
    fetchImpl?: typeof fetch
    baseUrl?: string
  }
): Promise<{ manifest: ReleaseManifest; manifestUrl: string }> {
  const fetchImpl = options?.fetchImpl ?? fetch
  const releasesBaseUrl = options?.baseUrl ?? getReleasesBaseUrl()
  const preferredUrl =
    version === 'latest'
      ? `${releasesBaseUrl}/manifest.json`
      : `${releasesBaseUrl}/${version}/manifest.json`

  const preferredResponse = await fetchImpl(preferredUrl)
  if (preferredResponse.ok) {
    const manifest = (await preferredResponse.json()) as ReleaseManifest
    return { manifest, manifestUrl: preferredUrl }
  }

  if (version !== 'latest') {
    const fallbackUrl = `${releasesBaseUrl}/manifest.json`
    const fallbackResponse = await fetchImpl(fallbackUrl)
    if (!fallbackResponse.ok) {
      throw new Error(
        `Failed to fetch release manifest: ${preferredResponse.status} ${preferredResponse.statusText}`
      )
    }
    const manifest = (await fallbackResponse.json()) as ReleaseManifest
    if (manifest.version !== version) {
      throw new Error(
        `Requested version ${version} but release manifest version is ${manifest.version}.`
      )
    }
    return { manifest, manifestUrl: fallbackUrl }
  }

  throw new Error(
    `Failed to fetch release manifest: ${preferredResponse.status} ${preferredResponse.statusText}`
  )
}

export async function downloadFile(
  url: string,
  destination: string,
  options?: { fetchImpl?: typeof fetch }
): Promise<void> {
  const fetchImpl = options?.fetchImpl ?? fetch
  const response = await fetchImpl(url)
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status} ${response.statusText}) for ${url}`)
  }
  mkdirSync(path.dirname(destination), { recursive: true })
  const file = createWriteStream(destination)
  await pipeline(Readable.fromWeb(response.body as never), file)
}
