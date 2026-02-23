import process from 'node:process'

import type { PlatformKey } from './types.js'

export function resolvePlatformKey(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
): PlatformKey {
  if (platform === 'darwin' && arch === 'arm64') return 'darwin-arm64'
  if (platform === 'darwin' && arch === 'x64') return 'darwin-x64'
  if (platform === 'linux' && arch === 'x64') return 'linux-x64'
  if (platform === 'linux' && arch === 'arm64') return 'linux-arm64'
  throw new Error(
    `Unsupported platform/arch: ${platform}/${arch}. Supported: macOS + Linux (x64, arm64).`
  )
}
