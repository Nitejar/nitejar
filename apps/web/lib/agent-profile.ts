import { z } from 'zod'

/**
 * .nitejar-agent.json portable agent profile format (v1)
 *
 * This is the Zod schema used for both export (assembly) and import (validation).
 * Unknown fields are passed through for forward compatibility.
 */

// ----- Sub-schemas -----

const IdentitySchema = z.object({
  name: z.string().min(1),
  handle: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9_-]+$/),
  title: z.string().optional().nullable(),
  emoji: z.string().optional().nullable(),
  avatarUrl: z.string().url().optional().nullable(),
})

const ModelSchema = z.object({
  preferred: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  editToolMode: z.enum(['hashline', 'replace']).optional(),
})

const MemorySettingsSchema = z.object({
  enabled: z.boolean().optional(),
  passiveUpdatesEnabled: z.boolean().optional(),
  maxMemories: z.number().int().positive().optional(),
  maxStoredMemories: z.number().int().positive().optional(),
  decayRate: z.number().min(0).max(1).optional(),
  reinforceAmount: z.number().min(0).max(1).optional(),
  similarityWeight: z.number().min(0).max(1).optional(),
  minStrength: z.number().min(0).max(1).optional(),
})

const CompactionSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  summaryMaxTokens: z.number().int().positive().optional(),
  extractMemories: z.boolean().optional(),
  loadPreviousSummary: z.boolean().optional(),
})

const SessionSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  maxTurns: z.number().int().positive().optional(),
  maxTokens: z.number().int().positive().optional(),
  resetTriggers: z.array(z.string()).optional(),
  idleTimeoutMinutes: z.number().int().positive().optional(),
  dailyResetHour: z.number().int().min(0).max(23).optional().nullable(),
  clearMemoriesOnReset: z.boolean().optional(),
  compaction: CompactionSettingsSchema.optional(),
  messageEmbeddings: z.boolean().optional(),
})

const NetworkPolicyRuleSchema = z.object({
  domain: z.string().min(1),
  action: z.enum(['allow', 'deny']),
})

const NetworkPolicySchema = z.object({
  mode: z.enum(['allow-list', 'deny-list', 'unrestricted']),
  presetId: z.string().optional(),
  customized: z.boolean().optional(),
  rules: z.array(NetworkPolicyRuleSchema),
})

const TriageSettingsSchema = z.object({
  maxTokens: z.number().int().positive().optional(),
  reasoningEffort: z.enum(['low', 'medium', 'high']).optional().nullable(),
  recentHistoryMaxChars: z.number().int().positive().optional(),
  recentHistoryLookbackMessages: z.number().int().positive().optional(),
  recentHistoryPerMessageMaxChars: z.number().int().positive().optional(),
})

const QueueSchema = z.object({
  mode: z.enum(['collect', 'followup', 'steer']).optional(),
  debounceMs: z.number().int().nonnegative().optional(),
  maxQueued: z.number().int().positive().optional(),
})

const FeaturesSchema = z.object({
  allowEphemeralSandboxCreation: z.boolean().optional(),
  allowRoutineManagement: z.boolean().optional(),
  dangerouslyUnrestricted: z.boolean().optional(),
})

const PluginRequirementSchema = z.object({
  pluginId: z.string(),
  required: z.boolean(),
  note: z.string().optional(),
})

const CostLimitSchema = z.object({
  period: z.string(),
  limitUsd: z.number().nonnegative(),
  softLimitPct: z.number().nonnegative().optional(),
  hardLimitPct: z.number().nonnegative().optional(),
})

const SkillAttachmentSchema = z.object({
  skillSlug: z.string(),
  priority: z.number().int().nonnegative().optional(),
  autoInject: z.boolean().optional(),
})

const SeedMemorySchema = z.object({
  content: z.string().min(1),
  permanent: z.boolean().optional(),
})

// ----- Main profile schema -----

export const AgentProfileV1Schema = z
  .object({
    $schema: z.string().optional(),
    formatVersion: z.literal(1),
    exportedAt: z.string().optional(),
    exportedFrom: z.string().optional(),

    identity: IdentitySchema,
    soul: z.string().optional(),
    model: ModelSchema.optional(),
    memorySettings: MemorySettingsSchema.optional(),
    sessionSettings: SessionSettingsSchema.optional(),
    networkPolicy: NetworkPolicySchema.optional(),
    triageSettings: TriageSettingsSchema.optional(),
    queue: QueueSchema.optional(),
    features: FeaturesSchema.optional(),

    pluginRequirements: z.array(PluginRequirementSchema).optional(),
    costLimits: z.array(CostLimitSchema).optional(),
    skillAttachments: z.array(SkillAttachmentSchema).optional(),
    seedMemories: z.array(SeedMemorySchema).optional(),
  })
  .passthrough()

export type AgentProfileV1 = z.infer<typeof AgentProfileV1Schema>

/** Maximum supported format version for import */
export const MAX_SUPPORTED_FORMAT_VERSION = 1
