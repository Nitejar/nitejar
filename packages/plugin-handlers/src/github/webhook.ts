import { getDb, type PluginInstanceRecord } from '@nitejar/database'
import {
  verifyGithubWebhook,
  sessionKeyFromIssue,
  sourceRefFromComment,
} from '@nitejar/connectors-github'
import type { WebhookParseResult } from '../types'
import type {
  GitHubConfig,
  GitHubCommentPolicy,
  GitHubResponseContext,
  GitHubIssueCommentPayload,
  GitHubIssuesPayload,
  GitHubCheckRunPayload,
} from './types'
import { parseGitHubConfig } from './config'
import { extractImagesFromComment, extractImagesFromIssue } from './attachments'

interface InstallationAccount {
  id?: number
  login?: string
}

interface RepoSummary {
  id: number
  full_name: string
  html_url?: string
}

interface InstallationEventPayload {
  action?: string
  installation?: {
    id?: number
    account?: InstallationAccount
  }
  repositories_added?: RepoSummary[]
  repositories_removed?: RepoSummary[]
}

const DEFAULT_COMMENT_POLICY: GitHubCommentPolicy = 'all'
const DEFAULT_MENTION_HANDLE = '@nitejar'
const DEFAULT_TRACK_ISSUE_OPEN = true
const DEFAULT_TRACK_CHECK_RUN = true
const now = () => Math.floor(Date.now() / 1000)

/**
 * Parse a GitHub webhook
 */
export async function parseGitHubWebhook(
  request: Request,
  pluginInstance: PluginInstanceRecord
): Promise<WebhookParseResult> {
  const config = parseGitHubConfig(pluginInstance)
  if (!config && pluginInstance.config) {
    console.warn('Failed to parse GitHub plugin instance config')
  }

  const commentPolicy = config?.commentPolicy ?? DEFAULT_COMMENT_POLICY
  const mentionHandleRaw = (config?.mentionHandle ?? DEFAULT_MENTION_HANDLE).trim()
  const mentionHandle = mentionHandleRaw.length > 0 ? mentionHandleRaw : DEFAULT_MENTION_HANDLE
  const trackIssueOpen = config?.trackIssueOpen ?? DEFAULT_TRACK_ISSUE_OPEN
  const trackCheckRun = config?.trackCheckRun ?? DEFAULT_TRACK_CHECK_RUN

  // Get the raw body for signature verification
  const rawBody = await request.text()

  // Verify webhook signature if secret is configured
  if (config?.webhookSecret) {
    const signature = request.headers.get('x-hub-signature-256')
    if (!signature || !verifyGithubWebhook(rawBody, signature, config.webhookSecret)) {
      console.warn('GitHub webhook signature verification failed')
      return { shouldProcess: false }
    }
  }

  // Parse the body
  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    console.warn('Failed to parse GitHub webhook body')
    return { shouldProcess: false }
  }

  // Get event type
  const eventType = request.headers.get('x-github-event')
  const deliveryId = request.headers.get('x-github-delivery')

  if (!eventType) {
    return { shouldProcess: false }
  }

  // Route to appropriate handler
  switch (eventType) {
    case 'installation':
      await handleInstallationEvent(payload as InstallationEventPayload, pluginInstance.id)
      return { shouldProcess: false }
    case 'installation_repositories':
      await handleInstallationRepositoriesEvent(
        payload as InstallationEventPayload,
        pluginInstance.id
      )
      return { shouldProcess: false }
    case 'issue_comment':
      if (!deliveryId) return { shouldProcess: false }
      return await handleIssueComment(payload as GitHubIssueCommentPayload, deliveryId, config, {
        commentPolicy,
        mentionHandle,
      })
    case 'issues':
      if (!deliveryId) return { shouldProcess: false }
      return await handleIssues(payload as GitHubIssuesPayload, deliveryId, config, {
        trackIssueOpen,
      })
    case 'check_run':
      if (!deliveryId) return { shouldProcess: false }
      return handleCheckRun(payload as GitHubCheckRunPayload, deliveryId, config, {
        trackCheckRun,
      })
    default:
      // Ignore other events
      return { shouldProcess: false }
  }
}

/**
 * Handle issue_comment events
 */
async function handleIssueComment(
  payload: GitHubIssueCommentPayload,
  deliveryId: string,
  config: GitHubConfig | null,
  options: { commentPolicy: GitHubCommentPolicy; mentionHandle: string }
): Promise<WebhookParseResult> {
  // Only handle new comments
  if (payload.action !== 'created') {
    return { shouldProcess: false }
  }

  // Ignore bot comments
  if (payload.sender.type === 'Bot') {
    return { shouldProcess: false }
  }

  if (options.commentPolicy === 'mentions') {
    const body = payload.comment?.body ?? ''
    const mention = options.mentionHandle.toLowerCase()
    if (!body.toLowerCase().includes(mention)) {
      return { shouldProcess: false }
    }
  }

  const { repository, issue, comment, installation } = payload
  const owner = repository.owner.login
  const repo = repository.name

  // Check allowed repos
  if (config?.allowedRepos && config.allowedRepos.length > 0) {
    if (!config.allowedRepos.includes(repository.full_name)) {
      return { shouldProcess: false }
    }
  }

  // Extract images from the comment via GitHub API (best-effort)
  let attachments: { type: 'image'; dataUrl: string; mimeType: string; fileSize: number }[] = []
  if (config && installation?.id) {
    try {
      attachments = await extractImagesFromComment(
        { config, installationId: installation.id, owner, repo },
        issue.number,
        comment.id
      )
    } catch (e) {
      console.warn('Failed to extract images from GitHub comment:', e)
    }
  }

  const responseContext: GitHubResponseContext = {
    owner,
    repo,
    issueNumber: issue.number,
    installationId: installation?.id,
  }

  return {
    shouldProcess: true,
    workItem: {
      session_key: sessionKeyFromIssue({ owner, repo, issueNumber: issue.number }),
      source: 'github',
      source_ref: sourceRefFromComment({
        owner,
        repo,
        issueNumber: issue.number,
        commentId: comment.id,
      }),
      title: truncate(`[${owner}/${repo}#${issue.number}] ${issue.title}`, 200),
      payload: JSON.stringify({
        type: 'issue_comment',
        body: comment.body,
        issueTitle: issue.title,
        issueBody: issue.body,
        issueNumber: issue.number,
        issueState: issue.state,
        issueUrl: issue.html_url,
        commentId: comment.id,
        commentUrl: comment.html_url,
        owner,
        repo,
        author: comment.user.login,
        authorId: comment.user.id,
        senderName: comment.user.login,
        senderUsername: comment.user.login,
        actor: {
          kind: 'human',
          externalId: String(comment.user.id),
          handle: comment.user.login,
          displayName: comment.user.login,
          source: 'github',
        },
        source: 'GitHub',
        installationId: installation?.id,
        timestamp: comment.created_at,
        attachments: attachments.length > 0 ? attachments : undefined,
      }),
      status: 'NEW',
    },
    idempotencyKey: `github:${deliveryId}`,
    responseContext,
  }
}

/**
 * Handle issues events (opened, reopened)
 */
async function handleIssues(
  payload: GitHubIssuesPayload,
  deliveryId: string,
  config: GitHubConfig | null,
  options: { trackIssueOpen: boolean }
): Promise<WebhookParseResult> {
  if (!options.trackIssueOpen) {
    return { shouldProcess: false }
  }

  // Only handle new or reopened issues
  if (payload.action !== 'opened' && payload.action !== 'reopened') {
    return { shouldProcess: false }
  }

  // Ignore bot-created issues
  if (payload.sender.type === 'Bot') {
    return { shouldProcess: false }
  }

  const { repository, issue, installation } = payload
  const owner = repository.owner.login
  const repo = repository.name

  // Check allowed repos
  if (config?.allowedRepos && config.allowedRepos.length > 0) {
    if (!config.allowedRepos.includes(repository.full_name)) {
      return { shouldProcess: false }
    }
  }

  // Extract images from the issue body via GitHub API (best-effort)
  let attachments: { type: 'image'; dataUrl: string; mimeType: string; fileSize: number }[] = []
  if (config && installation?.id) {
    try {
      attachments = await extractImagesFromIssue(
        { config, installationId: installation.id, owner, repo },
        issue.number
      )
    } catch (e) {
      console.warn('Failed to extract images from GitHub issue:', e)
    }
  }

  const responseContext: GitHubResponseContext = {
    owner,
    repo,
    issueNumber: issue.number,
    installationId: installation?.id,
  }

  return {
    shouldProcess: true,
    workItem: {
      session_key: sessionKeyFromIssue({ owner, repo, issueNumber: issue.number }),
      source: 'github',
      source_ref: `${owner}/${repo}#issue:${issue.number}`,
      title: truncate(`[${owner}/${repo}#${issue.number}] ${issue.title}`, 200),
      payload: JSON.stringify({
        type: 'issue',
        action: payload.action,
        body: issue.body,
        issueTitle: issue.title,
        issueNumber: issue.number,
        issueState: issue.state,
        issueUrl: issue.html_url,
        owner,
        repo,
        author: issue.user.login,
        authorId: issue.user.id,
        senderName: issue.user.login,
        senderUsername: issue.user.login,
        actor: {
          kind: 'human',
          externalId: String(issue.user.id),
          handle: issue.user.login,
          displayName: issue.user.login,
          source: 'github',
        },
        source: 'GitHub',
        installationId: installation?.id,
        attachments: attachments.length > 0 ? attachments : undefined,
      }),
      status: 'NEW',
    },
    idempotencyKey: `github:${deliveryId}`,
    responseContext,
  }
}

function handleCheckRun(
  payload: GitHubCheckRunPayload,
  deliveryId: string,
  config: GitHubConfig | null,
  options: { trackCheckRun: boolean }
): WebhookParseResult {
  if (!options.trackCheckRun) return { shouldProcess: false }
  if (payload.action !== 'completed') return { shouldProcess: false }

  const pullRequests = payload.check_run.pull_requests
  if (!pullRequests || pullRequests.length === 0) return { shouldProcess: false }

  const { repository, check_run, installation } = payload
  const owner = repository.owner.login
  const repo = repository.name

  if (config?.allowedRepos?.length && !config.allowedRepos.includes(repository.full_name)) {
    return { shouldProcess: false }
  }

  const primaryPR = pullRequests[0]!
  const conclusion = check_run.conclusion ?? 'unknown'

  const responseContext: GitHubResponseContext = {
    owner,
    repo,
    issueNumber: primaryPR.number,
    installationId: installation?.id,
  }

  return {
    shouldProcess: true,
    workItem: {
      session_key: sessionKeyFromIssue({ owner, repo, issueNumber: primaryPR.number }),
      source: 'github',
      source_ref: `${owner}/${repo}#pr:${primaryPR.number}#check:${check_run.id}`,
      title: truncate(
        `[${owner}/${repo}#${primaryPR.number}] CI: ${check_run.name} — ${conclusion}`,
        200
      ),
      payload: JSON.stringify({
        type: 'check_run',
        checkRunId: check_run.id,
        checkName: check_run.name,
        conclusion,
        headSha: check_run.head_sha,
        detailsUrl: check_run.details_url,
        htmlUrl: check_run.html_url,
        outputTitle: check_run.output.title,
        outputSummary: check_run.output.summary,
        appName: check_run.app?.name ?? null,
        senderName: check_run.app?.name ?? 'GitHub Checks',
        actor: {
          kind: 'system',
          externalId: check_run.app?.slug ?? undefined,
          handle: check_run.app?.slug ?? undefined,
          displayName: check_run.app?.name ?? 'GitHub Checks',
          source: 'github',
        },
        pullRequests: pullRequests.map((pr) => ({
          number: pr.number,
          headRef: pr.head.ref,
          baseRef: pr.base.ref,
        })),
        owner,
        repo,
        installationId: installation?.id,
      }),
      status: 'NEW',
    },
    idempotencyKey: `github:${deliveryId}`,
    responseContext,
  }
}

async function handleInstallationEvent(
  payload: InstallationEventPayload,
  pluginInstanceId: string
): Promise<void> {
  const installationId = payload.installation?.id
  if (!installationId) {
    return
  }

  if (payload.action === 'deleted') {
    const db = getDb()
    await db
      .deleteFrom('github_installations')
      .where('installation_id', '=', installationId)
      .execute()
    return
  }

  if (payload.action === 'created') {
    await ensureInstallation({
      installationId,
      pluginInstanceId,
      account: payload.installation?.account,
    })
  }
}

async function handleInstallationRepositoriesEvent(
  payload: InstallationEventPayload,
  pluginInstanceId: string
): Promise<void> {
  const installationId = payload.installation?.id
  if (!installationId) {
    return
  }

  const installationRowId = await ensureInstallation({
    installationId,
    pluginInstanceId,
    account: payload.installation?.account,
  })

  if (!installationRowId) {
    return
  }

  const addedRepos = payload.repositories_added ?? []
  const removedRepos = payload.repositories_removed ?? []

  await Promise.all(addedRepos.map((repo) => upsertRepository({ installationRowId, repo })))

  if (removedRepos.length > 0) {
    const db = getDb()
    await db
      .deleteFrom('github_repos')
      .where(
        'repo_id',
        'in',
        removedRepos.map((repo) => repo.id)
      )
      .execute()
  }
}

async function ensureInstallation(params: {
  installationId: number
  pluginInstanceId: string
  account?: InstallationAccount
}): Promise<number | null> {
  const db = getDb()
  const timestamp = now()
  const updateValues: Record<string, unknown> = {
    plugin_instance_id: params.pluginInstanceId,
    updated_at: timestamp,
  }

  if (params.account?.login !== undefined) {
    updateValues.account_login = params.account.login
  }

  if (params.account?.id !== undefined) {
    updateValues.account_id = params.account.id
  }

  await db
    .insertInto('github_installations')
    .values({
      installation_id: params.installationId,
      account_login: params.account?.login ?? null,
      account_id: params.account?.id ?? null,
      plugin_instance_id: params.pluginInstanceId,
      created_at: timestamp,
      updated_at: timestamp,
    })
    .onConflict((oc) => oc.column('installation_id').doUpdateSet(updateValues))
    .execute()

  const record = await db
    .selectFrom('github_installations')
    .select(['id'])
    .where('installation_id', '=', params.installationId)
    .executeTakeFirst()

  return record?.id ?? null
}

async function upsertRepository(params: {
  installationRowId: number
  repo: RepoSummary
}): Promise<void> {
  const db = getDb()
  const timestamp = now()

  await db
    .insertInto('github_repos')
    .values({
      repo_id: params.repo.id,
      full_name: params.repo.full_name,
      html_url: params.repo.html_url ?? null,
      installation_id: params.installationRowId,
      created_at: timestamp,
      updated_at: timestamp,
    })
    .onConflict((oc) =>
      oc.column('repo_id').doUpdateSet({
        full_name: params.repo.full_name,
        html_url: params.repo.html_url ?? null,
        installation_id: params.installationRowId,
        updated_at: timestamp,
      })
    )
    .execute()
}

/**
 * Truncate a string to a maximum length
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str
  }
  return str.slice(0, maxLength - 3) + '...'
}
