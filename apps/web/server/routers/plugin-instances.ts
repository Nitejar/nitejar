import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { protectedProcedure, router } from '../trpc'
import {
  createPluginInstance,
  encryptConfig,
  decryptConfig,
  findPluginInstanceById,
  findPluginById,
  updatePluginInstance,
  deletePluginInstance,
} from '@nitejar/database'
import { pluginHandlerRegistry } from '@nitejar/plugin-handlers'
import { PluginLoader } from '@nitejar/plugin-runtime'
import {
  getPluginInstanceOp,
  listPluginInstancesOp,
  setPluginInstanceAgentAssignmentOp,
  setPluginInstanceEnabledOp,
} from '../services/ops/plugin-instances'
import {
  getPluginInstanceInputSchema,
  listPluginInstancesInputSchema,
  setPluginInstanceAgentAssignmentInputSchema,
  setPluginInstanceEnabledInputSchema,
} from '../services/ops/schemas'

const REDACTED_SECRET_VALUE = '••••••••'

export const pluginInstancesRouter = router({
  list: protectedProcedure.input(listPluginInstancesInputSchema).query(async ({ input }) => {
    return listPluginInstancesOp(input)
  }),

  get: protectedProcedure.input(getPluginInstanceInputSchema).query(async ({ input }) => {
    return getPluginInstanceOp(input)
  }),

  setupConfig: protectedProcedure
    .input(z.object({ type: z.string().trim().min(1) }))
    .query(async ({ input }) => {
      let handler = pluginHandlerRegistry.get(input.type)

      // If the handler isn't in the in-memory registry, attempt on-demand load
      // from the DB. This covers custom plugins that were installed but whose
      // hot-load may have failed or hasn't happened yet.
      if (!handler) {
        const plugin = await findPluginById(input.type)
        if (
          plugin &&
          plugin.enabled === 1 &&
          plugin.current_install_path &&
          !plugin.current_install_path.startsWith('builtin://')
        ) {
          const loader = new PluginLoader(pluginHandlerRegistry, null)
          await loader.loadPlugin({
            id: plugin.id,
            manifest_json: plugin.manifest_json,
            current_install_path: plugin.current_install_path,
            source_kind: plugin.source_kind,
          })
          handler = pluginHandlerRegistry.get(input.type)
        }
      }

      if (!handler) {
        // Graceful fallback for custom plugins that can't be loaded yet —
        // return an empty setup config so the wizard can still proceed.
        return { fields: [] }
      }
      return handler.setupConfig ?? { fields: [] }
    }),

  createInstance: protectedProcedure
    .input(
      z.object({
        type: z.string().trim().min(1),
        name: z.string().trim().min(1),
        config: z.record(z.unknown()).default({}),
        enabled: z.boolean().default(true),
        /** Override plugin_id for non-builtin plugins (defaults to "builtin.{type}") */
        pluginId: z.string().trim().min(1).optional(),
      })
    )
    .mutation(async ({ input }) => {
      let handler = pluginHandlerRegistry.get(input.type)

      // Try on-demand load if handler isn't registered yet
      if (!handler) {
        const plugin = await findPluginById(input.type)
        if (
          plugin &&
          plugin.enabled === 1 &&
          plugin.current_install_path &&
          !plugin.current_install_path.startsWith('builtin://')
        ) {
          const loader = new PluginLoader(pluginHandlerRegistry, null)
          await loader.loadPlugin({
            id: plugin.id,
            manifest_json: plugin.manifest_json,
            current_install_path: plugin.current_install_path,
            source_kind: plugin.source_kind,
          })
          handler = pluginHandlerRegistry.get(input.type)
        }
      }

      let configToStore: Record<string, unknown> = { ...input.config }
      let enabled = input.enabled

      if (handler) {
        // For redirect flows (e.g. GitHub manifest), create with partial config
        const isRedirectFlow = handler.setupConfig?.usesRedirectFlow === true
        configToStore = {
          ...configToStore,
          ...(isRedirectFlow ? { manifestPending: true } : {}),
        }
        enabled = isRedirectFlow ? false : input.enabled

        // Validate config (redirect flows with manifestPending skip strict validation)
        const validation = handler.validateConfig(configToStore)
        if (!validation.valid && !isRedirectFlow) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Invalid config: ${validation.errors?.join(', ') ?? 'unknown error'}`,
          })
        }

        // For non-redirect flows, prevent creating an enabled instance unless
        // the connection test succeeds.
        if (enabled && !isRedirectFlow && handler.testConnection) {
          const testResult = await handler.testConnection(configToStore)
          if (!testResult.ok) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: `Connection test failed: ${testResult.error ?? 'unknown error'}`,
            })
          }
          if (
            testResult.configUpdates &&
            typeof testResult.configUpdates === 'object' &&
            !Array.isArray(testResult.configUpdates)
          ) {
            configToStore = {
              ...configToStore,
              ...testResult.configUpdates,
            }
          }
        }

        // Encrypt sensitive fields
        configToStore = encryptConfig(configToStore, handler.sensitiveFields)
      }

      const created = await createPluginInstance({
        plugin_id: input.pluginId ?? `builtin.${input.type}`,
        name: input.name,
        scope: 'global',
        enabled: enabled ? 1 : 0,
        config_json: JSON.stringify(configToStore),
      })

      return { id: created.id, name: created.name, type: created.type, enabled: !!created.enabled }
    }),

  testConnection: protectedProcedure
    .input(z.object({ pluginInstanceId: z.string().trim().min(1) }))
    .mutation(async ({ input }) => {
      const pluginInstance = await findPluginInstanceById(input.pluginInstanceId)
      if (!pluginInstance) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Plugin instance not found' })
      }

      const handler = pluginHandlerRegistry.get(pluginInstance.type)
      if (!handler?.testConnection) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This plugin type does not support connection testing',
        })
      }

      let config: Record<string, unknown> = {}
      if (pluginInstance.config) {
        try {
          const parsed = JSON.parse(
            typeof pluginInstance.config === 'string' ? pluginInstance.config : '{}'
          ) as Record<string, unknown>
          config = decryptConfig(parsed, handler.sensitiveFields)
        } catch {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to parse config' })
        }
      }

      const result = await handler.testConnection(config)

      if (
        result.ok &&
        result.configUpdates &&
        typeof result.configUpdates === 'object' &&
        !Array.isArray(result.configUpdates)
      ) {
        const mergedConfig: Record<string, unknown> = {
          ...config,
          ...result.configUpdates,
        }
        const encryptedConfig = encryptConfig(mergedConfig, handler.sensitiveFields)
        await updatePluginInstance(pluginInstance.id, {
          config_json: JSON.stringify(encryptedConfig),
        })
      }

      return result
    }),

  /** Test connection with raw config before creating an instance. */
  testConnectionDirect: protectedProcedure
    .input(
      z.object({
        type: z.string().trim().min(1),
        config: z.record(z.unknown()),
      })
    )
    .mutation(async ({ input }) => {
      const handler = pluginHandlerRegistry.get(input.type)
      if (!handler?.testConnection) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This plugin type does not support connection testing',
        })
      }

      const result = await handler.testConnection(input.config)
      return result
    }),

  create: protectedProcedure
    .input(
      z.object({
        pluginId: z.string().trim().min(1),
        name: z.string().trim().min(1),
        scope: z.string().trim().default('global'),
        enabled: z.boolean().default(true),
        configJson: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const created = await createPluginInstance({
        plugin_id: input.pluginId,
        name: input.name,
        scope: input.scope,
        enabled: input.enabled ? 1 : 0,
        config_json: input.configJson ?? null,
      })
      return created
    }),

  update: protectedProcedure
    .input(
      z.object({
        pluginInstanceId: z.string(),
        name: z.string().optional(),
        enabled: z.boolean().optional(),
        config: z.record(z.unknown()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const pluginInstance = await findPluginInstanceById(input.pluginInstanceId)
      if (!pluginInstance) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Plugin instance not found' })
      }

      const data: { name?: string; enabled?: number; config_json?: string } = {}
      if (input.name !== undefined) data.name = input.name
      if (input.enabled !== undefined) data.enabled = input.enabled ? 1 : 0
      if (input.config !== undefined) {
        const handler = pluginHandlerRegistry.get(pluginInstance.type)
        if (handler) {
          let existingConfig: Record<string, unknown> = {}
          if (pluginInstance.config) {
            try {
              const parsed = JSON.parse(
                typeof pluginInstance.config === 'string' ? pluginInstance.config : '{}'
              ) as Record<string, unknown>
              existingConfig = decryptConfig(parsed, handler.sensitiveFields)
            } catch {
              throw new TRPCError({
                code: 'INTERNAL_SERVER_ERROR',
                message: 'Failed to parse existing config',
              })
            }
          }

          const mergedConfig: Record<string, unknown> = {
            ...existingConfig,
            ...input.config,
          }

          for (const sensitiveField of handler.sensitiveFields) {
            const incoming = input.config[sensitiveField]
            if (
              incoming === REDACTED_SECRET_VALUE &&
              Object.prototype.hasOwnProperty.call(existingConfig, sensitiveField)
            ) {
              mergedConfig[sensitiveField] = existingConfig[sensitiveField]
            }
          }

          const validation = handler.validateConfig(mergedConfig)
          if (!validation.valid) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: `Invalid config: ${validation.errors?.join(', ') ?? 'unknown error'}`,
            })
          }

          const encryptedConfig = encryptConfig(mergedConfig, handler.sensitiveFields)
          data.config_json = JSON.stringify(encryptedConfig)
        } else {
          data.config_json = JSON.stringify(input.config)
        }
      }

      const updated = await updatePluginInstance(input.pluginInstanceId, data)
      return updated
    }),

  setEnabled: protectedProcedure
    .input(setPluginInstanceEnabledInputSchema)
    .mutation(async ({ input }) => {
      return setPluginInstanceEnabledOp(input)
    }),

  delete: protectedProcedure
    .input(z.object({ pluginInstanceId: z.string() }))
    .mutation(async ({ input }) => {
      const pluginInstance = await findPluginInstanceById(input.pluginInstanceId)
      if (!pluginInstance) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Plugin instance not found' })
      }

      await deletePluginInstance(input.pluginInstanceId)
      return { ok: true }
    }),

  setAgentAssignment: protectedProcedure
    .input(setPluginInstanceAgentAssignmentInputSchema)
    .mutation(async ({ input }) => {
      return setPluginInstanceAgentAssignmentOp(input)
    }),
})

export type PluginInstancesRouter = typeof pluginInstancesRouter
