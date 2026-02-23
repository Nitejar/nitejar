import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

import type { Paths } from './types.js'
import type { WizardResult } from './wizard.js'

export function parseEnvFile(content: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const idx = line.indexOf('=')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim()
    values[key] = value
  }
  return values
}

export function serializeEnvFile(values: Record<string, string>): string {
  const keys = Object.keys(values).sort()
  return `${keys.map((key) => `${key}=${values[key]}`).join('\n')}\n`
}

export function readEnv(paths: Paths): Record<string, string> {
  if (!existsSync(paths.envFile)) return {}
  return parseEnvFile(readFileSync(paths.envFile, 'utf8'))
}

export function writeEnv(paths: Paths, values: Record<string, string>): void {
  writeFileSync(paths.envFile, serializeEnvFile(values), 'utf8')
  chmodSync(paths.envFile, 0o600)
}

export function ensureBaseEnv(
  paths: Paths,
  port: number,
  wizardResult?: WizardResult
): Record<string, string> {
  const env = readEnv(paths)

  if (wizardResult) {
    env.ENCRYPTION_KEY = wizardResult.encryptionKey
    env.BETTER_AUTH_SECRET = wizardResult.betterAuthSecret
    env.APP_BASE_URL = wizardResult.appBaseUrl
    if (wizardResult.openRouterApiKey) {
      env.OPENROUTER_API_KEY = wizardResult.openRouterApiKey
    }
  }

  if (!env.ENCRYPTION_KEY) {
    env.ENCRYPTION_KEY = randomBytes(32).toString('hex')
  }
  if (!env.BETTER_AUTH_SECRET) {
    env.BETTER_AUTH_SECRET = randomBytes(32).toString('base64')
  }
  env.DATABASE_URL = path.join(paths.data, 'nitejar.db')
  if (!env.APP_BASE_URL) {
    env.APP_BASE_URL = `http://localhost:${port}`
  }
  writeEnv(paths, env)
  return env
}
