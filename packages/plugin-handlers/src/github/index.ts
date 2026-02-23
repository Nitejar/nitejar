import { z } from 'zod'
import type { PluginInstanceRecord } from '@nitejar/database'
import { createGitHubClient, postIssueComment } from '@nitejar/connectors-github'
import type {
  PluginHandler,
  WebhookParseResult,
  PostResponseResult,
  ConfigValidationResult,
} from '../types'
import type { GitHubConfig, GitHubResponseContext, GitHubPermissionsConfig } from './types'
import { GITHUB_SENSITIVE_FIELDS } from './types'
import { parseGitHubWebhook } from './webhook'
import { parseGitHubConfig } from './config'

const permissionLevelSchema = z.enum(['read', 'write', 'admin'])
const commentPolicySchema = z.enum(['all', 'mentions'])

const permissionsSchema: z.ZodType<GitHubPermissionsConfig> = z.object({
  preset: z.enum(['minimal', 'robust']),
  overrides: z.record(permissionLevelSchema).optional(),
})

const githubConfigSchema = z
  .object({
    appId: z.string().optional(),
    clientId: z.string().optional(),
    clientSecret: z.string().optional(),
    privateKey: z.string().optional(),
    webhookSecret: z.string().optional(),
    allowedRepos: z.array(z.string()).optional(),
    permissions: permissionsSchema.optional(),
    tokenTTL: z.number().int().positive().optional(),
    commentPolicy: commentPolicySchema.optional(),
    mentionHandle: z.string().min(1).optional(),
    trackIssueOpen: z.boolean().optional(),
    trackCheckRun: z.boolean().optional(),
    manifestPending: z.boolean().optional(),
  })
  .refine(
    (data) => {
      if (data.manifestPending) return true
      if (!data.webhookSecret) return false

      const hasAppId = Boolean(data.appId)
      const hasPrivateKey = Boolean(data.privateKey)
      if (hasAppId !== hasPrivateKey) {
        return false
      }

      const hasClientId = Boolean(data.clientId)
      const hasClientSecret = Boolean(data.clientSecret)
      if (hasClientId !== hasClientSecret) {
        return false
      }

      return true
    },
    { message: 'Webhook secret is required unless manifest registration is pending' }
  )
  .refine(
    (data) => {
      if (data.manifestPending) return true

      const hasAppId = Boolean(data.appId)
      const hasPrivateKey = Boolean(data.privateKey)
      if (hasAppId !== hasPrivateKey) {
        return false
      }

      const hasClientId = Boolean(data.clientId)
      const hasClientSecret = Boolean(data.clientSecret)
      if (hasClientId !== hasClientSecret) {
        return false
      }

      return (hasAppId && hasPrivateKey) || (hasClientId && hasClientSecret)
    },
    { message: 'Provide complete app credentials or complete OAuth client credentials' }
  )

/**
 * GitHub plugin handler
 */
export const githubHandler: PluginHandler<GitHubConfig> = {
  type: 'github',
  displayName: 'GitHub',
  description: 'Monitor issues and issue comments, respond to activity in GitHub.',
  icon: 'brand-github',
  category: 'code',
  responseMode: 'final',
  sensitiveFields: [...GITHUB_SENSITIVE_FIELDS],
  setupConfig: {
    fields: [
      {
        key: 'permissionPreset',
        label: 'Permission Preset',
        type: 'select',
        required: true,
        options: [
          { label: 'Robust (recommended)', value: 'robust' },
          { label: 'Minimal (read-only)', value: 'minimal' },
        ],
      },
    ],
    usesRedirectFlow: true,
    registrationUrl: 'https://github.com/settings/apps/new',
  },

  validateConfig(config: unknown): ConfigValidationResult {
    const result = githubConfigSchema.safeParse(config)
    if (result.success) {
      return { valid: true }
    }
    return {
      valid: false,
      errors: result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`),
    }
  },

  async parseWebhook(
    request: Request,
    pluginInstance: PluginInstanceRecord
  ): Promise<WebhookParseResult> {
    return parseGitHubWebhook(request, pluginInstance)
  },

  async postResponse(
    pluginInstance: PluginInstanceRecord,
    workItemId: string,
    content: string,
    responseContext?: unknown,
    _options?: { hitLimit?: boolean; idempotencyKey?: string }
  ): Promise<PostResponseResult> {
    const config = parseGitHubConfig(pluginInstance)
    const context = responseContext as GitHubResponseContext | undefined

    if (!context?.owner || !context?.repo || !context?.issueNumber) {
      return { success: false, error: 'Missing response context' }
    }

    try {
      if (!config?.appId || !config?.privateKey) {
        return { success: false, error: 'No authentication configured' }
      }
      if (!context.installationId) {
        return { success: false, error: 'Missing GitHub App installation context' }
      }

      const octokit = createGitHubClient({
        appId: config.appId,
        privateKey: config.privateKey,
        installationId: context.installationId,
      })

      // Post the comment
      await postIssueComment(octokit, {
        owner: context.owner,
        repo: context.repo,
        issueNumber: context.issueNumber,
        body: content,
      })

      return { success: true, outcome: 'sent' }
    } catch (error) {
      return {
        success: false,
        outcome: 'failed',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  },

  testConnection(config: GitHubConfig): Promise<{ ok: boolean; error?: string }> {
    if (config.appId && config.privateKey) {
      // For App auth, we need an installation ID to exercise API calls.
      // At setup time, validate presence/shape of credentials only.
      return Promise.resolve({ ok: true })
    }

    return Promise.resolve({
      ok: false,
      error: 'GitHub App credentials are not configured',
    })
  },
}

// Re-export types
export type { GitHubConfig, GitHubResponseContext } from './types'
export { getGitHubAppConfig, saveGitHubAppConfig } from './config'
