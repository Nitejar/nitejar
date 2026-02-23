import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import {
  acknowledgePluginDisclosures,
  createPluginEvent,
  deletePlugin,
  ensurePluginDisclosureRows,
  findPluginById,
  findPluginInstancesByType,
  listPluginDisclosureAcks,
  listPluginEvents,
  listPluginVersions,
  listPlugins,
  setPluginEnabled,
  upsertPlugin,
  upsertPluginVersion,
} from '@nitejar/database'
import { consumeUpload } from '../../app/api/admin/plugins/upload/cache'
import { pluginHandlerRegistry } from '@nitejar/plugin-handlers'
import { providerRegistry } from '@nitejar/agent/integrations/registry'
import {
  PluginInstaller,
  PluginLoader,
  PLUGIN_CATALOG,
  removePluginDir,
  getCrashGuard,
} from '@nitejar/plugin-runtime'
import { protectedProcedure, router } from '../trpc'
import {
  buildDeclaredCapabilities,
  capabilityKey,
  hostEnforcedControls,
  parsePluginManifest,
  type DeclaredCapability,
  type PluginManifest,
} from '../services/plugins/manifest'
import {
  getPluginRuntimePosture,
  resolvePluginTrustMode,
} from '../services/plugins/runtime-posture'

const sourceKindSchema = z.enum(['builtin', 'npm', 'git', 'upload', 'local'])

const declaredCapabilitySchema = z.object({
  permission: z.enum(['network', 'secret', 'filesystem_read', 'filesystem_write', 'process_spawn']),
  scope: z.string().trim().optional().nullable(),
})

const installPluginInputSchema = z.object({
  pluginId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  sourceKind: sourceKindSchema,
  sourceRef: z.string().trim().optional(),
  version: z.string().trim().min(1).default('1.0.0'),
  manifestJson: z.string().optional(),
  declaredCapabilities: z.array(declaredCapabilitySchema).default([]),
})

const enablePluginInputSchema = z.object({
  pluginId: z.string().trim().min(1),
  consentAccepted: z.boolean().default(false),
})

function stableChecksum(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function toManifestPermissions(
  capabilities: DeclaredCapability[]
): NonNullable<PluginManifest['permissions']> {
  const network = new Set<string>()
  const secrets = new Set<string>()
  const filesystemRead = new Set<string>()
  const filesystemWrite = new Set<string>()
  let allowProcessSpawn = false

  for (const cap of capabilities) {
    if (cap.permission === 'network' && cap.scope) network.add(cap.scope)
    if (cap.permission === 'secret' && cap.scope) secrets.add(cap.scope)
    if (cap.permission === 'filesystem_read' && cap.scope) filesystemRead.add(cap.scope)
    if (cap.permission === 'filesystem_write' && cap.scope) filesystemWrite.add(cap.scope)
    if (cap.permission === 'process_spawn') allowProcessSpawn = true
  }

  return {
    network: [...network],
    secrets: [...secrets],
    filesystemRead: [...filesystemRead],
    filesystemWrite: [...filesystemWrite],
    allowProcessSpawn,
  }
}

function buildManifestFromInput(input: z.infer<typeof installPluginInputSchema>): PluginManifest {
  if (input.manifestJson) {
    const parsed = parsePluginManifest(input.manifestJson)
    if (!parsed) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid plugin manifest JSON.' })
    }
    // Trust the manifest's ID as canonical. If there's a mismatch with the
    // user-provided pluginId, prefer the manifest (the upload flow ensures
    // manifest.id is always set, derived if needed).
    if (parsed.id !== input.pluginId) {
      console.warn(
        `[plugins] Manifest id "${parsed.id}" differs from pluginId "${input.pluginId}" — using manifest id`
      )
    }
    return parsed
  }

  return {
    schemaVersion: 1,
    id: input.pluginId,
    name: input.name,
    version: input.version,
    permissions: toManifestPermissions(
      input.declaredCapabilities.map((capability) => ({
        permission: capability.permission,
        scope: capability.scope ?? null,
      }))
    ),
  }
}

function createBuiltinManifest(params: {
  id: string
  name: string
  version: string
  permissions: NonNullable<PluginManifest['permissions']>
}): PluginManifest {
  return {
    schemaVersion: 1,
    id: params.id,
    name: params.name,
    version: params.version,
    permissions: params.permissions,
  }
}

const builtinDefinitions = [
  createBuiltinManifest({
    id: 'builtin.telegram',
    name: 'Telegram',
    version: '1.0.0',
    permissions: {
      network: ['api.telegram.org'],
      secrets: ['telegram.bot_token'],
      allowProcessSpawn: false,
    },
  }),
  createBuiltinManifest({
    id: 'builtin.github',
    name: 'GitHub',
    version: '1.0.0',
    permissions: {
      network: ['api.github.com'],
      secrets: ['github.app_private_key'],
      allowProcessSpawn: false,
    },
  }),
]

const builtinManifestById = new Map(builtinDefinitions.map((manifest) => [manifest.id, manifest]))

async function ensureBuiltinPluginsRegistered(): Promise<void> {
  const telegramPluginInstances = await findPluginInstancesByType('telegram')
  const githubPluginInstances = await findPluginInstancesByType('github')
  const enabledTypes = new Set<string>()
  if (telegramPluginInstances.length > 0) enabledTypes.add('builtin.telegram')
  if (githubPluginInstances.length > 0) enabledTypes.add('builtin.github')

  for (const manifest of builtinDefinitions) {
    const manifestJson = JSON.stringify(manifest)
    await upsertPlugin(
      {
        id: manifest.id,
        name: manifest.name,
        trustLevel: 'builtin',
        sourceKind: 'builtin',
        sourceRef: 'builtin',
        currentVersion: manifest.version,
        currentChecksum: stableChecksum(manifestJson),
        currentInstallPath: `builtin://${manifest.id}`,
        manifestJson,
        configJson: null,
        enabled: enabledTypes.has(manifest.id),
      },
      { preserveEnabled: true }
    )

    await upsertPluginVersion({
      plugin_id: manifest.id,
      version: manifest.version,
      checksum: stableChecksum(manifestJson),
      install_path: `builtin://${manifest.id}`,
      manifest_json: manifestJson,
      signature_json: null,
    })

    const declaredCapabilities = buildDeclaredCapabilities(manifest.permissions)

    await ensurePluginDisclosureRows({
      pluginId: manifest.id,
      permissions: declaredCapabilities.map((cap) => ({
        permission: cap.permission,
        scope: cap.scope,
      })),
    })

    // Built-in disclosures are auto-acknowledged
    await acknowledgePluginDisclosures(manifest.id)
  }
}

async function buildPluginResponse(pluginId: string) {
  const plugin = await findPluginById(pluginId)
  if (!plugin) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Plugin not found.' })
  }

  const runtime = getPluginRuntimePosture(resolvePluginTrustMode())
  const manifest = parsePluginManifest(plugin.manifest_json)
  const declaredCapabilities = buildDeclaredCapabilities(manifest?.permissions)
  const disclosureAcks = await listPluginDisclosureAcks(plugin.id)
  const versions = await listPluginVersions(plugin.id)
  const events = await listPluginEvents({ pluginId: plugin.id, limit: 30 })

  return {
    plugin: {
      id: plugin.id,
      name: plugin.name,
      sourceKind: plugin.source_kind,
      sourceRef: plugin.source_ref,
      enabled: plugin.enabled === 1,
      trustLevel: plugin.trust_level,
      currentVersion: plugin.current_version,
      currentChecksum: plugin.current_checksum,
      installedAt: plugin.installed_at,
      updatedAt: plugin.updated_at,
    },
    executionMode: runtime.executionMode,
    effectiveLimitations: runtime.effectiveLimitations,
    declaredCapabilities: declaredCapabilities.map((cap) => ({
      permission: cap.permission,
      scope: cap.scope,
      acknowledged:
        disclosureAcks.find(
          (ack) =>
            capabilityKey(ack.permission, ack.scope || null) ===
            capabilityKey(cap.permission, cap.scope)
        )?.acknowledged === 1,
    })),
    hostEnforcedControls: hostEnforcedControls(),
    disclosureAcks: disclosureAcks.map((ack) => ({
      permission: ack.permission,
      scope: ack.scope || null,
      acknowledged: ack.acknowledged === 1,
      acknowledgedAt: ack.acknowledged_at,
    })),
    versions: versions.map((version) => ({
      version: version.version,
      checksum: version.checksum,
      installPath: version.install_path,
      installedAt: version.installed_at,
    })),
    recentEvents: events.events.map((event) => ({
      id: event.id,
      kind: event.kind,
      status: event.status,
      createdAt: event.created_at,
      detailJson: event.detail_json,
    })),
    runtimeBadgeLabel: runtime.runtimeBadgeLabel,
    trustMode: runtime.trustMode,
  }
}

// ---------------------------------------------------------------------------
// resolveSource helpers — resolve a user-provided string into plugin metadata
// without installing anything.
// ---------------------------------------------------------------------------

export type ResolvedSourceKind = 'npm' | 'local' | 'github'

export interface ResolvedSource {
  sourceKind: ResolvedSourceKind
  sourceRef: string
  version: string
  pluginId: string
  displayName: string
  description: string
  error?: string
}

function suggestPluginId(raw: string): string {
  let name = raw.replace(/^@[^/]+\//, '')
  name = name.replace(/^nitejar-plugin-/, '')
  return name
}

function classifySource(source: string): { kind: ResolvedSourceKind; ref: string } {
  const trimmed = source.trim()

  // npm URL: https://www.npmjs.com/package/@scope/name or /package/name
  const npmUrlMatch = trimmed.match(
    /^https?:\/\/(?:www\.)?npmjs\.com\/package\/((?:@[^/]+\/)?[^/?#]+)/
  )
  if (npmUrlMatch?.[1]) {
    return { kind: 'npm', ref: npmUrlMatch[1] }
  }

  // GitHub URL: https://github.com/user/repo
  const ghMatch = trimmed.match(/^https?:\/\/github\.com\/([^/]+\/[^/?#]+)/)
  if (ghMatch?.[1]) {
    return { kind: 'github', ref: ghMatch[1].replace(/\.git$/, '') }
  }

  // Absolute path
  if (trimmed.startsWith('/') || trimmed.startsWith('~')) {
    return { kind: 'local', ref: trimmed }
  }

  // Otherwise treat as npm package name
  return { kind: 'npm', ref: trimmed }
}

async function resolveFromNpm(packageName: string): Promise<ResolvedSource> {
  const registryUrl = `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`
  let res: Response
  try {
    res = await fetch(registryUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    return {
      sourceKind: 'npm',
      sourceRef: packageName,
      version: '',
      pluginId: '',
      displayName: '',
      description: '',
      error: "Couldn't reach npm. Check your internet connection.",
    }
  }

  if (res.status === 404) {
    return {
      sourceKind: 'npm',
      sourceRef: packageName,
      version: '',
      pluginId: '',
      displayName: '',
      description: '',
      error: `We couldn't find a package called '${packageName}' on npm.`,
    }
  }

  if (!res.ok) {
    return {
      sourceKind: 'npm',
      sourceRef: packageName,
      version: '',
      pluginId: '',
      displayName: '',
      description: '',
      error: `npm returned status ${res.status}. Try again later.`,
    }
  }

  const data = (await res.json()) as Record<string, unknown>
  const version = typeof data.version === 'string' ? data.version : '1.0.0'
  const description = typeof data.description === 'string' ? data.description : ''
  const nitejarMeta =
    data.nitejar && typeof data.nitejar === 'object'
      ? (data.nitejar as Record<string, unknown>)
      : null
  const pluginId =
    (nitejarMeta && typeof nitejarMeta.id === 'string' ? nitejarMeta.id : null) ??
    suggestPluginId(packageName)
  const displayName =
    (nitejarMeta && typeof nitejarMeta.name === 'string' ? nitejarMeta.name : null) ??
    suggestPluginId(packageName)
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())

  return {
    sourceKind: 'npm',
    sourceRef: packageName,
    version,
    pluginId,
    displayName,
    description,
  }
}

async function resolveFromGitHub(repoSlug: string): Promise<ResolvedSource> {
  // Try npm first with the repo name
  const repoName = repoSlug.split('/')[1] ?? repoSlug
  const npmResult = await resolveFromNpm(repoName)
  if (!npmResult.error) {
    return { ...npmResult, sourceKind: 'github' }
  }

  // Try scoped package @owner/repo
  const owner = repoSlug.split('/')[0]
  if (owner) {
    const scopedResult = await resolveFromNpm(`@${owner}/${repoName}`)
    if (!scopedResult.error) {
      return { ...scopedResult, sourceKind: 'github' }
    }
  }

  // Fall back to checking for nitejar-plugin.json in the repo
  try {
    const rawUrl = `https://raw.githubusercontent.com/${repoSlug}/HEAD/nitejar-plugin.json`
    const rawRes = await fetch(rawUrl, { signal: AbortSignal.timeout(10_000) })
    if (rawRes.ok) {
      const manifest = (await rawRes.json()) as Record<string, unknown>
      return {
        sourceKind: 'github',
        sourceRef: repoSlug,
        version: typeof manifest.version === 'string' ? manifest.version : '1.0.0',
        pluginId: typeof manifest.id === 'string' ? manifest.id : suggestPluginId(repoName),
        displayName:
          typeof manifest.name === 'string'
            ? manifest.name
            : suggestPluginId(repoName)
                .replace(/[-_]/g, ' ')
                .replace(/\b\w/g, (c) => c.toUpperCase()),
        description: typeof manifest.description === 'string' ? manifest.description : '',
      }
    }
  } catch {
    // ignore fetch failures
  }

  return {
    sourceKind: 'github',
    sourceRef: repoSlug,
    version: '',
    pluginId: '',
    displayName: '',
    description: '',
    error: "That GitHub repo doesn't exist, is private, or doesn't contain a Nitejar plugin.",
  }
}

async function resolveFromLocal(localPath: string): Promise<ResolvedSource> {
  const resolvedPath = path.resolve(localPath.replace(/^~/, process.env.HOME ?? '~'))

  try {
    await fs.access(resolvedPath)
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'EACCES') {
      return {
        sourceKind: 'local',
        sourceRef: resolvedPath,
        version: '',
        pluginId: '',
        displayName: '',
        description: '',
        error: 'Permission denied reading that folder.',
      }
    }
    return {
      sourceKind: 'local',
      sourceRef: resolvedPath,
      version: '',
      pluginId: '',
      displayName: '',
      description: '',
      error: "That folder doesn't exist. Check the path and try again.",
    }
  }

  // Try nitejar-plugin.json first, then package.json
  for (const filename of ['nitejar-plugin.json', 'package.json']) {
    try {
      const content = await fs.readFile(path.join(resolvedPath, filename), 'utf-8')
      const data = JSON.parse(content) as Record<string, unknown>

      if (filename === 'nitejar-plugin.json') {
        return {
          sourceKind: 'local',
          sourceRef: resolvedPath,
          version: typeof data.version === 'string' ? data.version : '1.0.0',
          pluginId: typeof data.id === 'string' ? data.id : path.basename(resolvedPath),
          displayName: typeof data.name === 'string' ? data.name : path.basename(resolvedPath),
          description: typeof data.description === 'string' ? data.description : '',
        }
      }

      // package.json — check for nitejar key
      const nitejar =
        data.nitejar && typeof data.nitejar === 'object'
          ? (data.nitejar as Record<string, unknown>)
          : null
      const name = typeof data.name === 'string' ? data.name : path.basename(resolvedPath)
      return {
        sourceKind: 'local',
        sourceRef: resolvedPath,
        version: typeof data.version === 'string' ? data.version : '1.0.0',
        pluginId:
          (nitejar && typeof nitejar.id === 'string' ? nitejar.id : null) ?? suggestPluginId(name),
        displayName:
          (nitejar && typeof nitejar.name === 'string' ? nitejar.name : null) ??
          suggestPluginId(name)
            .replace(/[-_]/g, ' ')
            .replace(/\b\w/g, (c) => c.toUpperCase()),
        description: typeof data.description === 'string' ? data.description : '',
      }
    } catch {
      // continue to next filename
    }
  }

  return {
    sourceKind: 'local',
    sourceRef: resolvedPath,
    version: '',
    pluginId: '',
    displayName: '',
    description: '',
    error:
      "This package doesn't look like a Nitejar plugin — no nitejar-plugin.json or package.json found.",
  }
}

export const pluginsRouter = router({
  catalog: protectedProcedure.query(async () => {
    const handlers = pluginHandlerRegistry.getAll()
    const installedTypes = new Set(handlers.map((h) => h.type))

    const installed = await Promise.all(
      handlers.map(async (handler) => {
        const instances = await findPluginInstancesByType(handler.type)
        return {
          type: handler.type,
          displayName: handler.displayName,
          description: handler.description,
          icon: handler.icon,
          category: handler.category,
          status: 'installed' as const,
          instanceCount: instances.length,
          enabledCount: instances.filter((i) => i.enabled === 1).length,
        }
      })
    )

    const available = PLUGIN_CATALOG.filter((entry) => !installedTypes.has(entry.type)).map(
      (entry) => ({
        type: entry.type,
        displayName: entry.displayName,
        description: entry.description,
        icon: entry.icon,
        category: entry.category,
        status: 'available' as const,
        npmPackage: entry.npmPackage,
        official: entry.official,
        instanceCount: 0,
        enabledCount: 0,
      })
    )

    return { entries: [...installed, ...available] }
  }),

  resolveSource: protectedProcedure
    .input(z.object({ source: z.string().trim().min(1) }))
    .query(async ({ input }) => {
      const { kind, ref } = classifySource(input.source)

      switch (kind) {
        case 'npm':
          return resolveFromNpm(ref)
        case 'github':
          return resolveFromGitHub(ref)
        case 'local':
          return resolveFromLocal(ref)
        default:
          return resolveFromNpm(ref)
      }
    }),

  catalogType: protectedProcedure
    .input(z.object({ type: z.string().trim().min(1) }))
    .query(({ input }) => {
      const handler = pluginHandlerRegistry.get(input.type)
      if (!handler) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Unknown plugin type: ${input.type}` })
      }
      return {
        type: handler.type,
        displayName: handler.displayName,
        description: handler.description,
        icon: handler.icon,
        category: handler.category,
      }
    }),

  runtimeInfo: protectedProcedure.query(() => {
    const runtime = getPluginRuntimePosture(resolvePluginTrustMode())
    return {
      trustMode: runtime.trustMode,
      executionMode: runtime.executionMode,
      effectiveLimitations: runtime.effectiveLimitations,
      runtimeBadgeLabel: runtime.runtimeBadgeLabel,
    }
  }),

  listPlugins: protectedProcedure.query(async () => {
    await ensureBuiltinPluginsRegistered()
    const runtime = getPluginRuntimePosture(resolvePluginTrustMode())
    const plugins = await listPlugins()
    const acksByPlugin = new Map<string, Awaited<ReturnType<typeof listPluginDisclosureAcks>>>()

    await Promise.all(
      plugins.map(async (plugin) => {
        acksByPlugin.set(plugin.id, await listPluginDisclosureAcks(plugin.id))
      })
    )

    return {
      trustMode: runtime.trustMode,
      executionMode: runtime.executionMode,
      effectiveLimitations: runtime.effectiveLimitations,
      runtimeBadgeLabel: runtime.runtimeBadgeLabel,
      plugins: plugins.map((plugin) => {
        const manifest = parsePluginManifest(plugin.manifest_json)
        const declaredCapabilities = buildDeclaredCapabilities(manifest?.permissions)
        const acks = acksByPlugin.get(plugin.id) ?? []
        const acknowledgedKeys = new Set(
          acks
            .filter((ack) => ack.acknowledged === 1)
            .map((ack) => capabilityKey(ack.permission, ack.scope || null))
        )

        return {
          id: plugin.id,
          name: plugin.name,
          sourceKind: plugin.source_kind,
          sourceRef: plugin.source_ref,
          enabled: plugin.enabled === 1,
          trustLevel: plugin.trust_level,
          currentVersion: plugin.current_version,
          installedAt: plugin.installed_at,
          updatedAt: plugin.updated_at,
          declaredCapabilityCount: declaredCapabilities.length,
          acknowledgedDisclosureCount: declaredCapabilities.filter((cap) =>
            acknowledgedKeys.has(capabilityKey(cap.permission, cap.scope))
          ).length,
        }
      }),
    }
  }),

  getPlugin: protectedProcedure
    .input(z.object({ pluginId: z.string().trim().min(1) }))
    .query(async ({ input }) => {
      await ensureBuiltinPluginsRegistered()
      return buildPluginResponse(input.pluginId)
    }),

  listPluginEvents: protectedProcedure
    .input(
      z.object({
        pluginId: z.string().trim().min(1),
        limit: z.number().int().min(1).max(100).optional(),
        cursor: z
          .object({
            createdAt: z.number().int(),
            id: z.string(),
          })
          .nullable()
          .optional(),
      })
    )
    .query(async ({ input }) => {
      const runtime = getPluginRuntimePosture(resolvePluginTrustMode())
      const result = await listPluginEvents({
        pluginId: input.pluginId,
        limit: input.limit,
        cursor: input.cursor,
      })
      return {
        executionMode: runtime.executionMode,
        effectiveLimitations: runtime.effectiveLimitations,
        events: result.events,
        nextCursor: result.nextCursor,
      }
    }),

  installPlugin: protectedProcedure.input(installPluginInputSchema).mutation(async ({ input }) => {
    const runtime = getPluginRuntimePosture(resolvePluginTrustMode())
    const builtinManifest =
      input.sourceKind === 'builtin' ? builtinManifestById.get(input.pluginId) : undefined

    if (input.sourceKind === 'builtin' && !builtinManifest) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only platform builtin plugin IDs can use sourceKind "builtin".',
      })
    }

    if (runtime.trustMode === 'saas_locked' && input.sourceKind !== 'builtin') {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Third-party plugin install is disabled in saas_locked mode.',
      })
    }

    // For non-builtin sources, use the installer to fetch + extract + validate
    let installPath: string | null = null
    if (input.sourceKind === 'npm' && input.sourceRef) {
      const installer = new PluginInstaller()
      const result = await installer.installFromNpm(input.sourceRef, input.version, input.pluginId)
      if (!result.success) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Plugin install failed: ${result.error}`,
        })
      }
      installPath = result.installPath ?? null
    } else if (input.sourceKind === 'local' && input.sourceRef) {
      const installer = new PluginInstaller()
      const result = await installer.installFromLocal(input.sourceRef, input.pluginId)
      if (!result.success) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Plugin install failed: ${result.error}`,
        })
      }
      installPath = result.installPath ?? null
    }

    // For local installs without a provided manifest, read from disk so we
    // capture the real entry point and other fields the plugin declares.
    let effectiveManifestJson = input.manifestJson
    if (
      !effectiveManifestJson &&
      installPath &&
      (input.sourceKind === 'local' || input.sourceKind === 'upload')
    ) {
      for (const filename of ['nitejar-plugin.json', 'package.json']) {
        try {
          const raw = await fs.readFile(path.join(installPath, filename), 'utf-8')
          // Override the manifest id with the user-provided pluginId so the
          // id-mismatch check in buildManifestFromInput passes. The user's
          // chosen pluginId is the canonical DB key.
          const parsed = JSON.parse(raw) as Record<string, unknown>
          parsed.id = input.pluginId
          effectiveManifestJson = JSON.stringify(parsed)
          break
        } catch {
          // try next
        }
      }
    }

    const manifest =
      builtinManifest ?? buildManifestFromInput({ ...input, manifestJson: effectiveManifestJson })
    const manifestJson = JSON.stringify(manifest)
    const checksum = stableChecksum(manifestJson)
    const trustLevel = input.sourceKind === 'builtin' ? 'builtin' : 'untrusted'

    const plugin = await upsertPlugin({
      id: input.pluginId,
      name: manifest.name,
      trustLevel,
      sourceKind: input.sourceKind,
      sourceRef: input.sourceKind === 'builtin' ? 'builtin' : (input.sourceRef ?? null),
      currentVersion: manifest.version,
      currentChecksum: checksum,
      currentInstallPath:
        input.sourceKind === 'builtin'
          ? `builtin://${input.pluginId}`
          : (installPath ?? `${input.sourceKind}://${input.sourceRef ?? input.pluginId}`),
      manifestJson,
      configJson: null,
      enabled: input.sourceKind === 'builtin',
    })

    await upsertPluginVersion({
      plugin_id: input.pluginId,
      version: manifest.version,
      checksum,
      install_path:
        input.sourceKind === 'builtin'
          ? `builtin://${input.pluginId}`
          : (installPath ?? `${input.sourceKind}://${input.sourceRef ?? input.pluginId}`),
      manifest_json: manifestJson,
      signature_json: null,
    })

    const declaredCapabilities = buildDeclaredCapabilities(manifest.permissions)
    await ensurePluginDisclosureRows({
      pluginId: input.pluginId,
      permissions: declaredCapabilities.map((cap) => ({
        permission: cap.permission,
        scope: cap.scope,
      })),
    })

    await createPluginEvent({
      plugin_id: input.pluginId,
      plugin_version: manifest.version,
      kind: 'install',
      status: 'ok',
      detail_json: JSON.stringify({
        sourceKind: input.sourceKind,
        sourceRef: input.sourceRef ?? null,
        installPath,
        executionMode: runtime.executionMode,
      }),
    })

    // If the plugin has an install path and is enabled, hot-load it
    if (installPath && plugin.enabled === 1) {
      try {
        const loader = new PluginLoader(pluginHandlerRegistry, providerRegistry)
        await loader.loadPlugin({
          id: plugin.id,
          manifest_json: manifestJson,
          current_install_path: installPath,
          source_kind: input.sourceKind,
        })
      } catch (err) {
        console.warn(`[plugins] Hot-load after install failed for ${plugin.id}:`, err)
      }
    }

    return {
      ok: true,
      plugin: {
        id: plugin.id,
        name: plugin.name,
        enabled: plugin.enabled === 1,
      },
      executionMode: runtime.executionMode,
      effectiveLimitations: runtime.effectiveLimitations,
    }
  }),

  installFromUpload: protectedProcedure
    .input(
      z.object({
        uploadToken: z.string().trim().min(1),
        confirmUpdate: z.boolean().default(false),
      })
    )
    .mutation(async ({ input }) => {
      const cached = consumeUpload(input.uploadToken)
      if (!cached) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Upload expired or already consumed. Please upload the file again.',
        })
      }

      if (cached.isUpdate && !input.confirmUpdate) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'This plugin already exists. Confirm the update to proceed.',
        })
      }

      const runtime = getPluginRuntimePosture(resolvePluginTrustMode())
      if (runtime.trustMode === 'saas_locked') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Third-party plugin install is disabled in saas_locked mode.',
        })
      }

      // Use PluginInstaller.installFromTgz for the full lifecycle
      const installer = new PluginInstaller()
      const result = await installer.installFromTgz(
        cached.tgzBuffer,
        cached.pluginId,
        cached.version
      )
      if (!result.success) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Plugin install failed: ${result.error}`,
        })
      }

      const manifest = parsePluginManifest(cached.manifestJson)
      if (!manifest) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invalid plugin manifest in uploaded package.',
        })
      }

      const manifestJson = JSON.stringify(manifest)
      const checksum = stableChecksum(manifestJson)

      const plugin = await upsertPlugin({
        id: cached.pluginId,
        name: manifest.name,
        trustLevel: 'untrusted',
        sourceKind: 'upload',
        sourceRef: null,
        currentVersion: manifest.version,
        currentChecksum: checksum,
        currentInstallPath: result.installPath ?? `upload://${cached.pluginId}`,
        manifestJson,
        configJson: null,
        enabled: true,
      })

      await upsertPluginVersion({
        plugin_id: cached.pluginId,
        version: manifest.version,
        checksum,
        install_path: result.installPath ?? `upload://${cached.pluginId}`,
        manifest_json: manifestJson,
        signature_json: null,
      })

      const declaredCapabilities = buildDeclaredCapabilities(manifest.permissions)
      await ensurePluginDisclosureRows({
        pluginId: cached.pluginId,
        permissions: declaredCapabilities.map((cap) => ({
          permission: cap.permission,
          scope: cap.scope,
        })),
      })

      // Auto-acknowledge disclosures for upload flow
      await acknowledgePluginDisclosures(cached.pluginId)

      await createPluginEvent({
        plugin_id: cached.pluginId,
        plugin_version: manifest.version,
        kind: 'install',
        status: 'ok',
        detail_json: JSON.stringify({
          sourceKind: 'upload',
          sourceRef: null,
          installPath: result.installPath,
          executionMode: runtime.executionMode,
          isUpdate: cached.isUpdate,
        }),
      })

      // Hot-load the plugin
      if (result.installPath) {
        try {
          const loader = new PluginLoader(pluginHandlerRegistry, providerRegistry)
          await loader.loadPlugin({
            id: plugin.id,
            manifest_json: manifestJson,
            current_install_path: result.installPath,
            source_kind: 'upload',
          })
        } catch (err) {
          console.warn(`[plugins] Hot-load after upload install failed for ${plugin.id}:`, err)
        }
      }

      return {
        ok: true,
        plugin: {
          id: plugin.id,
          name: plugin.name,
          enabled: plugin.enabled === 1,
        },
        executionMode: runtime.executionMode,
        effectiveLimitations: runtime.effectiveLimitations,
      }
    }),

  enablePlugin: protectedProcedure.input(enablePluginInputSchema).mutation(async ({ input }) => {
    const runtime = getPluginRuntimePosture(resolvePluginTrustMode())
    const plugin = await findPluginById(input.pluginId)
    if (!plugin) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Plugin not found.' })
    }

    const isThirdParty = plugin.source_kind !== 'builtin'
    if (runtime.trustMode === 'saas_locked' && isThirdParty) {
      await createPluginEvent({
        plugin_id: input.pluginId,
        plugin_version: plugin.current_version ?? null,
        kind: 'enable',
        status: 'blocked',
        detail_json: JSON.stringify({
          reason: 'trust_mode_locked',
          executionMode: runtime.executionMode,
        }),
      })
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Third-party plugins cannot be enabled in saas_locked mode.',
      })
    }

    if (isThirdParty && !input.consentAccepted) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Explicit consent is required before enabling third-party plugins.',
      })
    }

    let unacknowledgedDisclosures: DeclaredCapability[] = []
    if (isThirdParty) {
      const manifest = parsePluginManifest(plugin.manifest_json)
      const declaredCapabilities = buildDeclaredCapabilities(manifest?.permissions)
      const acks = await listPluginDisclosureAcks(plugin.id)
      const acknowledgedKeys = new Set(
        acks
          .filter((ack) => ack.acknowledged === 1)
          .map((ack) => capabilityKey(ack.permission, ack.scope || null))
      )
      unacknowledgedDisclosures = declaredCapabilities.filter(
        (capability) =>
          !acknowledgedKeys.has(capabilityKey(capability.permission, capability.scope))
      )
    }

    await setPluginEnabled(input.pluginId, true)
    // Batch-acknowledge all disclosures when enabling
    await acknowledgePluginDisclosures(input.pluginId)
    await createPluginEvent({
      plugin_id: input.pluginId,
      plugin_version: plugin.current_version ?? null,
      kind: 'enable',
      status: 'ok',
      detail_json: JSON.stringify({
        executionMode: runtime.executionMode,
        consentAccepted: input.consentAccepted,
        disclosureAcknowledged: true,
        unacknowledgedDisclosures,
      }),
    })

    // Reset crash guard state on manual re-enable
    const crashGuard = getCrashGuard()
    if (crashGuard) {
      crashGuard.resetPlugin(input.pluginId)
    }

    // Hot-load the plugin if it's a non-builtin with an install path
    if (
      isThirdParty &&
      plugin.current_install_path &&
      !plugin.current_install_path.startsWith('builtin://')
    ) {
      try {
        const loader = new PluginLoader(pluginHandlerRegistry, providerRegistry)
        await loader.loadPlugin({
          id: plugin.id,
          manifest_json: plugin.manifest_json,
          current_install_path: plugin.current_install_path,
          source_kind: plugin.source_kind,
        })
      } catch (err) {
        console.warn(`[plugins] Hot-load on enable failed for ${plugin.id}:`, err)
      }
    }

    return {
      ok: true,
      executionMode: runtime.executionMode,
      effectiveLimitations: runtime.effectiveLimitations,
    }
  }),

  disablePlugin: protectedProcedure
    .input(z.object({ pluginId: z.string().trim().min(1) }))
    .mutation(async ({ input }) => {
      const runtime = getPluginRuntimePosture(resolvePluginTrustMode())
      const plugin = await findPluginById(input.pluginId)
      if (!plugin) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Plugin not found.' })
      }

      await setPluginEnabled(input.pluginId, false)
      await createPluginEvent({
        plugin_id: input.pluginId,
        plugin_version: plugin.current_version ?? null,
        kind: 'disable',
        status: 'ok',
        detail_json: JSON.stringify({
          executionMode: runtime.executionMode,
        }),
      })

      // Unload the handler if it's a non-builtin plugin
      if (plugin.source_kind !== 'builtin') {
        try {
          const manifest = parsePluginManifest(plugin.manifest_json)
          if (manifest?.entry) {
            // Infer handler type from plugin ID
            const handlerType = plugin.id.includes('.') ? plugin.id.split('.').pop()! : plugin.id
            const loader = new PluginLoader(pluginHandlerRegistry, providerRegistry)
            await loader.unloadPlugin(plugin.id, handlerType)
          }
        } catch (err) {
          console.warn(`[plugins] Unload on disable failed for ${plugin.id}:`, err)
        }
      }

      return { ok: true }
    }),

  deletePlugin: protectedProcedure
    .input(z.object({ pluginId: z.string().trim().min(1) }))
    .mutation(async ({ input }) => {
      const plugin = await findPluginById(input.pluginId)
      if (!plugin) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Plugin not found.' })
      }

      if (plugin.source_kind === 'builtin') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Built-in plugins cannot be deleted.',
        })
      }

      // Check for active instances referencing this plugin
      const instances = await findPluginInstancesByType(plugin.id)
      if (instances.length > 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `Cannot delete plugin with ${instances.length} active instance(s). Remove all instances first.`,
        })
      }

      // Unload handler if currently loaded
      try {
        const manifest = parsePluginManifest(plugin.manifest_json)
        if (manifest?.entry) {
          const handlerType = plugin.id.includes('.') ? plugin.id.split('.').pop()! : plugin.id
          const loader = new PluginLoader(pluginHandlerRegistry, providerRegistry)
          await loader.unloadPlugin(plugin.id, handlerType)
        }
      } catch {
        // Best-effort unload
      }

      // Remove cached files from disk
      await removePluginDir(plugin.id).catch(() => {})

      // Delete all DB rows
      await deletePlugin(input.pluginId)

      return { ok: true }
    }),
})

export type PluginsRouter = typeof pluginsRouter
