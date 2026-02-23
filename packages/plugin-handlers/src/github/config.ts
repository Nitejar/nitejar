import {
  decryptConfig,
  encryptConfig,
  findPluginInstanceById,
  updatePluginInstance,
  type PluginInstanceRecord,
} from '@nitejar/database'
import type { GitHubConfig } from './types'
import { GITHUB_SENSITIVE_FIELDS } from './types'

export function parseGitHubConfig(pluginInstance: PluginInstanceRecord): GitHubConfig | null {
  if (typeof pluginInstance.config === 'string') {
    try {
      return JSON.parse(pluginInstance.config) as GitHubConfig
    } catch {
      return null
    }
  }
  return pluginInstance.config as GitHubConfig | null
}

function sanitizeConfig(config: GitHubConfig): GitHubConfig {
  const entries = Object.entries(config).filter(([, value]) => value !== undefined)
  return Object.fromEntries(entries) as GitHubConfig
}

export async function getGitHubAppConfig(pluginInstanceId: string): Promise<GitHubConfig | null> {
  const pluginInstance = await findPluginInstanceById(pluginInstanceId)
  if (!pluginInstance || pluginInstance.type !== 'github') {
    return null
  }

  const parsed = parseGitHubConfig(pluginInstance)
  if (!parsed) {
    return null
  }

  const decrypted = decryptConfig(
    parsed as Record<string, unknown>,
    Array.from(GITHUB_SENSITIVE_FIELDS)
  )
  return decrypted as GitHubConfig
}

export async function saveGitHubAppConfig(
  pluginInstanceId: string,
  config: GitHubConfig
): Promise<PluginInstanceRecord | null> {
  const pluginInstance = await findPluginInstanceById(pluginInstanceId)
  if (!pluginInstance || pluginInstance.type !== 'github') {
    return null
  }

  const existing = await getGitHubAppConfig(pluginInstanceId)
  const nextConfig = {
    ...(existing ?? {}),
    ...sanitizeConfig(config),
  }

  const encrypted = encryptConfig(
    nextConfig as Record<string, unknown>,
    Array.from(GITHUB_SENSITIVE_FIELDS)
  )

  return updatePluginInstance(pluginInstanceId, {
    config: JSON.stringify(encrypted),
  })
}
