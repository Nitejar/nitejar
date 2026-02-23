import type OpenAI from 'openai'
import { getDb, type Agent, type WorkItem } from '@nitejar/database'
import {
  registerIntegrationProvider,
  type IntegrationProvider,
  type PromptSection,
} from './registry'
import type { WorkItemPayload } from '../types'
import { sanitize, wrapBoundary } from '../prompt-sanitize'

// ---------------------------------------------------------------------------
// Prompt constants (moved from prompt-builder.ts)
// ---------------------------------------------------------------------------

const GITHUB_WORKFLOW_PROMPT = `GitHub workflow rules:
- GitHub credentials are set in GH_TOKEN/GITHUB_TOKEN. If you need to mint credentials, call the configure_github_credentials tool with the repo name.
- If credential minting fails with "permissions requested are not granted", treat it as a GitHub App permissions/install issue and ask to fix app permissions + installation.
- Prefer git + gh CLI for GitHub operations. If gh is missing, install it or use curl.
- If network calls fail due policy or egress issues, call refresh_network_policy before retrying.
- By convention, clone repositories into /home/sprite/repos/<owner>/<repo> for consistency.
- After pushing code, open a PR and request review.
- Do not merge without explicit human approval via Telegram.
- If asked to review, fetch PR details/diff (gh pr view/diff or curl) and submit a formal review (gh pr review --approve/--request-changes).
- If asked to author, use git + gh/curl to create the PR (gh pr create) and request review (gh pr request-review).
- If approval arrives via Telegram reply context, merge via gh pr merge (or curl) after confirming PR details.
- Avoid Octokit wrapper APIs when CLI access is available.`

const GITHUB_PLATFORM_PROMPT = `Platform: GitHub
You are responding on a GitHub issue or pull request. Your final text response is automatically posted as a comment — do NOT use gh issue comment or the API to post your reply.

Response formatting rules:
- Use standard GitHub-flavored markdown
- Use code blocks with language hints (e.g. \`\`\`python)
- Reference issues/PRs with #number syntax`

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeParsePayload(payload: string | null): WorkItemPayload | null {
  if (!payload) return null
  try {
    return JSON.parse(payload) as WorkItemPayload
  } catch {
    return null
  }
}

async function getAgentRepoAccess(
  agentId: string
): Promise<{ full_name: string; capabilities: string[] }[]> {
  try {
    const db = getDb()
    const rows = await db
      .selectFrom('agent_repo_capabilities')
      .innerJoin('github_repos', 'github_repos.id', 'agent_repo_capabilities.github_repo_id')
      .select(['github_repos.full_name', 'agent_repo_capabilities.capabilities'])
      .where('agent_repo_capabilities.agent_id', '=', agentId)
      .execute()

    return rows.map((row) => ({
      full_name: row.full_name,
      capabilities: JSON.parse(row.capabilities) as string[],
    }))
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

const githubProvider: IntegrationProvider = {
  integrationType: 'github',

  async getSystemPromptSections(agent: Agent): Promise<PromptSection[]> {
    const sections: PromptSection[] = []

    // Platform formatting (only when work item source is GitHub — handled by runner
    // which calls this for all enabled plugin-instance channels, so we always contribute the
    // workflow rules, and the platform prompt is gated separately via preamble/source)
    sections.push({
      id: 'github:workflow',
      content: GITHUB_WORKFLOW_PROMPT,
      priority: 10,
    })

    // Repo access list
    const repoAccess = await getAgentRepoAccess(agent.id)
    if (repoAccess.length > 0) {
      const repoLines = repoAccess.map((r) => `- ${r.full_name} (${r.capabilities.join(', ')})`)
      sections.push({
        id: 'github:repo-access',
        content: `You have GitHub access to the following repositories:\n${repoLines.join('\n')}\n\nTo work with a repo, call configure_github_credentials with the repo name to mint a token.`,
        priority: 11,
      })
    }

    // Platform-specific formatting prompt (contributed at a different priority so it
    // sits next to the Telegram platform prompt if both are present)
    sections.push({
      id: 'github:platform',
      content: GITHUB_PLATFORM_PROMPT,
      priority: 5,
    })

    return sections
  },

  getPreambleMessage(workItem: WorkItem): OpenAI.ChatCompletionMessageParam | null {
    return buildIssuePreamble(workItem)
  },

  getPreambleLabel(workItem: WorkItem): string | null {
    const payload = safeParsePayload(workItem.payload)
    if (!payload) return null

    if (payload.type === 'check_run') {
      const checkName = (payload.checkName as string) ?? 'CI'
      return `CI Check: ${checkName}`
    }

    const label = payload.isPullRequest ? 'PR' : 'Issue'
    const issueNumber = payload.issueNumber as number | undefined
    const num = issueNumber ? `#${issueNumber}` : ''
    const title = (payload.issueTitle as string) ?? ''
    return [label, num, title].filter(Boolean).join(' ') || null
  },

  getDirectoryContextHint(workItem: WorkItem): string | null {
    return getLikelyGitHubRepoCwd(workItem)
  },
}

// ---------------------------------------------------------------------------
// Public helpers (re-exported for triage.ts compatibility)
// ---------------------------------------------------------------------------

/**
 * Build an issue/PR preamble for GitHub sessions.
 * Injected as a user-role message before session history so the agent always
 * knows what issue/PR the conversation is about.
 */
export function buildIssuePreamble(workItem: WorkItem): OpenAI.ChatCompletionMessageParam | null {
  const payload = safeParsePayload(workItem.payload)
  if (!payload) return null

  // Handle check_run CI events
  if (payload.type === 'check_run') {
    const parts: string[] = []
    const checkName = sanitize((payload.checkName as string) ?? 'unknown')
    const conclusion = (payload.conclusion as string) ?? 'unknown'
    parts.push(`[CI Check: ${checkName} — ${conclusion}]`)

    const pullRequests = payload.pullRequests as
      | Array<{ number: number; head?: { ref?: string }; base?: { ref?: string } }>
      | undefined
    if (pullRequests && pullRequests.length > 0) {
      const pr = pullRequests[0]!
      const headRef = pr.head?.ref ?? 'unknown'
      const baseRef = pr.base?.ref ?? 'unknown'
      parts.push(`PR: #${pr.number} (${headRef} → ${baseRef})`)
    }

    const headSha = payload.headSha as string | undefined
    if (headSha) {
      parts.push(`SHA: ${headSha}`)
    }

    const detailsUrl = payload.detailsUrl as string | undefined
    if (detailsUrl) {
      parts.push(`Details: ${detailsUrl}`)
    }

    const outputTitle = payload.outputTitle as string | undefined
    const outputSummary = payload.outputSummary as string | undefined
    if (outputTitle && outputSummary) {
      parts.push(`${sanitize(outputTitle)}: ${sanitize(outputSummary)}`)
    } else if (outputSummary) {
      parts.push(sanitize(outputSummary))
    }

    parts.push('')
    parts.push('This is an automated CI notification, not a human message.')
    parts.push('Only respond if the result is relevant to work you are actively doing.')
    parts.push('If you did not create this PR or are not working on it, pass.')

    return {
      role: 'user',
      content: wrapBoundary('preamble', parts.join('\n'), { source: 'github-ci' }),
    }
  }

  const issueTitle = payload.issueTitle as string | undefined
  const issueNumber = payload.issueNumber as number | undefined
  if (!issueTitle && !issueNumber) return null

  const parts: string[] = []

  // Header with issue/PR number and title
  const label = payload.isPullRequest ? 'Pull Request' : 'Issue'
  if (issueNumber && issueTitle) {
    parts.push(`[${label} #${issueNumber}: ${sanitize(issueTitle)}]`)
  } else if (issueTitle) {
    parts.push(`[${label}: ${sanitize(issueTitle)}]`)
  }

  // Issue state
  const issueState = payload.issueState as string | undefined
  if (issueState) {
    parts.push(`State: ${issueState}`)
  }

  // Issue URL
  const issueUrl = payload.issueUrl as string | undefined
  if (issueUrl) {
    parts.push(`URL: ${issueUrl}`)
  }

  // Issue body (the original description)
  const issueBody = payload.issueBody as string | undefined
  if (issueBody) {
    parts.push(`\n${sanitize(issueBody)}`)
  }

  if (parts.length === 0) return null

  return {
    role: 'user',
    content: wrapBoundary('preamble', parts.join('\n'), { source: 'github-issue' }),
  }
}

/**
 * Best-effort repo cwd guess for GitHub work items.
 * Convention: /home/sprite/repos/<owner>/<repo>
 */
export function getLikelyGitHubRepoCwd(workItem: WorkItem): string | null {
  const payload = safeParsePayload(workItem.payload)
  const owner = typeof payload?.owner === 'string' ? payload.owner : null
  const repo = typeof payload?.repo === 'string' ? payload.repo : null
  if (owner && repo) {
    return `/home/sprite/repos/${owner}/${repo}`
  }

  // Fallback to source_ref pattern: "owner/repo#issue:123..."
  const match = workItem.source_ref.match(/^([^/]+)\/([^#]+)#/)
  if (!match) return null

  return `/home/sprite/repos/${match[1]}/${match[2]}`
}

// ---------------------------------------------------------------------------
// Self-register
// ---------------------------------------------------------------------------

registerIntegrationProvider(githubProvider)
