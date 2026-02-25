import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { findPluginInstanceById, getRuntimeControl } from '@nitejar/database'
import { protectedProcedure, router } from '../trpc'

const SLACK_BOT_SCOPES = [
  'app_mentions:read',
  'chat:write',
  'channels:join',
  'channels:history',
  'channels:read',
  'emoji:read',
  'files:read',
  'groups:history',
  'groups:read',
  'im:history',
  'im:read',
  'mpim:history',
  'mpim:read',
  'reactions:read',
  'usergroups:read',
  'users:read',
  'users.profile:read',
  'users:read.email',
  'users:write',
  'reactions:write',
  'triggers:read',
] as const

const SLACK_BOT_EVENTS = [
  'app_mention',
  'message.channels',
  'message.groups',
  'message.im',
  'message.mpim',
] as const

function resolveEnvBaseUrl(): string {
  return (
    process.env.APP_URL ||
    process.env.APP_BASE_URL ||
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'http://localhost:3000'
  )
}

function normalizeBaseUrl(input: string | null | undefined): string | null {
  const value = input?.trim()
  if (!value) return null
  try {
    const parsed = new URL(value)
    return parsed.origin
  } catch {
    return null
  }
}

async function resolveBaseUrl(): Promise<string> {
  const control = await getRuntimeControl()
  const configured = normalizeBaseUrl(control.app_base_url)
  if (configured) return configured
  return resolveEnvBaseUrl()
}

function isPublicUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase()
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

function normalizeSlackAppName(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return 'Slopbot'
  return trimmed.length <= 35 ? trimmed : trimmed.slice(0, 35)
}

function normalizeSlackBotDisplayName(input: string): string {
  const lowered = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
  const compact = lowered.replace(/-+/g, '-').replace(/^-|-$/g, '')
  if (!compact) return 'slopbot'
  return compact.length <= 35 ? compact : compact.slice(0, 35)
}

export function buildSlackManifest(params: { appName: string; requestUrl: string }) {
  const displayName = normalizeSlackAppName(params.appName)
  const botDisplayName = normalizeSlackBotDisplayName(params.appName)

  return {
    display_information: {
      name: displayName,
      description: 'Chat with Slopbot agents inside Slack threads.',
      background_color: '#1a1a1a',
    },
    features: {
      bot_user: {
        display_name: botDisplayName,
        always_online: false,
      },
    },
    oauth_config: {
      scopes: {
        bot: [...SLACK_BOT_SCOPES],
      },
    },
    settings: {
      event_subscriptions: {
        request_url: params.requestUrl,
        bot_events: [...SLACK_BOT_EVENTS],
      },
      socket_mode_enabled: false,
      token_rotation_enabled: false,
    },
  }
}

export function buildSlackManifestCreateUrl(manifest: Record<string, unknown>): string {
  const encoded = encodeURIComponent(JSON.stringify(manifest))
  return `https://api.slack.com/apps?new_app=1&manifest_json=${encoded}`
}

export const slackRouter = router({
  getManifest: protectedProcedure
    .input(
      z.object({
        pluginInstanceId: z.string().trim().min(1),
      })
    )
    .query(async ({ input }) => {
      const pluginInstance = await findPluginInstanceById(input.pluginInstanceId)
      if (!pluginInstance || pluginInstance.type !== 'slack') {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Slack plugin instance not found' })
      }

      const baseUrl = await resolveBaseUrl()
      const requestUrl = `${baseUrl}/api/webhooks/plugins/slack/${pluginInstance.id}`
      const manifest = buildSlackManifest({
        appName: pluginInstance.name || 'Slopbot',
        requestUrl,
      })

      return {
        manifest,
        manifestJson: JSON.stringify(manifest, null, 2),
        createUrl: buildSlackManifestCreateUrl(manifest as Record<string, unknown>),
        requestUrl,
        isPublicBaseUrl: isPublicUrl(baseUrl),
        setupGuide: {
          inviteCommand: '/invite @your-bot-handle',
          botTokenPath: 'OAuth & Permissions -> Bot User OAuth Token',
          signingSecretPath: 'Basic Information -> App Credentials -> Signing Secret',
        },
      }
    }),
})

export type SlackRouter = typeof slackRouter
