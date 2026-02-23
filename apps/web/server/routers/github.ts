import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { protectedProcedure, router } from '../trpc'
import {
  findPluginInstanceById,
  findPluginInstancesByType,
  getDb,
  updatePluginInstance,
} from '@nitejar/database'
import {
  createAppAuth,
  getGitHubAppConfig,
  saveGitHubAppConfig,
  GitHubCredentialProvider,
} from '@nitejar/plugin-handlers'

const permissionPresetSchema = z.enum(['minimal', 'robust'])
type PermissionPreset = z.infer<typeof permissionPresetSchema>
const commentPolicySchema = z.enum(['all', 'mentions'])
type CommentPolicy = z.infer<typeof commentPolicySchema>

type PermissionLevel = 'read' | 'write' | 'admin'

type PermissionMap = Record<string, PermissionLevel>

const PERMISSION_LEVEL_ORDER: Record<PermissionLevel, number> = {
  read: 1,
  write: 2,
  admin: 3,
}

const PERMISSION_PRESETS: Record<z.infer<typeof permissionPresetSchema>, PermissionMap> = {
  minimal: {
    metadata: 'read',
  },
  robust: {
    metadata: 'read',
    contents: 'write',
    issues: 'write',
    pull_requests: 'write',
    actions: 'read',
    checks: 'read',
    security_events: 'read',
    workflows: 'write',
    discussions: 'write',
  },
}

const DEFAULT_COMMENT_POLICY: CommentPolicy = 'all'
const DEFAULT_MENTION_HANDLE = '@nitejar'
const DEFAULT_TRACK_ISSUE_OPEN = true

function getRequiredEvents(permissions: PermissionMap): string[] {
  const events: string[] = []
  if (permissions.issues) {
    events.push('issues', 'issue_comment')
  }
  if (permissions.pull_requests) {
    events.push('pull_request', 'pull_request_review')
  }
  if (permissions.checks) {
    events.push('check_run')
  }
  return events
}

function hasRequiredPermission(granted: unknown, required: PermissionLevel): boolean {
  if (typeof granted !== 'string') return false
  if (granted !== 'read' && granted !== 'write' && granted !== 'admin') {
    return false
  }

  return PERMISSION_LEVEL_ORDER[granted] >= PERMISSION_LEVEL_ORDER[required]
}

async function fetchRegisteredAppCapabilities(params: {
  appId: string
  privateKey: string
}): Promise<{ permissions: Record<string, unknown>; events: string[] }> {
  const auth = createAppAuth({
    appId: params.appId,
    privateKey: params.privateKey,
  })
  const appAuth = await auth({ type: 'app' })

  const response = await fetch('https://api.github.com/app', {
    headers: {
      Authorization: `Bearer ${appAuth.token}`,
      Accept: 'application/vnd.github+json',
    },
  })

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(`Failed to verify registered app (${response.status}): ${errorBody}`)
  }

  const payload = (await response.json()) as {
    permissions?: Record<string, unknown>
    events?: string[]
  }

  return {
    permissions: payload.permissions ?? {},
    events: Array.isArray(payload.events) ? payload.events : [],
  }
}

async function fetchAppInstallations(params: { appId: string; privateKey: string }): Promise<
  Array<{
    id: number
    accountLogin: string | null
    htmlUrl: string | null
    permissions: Record<string, unknown>
  }>
> {
  const auth = createAppAuth({
    appId: params.appId,
    privateKey: params.privateKey,
  })
  const appAuth = await auth({ type: 'app' })

  const response = await fetch('https://api.github.com/app/installations?per_page=100', {
    headers: {
      Authorization: `Bearer ${appAuth.token}`,
      Accept: 'application/vnd.github+json',
    },
  })

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(`Failed to fetch installations (${response.status}): ${errorBody}`)
  }

  const payload = (await response.json()) as Array<{
    id: number
    account?: { login?: string }
    html_url?: string
    permissions?: Record<string, unknown>
  }>

  return payload.map((installation) => ({
    id: installation.id,
    accountLogin: installation.account?.login ?? null,
    htmlUrl: installation.html_url ?? null,
    permissions: installation.permissions ?? {},
  }))
}

function findMissingPermissions(
  expectedPermissions: PermissionMap,
  actualPermissions: Record<string, unknown>
): Array<{ name: string; required: PermissionLevel; actual: string | null }> {
  return Object.entries(expectedPermissions)
    .filter(
      ([permissionName, requiredLevel]) =>
        !hasRequiredPermission(actualPermissions[permissionName], requiredLevel)
    )
    .map(([permissionName, requiredLevel]) => ({
      name: permissionName,
      required: requiredLevel,
      actual:
        typeof actualPermissions[permissionName] === 'string'
          ? actualPermissions[permissionName]
          : null,
    }))
}

function resolveBaseUrl(): string {
  return (
    process.env.APP_URL ||
    process.env.APP_BASE_URL ||
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'http://localhost:3000'
  )
}

function resolvePermissions(
  preset: z.infer<typeof permissionPresetSchema>,
  overrides?: PermissionMap
): PermissionMap {
  return {
    ...PERMISSION_PRESETS[preset],
    ...(overrides ?? {}),
  }
}

function isPublicUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase()
    // Reject localhost, 127.x.x.x, and private IPs
    if (
      host === 'localhost' ||
      host.startsWith('127.') ||
      host.startsWith('192.168.') ||
      host.startsWith('10.') ||
      host.match(/^172\.(1[6-9]|2\d|3[01])\./)
    ) {
      return false
    }
    return true
  } catch {
    return false
  }
}

function buildManifest(params: {
  baseUrl: string
  name: string
  permissions: PermissionMap
  pluginInstanceId: string
}) {
  const { baseUrl, name, permissions, pluginInstanceId } = params
  const isPublic = isPublicUrl(baseUrl)

  // Only request events that match the granted permissions
  const events = getRequiredEvents(permissions)

  const manifest: Record<string, unknown> = {
    name,
    url: baseUrl,
    redirect_url: `${baseUrl}/admin/plugins/github/callback`,
    public: false,
    default_permissions: permissions,
    default_events: events,
  }

  // Only include webhook config if URL is publicly reachable
  if (isPublic) {
    manifest.hook_attributes = {
      url: `${baseUrl}/api/webhooks/plugins/github/${pluginInstanceId}`,
      active: true,
    }
  }

  return manifest
}

export const githubRouter = router({
  listPluginInstances: protectedProcedure.query(async () => {
    const pluginInstances = await findPluginInstancesByType('github')

    return pluginInstances.map((pluginInstance) => ({
      id: pluginInstance.id,
      name: pluginInstance.name,
      enabled: !!pluginInstance.enabled,
    }))
  }),

  getSettings: protectedProcedure
    .input(z.object({ pluginInstanceId: z.string() }))
    .query(async ({ input }) => {
      const pluginInstance = await findPluginInstanceById(input.pluginInstanceId)
      if (!pluginInstance || pluginInstance.type !== 'github') {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'GitHub plugin instance not found' })
      }

      const baseUrl = resolveBaseUrl()
      const config = await getGitHubAppConfig(input.pluginInstanceId)
      const permissionsPreset: PermissionPreset =
        (config?.permissions?.preset as PermissionPreset | undefined) ?? 'robust'
      const commentPolicy: CommentPolicy =
        (config?.commentPolicy as CommentPolicy | undefined) ?? DEFAULT_COMMENT_POLICY
      const mentionHandle = config?.mentionHandle ?? DEFAULT_MENTION_HANDLE
      const trackIssueOpen = config?.trackIssueOpen ?? DEFAULT_TRACK_ISSUE_OPEN
      const manifestPending = Boolean(config?.manifestPending)
      const allowedRepos = config?.allowedRepos ?? []

      return {
        pluginInstanceId: pluginInstance.id,
        name: pluginInstance.name,
        enabled: !!pluginInstance.enabled,
        baseUrl,
        permissionsPreset,
        tokenTTL: config?.tokenTTL ?? null,
        connected: Boolean(config?.appId && config?.privateKey),
        webhookSecretSet: Boolean(config?.webhookSecret),
        commentPolicy,
        mentionHandle,
        trackIssueOpen,
        manifestPending,
        allowedRepos,
        appId: config?.appId ?? null,
        appSlug: config?.appSlug ?? null,
      }
    }),

  updateSettings: protectedProcedure
    .input(
      z.object({
        pluginInstanceId: z.string(),
        permissionsPreset: permissionPresetSchema,
        tokenTTL: z.number().int().positive().optional().nullable(),
        commentPolicy: commentPolicySchema.optional(),
        mentionHandle: z.string().min(1).optional(),
        trackIssueOpen: z.boolean().optional(),
        allowedRepos: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const pluginInstance = await findPluginInstanceById(input.pluginInstanceId)
      if (!pluginInstance || pluginInstance.type !== 'github') {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'GitHub plugin instance not found' })
      }

      const existingConfig = await getGitHubAppConfig(input.pluginInstanceId)
      const overrides = existingConfig?.permissions?.overrides
      const commentPolicy: CommentPolicy =
        input.commentPolicy ??
        (existingConfig?.commentPolicy as CommentPolicy | undefined) ??
        DEFAULT_COMMENT_POLICY
      const mentionHandleRaw =
        input.mentionHandle ?? existingConfig?.mentionHandle ?? DEFAULT_MENTION_HANDLE
      const mentionHandle =
        mentionHandleRaw.trim().length > 0 ? mentionHandleRaw.trim() : DEFAULT_MENTION_HANDLE
      const trackIssueOpen =
        input.trackIssueOpen ?? existingConfig?.trackIssueOpen ?? DEFAULT_TRACK_ISSUE_OPEN
      const allowedRepos = input.allowedRepos ?? existingConfig?.allowedRepos

      await saveGitHubAppConfig(input.pluginInstanceId, {
        permissions: {
          preset: input.permissionsPreset,
          ...(overrides ? { overrides } : {}),
        },
        tokenTTL: input.tokenTTL ?? existingConfig?.tokenTTL,
        commentPolicy,
        mentionHandle,
        trackIssueOpen,
        ...(allowedRepos ? { allowedRepos } : {}),
      })

      return { ok: true }
    }),

  getScopeStatus: protectedProcedure
    .input(z.object({ pluginInstanceId: z.string() }))
    .query(async ({ input }) => {
      const pluginInstance = await findPluginInstanceById(input.pluginInstanceId)
      if (!pluginInstance || pluginInstance.type !== 'github') {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'GitHub plugin instance not found' })
      }

      const config = await getGitHubAppConfig(input.pluginInstanceId)
      const permissionsPreset: PermissionPreset =
        (config?.permissions?.preset as PermissionPreset | undefined) ?? 'robust'
      const overrides = config?.permissions?.overrides
      const expectedPermissions = resolvePermissions(permissionsPreset, overrides)
      const expectedEvents = getRequiredEvents(expectedPermissions)

      if (!config?.appId || !config.privateKey) {
        return {
          connected: false,
          permissionsPreset,
          expectedPermissions,
          expectedEvents,
          checkedAt: Math.floor(Date.now() / 1000),
          app: null,
          installations: [],
          inSync: false,
          checkError: 'GitHub App credentials are not configured.',
        }
      }

      try {
        const [appCapabilities, appInstallations] = await Promise.all([
          fetchRegisteredAppCapabilities({
            appId: config.appId,
            privateKey: config.privateKey,
          }),
          fetchAppInstallations({
            appId: config.appId,
            privateKey: config.privateKey,
          }),
        ])

        const appMissingPermissions = findMissingPermissions(
          expectedPermissions,
          appCapabilities.permissions
        )
        const appMissingEvents = expectedEvents.filter(
          (eventName) => !appCapabilities.events.includes(eventName)
        )

        const installations = appInstallations.map((installation) => {
          const missingPermissions = findMissingPermissions(
            expectedPermissions,
            installation.permissions
          )

          return {
            id: installation.id,
            accountLogin: installation.accountLogin,
            htmlUrl: installation.htmlUrl,
            missingPermissions,
            inSync: missingPermissions.length === 0,
          }
        })

        const installationDriftCount = installations.filter(
          (installation) => !installation.inSync
        ).length
        const inSync =
          appMissingPermissions.length === 0 &&
          appMissingEvents.length === 0 &&
          installationDriftCount === 0

        return {
          connected: true,
          permissionsPreset,
          expectedPermissions,
          expectedEvents,
          checkedAt: Math.floor(Date.now() / 1000),
          app: {
            permissions: appCapabilities.permissions,
            events: appCapabilities.events,
            missingPermissions: appMissingPermissions,
            missingEvents: appMissingEvents,
          },
          installations,
          installationDriftCount,
          inSync,
          checkError: null,
        }
      } catch (error) {
        return {
          connected: true,
          permissionsPreset,
          expectedPermissions,
          expectedEvents,
          checkedAt: Math.floor(Date.now() / 1000),
          app: null,
          installations: [],
          inSync: false,
          checkError: error instanceof Error ? error.message : String(error),
        }
      }
    }),

  setManifestPreferences: protectedProcedure
    .input(
      z.object({
        pluginInstanceId: z.string(),
        permissionsPreset: permissionPresetSchema,
      })
    )
    .mutation(async ({ input }) => {
      const pluginInstance = await findPluginInstanceById(input.pluginInstanceId)
      if (!pluginInstance || pluginInstance.type !== 'github') {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'GitHub plugin instance not found' })
      }

      const existingConfig = await getGitHubAppConfig(input.pluginInstanceId)
      const overrides = existingConfig?.permissions?.overrides

      await saveGitHubAppConfig(input.pluginInstanceId, {
        permissions: {
          preset: input.permissionsPreset,
          ...(overrides ? { overrides } : {}),
        },
      })

      return { ok: true, permissionsPreset: input.permissionsPreset }
    }),

  getManifest: protectedProcedure
    .input(
      z
        .object({
          pluginInstanceId: z.string().optional(),
          permissionsPreset: permissionPresetSchema.optional(),
          appName: z.string().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const baseUrl = resolveBaseUrl()

      let pluginInstanceName: string | undefined
      let permissionsPreset: PermissionPreset | undefined = input?.permissionsPreset
      let overrides: PermissionMap | undefined

      if (!input?.pluginInstanceId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'pluginInstanceId is required to build the GitHub App manifest',
        })
      }

      {
        const pluginInstance = await findPluginInstanceById(input.pluginInstanceId)
        if (!pluginInstance || pluginInstance.type !== 'github') {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'GitHub plugin instance not found' })
        }
        pluginInstanceName = pluginInstance.name

        const config = await getGitHubAppConfig(input.pluginInstanceId)
        if (config?.permissions?.preset) {
          permissionsPreset = permissionsPreset ?? (config.permissions.preset as PermissionPreset)
        }
        overrides = config?.permissions?.overrides
      }

      const preset = permissionsPreset ?? 'robust'
      const permissions = resolvePermissions(preset, overrides)
      const name = input?.appName ?? pluginInstanceName ?? 'Nitejar'

      return buildManifest({ baseUrl, name, permissions, pluginInstanceId: input.pluginInstanceId })
    }),

  exchangeCode: protectedProcedure
    .input(
      z.object({
        pluginInstanceId: z.string(),
        code: z.string().min(1),
        permissionsPreset: permissionPresetSchema.optional(),
        tokenTTL: z.number().int().positive().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const pluginInstance = await findPluginInstanceById(input.pluginInstanceId)
      if (!pluginInstance || pluginInstance.type !== 'github') {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'GitHub plugin instance not found' })
      }

      const response = await fetch(
        `https://api.github.com/app-manifests/${input.code}/conversions`,
        {
          method: 'POST',
          headers: {
            Accept: 'application/vnd.github+json',
          },
        }
      )

      if (!response.ok) {
        const errorBody = await response.text()
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `GitHub manifest exchange failed (${response.status}): ${errorBody}`,
        })
      }

      const payload = (await response.json()) as {
        id: number
        slug?: string
        client_id: string
        client_secret: string
        webhook_secret?: string
        pem: string
      }

      const existingConfig = await getGitHubAppConfig(input.pluginInstanceId)
      const permissionsPreset: PermissionPreset =
        input.permissionsPreset ??
        (existingConfig?.permissions?.preset as PermissionPreset | undefined) ??
        'robust'
      const overrides = existingConfig?.permissions?.overrides
      const expectedPermissions = resolvePermissions(permissionsPreset, overrides)
      const expectedEvents = getRequiredEvents(expectedPermissions)

      let registeredPermissions: Record<string, unknown> = {}
      let registeredEvents: string[] = []
      try {
        const capabilities = await fetchRegisteredAppCapabilities({
          appId: String(payload.id),
          privateKey: payload.pem,
        })
        registeredPermissions = capabilities.permissions
        registeredEvents = capabilities.events
      } catch (error) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            `GitHub app registration completed, but Nitejar could not verify app permissions/events. ` +
            `Original error: ${error instanceof Error ? error.message : String(error)}`,
        })
      }

      const missingPermissions = findMissingPermissions(expectedPermissions, registeredPermissions)
      const missingEvents = expectedEvents.filter(
        (eventName) => !registeredEvents.includes(eventName)
      )

      if (missingPermissions.length > 0 || missingEvents.length > 0) {
        const missingPermissionsMessage =
          missingPermissions.length > 0
            ? missingPermissions
                .map((permission) => `${permission.name}:${permission.required}`)
                .join(', ')
            : 'none'
        const missingEventsMessage = missingEvents.length > 0 ? missingEvents.join(', ') : 'none'

        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            `GitHub app was created but is under-scoped for preset "${permissionsPreset}". ` +
            `Missing permissions: ${missingPermissionsMessage}. Missing events: ${missingEventsMessage}. ` +
            `Update the app under GitHub Settings > Developer settings > GitHub Apps, then re-run registration.`,
        })
      }

      await saveGitHubAppConfig(input.pluginInstanceId, {
        appId: String(payload.id),
        appSlug: payload.slug,
        clientId: payload.client_id,
        clientSecret: payload.client_secret,
        webhookSecret: payload.webhook_secret,
        privateKey: payload.pem,
        manifestPending: false,
        permissions: {
          preset: permissionsPreset,
          ...(overrides ? { overrides } : {}),
        },
        tokenTTL: input.tokenTTL ?? existingConfig?.tokenTTL,
      })

      await updatePluginInstance(input.pluginInstanceId, { enabled: 1 })

      return {
        ok: true,
        appId: String(payload.id),
        clientId: payload.client_id,
        slug: payload.slug ?? null,
      }
    }),

  listInstallations: protectedProcedure
    .input(z.object({ pluginInstanceId: z.string() }))
    .query(async ({ input }) => {
      const db = getDb()
      const installations = await db
        .selectFrom('github_installations')
        .select([
          'id',
          'installation_id',
          'account_login',
          'account_id',
          'created_at',
          'updated_at',
        ])
        .where('plugin_instance_id', '=', input.pluginInstanceId)
        .orderBy('created_at', 'desc')
        .execute()

      if (installations.length === 0) {
        return []
      }

      const repos = await db
        .selectFrom('github_repos')
        .select(['id', 'repo_id', 'full_name', 'html_url', 'installation_id'])
        .where(
          'installation_id',
          'in',
          installations.map((installation) => installation.id)
        )
        .orderBy('full_name', 'asc')
        .execute()

      const reposByInstallation = new Map<number, typeof repos>()
      repos.forEach((repo) => {
        const list = reposByInstallation.get(repo.installation_id) ?? []
        list.push(repo)
        reposByInstallation.set(repo.installation_id, list)
      })

      return installations.map((installation) => ({
        ...installation,
        repos: reposByInstallation.get(installation.id) ?? [],
      }))
    }),

  syncInstallation: protectedProcedure
    .input(
      z.object({
        pluginInstanceId: z.string(),
        installationId: z.number().int(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb()
      const installation = await db
        .selectFrom('github_installations')
        .select(['id', 'installation_id', 'plugin_instance_id'])
        .where('installation_id', '=', input.installationId)
        .where('plugin_instance_id', '=', input.pluginInstanceId)
        .executeTakeFirst()

      if (!installation) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Installation not found' })
      }

      const provider = new GitHubCredentialProvider({
        pluginInstanceId: installation.plugin_instance_id,
      })

      const credential = await provider.getCredential({
        installationId: installation.installation_id,
      })

      const response = await fetch(
        'https://api.github.com/installation/repositories?per_page=100',
        {
          headers: {
            Authorization: `token ${credential.token}`,
            Accept: 'application/vnd.github+json',
          },
        }
      )

      if (!response.ok) {
        const errorBody = await response.text()
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Failed to sync repos (${response.status}): ${errorBody}`,
        })
      }

      const payload = (await response.json()) as {
        repositories: { id: number; full_name: string; html_url?: string }[]
      }

      const now = Math.floor(Date.now() / 1000)
      for (const repo of payload.repositories) {
        await db
          .insertInto('github_repos')
          .values({
            repo_id: repo.id,
            full_name: repo.full_name,
            html_url: repo.html_url ?? null,
            installation_id: installation.id,
            created_at: now,
            updated_at: now,
          })
          .onConflict((oc) =>
            oc.column('repo_id').doUpdateSet({
              full_name: repo.full_name,
              html_url: repo.html_url ?? null,
              installation_id: installation.id,
              updated_at: now,
            })
          )
          .execute()
      }

      const existingRepoIds = await db
        .selectFrom('github_repos')
        .select(['repo_id'])
        .where('installation_id', '=', installation.id)
        .execute()

      const incomingIds = new Set(payload.repositories.map((repo) => repo.id))
      const removedIds = existingRepoIds
        .map((repo) => repo.repo_id)
        .filter((repoId) => !incomingIds.has(repoId))

      if (removedIds.length > 0) {
        await db
          .deleteFrom('github_repos')
          .where('installation_id', '=', installation.id)
          .where('repo_id', 'in', removedIds)
          .execute()
      }

      return {
        ok: true,
        added: payload.repositories.length,
        removed: removedIds.length,
      }
    }),

  discoverInstallations: protectedProcedure
    .input(z.object({ pluginInstanceId: z.string() }))
    .mutation(async ({ input }) => {
      const config = await getGitHubAppConfig(input.pluginInstanceId)
      if (!config?.appId || !config.privateKey) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'GitHub App credentials are not configured. Register the app first.',
        })
      }

      const auth = createAppAuth({
        appId: config.appId,
        privateKey: config.privateKey,
      })
      const appAuth = await auth({ type: 'app' })

      // Fetch all installations for this app
      const response = await fetch('https://api.github.com/app/installations?per_page=100', {
        headers: {
          Authorization: `Bearer ${appAuth.token}`,
          Accept: 'application/vnd.github+json',
        },
      })

      if (!response.ok) {
        const errorBody = await response.text()
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Failed to fetch installations (${response.status}): ${errorBody}`,
        })
      }

      const ghInstallations = (await response.json()) as {
        id: number
        account: { login: string; id: number }
      }[]

      const db = getDb()
      const now = Math.floor(Date.now() / 1000)
      let discovered = 0

      for (const ghInst of ghInstallations) {
        const existing = await db
          .selectFrom('github_installations')
          .select(['id'])
          .where('installation_id', '=', ghInst.id)
          .where('plugin_instance_id', '=', input.pluginInstanceId)
          .executeTakeFirst()

        if (!existing) {
          await db
            .insertInto('github_installations')
            .values({
              installation_id: ghInst.id,
              account_login: ghInst.account.login,
              account_id: ghInst.account.id,
              plugin_instance_id: input.pluginInstanceId,
              created_at: now,
              updated_at: now,
            })
            .execute()
          discovered++
        } else {
          await db
            .updateTable('github_installations')
            .set({
              account_login: ghInst.account.login,
              account_id: ghInst.account.id,
              updated_at: now,
            })
            .where('id', '=', existing.id)
            .execute()
        }
      }

      // Now sync repos for each installation
      const allInstallations = await db
        .selectFrom('github_installations')
        .select(['id', 'installation_id', 'plugin_instance_id'])
        .where('plugin_instance_id', '=', input.pluginInstanceId)
        .execute()

      for (const inst of allInstallations) {
        try {
          const provider = new GitHubCredentialProvider({
            pluginInstanceId: inst.plugin_instance_id,
          })
          const credential = await provider.getCredential({
            installationId: inst.installation_id,
          })

          const repoResponse = await fetch(
            'https://api.github.com/installation/repositories?per_page=100',
            {
              headers: {
                Authorization: `token ${credential.token}`,
                Accept: 'application/vnd.github+json',
              },
            }
          )

          if (!repoResponse.ok) continue

          const repoPayload = (await repoResponse.json()) as {
            repositories: { id: number; full_name: string; html_url?: string }[]
          }

          for (const repo of repoPayload.repositories) {
            await db
              .insertInto('github_repos')
              .values({
                repo_id: repo.id,
                full_name: repo.full_name,
                html_url: repo.html_url ?? null,
                installation_id: inst.id,
                created_at: now,
                updated_at: now,
              })
              .onConflict((oc) =>
                oc.column('repo_id').doUpdateSet({
                  full_name: repo.full_name,
                  html_url: repo.html_url ?? null,
                  installation_id: inst.id,
                  updated_at: now,
                })
              )
              .execute()
          }
        } catch {
          // Skip installations that fail to sync repos
        }
      }

      return { ok: true, discovered, total: ghInstallations.length }
    }),
})

export type GitHubRouter = typeof githubRouter
