import { z } from 'zod'
import {
  getDb,
  createAgent,
  createAgentSandbox,
  createCostLimit,
  createMemory,
  findAgentByHandle,
  findAgentById,
  getPluginInstancesForAgent,
  listCostLimitsForAgent,
  listPermanentMemories,
  updateAgent,
} from '@nitejar/database'
import {
  DEFAULT_EDIT_TOOL_MODE,
  getDefaultModel,
  parseAgentConfig,
  serializeAgentConfig,
} from '@nitejar/agent/config'
import { DEFAULT_NETWORK_POLICY, getPolicyStatus } from '@nitejar/agent/network-policy'
import { createInviteToken, hashInviteToken } from '@/lib/invitations'
import { AgentProfileV1Schema, MAX_SUPPORTED_FORMAT_VERSION } from '@/lib/agent-profile'
import type { AgentProfileV1 } from '@/lib/agent-profile'
import { getModelCatalogRecordByExternalId } from '../services/model-catalog'
import { protectedProcedure, router } from '../trpc'

const roleSchema = z.enum(['superadmin', 'admin', 'member'])
const statusSchema = z.enum(['active', 'disabled'])

const now = () => Math.floor(Date.now() / 1000)
const uuid = () => crypto.randomUUID()

const emailSchema = z
  .string()
  .trim()
  .email()
  .transform((value) => value.toLowerCase())

export const orgRouter = router({
  listMembers: protectedProcedure.query(async () => {
    const db = getDb()
    const users = await db.selectFrom('users').selectAll().orderBy('created_at', 'desc').execute()
    const invites = await db
      .selectFrom('invitations')
      .selectAll()
      .where('status', '=', 'pending')
      .orderBy('created_at', 'desc')
      .execute()

    const teamLinks = await db
      .selectFrom('team_members')
      .innerJoin('teams', 'teams.id', 'team_members.team_id')
      .select(['team_members.user_id as user_id', 'teams.id as team_id', 'teams.name as team_name'])
      .execute()

    const teamsByUser = new Map<string, { id: string; name: string }[]>()
    teamLinks.forEach((link) => {
      const list = teamsByUser.get(link.user_id) ?? []
      list.push({ id: link.team_id, name: link.team_name })
      teamsByUser.set(link.user_id, list)
    })

    const userRows = users.map((user) => ({
      kind: 'user' as const,
      id: user.id,
      name: user.name,
      email: user.email,
      avatar_url: user.avatar_url,
      role: user.role,
      status: user.status,
      teams: teamsByUser.get(user.id) ?? [],
      created_at: user.created_at,
    }))

    const inviteRows = invites.map((invite) => ({
      kind: 'invite' as const,
      id: invite.id,
      name: invite.name,
      email: invite.email,
      avatar_url: invite.avatar_url,
      role: invite.role,
      status: 'invited',
      teams: [] as { id: string; name: string }[],
      created_at: invite.created_at,
      expires_at: invite.expires_at,
    }))

    return [...userRows, ...inviteRows]
  }),

  createInvite: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1),
        email: emailSchema,
        role: roleSchema.default('member'),
        avatarUrl: z.string().url().optional().nullable(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb()
      const existing = await db
        .selectFrom('users')
        .select(['id', 'status'])
        .where('email', '=', input.email)
        .executeTakeFirst()

      if (existing) {
        throw new Error('A user with this email already exists.')
      }

      const timestamp = now()
      const token = createInviteToken()
      const tokenHash = hashInviteToken(token)
      const invitationId = uuid()
      const expiresAt = timestamp + 60 * 60 * 24 * 7

      await db
        .updateTable('invitations')
        .set({
          status: 'expired',
          updated_at: timestamp,
        })
        .where('email', '=', input.email)
        .where('status', '=', 'pending')
        .execute()

      await db
        .insertInto('invitations')
        .values({
          id: invitationId,
          name: input.name,
          email: input.email,
          token_hash: tokenHash,
          avatar_url: input.avatarUrl ?? null,
          role: input.role,
          status: 'pending',
          expires_at: expiresAt,
          accepted_at: null,
          created_by_user_id: ctx.session?.user.id ?? null,
          created_at: timestamp,
          updated_at: timestamp,
        })
        .execute()

      const baseUrl =
        process.env.APP_URL ??
        process.env.APP_BASE_URL ??
        process.env.NEXT_PUBLIC_APP_URL ??
        'http://localhost:3000'
      const inviteUrl = `${baseUrl}/invite/${token}`

      const { sendInviteEmail } = await import('@/lib/email')
      const { sent: emailSent } = await sendInviteEmail({
        to: input.email,
        name: input.name,
        inviteUrl,
      })

      return { inviteUrl, emailSent }
    }),

  updateMember: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().trim().min(1).optional(),
        avatarUrl: z.string().url().optional().nullable(),
        role: roleSchema.optional(),
        status: statusSchema.optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb()
      const timestamp = new Date().toISOString()
      await db
        .updateTable('users')
        .set({
          ...(input.name ? { name: input.name } : {}),
          ...(input.avatarUrl !== undefined ? { avatar_url: input.avatarUrl } : {}),
          ...(input.role ? { role: input.role } : {}),
          ...(input.status ? { status: input.status } : {}),
          updated_at: timestamp,
        })
        .where('id', '=', input.id)
        .execute()
      return { ok: true }
    }),

  listTeams: protectedProcedure.query(async () => {
    const db = getDb()
    const teams = await db.selectFrom('teams').selectAll().orderBy('name', 'asc').execute()

    const memberLinks = await db
      .selectFrom('team_members')
      .innerJoin('users', 'users.id', 'team_members.user_id')
      .select([
        'team_members.team_id as team_id',
        'users.id as user_id',
        'users.name as user_name',
        'users.avatar_url as avatar_url',
        'team_members.role as role',
      ])
      .execute()

    const agentLinks = await db
      .selectFrom('agent_teams')
      .innerJoin('agents', 'agents.id', 'agent_teams.agent_id')
      .select([
        'agent_teams.team_id as team_id',
        'agents.id as agent_id',
        'agents.name as agent_name',
        'agents.config as agent_config',
      ])
      .execute()

    type TeamMember = {
      id: string
      name: string
      avatarUrl: string | null
      role: string
    }
    type TeamAgent = {
      id: string
      name: string
      emoji: string | null
      avatarUrl: string | null
      title: string | null
    }

    const membersByTeam = new Map<string, TeamMember[]>()
    memberLinks.forEach((link) => {
      const list = membersByTeam.get(link.team_id) ?? []
      list.push({
        id: link.user_id,
        name: link.user_name,
        avatarUrl: link.avatar_url,
        role: link.role,
      })
      membersByTeam.set(link.team_id, list)
    })

    const agentsByTeam = new Map<string, TeamAgent[]>()
    agentLinks.forEach((link) => {
      const parsed = parseAgentConfig(link.agent_config)
      const list = agentsByTeam.get(link.team_id) ?? []
      list.push({
        id: link.agent_id,
        name: link.agent_name,
        emoji: parsed.emoji ?? null,
        avatarUrl: parsed.avatarUrl ?? null,
        title: parsed.title ?? null,
      })
      agentsByTeam.set(link.team_id, list)
    })

    return teams.map((team) => ({
      ...team,
      members: membersByTeam.get(team.id) ?? [],
      agents: agentsByTeam.get(team.id) ?? [],
    }))
  }),

  createTeam: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(2),
        description: z.string().trim().optional().nullable(),
        slug: z.string().trim().optional().nullable(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb()
      const timestamp = now()
      const id = uuid()
      const slug = input.slug
        ? input.slug
        : input.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)+/g, '')

      await db
        .insertInto('teams')
        .values({
          id,
          name: input.name,
          description: input.description ?? null,
          slug,
          created_at: timestamp,
          updated_at: timestamp,
        })
        .execute()

      return { id }
    }),

  addTeamMember: protectedProcedure
    .input(
      z.object({
        teamId: z.string(),
        userId: z.string(),
        role: roleSchema.optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb()
      await db
        .insertInto('team_members')
        .values({
          team_id: input.teamId,
          user_id: input.userId,
          role: input.role ?? 'member',
          created_at: now(),
        })
        .onConflict((oc) =>
          oc.columns(['team_id', 'user_id']).doUpdateSet({ role: input.role ?? 'member' })
        )
        .execute()

      return { ok: true }
    }),

  removeTeamMember: protectedProcedure
    .input(z.object({ teamId: z.string(), userId: z.string() }))
    .mutation(async ({ input }) => {
      const db = getDb()
      await db
        .deleteFrom('team_members')
        .where('team_id', '=', input.teamId)
        .where('user_id', '=', input.userId)
        .execute()
      return { ok: true }
    }),

  listAgents: protectedProcedure.query(async () => {
    const db = getDb()
    const agents = await db.selectFrom('agents').selectAll().orderBy('created_at', 'desc').execute()

    return agents.map((agent) => {
      const config = parseAgentConfig(agent.config)
      return {
        id: agent.id,
        handle: agent.handle,
        name: agent.name,
        status: agent.status,
        spriteId: agent.sprite_id,
        title: config.title ?? null,
        emoji: config.emoji ?? null,
        avatarUrl: config.avatarUrl ?? null,
        policyStatus: getPolicyStatus(config.networkPolicy),
      }
    })
  }),

  createAgent: protectedProcedure
    .input(
      z.object({
        handle: z.string().trim().min(1), // @mention ID (slug)
        name: z.string().trim().min(1), // Display name
        title: z.string().trim().optional().nullable(), // Role
        emoji: z.string().trim().optional().nullable(),
        avatarUrl: z.string().url().optional().nullable(),
        teamId: z.string().optional().nullable(),
      })
    )
    .mutation(async ({ input }) => {
      if (!/^[a-zA-Z0-9_-]+$/.test(input.handle)) {
        throw new Error('Agent handle can only contain letters, numbers, hyphens, and underscores')
      }

      const config = serializeAgentConfig({
        model: getDefaultModel(),
        editToolMode: DEFAULT_EDIT_TOOL_MODE,
        memorySettings: {
          passiveUpdatesEnabled: true,
        },
        allowEphemeralSandboxCreation: true,
        title: input.title ?? undefined,
        emoji: input.emoji ?? undefined,
        avatarUrl: input.avatarUrl ?? undefined,
        networkPolicy: {
          ...DEFAULT_NETWORK_POLICY,
          rules: DEFAULT_NETWORK_POLICY.rules.map((rule) => ({ ...rule })),
        },
      })

      const agent = await createAgent({
        handle: input.handle,
        name: input.name,
        sprite_id: null,
        config,
        status: 'idle',
      })

      // Create the home sandbox for the new agent
      const spriteName = agent.sprite_id ?? `nitejar-${input.handle}`
      await createAgentSandbox({
        agent_id: agent.id,
        name: 'home',
        description: 'Persistent home sandbox',
        sprite_name: spriteName,
        kind: 'home',
        created_by: 'system',
      })

      if (input.teamId) {
        const db = getDb()
        await db
          .insertInto('agent_teams')
          .values({
            team_id: input.teamId,
            agent_id: agent.id,
            is_primary: 0,
            created_at: now(),
          })
          .execute()
      }

      return { id: agent.id }
    }),

  assignAgentToTeam: protectedProcedure
    .input(
      z.object({
        teamId: z.string(),
        agentId: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb()
      await db.transaction().execute(async (trx) => {
        await trx.deleteFrom('agent_teams').where('agent_id', '=', input.agentId).execute()

        await trx
          .insertInto('agent_teams')
          .values({
            team_id: input.teamId,
            agent_id: input.agentId,
            is_primary: 0,
            created_at: now(),
          })
          .execute()
      })
      return { ok: true }
    }),

  removeAgentFromTeam: protectedProcedure
    .input(z.object({ teamId: z.string(), agentId: z.string() }))
    .mutation(async ({ input }) => {
      const db = getDb()
      await db
        .deleteFrom('agent_teams')
        .where('team_id', '=', input.teamId)
        .where('agent_id', '=', input.agentId)
        .execute()
      return { ok: true }
    }),

  updateAgentIdentity: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().trim().optional().nullable(),
        title: z.string().trim().optional().nullable(),
        emoji: z.string().trim().optional().nullable(),
        avatarUrl: z.string().url().optional().nullable(),
      })
    )
    .mutation(async ({ input }) => {
      const agent = await findAgentById(input.id)
      if (!agent) {
        throw new Error('Agent not found')
      }
      const config = parseAgentConfig(agent.config)
      const updatedConfig = serializeAgentConfig({
        ...config,
        title: input.title ?? config.title,
        emoji: input.emoji ?? config.emoji,
        avatarUrl: input.avatarUrl ?? config.avatarUrl,
      })
      await updateAgent(input.id, {
        ...(input.name ? { name: input.name } : {}),
        config: updatedConfig,
      })
      return { ok: true }
    }),

  updateAgentStatus: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        status: z.enum(['idle', 'busy', 'offline']),
      })
    )
    .mutation(async ({ input }) => {
      await updateAgent(input.id, { status: input.status })
      return { ok: true }
    }),

  updateAgentModel: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        model: z.string().trim().min(1),
        temperature: z.number().min(0).max(2),
        maxTokens: z.number().int().positive(),
        editToolMode: z.enum(['hashline', 'replace']),
        triageMaxTokens: z.number().int().positive().optional(),
        triageReasoningEffort: z.enum(['default', 'low', 'medium', 'high']).optional(),
        triageRecentHistoryMaxChars: z.number().int().positive().optional(),
        triageRecentHistoryLookbackMessages: z.number().int().positive().optional(),
        triageRecentHistoryPerMessageMaxChars: z.number().int().positive().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const agent = await findAgentById(input.id)
      if (!agent) {
        throw new Error('Agent not found')
      }

      const config = parseAgentConfig(agent.config)
      const modelRecord = await getModelCatalogRecordByExternalId(input.model)
      const supportsReasoningControl =
        modelRecord?.metadata?.supportsReasoningControl === false ? false : true
      const requestedTriageReasoningEffort =
        input.triageReasoningEffort === 'default' ? undefined : input.triageReasoningEffort
      const nextTriageSettings: {
        maxTokens?: number
        reasoningEffort?: 'low' | 'medium' | 'high'
        recentHistoryMaxChars?: number
        recentHistoryLookbackMessages?: number
        recentHistoryPerMessageMaxChars?: number
      } = {
        ...config.triageSettings,
        ...(input.triageMaxTokens !== undefined ? { maxTokens: input.triageMaxTokens } : {}),
        ...(input.triageRecentHistoryMaxChars !== undefined
          ? { recentHistoryMaxChars: input.triageRecentHistoryMaxChars }
          : {}),
        ...(input.triageRecentHistoryLookbackMessages !== undefined
          ? { recentHistoryLookbackMessages: input.triageRecentHistoryLookbackMessages }
          : {}),
        ...(input.triageRecentHistoryPerMessageMaxChars !== undefined
          ? { recentHistoryPerMessageMaxChars: input.triageRecentHistoryPerMessageMaxChars }
          : {}),
      }
      if (!supportsReasoningControl) {
        nextTriageSettings.reasoningEffort = undefined
      } else if (input.triageReasoningEffort !== undefined) {
        nextTriageSettings.reasoningEffort = requestedTriageReasoningEffort
      }
      const triageSettings =
        nextTriageSettings.maxTokens !== undefined ||
        nextTriageSettings.reasoningEffort !== undefined ||
        nextTriageSettings.recentHistoryMaxChars !== undefined ||
        nextTriageSettings.recentHistoryLookbackMessages !== undefined ||
        nextTriageSettings.recentHistoryPerMessageMaxChars !== undefined
          ? nextTriageSettings
          : undefined
      const updatedConfig = serializeAgentConfig({
        ...config,
        model: input.model,
        temperature: input.temperature,
        maxTokens: input.maxTokens,
        editToolMode: input.editToolMode,
        triageSettings,
      })

      await updateAgent(input.id, { config: updatedConfig })
      return { ok: true }
    }),

  // ====================================================================
  // Agent Profile Export / Validate / Import
  // ====================================================================

  exportAgentProfile: protectedProcedure
    .input(
      z.object({
        agentId: z.string(),
        includeSeedMemories: z.boolean().optional(),
      })
    )
    .query(async ({ input }) => {
      const agent = await findAgentById(input.agentId)
      if (!agent) throw new Error('Agent not found')

      const config = parseAgentConfig(agent.config)
      const costLimits = await listCostLimitsForAgent(agent.id)
      const pluginInstances = await getPluginInstancesForAgent(agent.id)

      // Build seed memories from permanent memories if requested
      let seedMemories: { content: string; permanent: boolean }[] = []
      if (input.includeSeedMemories) {
        const permanentMems = await listPermanentMemories(agent.id)
        seedMemories = permanentMems.map((m) => ({
          content: m.content,
          permanent: true,
        }))
      }

      // Build skill attachments
      const db = getDb()
      const skillAssignments = await db
        .selectFrom('skill_assignments')
        .selectAll()
        .where('scope', '=', 'agent')
        .where('scope_id', '=', agent.id)
        .where('enabled', '=', 1)
        .execute()

      const profile: AgentProfileV1 = {
        $schema: 'https://nitejar.dev/schemas/agent-profile/v1.json',
        formatVersion: 1,
        exportedAt: new Date().toISOString(),
        exportedFrom: 'nitejar/1.0.0',

        identity: {
          name: agent.name,
          handle: agent.handle,
          title: config.title ?? null,
          emoji: config.emoji ?? null,
          avatarUrl: config.avatarUrl ?? null,
        },

        soul: config.soul,

        model: {
          preferred: config.model,
          temperature: config.temperature,
          maxTokens: config.maxTokens,
          editToolMode: config.editToolMode,
        },

        memorySettings: config.memorySettings,
        sessionSettings: config.sessionSettings,
        networkPolicy: config.networkPolicy,
        triageSettings: config.triageSettings,
        queue: config.queue,

        features: {
          allowEphemeralSandboxCreation: config.allowEphemeralSandboxCreation,
          allowRoutineManagement: config.allowRoutineManagement,
          dangerouslyUnrestricted: config.dangerouslyUnrestricted,
        },

        pluginRequirements: pluginInstances.map((pi) => ({
          pluginId: pi.type,
          required: false,
          note: pi.name,
        })),

        costLimits: costLimits.map((cl) => ({
          period: cl.period,
          limitUsd: cl.limit_usd,
          softLimitPct: cl.soft_limit_pct,
          hardLimitPct: cl.hard_limit_pct,
        })),

        skillAttachments: skillAssignments.map((sa) => ({
          skillSlug: sa.skill_slug,
          priority: sa.priority,
          autoInject: sa.auto_inject === 1,
        })),

        ...(seedMemories.length > 0 ? { seedMemories } : {}),
      }

      // Strip undefined values for clean output
      const clean = JSON.parse(JSON.stringify(profile)) as AgentProfileV1

      return {
        profile: clean,
        filename: `${agent.handle}.nitejar-agent.json`,
      }
    }),

  validateAgentProfile: protectedProcedure
    .input(
      z.object({
        profile: z.unknown(),
      })
    )
    .mutation(async ({ input }) => {
      const errors: string[] = []
      const warnings: string[] = []

      // Basic structure check
      if (!input.profile || typeof input.profile !== 'object') {
        return {
          valid: false,
          errors: ['Invalid profile: must be a JSON object.'],
          warnings: [],
          handleConflict: false,
          modelAvailable: false,
          pluginStatus: [],
          skillStatus: [],
        }
      }

      const raw = input.profile as Record<string, unknown>

      // Check format version
      if (typeof raw.formatVersion !== 'number') {
        errors.push('Missing formatVersion field.')
      } else if (raw.formatVersion > MAX_SUPPORTED_FORMAT_VERSION) {
        errors.push(
          `This profile requires a newer version of Nitejar (format version ${raw.formatVersion}, max supported: ${MAX_SUPPORTED_FORMAT_VERSION}).`
        )
      }

      // Try Zod parse
      const parseResult = AgentProfileV1Schema.safeParse(raw)
      if (!parseResult.success) {
        for (const issue of parseResult.error.issues) {
          errors.push(`${issue.path.join('.')}: ${issue.message}`)
        }
        return {
          valid: false,
          errors,
          warnings,
          handleConflict: false,
          modelAvailable: false,
          pluginStatus: [],
          skillStatus: [],
        }
      }

      const profile = parseResult.data

      // Check handle conflict
      const existingAgent = await findAgentByHandle(profile.identity.handle)
      const handleConflict = !!existingAgent

      if (handleConflict) {
        warnings.push(
          `Handle "${profile.identity.handle}" is already in use. You will need to choose a different handle.`
        )
      }

      // Check model availability
      let modelAvailable = true
      if (profile.model?.preferred) {
        const modelRecord = await getModelCatalogRecordByExternalId(profile.model.preferred)
        if (!modelRecord) {
          modelAvailable = false
          warnings.push(
            `Model "${profile.model.preferred}" is not in the local catalog. The default model will be used.`
          )
        }
      }

      // Check plugin status
      const db = getDb()
      const pluginStatus: Array<{
        pluginId: string
        installed: boolean
        hasInstance: boolean
      }> = []

      if (profile.pluginRequirements) {
        for (const req of profile.pluginRequirements) {
          const plugin = await db
            .selectFrom('plugins')
            .select(['id', 'enabled'])
            .where('id', '=', req.pluginId)
            .executeTakeFirst()

          const installed = !!plugin && plugin.enabled === 1
          let hasInstance = false
          if (installed) {
            const instances = await db
              .selectFrom('plugin_instances')
              .select('id')
              .where('plugin_id', '=', req.pluginId)
              .where('enabled', '=', 1)
              .limit(1)
              .execute()
            hasInstance = instances.length > 0
          }

          pluginStatus.push({ pluginId: req.pluginId, installed, hasInstance })

          if (!installed && req.required) {
            warnings.push(`Required plugin "${req.pluginId}" is not installed.`)
          } else if (!installed) {
            warnings.push(`Optional plugin "${req.pluginId}" is not installed.`)
          } else if (!hasInstance) {
            warnings.push(`Plugin "${req.pluginId}" is installed but has no active instance.`)
          }
        }
      }

      // Check skill status
      const skillStatus: Array<{ skillSlug: string; available: boolean }> = []
      if (profile.skillAttachments) {
        for (const sa of profile.skillAttachments) {
          const skill = await db
            .selectFrom('skills')
            .select('id')
            .where('slug', '=', sa.skillSlug)
            .where('enabled', '=', 1)
            .executeTakeFirst()

          const available = !!skill
          skillStatus.push({ skillSlug: sa.skillSlug, available })

          if (!available) {
            warnings.push(`Skill "${sa.skillSlug}" is not available locally.`)
          }
        }
      }

      return {
        valid: errors.length === 0,
        errors,
        warnings,
        handleConflict,
        modelAvailable,
        pluginStatus,
        skillStatus,
      }
    }),

  importAgentProfile: protectedProcedure
    .input(
      z.object({
        profile: AgentProfileV1Schema,
        handleOverride: z.string().trim().min(1).optional(),
        modelOverride: z.string().trim().min(1).optional(),
        teamId: z.string().optional(),
        skipSeedMemories: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { profile, handleOverride, modelOverride, skipSeedMemories } = input
      const handle = handleOverride || profile.identity.handle

      // Validate handle format
      if (!/^[a-zA-Z0-9_-]+$/.test(handle)) {
        throw new Error('Agent handle can only contain letters, numbers, hyphens, and underscores')
      }

      // Check handle conflict
      const existing = await findAgentByHandle(handle)
      if (existing) {
        throw new Error(`Handle "${handle}" is already in use.`)
      }

      // Resolve model
      let model = profile.model?.preferred || getDefaultModel()
      if (modelOverride) {
        model = modelOverride
      } else if (profile.model?.preferred) {
        const modelRecord = await getModelCatalogRecordByExternalId(profile.model.preferred)
        if (!modelRecord) {
          model = getDefaultModel()
        }
      }

      // Build the agent config JSON
      const importedMemorySettings = {
        ...profile.memorySettings,
      }
      if (importedMemorySettings.passiveUpdatesEnabled === undefined) {
        importedMemorySettings.passiveUpdatesEnabled = true
      }

      const agentConfig = serializeAgentConfig({
        model,
        temperature: profile.model?.temperature,
        maxTokens: profile.model?.maxTokens,
        editToolMode: profile.model?.editToolMode,
        title: profile.identity.title ?? undefined,
        emoji: profile.identity.emoji ?? undefined,
        avatarUrl: profile.identity.avatarUrl ?? undefined,
        soul: profile.soul,
        memorySettings: importedMemorySettings,
        sessionSettings: profile.sessionSettings,
        networkPolicy: profile.networkPolicy ?? {
          ...DEFAULT_NETWORK_POLICY,
          rules: DEFAULT_NETWORK_POLICY.rules.map((r) => ({ ...r })),
        },
        triageSettings: profile.triageSettings
          ? {
              maxTokens: profile.triageSettings.maxTokens,
              reasoningEffort: profile.triageSettings.reasoningEffort ?? undefined,
              recentHistoryMaxChars: profile.triageSettings.recentHistoryMaxChars,
              recentHistoryLookbackMessages: profile.triageSettings.recentHistoryLookbackMessages,
              recentHistoryPerMessageMaxChars:
                profile.triageSettings.recentHistoryPerMessageMaxChars,
            }
          : undefined,
        queue: profile.queue,
        allowEphemeralSandboxCreation: profile.features?.allowEphemeralSandboxCreation,
        allowRoutineManagement: profile.features?.allowRoutineManagement,
        dangerouslyUnrestricted: profile.features?.dangerouslyUnrestricted,
      })

      // Create the agent
      const agent = await createAgent({
        handle,
        name: profile.identity.name,
        sprite_id: null,
        config: agentConfig,
        status: 'idle',
      })

      // Create home sandbox
      const spriteName = `nitejar-${handle}`
      await createAgentSandbox({
        agent_id: agent.id,
        name: 'home',
        description: 'Persistent home sandbox',
        sprite_name: spriteName,
        kind: 'home',
        created_by: 'system',
      })

      // Assign team if specified
      if (input.teamId) {
        const db = getDb()
        await db
          .insertInto('agent_teams')
          .values({
            team_id: input.teamId,
            agent_id: agent.id,
            is_primary: 0,
            created_at: now(),
          })
          .execute()
      }

      // Create cost limits
      if (profile.costLimits) {
        for (const cl of profile.costLimits) {
          await createCostLimit({
            agent_id: agent.id,
            period: cl.period,
            limit_usd: cl.limitUsd,
            enabled: 1,
            scope: 'agent',
            team_id: null,
            soft_limit_pct: cl.softLimitPct ?? 100,
            hard_limit_pct: cl.hardLimitPct ?? 150,
          })
        }
      }

      // Create seed memories
      if (!skipSeedMemories && profile.seedMemories) {
        for (const mem of profile.seedMemories) {
          await createMemory({
            agent_id: agent.id,
            content: mem.content,
            embedding: null,
            strength: 1.0,
            access_count: 0,
            permanent: mem.permanent !== false ? 1 : 0,
            version: 1,
            last_accessed_at: null,
          })
        }
      }

      // Create skill attachments
      if (profile.skillAttachments) {
        const db = getDb()
        for (const sa of profile.skillAttachments) {
          // Only attach if skill exists locally
          const skill = await db
            .selectFrom('skills')
            .select(['id', 'slug'])
            .where('slug', '=', sa.skillSlug)
            .where('enabled', '=', 1)
            .executeTakeFirst()

          if (skill) {
            await db
              .insertInto('skill_assignments')
              .values({
                id: uuid(),
                skill_id: skill.id,
                skill_slug: skill.slug,
                scope: 'agent',
                scope_id: agent.id,
                priority: sa.priority ?? 0,
                auto_inject: sa.autoInject ? 1 : 0,
                enabled: 1,
                created_at: now(),
                updated_at: now(),
              })
              .execute()
          }
        }
      }

      return { agentId: agent.id }
    }),
})
