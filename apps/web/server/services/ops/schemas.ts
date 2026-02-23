import { z } from 'zod'

const trimmedString = z.string().trim().min(1)
const optionalString = z.string().trim().min(1).optional()
const optionalStringList = z.array(trimmedString).min(1).optional()
const optionalUnixTimestamp = z.number().int().nonnegative().optional()
const optionalLimit = z.number().int().min(1).max(100).optional()
const optionalOffset = z.number().int().nonnegative().optional()
const optionalChunkSize = z.number().int().min(1).max(200_000).optional()
const optionalContentBytes = z.number().int().min(64).max(500_000).optional()

export const searchWorkItemsInputSchema = z
  .object({
    q: optionalString,
    statuses: optionalStringList,
    sources: optionalStringList,
    pluginInstanceId: optionalString,
    agentId: optionalString,
    sessionKeyPrefix: optionalString,
    createdAfter: optionalUnixTimestamp,
    createdBefore: optionalUnixTimestamp,
    limit: optionalLimit,
    cursor: optionalString,
  })
  .strict()

export const getWorkItemInputSchema = z
  .object({
    workItemId: trimmedString,
    includeRuns: z.boolean().optional(),
    includeDispatches: z.boolean().optional(),
    includeEffects: z.boolean().optional(),
  })
  .strict()

export const searchRunsInputSchema = z
  .object({
    q: optionalString,
    statuses: optionalStringList,
    agentId: optionalString,
    workItemId: optionalString,
    sources: optionalStringList,
    pluginInstanceId: optionalString,
    sessionKeyPrefix: optionalString,
    createdAfter: optionalUnixTimestamp,
    createdBefore: optionalUnixTimestamp,
    limit: optionalLimit,
    cursor: optionalString,
  })
  .strict()

export const getRunInputSchema = z
  .object({
    jobId: trimmedString,
    includeMessages: z.boolean().optional(),
    includeBackgroundTasks: z.boolean().optional(),
    includeControl: z.boolean().optional(),
    messageOffset: optionalOffset,
    messageLimit: z.number().int().min(1).max(500).optional(),
    includeFullMessageContent: z.boolean().optional(),
    maxContentBytes: optionalContentBytes,
    backgroundTaskOffset: optionalOffset,
    backgroundTaskLimit: z.number().int().min(1).max(500).optional(),
  })
  .strict()

export const getRunTraceInputSchema = z
  .object({
    jobId: trimmedString,
    includeSpans: z.boolean().optional(),
    includeMessages: z.boolean().optional(),
    includeInferenceCalls: z.boolean().optional(),
    includeBackgroundTasks: z.boolean().optional(),
    includeExternalCalls: z.boolean().optional(),
    includeDispatch: z.boolean().optional(),
    spanOffset: optionalOffset,
    spanLimit: z.number().int().min(1).max(1000).optional(),
    messageOffset: optionalOffset,
    messageLimit: z.number().int().min(1).max(500).optional(),
    includeFullMessageContent: z.boolean().optional(),
    maxContentBytes: optionalContentBytes,
    inferenceCallOffset: optionalOffset,
    inferenceCallLimit: z.number().int().min(1).max(500).optional(),
    backgroundTaskOffset: optionalOffset,
    backgroundTaskLimit: z.number().int().min(1).max(500).optional(),
    externalCallOffset: optionalOffset,
    externalCallLimit: z.number().int().min(1).max(500).optional(),
  })
  .strict()

export const getWorkItemQueueMessagesInputSchema = z
  .object({
    workItemId: trimmedString,
    statuses: optionalStringList,
    offset: optionalOffset,
    limit: z.number().int().min(1).max(500).optional(),
  })
  .strict()

export const getDispatchDecisionsInputSchema = z
  .object({
    workItemId: optionalString,
    dispatchId: optionalString,
    includeNonArbiter: z.boolean().optional(),
    offset: optionalOffset,
    limit: z.number().int().min(1).max(500).optional(),
  })
  .strict()
  .refine((value) => !!value.workItemId !== !!value.dispatchId, {
    message: 'Provide exactly one of workItemId or dispatchId',
    path: ['workItemId'],
  })

export const getWorkItemTriageReceiptsInputSchema = z
  .object({
    workItemId: trimmedString,
    offset: optionalOffset,
    limit: z.number().int().min(1).max(500).optional(),
  })
  .strict()

export const getMessageChunkInputSchema = z
  .object({
    messageId: trimmedString,
    chunkIndex: optionalOffset,
    chunkSize: optionalChunkSize,
  })
  .strict()

export const listPluginInstancesInputSchema = z
  .object({
    q: optionalString,
    types: optionalStringList,
    enabled: z.boolean().optional(),
    agentId: optionalString,
    limit: optionalLimit,
    cursor: optionalString,
  })
  .strict()

export const getPluginInstanceInputSchema = z
  .object({
    pluginInstanceId: trimmedString,
  })
  .strict()

export const pauseRunInputSchema = z
  .object({
    jobId: trimmedString,
    actor: z.string().trim().min(1).default('admin'),
    reason: optionalString,
  })
  .strict()

export const resumeRunInputSchema = z
  .object({
    jobId: trimmedString,
  })
  .strict()

export const cancelRunInputSchema = z
  .object({
    jobId: trimmedString,
    actor: z.string().trim().min(1).default('admin'),
    reason: optionalString,
  })
  .strict()

export const setPluginInstanceEnabledInputSchema = z
  .object({
    pluginInstanceId: trimmedString,
    enabled: z.boolean(),
  })
  .strict()

export const setPluginInstanceAgentAssignmentInputSchema = z
  .object({
    pluginInstanceId: trimmedString,
    agentId: trimmedString,
    enabled: z.boolean(),
  })
  .strict()

type McpInputSchemaMap = {
  search_work_items: Record<string, unknown>
  get_work_item: Record<string, unknown>
  search_runs: Record<string, unknown>
  get_run: Record<string, unknown>
  get_run_trace: Record<string, unknown>
  get_work_item_queue_messages: Record<string, unknown>
  get_dispatch_decisions: Record<string, unknown>
  get_work_item_triage_receipts: Record<string, unknown>
  get_message_chunk: Record<string, unknown>
  list_plugin_instances: Record<string, unknown>
  get_plugin_instance: Record<string, unknown>
  pause_run: Record<string, unknown>
  resume_run: Record<string, unknown>
  cancel_run: Record<string, unknown>
  set_plugin_instance_enabled: Record<string, unknown>
  set_plugin_instance_agent_assignment: Record<string, unknown>
}

export const mcpInputSchemas: McpInputSchemaMap = {
  search_work_items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      q: { type: 'string' },
      statuses: { type: 'array', items: { type: 'string' } },
      sources: { type: 'array', items: { type: 'string' } },
      pluginInstanceId: { type: 'string' },
      agentId: { type: 'string' },
      sessionKeyPrefix: { type: 'string' },
      createdAfter: { type: 'number' },
      createdBefore: { type: 'number' },
      limit: { type: 'number' },
      cursor: { type: 'string' },
    },
  },
  get_work_item: {
    type: 'object',
    additionalProperties: false,
    required: ['workItemId'],
    properties: {
      workItemId: { type: 'string' },
      includeRuns: { type: 'boolean' },
      includeDispatches: { type: 'boolean' },
      includeEffects: { type: 'boolean' },
    },
  },
  search_runs: {
    type: 'object',
    additionalProperties: false,
    properties: {
      q: { type: 'string' },
      statuses: { type: 'array', items: { type: 'string' } },
      agentId: { type: 'string' },
      workItemId: { type: 'string' },
      sources: { type: 'array', items: { type: 'string' } },
      pluginInstanceId: { type: 'string' },
      sessionKeyPrefix: { type: 'string' },
      createdAfter: { type: 'number' },
      createdBefore: { type: 'number' },
      limit: { type: 'number' },
      cursor: { type: 'string' },
    },
  },
  get_run: {
    type: 'object',
    additionalProperties: false,
    required: ['jobId'],
    properties: {
      jobId: { type: 'string' },
      includeMessages: { type: 'boolean' },
      includeBackgroundTasks: { type: 'boolean' },
      includeControl: { type: 'boolean' },
      messageOffset: { type: 'number' },
      messageLimit: { type: 'number' },
      includeFullMessageContent: { type: 'boolean' },
      maxContentBytes: { type: 'number' },
      backgroundTaskOffset: { type: 'number' },
      backgroundTaskLimit: { type: 'number' },
    },
  },
  get_run_trace: {
    type: 'object',
    additionalProperties: false,
    required: ['jobId'],
    properties: {
      jobId: { type: 'string' },
      includeSpans: { type: 'boolean' },
      includeMessages: { type: 'boolean' },
      includeInferenceCalls: { type: 'boolean' },
      includeBackgroundTasks: { type: 'boolean' },
      includeExternalCalls: { type: 'boolean' },
      includeDispatch: { type: 'boolean' },
      spanOffset: { type: 'number' },
      spanLimit: { type: 'number' },
      messageOffset: { type: 'number' },
      messageLimit: { type: 'number' },
      includeFullMessageContent: { type: 'boolean' },
      maxContentBytes: { type: 'number' },
      inferenceCallOffset: { type: 'number' },
      inferenceCallLimit: { type: 'number' },
      backgroundTaskOffset: { type: 'number' },
      backgroundTaskLimit: { type: 'number' },
      externalCallOffset: { type: 'number' },
      externalCallLimit: { type: 'number' },
    },
  },
  get_work_item_queue_messages: {
    type: 'object',
    additionalProperties: false,
    required: ['workItemId'],
    properties: {
      workItemId: { type: 'string' },
      statuses: { type: 'array', items: { type: 'string' } },
      offset: { type: 'number' },
      limit: { type: 'number' },
    },
  },
  get_dispatch_decisions: {
    type: 'object',
    additionalProperties: false,
    properties: {
      workItemId: { type: 'string' },
      dispatchId: { type: 'string' },
      includeNonArbiter: { type: 'boolean' },
      offset: { type: 'number' },
      limit: { type: 'number' },
    },
  },
  get_work_item_triage_receipts: {
    type: 'object',
    additionalProperties: false,
    required: ['workItemId'],
    properties: {
      workItemId: { type: 'string' },
      offset: { type: 'number' },
      limit: { type: 'number' },
    },
  },
  get_message_chunk: {
    type: 'object',
    additionalProperties: false,
    required: ['messageId'],
    properties: {
      messageId: { type: 'string' },
      chunkIndex: { type: 'number' },
      chunkSize: { type: 'number' },
    },
  },
  list_plugin_instances: {
    type: 'object',
    additionalProperties: false,
    properties: {
      q: { type: 'string' },
      types: { type: 'array', items: { type: 'string' } },
      enabled: { type: 'boolean' },
      agentId: { type: 'string' },
      limit: { type: 'number' },
      cursor: { type: 'string' },
    },
  },
  get_plugin_instance: {
    type: 'object',
    additionalProperties: false,
    required: ['pluginInstanceId'],
    properties: {
      pluginInstanceId: { type: 'string' },
    },
  },
  pause_run: {
    type: 'object',
    additionalProperties: false,
    required: ['jobId'],
    properties: {
      jobId: { type: 'string' },
      actor: { type: 'string' },
      reason: { type: 'string' },
    },
  },
  resume_run: {
    type: 'object',
    additionalProperties: false,
    required: ['jobId'],
    properties: {
      jobId: { type: 'string' },
    },
  },
  cancel_run: {
    type: 'object',
    additionalProperties: false,
    required: ['jobId'],
    properties: {
      jobId: { type: 'string' },
      actor: { type: 'string' },
      reason: { type: 'string' },
    },
  },
  set_plugin_instance_enabled: {
    type: 'object',
    additionalProperties: false,
    required: ['pluginInstanceId', 'enabled'],
    properties: {
      pluginInstanceId: { type: 'string' },
      enabled: { type: 'boolean' },
    },
  },
  set_plugin_instance_agent_assignment: {
    type: 'object',
    additionalProperties: false,
    required: ['pluginInstanceId', 'agentId', 'enabled'],
    properties: {
      pluginInstanceId: { type: 'string' },
      agentId: { type: 'string' },
      enabled: { type: 'boolean' },
    },
  },
}

export type SearchWorkItemsInput = z.infer<typeof searchWorkItemsInputSchema>
export type GetWorkItemInput = z.infer<typeof getWorkItemInputSchema>
export type SearchRunsInput = z.infer<typeof searchRunsInputSchema>
export type GetRunInput = z.infer<typeof getRunInputSchema>
export type GetRunTraceInput = z.infer<typeof getRunTraceInputSchema>
export type GetWorkItemQueueMessagesInput = z.infer<typeof getWorkItemQueueMessagesInputSchema>
export type GetDispatchDecisionsInput = z.infer<typeof getDispatchDecisionsInputSchema>
export type GetWorkItemTriageReceiptsInput = z.infer<typeof getWorkItemTriageReceiptsInputSchema>
export type GetMessageChunkInput = z.infer<typeof getMessageChunkInputSchema>
export type ListPluginInstancesInput = z.infer<typeof listPluginInstancesInputSchema>
export type GetPluginInstanceInput = z.infer<typeof getPluginInstanceInputSchema>
export type PauseRunInput = z.infer<typeof pauseRunInputSchema>
export type ResumeRunInput = z.infer<typeof resumeRunInputSchema>
export type CancelRunInput = z.infer<typeof cancelRunInputSchema>
export type SetPluginInstanceEnabledInput = z.infer<typeof setPluginInstanceEnabledInputSchema>
export type SetPluginInstanceAgentAssignmentInput = z.infer<
  typeof setPluginInstanceAgentAssignmentInputSchema
>
