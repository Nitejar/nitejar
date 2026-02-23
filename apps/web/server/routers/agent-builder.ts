import { z } from 'zod'
import {
  getDb,
  createAgent,
  createAgentSandbox,
  createCostLimit,
  createQueueMessage,
  deleteAgent,
  findAgentById,
  upsertQueueLaneOnMessage,
  updateAgent,
} from '@nitejar/database'
import {
  DEFAULT_EDIT_TOOL_MODE,
  getDefaultModel,
  serializeAgentConfig,
} from '@nitejar/agent/config'
import { DEFAULT_NETWORK_POLICY } from '@nitejar/agent/network-policy'
import type { AgentConfig } from '@nitejar/agent/types'
import { protectedProcedure, router } from '../trpc'

const now = () => Math.floor(Date.now() / 1000)
const uuid = () => crypto.randomUUID()

/** Generate a random _test- handle to avoid collisions with real agents */
function generateTestHandle(): string {
  return `_test-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return (
    error.message.includes('UNIQUE constraint failed: agents.name') ||
    error.message.includes('UNIQUE constraint failed: agents.handle')
  )
}

/**
 * Build a full AgentConfig from partial wizard state.
 */
function buildConfigFromPartial(input: {
  model?: string
  temperature?: number
  maxTokens?: number
  editToolMode?: 'hashline' | 'replace'
  soul?: string
  title?: string
  emoji?: string
  avatarUrl?: string
  memorySettings?: Record<string, unknown>
  sessionSettings?: Record<string, unknown>
  networkPolicy?: Record<string, unknown>
  queue?: Record<string, unknown>
  allowEphemeralSandboxCreation?: boolean
  allowRoutineManagement?: boolean
  dangerouslyUnrestricted?: boolean
}): AgentConfig {
  const memorySettings = {
    ...(input.memorySettings as AgentConfig['memorySettings']),
  }
  if (memorySettings.passiveUpdatesEnabled === undefined) {
    memorySettings.passiveUpdatesEnabled = true
  }

  return {
    model: input.model ?? getDefaultModel(),
    temperature: input.temperature,
    maxTokens: input.maxTokens,
    editToolMode: input.editToolMode ?? DEFAULT_EDIT_TOOL_MODE,
    soul: input.soul,
    title: input.title,
    emoji: input.emoji,
    avatarUrl: input.avatarUrl,
    memorySettings,
    sessionSettings: input.sessionSettings as AgentConfig['sessionSettings'],
    networkPolicy: (input.networkPolicy as AgentConfig['networkPolicy']) ?? {
      ...DEFAULT_NETWORK_POLICY,
      rules: DEFAULT_NETWORK_POLICY.rules.map((r) => ({ ...r })),
    },
    queue: input.queue as AgentConfig['queue'],
    allowEphemeralSandboxCreation: input.allowEphemeralSandboxCreation,
    allowRoutineManagement: input.allowRoutineManagement,
    dangerouslyUnrestricted: input.dangerouslyUnrestricted,
  }
}

const partialConfigSchema = z
  .object({
    model: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().positive().optional(),
    editToolMode: z.enum(['hashline', 'replace']).optional(),
    soul: z.string().optional(),
    title: z.string().optional(),
    emoji: z.string().optional(),
    avatarUrl: z.string().optional(),
    memorySettings: z.record(z.unknown()).optional(),
    sessionSettings: z.record(z.unknown()).optional(),
    networkPolicy: z.record(z.unknown()).optional(),
    queue: z.record(z.unknown()).optional(),
    allowEphemeralSandboxCreation: z.boolean().optional(),
    allowRoutineManagement: z.boolean().optional(),
    dangerouslyUnrestricted: z.boolean().optional(),
  })
  .optional()

export const agentBuilderRouter = router({
  /**
   * Create a temporary agent for the builder test conversation.
   * published: false, random _test- handle.
   */
  createTestAgent: protectedProcedure
    .input(
      z.object({
        config: partialConfigSchema,
        identity: z.object({
          name: z.string().min(1),
          handle: z.string().optional(),
          title: z.string().optional(),
          emoji: z.string().optional(),
          avatarUrl: z.string().optional(),
        }),
      })
    )
    .mutation(async ({ input }) => {
      const builtConfig = buildConfigFromPartial({
        ...input.config,
        title: input.identity.title,
        emoji: input.identity.emoji,
        avatarUrl: input.identity.avatarUrl,
      })

      // Retry a few times in case a stale/test row already took the generated handle/name.
      let agent = null as Awaited<ReturnType<typeof createAgent>> | null
      for (let attempt = 0; attempt < 5; attempt++) {
        const testHandle = generateTestHandle()
        const testAgentName = `builder-test-${testHandle}`
        try {
          agent = await createAgent({
            handle: testHandle,
            name: testAgentName,
            sprite_id: null,
            config: serializeAgentConfig(builtConfig),
            status: 'idle',
          })
          break
        } catch (error) {
          if (!isUniqueConstraintError(error) || attempt === 4) {
            throw error
          }
        }
      }
      if (!agent) throw new Error('Failed to create a unique builder test agent')

      // Create home sandbox for the test agent
      const spriteName = `nitejar-${agent.handle}`
      await createAgentSandbox({
        agent_id: agent.id,
        name: 'home',
        description: 'Persistent home sandbox',
        sprite_name: spriteName,
        kind: 'home',
        created_by: 'system',
      })

      const testSessionKey = `builder-test:${agent.id}:${uuid()}`

      return { testAgentId: agent.id, testSessionKey }
    }),

  /**
   * Update a test agent's config when the operator changes wizard state.
   */
  updateTestAgentConfig: protectedProcedure
    .input(
      z.object({
        testAgentId: z.string(),
        config: partialConfigSchema,
        identity: z
          .object({
            name: z.string().optional(),
            title: z.string().optional(),
            emoji: z.string().optional(),
            avatarUrl: z.string().optional(),
          })
          .optional(),
      })
    )
    .mutation(async ({ input }) => {
      const agent = await findAgentById(input.testAgentId)
      if (!agent) throw new Error('Test agent not found')
      if (!agent.handle.startsWith('_test-')) {
        throw new Error('Can only update test agents')
      }

      const builtConfig = buildConfigFromPartial({
        ...input.config,
        title: input.identity?.title,
        emoji: input.identity?.emoji,
        avatarUrl: input.identity?.avatarUrl,
      })

      await updateAgent(agent.id, {
        // keep the temporary agent's name untouched so we never collide with the builder's display name
        config: serializeAgentConfig(builtConfig),
      })

      return { ok: true }
    }),

  /**
   * Send a test message to the temp agent.
   * Creates a work item and enqueues it for dispatch.
   */
  sendTestMessage: protectedProcedure
    .input(
      z.object({
        testAgentId: z.string(),
        testSessionKey: z.string(),
        message: z.string().min(1),
      })
    )
    .mutation(async ({ input }) => {
      const agent = await findAgentById(input.testAgentId)
      if (!agent) throw new Error('Test agent not found')
      if (!agent.handle.startsWith('_test-')) {
        throw new Error('Can only message test agents')
      }

      const db = getDb()
      const workItemId = uuid()
      const timestamp = now()

      // Create work item
      await db
        .insertInto('work_items')
        .values({
          id: workItemId,
          plugin_instance_id: null,
          session_key: input.testSessionKey,
          source: 'builder-test',
          source_ref: `builder:${input.testAgentId}`,
          status: 'NEW',
          title: 'Builder test message',
          payload: JSON.stringify({
            body: input.message,
            senderName: 'Builder',
            source: 'builder-test',
          }),
          created_at: timestamp,
          updated_at: timestamp,
        })
        .execute()

      const queueKey = `${input.testSessionKey}:${input.testAgentId}`
      await createQueueMessage({
        queue_key: queueKey,
        work_item_id: workItemId,
        plugin_instance_id: null,
        response_context: null,
        text: input.message,
        sender_name: 'Builder',
        arrived_at: timestamp,
        status: 'pending',
        dispatch_id: null,
        drop_reason: null,
      })

      await upsertQueueLaneOnMessage({
        queueKey,
        sessionKey: input.testSessionKey,
        agentId: input.testAgentId,
        pluginInstanceId: null,
        arrivedAt: timestamp,
        debounceMs: 1000,
        maxQueued: 10,
        mode: 'steer',
      })

      // Wait briefly for the dispatch worker to create the job so the UI can poll it.
      const timeoutMs = 15_000
      const pollIntervalMs = 250
      const startedAt = Date.now()
      while (Date.now() - startedAt < timeoutMs) {
        const job = await db
          .selectFrom('jobs')
          .select('id')
          .where('work_item_id', '=', workItemId)
          .where('agent_id', '=', input.testAgentId)
          .orderBy('created_at', 'desc')
          .executeTakeFirst()

        if (job?.id) {
          return { jobId: job.id }
        }

        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
      }

      throw new Error(
        'Test message was queued, but no run started yet. Check runtime workers and try again.'
      )
    }),

  /**
   * Clean up a test agent and its associated data.
   */
  cleanupTestAgent: protectedProcedure
    .input(z.object({ testAgentId: z.string() }))
    .mutation(async ({ input }) => {
      const agent = await findAgentById(input.testAgentId)
      if (!agent) return { ok: true }
      if (!agent.handle.startsWith('_test-')) {
        throw new Error('Can only cleanup test agents')
      }

      const db = getDb()

      // Delete associated data
      await db.deleteFrom('agent_memories').where('agent_id', '=', agent.id).execute()
      await db.deleteFrom('agent_sandboxes').where('agent_id', '=', agent.id).execute()
      await db.deleteFrom('agent_teams').where('agent_id', '=', agent.id).execute()
      await db.deleteFrom('agent_plugin_instances').where('agent_id', '=', agent.id).execute()
      await db.deleteFrom('cost_limits').where('agent_id', '=', agent.id).execute()
      await db
        .deleteFrom('skill_assignments')
        .where('scope', '=', 'agent')
        .where('scope_id', '=', agent.id)
        .execute()

      // Delete jobs and messages for work items linked to this agent
      const jobs = await db
        .selectFrom('jobs')
        .select('id')
        .where('agent_id', '=', agent.id)
        .execute()

      if (jobs.length > 0) {
        const jobIds = jobs.map((j) => j.id)
        await db.deleteFrom('messages').where('job_id', 'in', jobIds).execute()
        await db.deleteFrom('jobs').where('agent_id', '=', agent.id).execute()
      }

      // Delete work items
      await db
        .deleteFrom('work_items')
        .where('source_ref', 'like', `builder:${agent.id}%`)
        .execute()

      // Delete the agent
      await deleteAgent(agent.id)

      return { ok: true }
    }),

  /**
   * Promote a test agent to a real published agent.
   */
  promoteTestAgent: protectedProcedure
    .input(
      z.object({
        testAgentId: z.string(),
        finalIdentity: z.object({
          name: z.string().min(1),
          handle: z.string().min(1),
          title: z.string().optional(),
          emoji: z.string().optional(),
          avatarUrl: z.string().optional(),
        }),
        finalConfig: z.record(z.unknown()),
        teamId: z.string().optional(),
        pluginAssignments: z.array(z.object({ pluginInstanceId: z.string() })).optional(),
        skillAttachments: z
          .array(
            z.object({
              skillSlug: z.string(),
              priority: z.number().int().nonnegative(),
              autoInject: z.boolean(),
            })
          )
          .optional(),
        costLimits: z
          .array(
            z.object({
              period: z.string(),
              limitUsd: z.number().nonnegative(),
              softLimitPct: z.number().nonnegative(),
              hardLimitPct: z.number().nonnegative(),
            })
          )
          .optional(),
      })
    )
    .mutation(async ({ input }) => {
      const agent = await findAgentById(input.testAgentId)
      if (!agent) throw new Error('Test agent not found')
      if (!agent.handle.startsWith('_test-')) {
        throw new Error('Can only promote test agents')
      }

      // Validate handle
      const handle = input.finalIdentity.handle
      if (!/^[a-zA-Z0-9_-]+$/.test(handle)) {
        throw new Error('Agent handle can only contain letters, numbers, hyphens, and underscores')
      }

      // Update agent with final identity and config
      const configObj = buildConfigFromPartial({
        ...input.finalConfig,
        title: input.finalIdentity.title,
        emoji: input.finalIdentity.emoji,
        avatarUrl: input.finalIdentity.avatarUrl,
      })

      await updateAgent(agent.id, {
        handle,
        name: input.finalIdentity.name,
        config: serializeAgentConfig(configObj),
        status: 'idle',
      })

      const db = getDb()

      // Assign team
      if (input.teamId) {
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

      // Assign plugin instances
      if (input.pluginAssignments) {
        for (const pa of input.pluginAssignments) {
          await db
            .insertInto('agent_plugin_instances')
            .values({
              agent_id: agent.id,
              plugin_instance_id: pa.pluginInstanceId,
              created_at: now(),
            })
            .onConflict((oc) => oc.columns(['agent_id', 'plugin_instance_id']).doNothing())
            .execute()
        }
      }

      // Create cost limits
      if (input.costLimits) {
        for (const cl of input.costLimits) {
          await createCostLimit({
            agent_id: agent.id,
            period: cl.period,
            limit_usd: cl.limitUsd,
            enabled: 1,
            scope: 'agent',
            team_id: null,
            soft_limit_pct: cl.softLimitPct,
            hard_limit_pct: cl.hardLimitPct,
          })
        }
      }

      // Create skill assignments
      if (input.skillAttachments) {
        for (const sa of input.skillAttachments) {
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
                priority: sa.priority,
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

  /**
   * List orphaned test agents (for diagnostics / cleanup).
   */
  listTempAgents: protectedProcedure
    .input(z.object({ olderThanMinutes: z.number().int().positive().optional() }))
    .query(async ({ input }) => {
      const db = getDb()
      let query = db
        .selectFrom('agents')
        .select(['id', 'handle', 'created_at'])
        .where('handle', 'like', '_test-%')

      if (input.olderThanMinutes) {
        const cutoff = now() - input.olderThanMinutes * 60
        query = query.where('created_at', '<', cutoff)
      }

      const agents = await query.orderBy('created_at', 'desc').execute()
      return {
        agents: agents.map((a) => ({
          id: a.id,
          handle: a.handle,
          createdAt: new Date(a.created_at * 1000).toISOString(),
        })),
      }
    }),
})
