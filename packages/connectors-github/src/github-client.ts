import { Octokit } from '@octokit/rest'
import { createAppAuth } from '@octokit/auth-app'

export interface GitHubAppConfig {
  appId: string
  privateKey: string
  installationId: number
}

/**
 * Creates an Octokit client authenticated as a GitHub App installation.
 * Use this for production with proper GitHub App auth.
 */
export function createGitHubClient(config: GitHubAppConfig): Octokit {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: config.appId,
      privateKey: config.privateKey,
      installationId: config.installationId,
    },
  })
}

/**
 * Creates an Octokit client authenticated with an access token.
 * Used for short-lived installation tokens minted by the GitHub credential provider.
 */
export function createGitHubClientWithToken(token: string): Octokit {
  return new Octokit({
    auth: token,
  })
}
