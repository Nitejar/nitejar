/**
 * GitHub plugin instance configuration
 */
export interface GitHubConfig {
  /** GitHub App ID (for App authentication) */
  appId?: string
  /** GitHub App slug (manifest flow) */
  appSlug?: string
  /** GitHub App client ID (manifest flow) */
  clientId?: string
  /** GitHub App client secret (manifest flow) */
  clientSecret?: string
  /** GitHub App private key (for App authentication) */
  privateKey?: string
  /** Webhook secret for signature verification */
  webhookSecret?: string
  /** Optional: only process webhooks from these repos */
  allowedRepos?: string[]
  /** Permissions preset selection for manifest generation */
  permissions?: GitHubPermissionsConfig
  /** Token time-to-live (seconds) */
  tokenTTL?: number
  /** How to handle issue_comment events */
  commentPolicy?: GitHubCommentPolicy
  /** Mention handle used when commentPolicy = 'mentions' */
  mentionHandle?: string
  /** Whether to create work items for opened/reopened issues */
  trackIssueOpen?: boolean
  /** Whether to create work items for completed check runs on PRs */
  trackCheckRun?: boolean
  /** Indicates manifest registration is in progress */
  manifestPending?: boolean
}

export type GitHubPermissionLevel = 'read' | 'write' | 'admin'
export type GitHubPermissionPreset = 'minimal' | 'robust'
export type GitHubCommentPolicy = 'all' | 'mentions'

export interface GitHubPermissionsConfig {
  preset: GitHubPermissionPreset
  overrides?: Record<string, GitHubPermissionLevel>
}

export const GITHUB_SENSITIVE_FIELDS = ['privateKey', 'clientSecret', 'webhookSecret'] as const

/**
 * Context for responding to GitHub events
 */
export interface GitHubResponseContext {
  owner: string
  repo: string
  issueNumber: number
  installationId?: number
}

/**
 * GitHub webhook payload types we care about
 */
export interface GitHubIssueCommentPayload {
  action: 'created' | 'edited' | 'deleted'
  issue: {
    number: number
    title: string
    body: string | null
    state: string
    user: {
      login: string
      id: number
    }
    html_url: string
  }
  comment: {
    id: number
    body: string
    user: {
      login: string
      id: number
    }
    created_at: string
    html_url: string
  }
  repository: {
    name: string
    full_name: string
    owner: {
      login: string
    }
  }
  installation?: {
    id: number
  }
  sender: {
    login: string
    id: number
    type: string
  }
}

export interface GitHubIssuesPayload {
  action:
    | 'opened'
    | 'edited'
    | 'closed'
    | 'reopened'
    | 'assigned'
    | 'unassigned'
    | 'labeled'
    | 'unlabeled'
  issue: {
    number: number
    title: string
    body: string | null
    state: string
    user: {
      login: string
      id: number
    }
    html_url: string
  }
  repository: {
    name: string
    full_name: string
    owner: {
      login: string
    }
  }
  installation?: {
    id: number
  }
  sender: {
    login: string
    id: number
    type: string
  }
}

export interface GitHubCheckRunPayload {
  action: 'created' | 'completed' | 'rerequested' | 'requested_action'
  check_run: {
    id: number
    name: string
    head_sha: string
    status: string
    conclusion: string | null
    started_at: string | null
    completed_at: string | null
    html_url: string
    details_url: string | null
    output: {
      title: string | null
      summary: string | null
      text: string | null
    }
    pull_requests: Array<{
      number: number
      head: { ref: string; sha: string }
      base: { ref: string; sha: string }
    }>
    app: { name: string; slug: string } | null
  }
  repository: {
    name: string
    full_name: string
    owner: { login: string }
  }
  installation?: { id: number }
  sender: { login: string; id: number; type: string }
}
