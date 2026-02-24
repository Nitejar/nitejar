import { z } from 'zod'
import type { PluginInstanceRecord } from '@nitejar/database'
import type { ConfigValidationResult } from '../types'
import type { SlackConfig } from './types'

const allowedChannelsSchema = z.preprocess(
  (value) => {
    if (Array.isArray(value)) {
      return value
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    }

    if (typeof value === 'string') {
      const parts = value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)

      return parts.length > 0 ? parts : undefined
    }

    return value
  },
  z.array(z.string().min(1)).optional()
)

export const slackConfigSchema = z
  .object({
    manifestPending: z.boolean().optional(),
    botToken: z.string().min(1, 'Bot token is required').optional(),
    signingSecret: z.string().min(1, 'Signing secret is required').optional(),
    botUserId: z.string().min(1).optional(),
    allowedChannels: allowedChannelsSchema,
    inboundPolicy: z.enum(['mentions', 'all']).optional(),
    agentMentionHandoffs: z.boolean().optional(),
  })
  .refine(
    (config) => {
      if (config.manifestPending) return true
      return Boolean(config.botToken && config.signingSecret)
    },
    {
      message: 'Bot token and signing secret are required unless app registration is pending',
      path: ['botToken'],
    }
  )

export function parseSlackConfig(pluginInstance: PluginInstanceRecord): SlackConfig | null {
  const raw = pluginInstance.config

  let parsed: unknown = raw
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      return null
    }
  }

  const result = slackConfigSchema.safeParse(parsed)
  return result.success ? result.data : null
}

export function validateSlackConfig(config: unknown): ConfigValidationResult {
  const result = slackConfigSchema.safeParse(config)
  if (result.success) {
    return { valid: true }
  }

  return {
    valid: false,
    errors: result.error.errors.map((err) => `${err.path.join('.')}: ${err.message}`),
  }
}
