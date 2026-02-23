import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { getDb } from '@nitejar/database'
import { createAppAuth, getGitHubAppConfig } from '@nitejar/plugin-handlers'
import { protectedProcedure, router } from '../trpc'

const capabilitySchema = z.enum([
  'read_repo',
  'create_branch',
  'push_branch',
  'open_pr',
  'comment',
  'request_review',
  'label_issue_pr',
  'review_pr',
  'merge_pr',
])

export const capabilitiesRouter = router({
  listRepos: protectedProcedure
    .input(z.object({ pluginInstanceId: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb()
      let query = db
        .selectFrom('github_repos')
        .innerJoin(
          'github_installations',
          'github_installations.id',
          'github_repos.installation_id'
        )
        .select([
          'github_repos.id as id',
          'github_repos.full_name as full_name',
          'github_repos.html_url as html_url',
          'github_installations.account_login as account_login',
          'github_installations.installation_id as installation_id',
        ])
        .orderBy('github_repos.full_name', 'asc')

      if (input?.pluginInstanceId) {
        query = query.where('github_installations.plugin_instance_id', '=', input.pluginInstanceId)
      }

      return query.execute()
    }),

  listAssignments: protectedProcedure
    .input(z.object({ pluginInstanceId: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb()
      let query = db
        .selectFrom('agent_repo_capabilities')
        .innerJoin('agents', 'agents.id', 'agent_repo_capabilities.agent_id')
        .innerJoin('github_repos', 'github_repos.id', 'agent_repo_capabilities.github_repo_id')
        .innerJoin(
          'github_installations',
          'github_installations.id',
          'github_repos.installation_id'
        )
        .select([
          'agent_repo_capabilities.agent_id as agent_id',
          'agent_repo_capabilities.github_repo_id as github_repo_id',
          'agent_repo_capabilities.capabilities as capabilities',
          'agents.name as agent_name',
          'agents.handle as agent_handle',
          'github_repos.full_name as repo_full_name',
          'github_repos.html_url as repo_html_url',
        ])
        .orderBy('agents.name', 'asc')

      if (input?.pluginInstanceId) {
        query = query.where('github_installations.plugin_instance_id', '=', input.pluginInstanceId)
      }

      const rows = await query.execute()

      return rows.map((row) => {
        let parsed: string[] = []
        try {
          parsed = JSON.parse(row.capabilities) as string[]
        } catch {
          parsed = []
        }

        return {
          agentId: row.agent_id,
          agentName: row.agent_name,
          agentHandle: row.agent_handle,
          repoId: row.github_repo_id,
          repoFullName: row.repo_full_name,
          repoHtmlUrl: row.repo_html_url,
          capabilities: parsed,
        }
      })
    }),

  upsert: protectedProcedure
    .input(
      z.object({
        agentId: z.string(),
        repoId: z.number().int(),
        capabilities: z.array(capabilitySchema),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb()
      const capabilities = JSON.stringify(input.capabilities)

      if (input.capabilities.length === 0) {
        await db
          .deleteFrom('agent_repo_capabilities')
          .where('agent_id', '=', input.agentId)
          .where('github_repo_id', '=', input.repoId)
          .execute()

        return { ok: true, deleted: true }
      }

      await db
        .insertInto('agent_repo_capabilities')
        .values({
          agent_id: input.agentId,
          github_repo_id: input.repoId,
          capabilities,
        })
        .onConflict((oc) =>
          oc.columns(['agent_id', 'github_repo_id']).doUpdateSet({
            capabilities,
          })
        )
        .execute()

      return { ok: true }
    }),

  checkBranchProtection: protectedProcedure
    .input(
      z.object({
        pluginInstanceId: z.string(),
        repoIds: z.array(z.number().int()),
      })
    )
    .query(async ({ input }) => {
      const db = getDb()

      // Look up repos and their installations
      const repos = await db
        .selectFrom('github_repos')
        .innerJoin(
          'github_installations',
          'github_installations.id',
          'github_repos.installation_id'
        )
        .select([
          'github_repos.id as id',
          'github_repos.full_name as full_name',
          'github_repos.repo_id as repo_id',
          'github_installations.installation_id as installation_id',
          'github_installations.plugin_instance_id as plugin_instance_id',
        ])
        .where('github_repos.id', 'in', input.repoIds)
        .where('github_installations.plugin_instance_id', '=', input.pluginInstanceId)
        .execute()

      if (repos.length === 0) return []

      const config = await getGitHubAppConfig(input.pluginInstanceId)
      if (!config?.appId || !config.privateKey) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'GitHub App credentials are not configured',
        })
      }

      const auth = createAppAuth({ appId: config.appId, privateKey: config.privateKey })

      const results: Array<{
        repoId: number
        defaultBranch: string
        protected: boolean
        error?: string
      }> = []

      for (const repo of repos) {
        try {
          // Mint a token scoped to this repo with metadata read
          const appAuth = await auth({ type: 'app' })
          const tokenResponse = await fetch(
            `https://api.github.com/app/installations/${repo.installation_id}/access_tokens`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${appAuth.token}`,
                Accept: 'application/vnd.github+json',
              },
              body: JSON.stringify({
                repository_ids: [repo.repo_id],
                permissions: { metadata: 'read' },
              }),
            }
          )

          if (!tokenResponse.ok) {
            results.push({
              repoId: repo.id,
              defaultBranch: 'unknown',
              protected: false,
              error: 'Could not mint token',
            })
            continue
          }

          const { token } = (await tokenResponse.json()) as { token: string }
          const headers = {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
          }

          // Get default branch
          const repoResponse = await fetch(`https://api.github.com/repos/${repo.full_name}`, {
            headers,
          })

          if (!repoResponse.ok) {
            results.push({
              repoId: repo.id,
              defaultBranch: 'unknown',
              protected: false,
              error: 'Could not fetch repo info',
            })
            continue
          }

          const repoData = (await repoResponse.json()) as { default_branch?: string }
          const defaultBranch = repoData.default_branch ?? 'main'

          // Check rules on default branch
          const rulesResponse = await fetch(
            `https://api.github.com/repos/${repo.full_name}/rules/branches/${defaultBranch}`,
            { headers }
          )

          if (!rulesResponse.ok) {
            // 404 means no rules configured
            results.push({ repoId: repo.id, defaultBranch, protected: false })
            continue
          }

          const rules = (await rulesResponse.json()) as Array<{ type: string }>
          const hasProtection = rules.some(
            (r) =>
              r.type === 'pull_request' ||
              r.type === 'required_status_checks' ||
              r.type === 'restrict_pushes'
          )

          results.push({ repoId: repo.id, defaultBranch, protected: hasProtection })
        } catch {
          results.push({
            repoId: repo.id,
            defaultBranch: 'unknown',
            protected: false,
            error: 'Check failed',
          })
        }
      }

      return results
    }),
})

export type CapabilitiesRouter = typeof capabilitiesRouter
