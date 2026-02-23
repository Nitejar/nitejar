import { createAppAuth } from '@octokit/auth-app'
import { getGitHubAppConfig } from './config'
import type { GitHubPermissionLevel } from './types'
import type { CredentialEnvelope, ICredentialProvider } from '../credential-provider'

const DEFAULT_CACHE_SKEW_SECONDS = 30
const DEFAULT_TOKEN_TTL_SECONDS = 3600

type PermissionMap = Record<string, GitHubPermissionLevel>

export interface GitHubCredentialRequest {
  installationId: number
  repositoryIds?: number[]
  permissions?: PermissionMap
}

export interface GitHubCredentialProviderOptions {
  pluginInstanceId: string
  tokenTtlSeconds?: number
  cache?: Map<string, CachedToken>
  now?: () => number
  logger?: {
    info: (message: string, meta?: Record<string, unknown>) => void
    warn: (message: string, meta?: Record<string, unknown>) => void
  }
}

interface CachedToken {
  token: string
  expiresAt: number
}

function tryParseJson(input: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(input) as unknown
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

export class GitHubCredentialProvider implements ICredentialProvider<
  GitHubCredentialRequest,
  CredentialEnvelope
> {
  private readonly pluginInstanceId: string
  private readonly cache: Map<string, CachedToken>
  private readonly now: () => number
  private readonly logger: {
    info: (message: string, meta?: Record<string, unknown>) => void
    warn: (message: string, meta?: Record<string, unknown>) => void
  }
  private readonly tokenTtlSeconds?: number

  constructor(options: GitHubCredentialProviderOptions) {
    this.pluginInstanceId = options.pluginInstanceId
    this.cache = options.cache ?? new Map<string, CachedToken>()
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000))
    this.logger = options.logger ?? {
      info: (message: string, meta?: Record<string, unknown>) => console.log(message, meta ?? {}),
      warn: (message: string, meta?: Record<string, unknown>) => console.warn(message, meta ?? {}),
    }
    this.tokenTtlSeconds = options.tokenTtlSeconds
  }

  async getCredential(request: GitHubCredentialRequest): Promise<CredentialEnvelope> {
    const cacheKey = this.buildCacheKey(request)
    const cached = this.cache.get(cacheKey)
    if (cached && this.isFresh(cached)) {
      this.logger.info('[github-token] Served token from cache', {
        installationId: request.installationId,
        repositoryIds: request.repositoryIds,
      })
      return { token: cached.token, expiresAt: cached.expiresAt, source: 'cache' }
    }

    const config = await getGitHubAppConfig(this.pluginInstanceId)
    if (!config?.appId || !config.privateKey) {
      throw new Error('GitHub App credentials are not configured')
    }

    const auth = createAppAuth({
      appId: config.appId,
      privateKey: config.privateKey,
    })

    const appAuth = await auth({ type: 'app' })

    const body: Record<string, unknown> = {}
    if (request.repositoryIds && request.repositoryIds.length > 0) {
      body.repository_ids = request.repositoryIds
    }
    if (request.permissions) {
      body.permissions = request.permissions
    }

    const response = await fetch(
      `https://api.github.com/app/installations/${request.installationId}/access_tokens`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${appAuth.token}`,
          Accept: 'application/vnd.github+json',
        },
        body: JSON.stringify(body),
      }
    )

    if (!response.ok) {
      const errorBody = await response.text()
      const parsedError = tryParseJson(errorBody)
      const message = typeof parsedError?.message === 'string' ? parsedError.message : errorBody
      const documentationUrl =
        typeof parsedError?.documentation_url === 'string'
          ? parsedError.documentation_url
          : undefined

      this.logger.warn('[github-token] Failed to mint token', {
        pluginInstanceId: this.pluginInstanceId,
        installationId: request.installationId,
        repositoryIds: request.repositoryIds,
        requestedPermissions: request.permissions,
        configuredPermissionPreset: config.permissions?.preset,
        status: response.status,
        message,
        documentationUrl,
        errorBody,
      })
      throw new Error(`Failed to mint GitHub token (${response.status}): ${errorBody}`)
    }

    const payload = (await response.json()) as {
      token: string
      expires_at?: string
    }

    const now = this.now()
    const expiresAt = payload.expires_at
      ? Math.floor(Date.parse(payload.expires_at) / 1000)
      : now + DEFAULT_TOKEN_TTL_SECONDS

    const ttlSeconds = config.tokenTTL ?? this.tokenTtlSeconds ?? DEFAULT_TOKEN_TTL_SECONDS
    const cacheExpiresAt = Math.min(expiresAt, now + ttlSeconds)

    this.cache.set(cacheKey, {
      token: payload.token,
      expiresAt: cacheExpiresAt,
    })

    this.logger.info('[github-token] Minted installation token', {
      installationId: request.installationId,
      repositoryIds: request.repositoryIds,
    })

    return {
      token: payload.token,
      expiresAt: cacheExpiresAt,
      source: 'mint',
    }
  }

  private buildCacheKey(request: GitHubCredentialRequest): string {
    const repoKey =
      request.repositoryIds
        ?.slice()
        .sort((a, b) => a - b)
        .join(',') ?? 'all'
    const permissionsKey = request.permissions ? JSON.stringify(request.permissions) : 'default'
    return `${request.installationId}:${repoKey}:${permissionsKey}`
  }

  private isFresh(entry: CachedToken): boolean {
    return entry.expiresAt - DEFAULT_CACHE_SKEW_SECONDS > this.now()
  }
}
