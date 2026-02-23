import { TRPCError } from '@trpc/server'
import {
  createSkill,
  createSkillAssignment,
  createSkillFile,
  deleteSkill,
  deleteSkillAssignment,
  deleteSkillFile,
  findSkillAssignmentById,
  findSkillById,
  findSkillFile,
  getAgentIdsForSkill,
  getSkillAssignmentsForAgent,
  getSkillsWithAssignmentCounts,
  isSkillSlugAvailable,
  listCategories,
  listSkillAssignments,
  listSkillFiles,
  updateSkill,
  updateSkillAssignment,
  updateSkillFile,
  findAgentById,
  listAgents,
  listPlugins,
} from '@nitejar/database'
import {
  materializeSkill,
  rematerializeSkill,
  removeMaterializedSkill,
} from '@nitejar/agent/skill-materialize'
import { syncSkillsToSandbox, removeSkillFromSprite } from '@nitejar/agent/skill-sync'
import { parseAgentConfig } from '@nitejar/agent/config'
import { z } from 'zod'
import { protectedProcedure, router } from '../trpc'

async function resolvePluginInfo(
  pluginId: string | null
): Promise<{ pluginName: string; pluginType: string } | null> {
  if (!pluginId) return null
  const plugins = await listPlugins()
  const plugin = plugins.find((p) => p.id === pluginId)
  if (!plugin) return null
  // Extract the plugin type from the manifest (used for routes + icon mapping)
  let pluginType: string = plugin.name.toLowerCase()
  try {
    const manifest = JSON.parse(plugin.manifest_json) as { id?: string }
    if (manifest.id) pluginType = manifest.id.replace(/^builtin\./, '')
  } catch {
    // fall back to name-based type
  }
  return { pluginName: plugin.name, pluginType }
}

const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/, 'Slug must be lowercase alphanumeric with hyphens')

const tagSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9-]+$/)

const SKILL_CATEGORIES = [
  'general',
  'coding',
  'ops',
  'writing',
  'research',
  'design',
  'testing',
  'security',
  'custom',
] as const

const categorySchema = z.enum(SKILL_CATEGORIES)

const relativePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .refine((p) => !p.includes('..'), 'Path must not contain ".."')
  .refine((p) => !p.startsWith('/'), 'Path must not start with "/"')

/**
 * Trigger sandbox sync for all agents affected by a skill change.
 * Non-blocking — logs errors but does not throw.
 */
async function triggerSyncForSkill(skillId: string): Promise<void> {
  try {
    const agentIds = await getAgentIdsForSkill(skillId)
    for (const agentId of agentIds) {
      const agent = await findAgentById(agentId)
      if (!agent?.sprite_id) continue
      try {
        await syncSkillsToSandbox(agentId, agent.sprite_id)
      } catch (error) {
        console.warn(
          `[skills] Failed to sync skills to agent ${agentId}:`,
          error instanceof Error ? error.message : error
        )
      }
    }
  } catch (error) {
    console.warn(
      `[skills] Failed to get agent IDs for skill ${skillId}:`,
      error instanceof Error ? error.message : error
    )
  }
}

export const skillsRouter = router({
  // ========================================================================
  // Queries
  // ========================================================================

  list: protectedProcedure
    .input(
      z
        .object({
          source: z.enum(['admin', 'plugin']).optional(),
          category: z.string().optional(),
          search: z.string().optional(),
          enabled: z.boolean().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const skills = await getSkillsWithAssignmentCounts()
      let filtered = skills
      if (input?.source) {
        filtered = filtered.filter((s) => s.source_kind === input.source)
      }
      if (input?.category) {
        filtered = filtered.filter((s) => s.category === input.category)
      }
      if (input?.enabled !== undefined) {
        filtered = filtered.filter((s) => s.enabled === (input.enabled ? 1 : 0))
      }
      if (input?.search) {
        const term = input.search.toLowerCase()
        filtered = filtered.filter(
          (s) =>
            s.name.toLowerCase().includes(term) ||
            (s.description ?? '').toLowerCase().includes(term)
        )
      }

      // Enrich with assigned agent info (emoji avatars for cards)
      const allAgents = await listAgents()
      const agentMap = new Map(
        allAgents.map((a) => {
          const cfg = parseAgentConfig(a.config)
          return [a.id, { id: a.id, name: a.name, emoji: cfg.emoji ?? null }]
        })
      )

      const allAssignments = await listSkillAssignments()
      const skillAgentMap = new Map<
        string,
        Array<{ id: string; name: string; emoji: string | null }>
      >()

      for (const assignment of allAssignments) {
        if (assignment.scope === 'agent' && assignment.scope_id) {
          const agent = agentMap.get(assignment.scope_id)
          if (agent) {
            const existing = skillAgentMap.get(assignment.skill_id) ?? []
            if (!existing.some((a) => a.id === agent.id)) {
              existing.push(agent)
              skillAgentMap.set(assignment.skill_id, existing)
            }
          }
        } else if (assignment.scope === 'global') {
          // Global means all agents — mark with a special flag
          if (!skillAgentMap.has(assignment.skill_id)) {
            skillAgentMap.set(assignment.skill_id, [])
          }
          // We'll handle "global" display on the client side via isGlobal flag
        }
      }

      // Resolve plugin info (name + type for icon/link)
      const plugins = await listPlugins()
      const pluginInfoMap = new Map(
        plugins.map((p) => {
          let pluginType: string = p.name.toLowerCase()
          try {
            const manifest = JSON.parse(p.manifest_json) as { id?: string }
            if (manifest.id) pluginType = manifest.id.replace(/^builtin\./, '')
          } catch {
            // fall back to name-based type
          }
          return [p.id, { pluginName: p.name, pluginType }] as const
        })
      )

      return filtered.map((s) => {
        const info =
          s.source_kind === 'plugin' && s.plugin_id ? pluginInfoMap.get(s.plugin_id) : null
        return {
          ...s,
          assignedAgents: skillAgentMap.get(s.id) ?? [],
          isGlobalAssignment: allAssignments.some(
            (a) => a.skill_id === s.id && a.scope === 'global'
          ),
          pluginName: info?.pluginName ?? null,
          pluginType: info?.pluginType ?? null,
        }
      })
    }),

  get: protectedProcedure
    .input(z.object({ skillId: z.string().trim().min(1) }))
    .query(async ({ input }) => {
      const skill = await findSkillById(input.skillId)
      if (!skill) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Skill not found' })
      }
      const files = await listSkillFiles(input.skillId)
      const pluginInfo = await resolvePluginInfo(skill.plugin_id)
      return {
        ...skill,
        files,
        pluginName: pluginInfo?.pluginName ?? null,
        pluginType: pluginInfo?.pluginType ?? null,
      }
    }),

  listAssignments: protectedProcedure
    .input(
      z
        .object({
          skillId: z.string().optional(),
          scope: z.enum(['global', 'team', 'agent']).optional(),
          scopeId: z.string().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const assignments = await listSkillAssignments({
        skillId: input?.skillId,
        scope: input?.scope,
        scopeId: input?.scopeId,
      })

      // Resolve agent names for agent-scoped assignments
      const agentIds = [
        ...new Set(
          assignments
            .filter((a) => a.scope === 'agent' && a.scope_id)
            .map((a) => a.scope_id as string)
        ),
      ]

      let agentMap: Record<string, { name: string; handle: string; emoji: string | null }> = {}
      if (agentIds.length > 0) {
        const agents = await listAgents()
        agentMap = Object.fromEntries(
          agents
            .filter((a) => agentIds.includes(a.id))
            .map((a) => {
              const config = parseAgentConfig(a.config)
              return [a.id, { name: a.name, handle: a.handle, emoji: config.emoji ?? null }]
            })
        )
      }

      return assignments.map((a) => ({
        ...a,
        agentName: a.scope === 'agent' && a.scope_id ? (agentMap[a.scope_id]?.name ?? null) : null,
        agentHandle:
          a.scope === 'agent' && a.scope_id ? (agentMap[a.scope_id]?.handle ?? null) : null,
        agentEmoji:
          a.scope === 'agent' && a.scope_id ? (agentMap[a.scope_id]?.emoji ?? null) : null,
      }))
    }),

  listForAgent: protectedProcedure
    .input(z.object({ agentId: z.string().trim().min(1) }))
    .query(async ({ input }) => {
      return getSkillAssignmentsForAgent(input.agentId)
    }),

  listCategories: protectedProcedure.query(async () => {
    const used = await listCategories()
    // Merge with predefined categories
    const all = new Set([...SKILL_CATEGORIES, ...used])
    return Array.from(all).sort()
  }),

  getFile: protectedProcedure
    .input(
      z.object({
        skillId: z.string().trim().min(1),
        relativePath: z.string().trim().min(1),
      })
    )
    .query(async ({ input }) => {
      const file = await findSkillFile(input.skillId, input.relativePath)
      if (!file) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Skill file not found',
        })
      }
      return file
    }),

  checkSlug: protectedProcedure
    .input(
      z.object({
        slug: slugSchema,
        excludeId: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      const available = await isSkillSlugAvailable(input.slug, input.excludeId)
      return { available }
    }),

  // ========================================================================
  // Mutations
  // ========================================================================

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(128),
        slug: slugSchema,
        description: z.string().optional(),
        category: categorySchema.optional(),
        content: z.string().min(1),
        tags: z.array(tagSchema).max(20).optional(),
        requiresTools: z.array(z.string().trim().min(1)).optional(),
        metadata: z.record(z.unknown()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const slugAvailable = await isSkillSlugAvailable(input.slug)
      if (!slugAvailable) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Slug "${input.slug}" is already in use.`,
        })
      }

      const skill = await createSkill({
        name: input.name,
        slug: input.slug,
        description: input.description,
        category: input.category,
        sourceKind: 'admin',
        content: input.content,
        isDirectory: false,
        tags: input.tags,
        requiresTools: input.requiresTools,
        metadata: input.metadata,
      })

      // Materialize to host filesystem cache
      try {
        await materializeSkill(skill.id)
      } catch (error) {
        console.warn(
          '[skills] Failed to materialize skill after creation:',
          error instanceof Error ? error.message : error
        )
      }

      return skill
    }),

  createDirectory: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(128),
        slug: slugSchema,
        description: z.string().optional(),
        category: categorySchema.optional(),
        content: z.string().min(1),
        files: z.array(
          z.object({
            path: relativePathSchema,
            content: z.string(),
            contentType: z.string().optional(),
          })
        ),
        tags: z.array(tagSchema).max(20).optional(),
        requiresTools: z.array(z.string().trim().min(1)).optional(),
        metadata: z.record(z.unknown()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const slugAvailable = await isSkillSlugAvailable(input.slug)
      if (!slugAvailable) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Slug "${input.slug}" is already in use.`,
        })
      }

      const skill = await createSkill({
        name: input.name,
        slug: input.slug,
        description: input.description,
        category: input.category,
        sourceKind: 'admin',
        content: input.content,
        isDirectory: true,
        tags: input.tags,
        requiresTools: input.requiresTools,
        metadata: input.metadata,
      })

      // Create supporting files
      for (const file of input.files) {
        await createSkillFile({
          skillId: skill.id,
          relativePath: file.path,
          content: file.content,
          contentType: file.contentType,
        })
      }

      // Materialize to host filesystem cache
      try {
        await materializeSkill(skill.id)
      } catch (error) {
        console.warn(
          '[skills] Failed to materialize directory skill after creation:',
          error instanceof Error ? error.message : error
        )
      }

      return skill
    }),

  update: protectedProcedure
    .input(
      z.object({
        skillId: z.string().trim().min(1),
        name: z.string().trim().min(1).max(128).optional(),
        description: z.string().nullable().optional(),
        category: categorySchema.optional(),
        content: z.string().min(1).optional(),
        tags: z.array(tagSchema).max(20).optional(),
        requiresTools: z.array(z.string().trim().min(1)).optional(),
        enabled: z.boolean().optional(),
        metadata: z.record(z.unknown()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { skillId, ...data } = input
      const updated = await updateSkill(skillId, data)
      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Skill not found' })
      }

      // Re-materialize and trigger sandbox re-sync
      try {
        await rematerializeSkill(skillId)
        await triggerSyncForSkill(skillId)
      } catch (error) {
        console.warn(
          '[skills] Failed to re-materialize/sync after update:',
          error instanceof Error ? error.message : error
        )
      }

      return updated
    }),

  addFile: protectedProcedure
    .input(
      z.object({
        skillId: z.string().trim().min(1),
        relativePath: relativePathSchema,
        content: z.string(),
        contentType: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const skill = await findSkillById(input.skillId)
      if (!skill) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Skill not found' })
      }

      // If not already a directory skill, upgrade it
      if (!skill.is_directory) {
        await updateSkill(input.skillId, { content: skill.content })
        // Mark as directory by re-creating with is_directory=1 flag
        // Actually, we need to update the is_directory flag directly
        const { getDb } = await import('@nitejar/database')
        const db = getDb()
        await db
          .updateTable('skills')
          .set({ is_directory: 1, updated_at: Math.floor(Date.now() / 1000) })
          .where('id', '=', input.skillId)
          .execute()
      }

      const file = await createSkillFile({
        skillId: input.skillId,
        relativePath: input.relativePath,
        content: input.content,
        contentType: input.contentType,
      })

      try {
        await rematerializeSkill(input.skillId)
        await triggerSyncForSkill(input.skillId)
      } catch (error) {
        console.warn(
          '[skills] Failed to sync after addFile:',
          error instanceof Error ? error.message : error
        )
      }

      return file
    }),

  updateFile: protectedProcedure
    .input(
      z.object({
        skillId: z.string().trim().min(1),
        relativePath: relativePathSchema,
        content: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const file = await findSkillFile(input.skillId, input.relativePath)
      if (!file) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Skill file not found',
        })
      }

      const updated = await updateSkillFile(file.id, {
        content: input.content,
      })
      if (!updated) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update skill file',
        })
      }

      try {
        await rematerializeSkill(input.skillId)
        await triggerSyncForSkill(input.skillId)
      } catch (error) {
        console.warn(
          '[skills] Failed to sync after updateFile:',
          error instanceof Error ? error.message : error
        )
      }

      return updated
    }),

  removeFile: protectedProcedure
    .input(
      z.object({
        skillId: z.string().trim().min(1),
        relativePath: relativePathSchema,
      })
    )
    .mutation(async ({ input }) => {
      const file = await findSkillFile(input.skillId, input.relativePath)
      if (!file) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Skill file not found',
        })
      }

      await deleteSkillFile(file.id)

      try {
        await rematerializeSkill(input.skillId)
        await triggerSyncForSkill(input.skillId)
      } catch (error) {
        console.warn(
          '[skills] Failed to sync after removeFile:',
          error instanceof Error ? error.message : error
        )
      }

      return { ok: true }
    }),

  delete: protectedProcedure
    .input(z.object({ skillId: z.string().trim().min(1) }))
    .mutation(async ({ input }) => {
      const skill = await findSkillById(input.skillId)
      if (!skill) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Skill not found' })
      }

      // Get affected agent IDs before deletion (assignments cascade on delete)
      const agentIds = await getAgentIdsForSkill(input.skillId)

      // Delete skill (cascades to skill_files and skill_assignments)
      const deleted = await deleteSkill(input.skillId)
      if (!deleted) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to delete skill',
        })
      }

      // Remove from host filesystem cache
      try {
        await removeMaterializedSkill(input.skillId)
      } catch (error) {
        console.warn(
          '[skills] Failed to remove materialized skill:',
          error instanceof Error ? error.message : error
        )
      }

      // Trigger sandbox cleanup for affected agents
      for (const agentId of agentIds) {
        try {
          const agent = await findAgentById(agentId)
          if (!agent?.sprite_id) continue
          await removeSkillFromSprite(skill.slug, agent.sprite_id)
        } catch (error) {
          console.warn(
            `[skills] Failed to remove skill from agent ${agentId} sandbox:`,
            error instanceof Error ? error.message : error
          )
        }
      }

      return { ok: true }
    }),

  assign: protectedProcedure
    .input(
      z.object({
        skillId: z.string().trim().min(1),
        scope: z.enum(['global', 'team', 'agent']),
        scopeId: z.string().trim().min(1).optional(),
        priority: z.number().int().optional(),
        autoInject: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const skill = await findSkillById(input.skillId)
      if (!skill) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Skill not found' })
      }

      if ((input.scope === 'team' || input.scope === 'agent') && !input.scopeId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `scopeId is required for ${input.scope} scope.`,
        })
      }

      // Validate agent/team exists
      if (input.scope === 'agent' && input.scopeId) {
        const agent = await findAgentById(input.scopeId)
        if (!agent) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Agent not found',
          })
        }
      }

      try {
        const assignment = await createSkillAssignment({
          skillId: input.skillId,
          skillSlug: skill.slug,
          scope: input.scope,
          scopeId: input.scope === 'global' ? null : input.scopeId,
          priority: input.priority,
          autoInject: input.autoInject,
        })

        // Trigger sandbox sync
        await triggerSyncForSkill(input.skillId)

        return assignment
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Failed to create assignment'
        if (msg.toLowerCase().includes('unique')) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'This skill is already assigned to the specified scope.',
          })
        }
        throw new TRPCError({ code: 'BAD_REQUEST', message: msg })
      }
    }),

  updateAssignment: protectedProcedure
    .input(
      z.object({
        assignmentId: z.string().trim().min(1),
        enabled: z.boolean().optional(),
        priority: z.number().int().optional(),
        autoInject: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { assignmentId, ...data } = input
      const updated = await updateSkillAssignment(assignmentId, data)
      if (!updated) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Assignment not found',
        })
      }

      // Trigger sync for the skill
      try {
        await triggerSyncForSkill(updated.skill_id)
      } catch (error) {
        console.warn(
          '[skills] Failed to sync after assignment update:',
          error instanceof Error ? error.message : error
        )
      }

      return updated
    }),

  removeAssignment: protectedProcedure
    .input(z.object({ assignmentId: z.string().trim().min(1) }))
    .mutation(async ({ input }) => {
      const assignment = await findSkillAssignmentById(input.assignmentId)
      if (!assignment) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Assignment not found',
        })
      }

      const deleted = await deleteSkillAssignment(input.assignmentId)
      if (!deleted) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to remove assignment',
        })
      }

      // Trigger sandbox sync/cleanup
      try {
        await triggerSyncForSkill(assignment.skill_id)
      } catch (error) {
        console.warn(
          '[skills] Failed to sync after assignment removal:',
          error instanceof Error ? error.message : error
        )
      }

      return { ok: true }
    }),

  duplicate: protectedProcedure
    .input(
      z.object({
        skillId: z.string().trim().min(1),
        newSlug: slugSchema,
      })
    )
    .mutation(async ({ input }) => {
      const original = await findSkillById(input.skillId)
      if (!original) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Skill not found' })
      }

      const slugAvailable = await isSkillSlugAvailable(input.newSlug)
      if (!slugAvailable) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Slug "${input.newSlug}" is already in use.`,
        })
      }

      const copy = await createSkill({
        name: `${original.name} (copy)`,
        slug: input.newSlug,
        description: original.description,
        category: original.category,
        sourceKind: 'admin',
        content: original.content,
        isDirectory: original.is_directory === 1,
        version: original.version,
        tags: original.tags_json ? (JSON.parse(original.tags_json) as string[]) : undefined,
        requiresTools: original.requires_tools_json
          ? (JSON.parse(original.requires_tools_json) as string[])
          : undefined,
        metadata: original.metadata_json
          ? (JSON.parse(original.metadata_json) as Record<string, unknown>)
          : undefined,
      })

      // Copy supporting files
      if (original.is_directory) {
        const files = await listSkillFiles(original.id)
        for (const file of files) {
          await createSkillFile({
            skillId: copy.id,
            relativePath: file.relative_path,
            content: file.content,
            contentType: file.content_type,
          })
        }
      }

      // Materialize
      try {
        await materializeSkill(copy.id)
      } catch (error) {
        console.warn(
          '[skills] Failed to materialize duplicated skill:',
          error instanceof Error ? error.message : error
        )
      }

      return copy
    }),

  import: protectedProcedure
    .input(
      z.object({
        skill: z.object({
          formatVersion: z.number().int().optional(),
          skill: z.object({
            name: z.string().min(1).max(128),
            slug: slugSchema,
            description: z.string().optional(),
            category: z.string().optional(),
            tags: z.array(z.string()).optional(),
            version: z.string().optional(),
            requiresTools: z.array(z.string()).optional(),
            content: z.string().min(1),
            files: z
              .array(
                z.object({
                  path: z.string().min(1),
                  content: z.string(),
                  contentType: z.string().optional(),
                })
              )
              .optional(),
          }),
          metadata: z.record(z.unknown()).optional(),
        }),
      })
    )
    .mutation(async ({ input }) => {
      const { skill: portableSkill } = input.skill
      const slugAvailable = await isSkillSlugAvailable(portableSkill.slug)
      if (!slugAvailable) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Slug "${portableSkill.slug}" already exists. Choose a different slug or delete the existing skill.`,
        })
      }

      const hasFiles = portableSkill.files && portableSkill.files.length > 0
      const created = await createSkill({
        name: portableSkill.name,
        slug: portableSkill.slug,
        description: portableSkill.description,
        category: portableSkill.category,
        sourceKind: 'admin',
        content: portableSkill.content,
        isDirectory: !!hasFiles,
        version: portableSkill.version,
        tags: portableSkill.tags,
        requiresTools: portableSkill.requiresTools,
      })

      if (hasFiles && portableSkill.files) {
        for (const file of portableSkill.files) {
          await createSkillFile({
            skillId: created.id,
            relativePath: file.path,
            content: file.content,
            contentType: file.contentType,
          })
        }
      }

      try {
        await materializeSkill(created.id)
      } catch (error) {
        console.warn(
          '[skills] Failed to materialize imported skill:',
          error instanceof Error ? error.message : error
        )
      }

      return created
    }),

  export: protectedProcedure
    .input(z.object({ skillId: z.string().trim().min(1) }))
    .mutation(async ({ input }) => {
      const skill = await findSkillById(input.skillId)
      if (!skill) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Skill not found' })
      }

      const files = skill.is_directory ? await listSkillFiles(input.skillId) : []

      return {
        formatVersion: 2,
        skill: {
          name: skill.name,
          slug: skill.slug,
          description: skill.description,
          category: skill.category,
          tags: skill.tags_json ? (JSON.parse(skill.tags_json) as string[]) : [],
          version: skill.version,
          requiresTools: skill.requires_tools_json
            ? (JSON.parse(skill.requires_tools_json) as string[])
            : [],
          content: skill.content,
          files: files.map((f) => ({
            path: f.relative_path,
            content: f.content,
            contentType: f.content_type,
          })),
        },
        metadata: {
          exportedAt: new Date().toISOString(),
          exportedFrom: 'nitejar',
        },
      }
    }),
})

export type SkillsRouter = typeof skillsRouter
