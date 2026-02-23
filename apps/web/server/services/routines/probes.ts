import { createGitHubClientWithToken } from '@nitejar/connectors-github'
import { getDb } from '@nitejar/database'
import { GitHubCredentialProvider } from '@nitejar/plugin-handlers'
import { z } from 'zod'

export type RoutineConditionProbe =
  | 'github_stale_prs'
  | 'github_dependency_alerts'
  | 'ci_failure_rate'

const stalePrsConfigSchema = z.object({
  repoFullName: z.string().trim().min(3),
  thresholdDays: z.number().int().min(1).max(365).default(7),
  maxItems: z.number().int().min(1).max(100).default(50),
})

const dependencyAlertsConfigSchema = z.object({
  repoFullName: z.string().trim().min(3),
  maxItems: z.number().int().min(1).max(100).default(100),
})

const ciFailureRateConfigSchema = z.object({
  repoFullName: z.string().trim().min(3).optional(),
  windowDays: z.number().int().min(1).max(90).default(7),
  sampleSize: z.number().int().min(5).max(500).default(100),
})

function parseJsonObject(value: string | null): Record<string, unknown> {
  if (!value) return {}
  try {
    const parsed: unknown = JSON.parse(value)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // Ignore malformed JSON payloads.
  }
  return {}
}

function splitRepoFullName(repoFullName: string): { owner: string; repo: string } {
  const [owner, repo] = repoFullName.split('/')
  if (!owner || !repo) {
    throw new Error(`Invalid repoFullName: ${repoFullName}`)
  }
  return { owner, repo }
}

async function resolveRepoAuth(repoFullName: string): Promise<{
  owner: string
  repo: string
  pluginInstanceId: string
  installationId: number
  repoId: number
}> {
  const db = getDb()
  const repoRow = await db
    .selectFrom('github_repos')
    .innerJoin('github_installations', 'github_installations.id', 'github_repos.installation_id')
    .select([
      'github_repos.repo_id as repo_id',
      'github_repos.full_name as full_name',
      'github_installations.installation_id as installation_id',
      'github_installations.plugin_instance_id as plugin_instance_id',
    ])
    .where('github_repos.full_name', '=', repoFullName)
    .executeTakeFirst()

  if (!repoRow) {
    throw new Error(`GitHub repo not found for routine probe: ${repoFullName}`)
  }

  const { owner, repo } = splitRepoFullName(repoRow.full_name)

  return {
    owner,
    repo,
    pluginInstanceId: repoRow.plugin_instance_id,
    installationId: repoRow.installation_id,
    repoId: repoRow.repo_id,
  }
}

async function getGitHubToken(input: {
  pluginInstanceId: string
  installationId: number
  repoId: number
  permissions: Record<string, 'read' | 'write' | 'admin'>
}): Promise<string> {
  const provider = new GitHubCredentialProvider({ pluginInstanceId: input.pluginInstanceId })
  const credential = await provider.getCredential({
    installationId: input.installationId,
    repositoryIds: [input.repoId],
    permissions: input.permissions,
  })
  return credential.token
}

async function runGitHubStalePrsProbe(configInput: unknown): Promise<Record<string, unknown>> {
  const config = stalePrsConfigSchema.parse(configInput)
  const repoAuth = await resolveRepoAuth(config.repoFullName)
  const token = await getGitHubToken({
    pluginInstanceId: repoAuth.pluginInstanceId,
    installationId: repoAuth.installationId,
    repoId: repoAuth.repoId,
    permissions: {
      pull_requests: 'read',
      contents: 'read',
    },
  })

  const octokit = createGitHubClientWithToken(token)
  const response = await octokit.pulls.list({
    owner: repoAuth.owner,
    repo: repoAuth.repo,
    state: 'open',
    per_page: config.maxItems,
  })

  const thresholdSeconds = config.thresholdDays * 24 * 60 * 60
  const nowSeconds = Math.floor(Date.now() / 1000)

  const stalePrs = response.data
    .map((pr) => {
      const updatedAt = Math.floor(Date.parse(pr.updated_at) / 1000)
      const ageSeconds = nowSeconds - updatedAt
      return {
        number: pr.number,
        title: pr.title,
        url: pr.html_url,
        ageDays: Math.floor(ageSeconds / (24 * 60 * 60)),
        updatedAt,
      }
    })
    .filter((pr) => pr.ageDays * 24 * 60 * 60 >= thresholdSeconds)

  return {
    probe: 'github_stale_prs',
    repoFullName: config.repoFullName,
    thresholdDays: config.thresholdDays,
    totalOpenPrs: response.data.length,
    staleCount: stalePrs.length,
    stalePrs,
  }
}

function incrementSeverityCounter(
  bucket: Record<string, number>,
  severityRaw: unknown
): Record<string, number> {
  const severity = typeof severityRaw === 'string' ? severityRaw.toLowerCase() : 'unknown'
  const key = ['critical', 'high', 'medium', 'low'].includes(severity) ? severity : 'unknown'
  bucket[key] = (bucket[key] ?? 0) + 1
  return bucket
}

async function runGitHubDependencyAlertsProbe(
  configInput: unknown
): Promise<Record<string, unknown>> {
  const config = dependencyAlertsConfigSchema.parse(configInput)
  const repoAuth = await resolveRepoAuth(config.repoFullName)

  const token = await getGitHubToken({
    pluginInstanceId: repoAuth.pluginInstanceId,
    installationId: repoAuth.installationId,
    repoId: repoAuth.repoId,
    permissions: {
      security_events: 'read',
      contents: 'read',
    },
  })

  const octokit = createGitHubClientWithToken(token)

  const dependabotResponse = await octokit.request('GET /repos/{owner}/{repo}/dependabot/alerts', {
    owner: repoAuth.owner,
    repo: repoAuth.repo,
    state: 'open',
    per_page: config.maxItems,
  })

  const codeScanningResponse = await octokit.request(
    'GET /repos/{owner}/{repo}/code-scanning/alerts',
    {
      owner: repoAuth.owner,
      repo: repoAuth.repo,
      state: 'open',
      per_page: config.maxItems,
    }
  )

  const bySeverity: Record<string, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    unknown: 0,
  }

  for (const alert of dependabotResponse.data as Array<Record<string, unknown>>) {
    const advisory =
      alert.security_advisory && typeof alert.security_advisory === 'object'
        ? (alert.security_advisory as Record<string, unknown>)
        : null
    incrementSeverityCounter(bySeverity, advisory?.severity)
  }

  for (const alert of codeScanningResponse.data as Array<Record<string, unknown>>) {
    const rule =
      alert.rule && typeof alert.rule === 'object' ? (alert.rule as Record<string, unknown>) : null
    incrementSeverityCounter(bySeverity, rule?.severity ?? alert.severity)
  }

  return {
    probe: 'github_dependency_alerts',
    repoFullName: config.repoFullName,
    dependabotOpenAlerts: dependabotResponse.data.length,
    codeScanningOpenAlerts: codeScanningResponse.data.length,
    totalOpenAlerts: dependabotResponse.data.length + codeScanningResponse.data.length,
    bySeverity,
  }
}

async function runCiFailureRateProbe(configInput: unknown): Promise<Record<string, unknown>> {
  const config = ciFailureRateConfigSchema.parse(configInput)

  const windowStart = Math.floor(Date.now() / 1000) - config.windowDays * 24 * 60 * 60
  const db = getDb()
  const query = db
    .selectFrom('work_items')
    .select(['payload', 'created_at'])
    .where('source', '=', 'github')
    .where('created_at', '>=', windowStart)
    .orderBy('created_at', 'desc')
    .limit(config.sampleSize)

  const repoFilter = config.repoFullName?.toLowerCase() ?? null
  const rows = await query.execute()

  const checkRuns: Array<{ conclusion: string; repoFullName: string | null }> = []
  for (const row of rows) {
    const payload = parseJsonObject(row.payload)
    if (payload.type !== 'check_run') {
      continue
    }

    const owner = typeof payload.owner === 'string' ? payload.owner : null
    const repo = typeof payload.repo === 'string' ? payload.repo : null
    const repoFullName = owner && repo ? `${owner}/${repo}` : null
    if (repoFilter && repoFullName?.toLowerCase() !== repoFilter) {
      continue
    }

    const conclusionRaw = typeof payload.conclusion === 'string' ? payload.conclusion : 'unknown'
    checkRuns.push({
      conclusion: conclusionRaw.toLowerCase(),
      repoFullName,
    })
  }

  const failureConclusions = new Set([
    'failure',
    'timed_out',
    'cancelled',
    'action_required',
    'startup_failure',
  ])

  const failureCount = checkRuns.filter((run) => failureConclusions.has(run.conclusion)).length
  const total = checkRuns.length
  const failureRate = total === 0 ? 0 : failureCount / total

  const byConclusion: Record<string, number> = {}
  for (const run of checkRuns) {
    byConclusion[run.conclusion] = (byConclusion[run.conclusion] ?? 0) + 1
  }

  return {
    probe: 'ci_failure_rate',
    repoFullName: config.repoFullName ?? null,
    windowDays: config.windowDays,
    sampleSize: config.sampleSize,
    totalChecks: total,
    failedChecks: failureCount,
    failureRate,
    byConclusion,
  }
}

export async function runConditionProbe(
  probe: string,
  probeConfigJson: string | null
): Promise<Record<string, unknown>> {
  const configInput = parseJsonObject(probeConfigJson)

  switch (probe as RoutineConditionProbe) {
    case 'github_stale_prs':
      return runGitHubStalePrsProbe(configInput)
    case 'github_dependency_alerts':
      return runGitHubDependencyAlertsProbe(configInput)
    case 'ci_failure_rate':
      return runCiFailureRateProbe(configInput)
    default:
      throw new Error(`Unsupported routine condition probe: ${probe}`)
  }
}
