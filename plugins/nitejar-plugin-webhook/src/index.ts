import { createHmac, timingSafeEqual } from 'node:crypto'
import { definePlugin } from '@nitejar/plugin-sdk'
import type {
  PluginHandler,
  PluginInstance,
  WebhookParseResult,
  PostResponseResult,
  ConfigValidationResult,
} from '@nitejar/plugin-sdk'

interface WebhookConfig {
  secret?: string
}

const handler: PluginHandler<WebhookConfig> = {
  type: 'webhook',
  displayName: 'Generic Webhook',
  description: 'Accept any JSON POST and create a work item. Testable with curl.',
  icon: 'webhook',
  category: 'productivity',
  sensitiveFields: ['secret'],

  setupConfig: {
    fields: [
      {
        key: 'secret',
        label: 'HMAC Secret',
        type: 'password',
        required: false,
        placeholder: 'Optional shared secret for signature verification',
        helpText:
          'If set, requests must include an X-Webhook-Signature header with the HMAC-SHA256 hex digest of the body.',
      },
    ],
  },

  validateConfig(config: unknown): ConfigValidationResult {
    if (config === null || config === undefined || typeof config === 'object') {
      return { valid: true }
    }
    return { valid: false, errors: ['Config must be an object or empty'] }
  },

  async parseWebhook(
    request: Request,
    pluginInstance: PluginInstance
  ): Promise<WebhookParseResult> {
    const bodyText = await request.text()

    // Verify HMAC signature if secret is configured
    const config = pluginInstance.config ? (JSON.parse(pluginInstance.config) as WebhookConfig) : {}
    if (config.secret) {
      const signature = request.headers.get('x-webhook-signature')
      if (!signature) {
        return { shouldProcess: false }
      }
      const expected = createHmac('sha256', config.secret).update(bodyText).digest('hex')
      const sigBuffer = Buffer.from(signature, 'hex')
      const expectedBuffer = Buffer.from(expected, 'hex')
      if (
        sigBuffer.length !== expectedBuffer.length ||
        !timingSafeEqual(sigBuffer, expectedBuffer)
      ) {
        return { shouldProcess: false }
      }
    }

    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(bodyText)
    } catch {
      return { shouldProcess: false }
    }

    const source = String(payload.source ?? 'webhook')
    const senderId = String(payload.sender_id ?? payload.sender ?? 'anonymous')
    const senderName = String(payload.sender_name ?? payload.sender ?? 'Anonymous')
    const text = String(payload.text ?? payload.message ?? payload.body ?? JSON.stringify(payload))
    const eventType = String(payload.event_type ?? payload.event ?? 'message')

    return {
      shouldProcess: true,
      workItem: {
        source,
        source_ref: `webhook-${Date.now()}`,
        session_key: `webhook:${senderId}`,
        title: text.length > 120 ? text.slice(0, 117) + '...' : text,
        payload: JSON.stringify({
          text,
          sender_id: senderId,
          sender_name: senderName,
          event_type: eventType,
          raw: payload,
        }),
      },
      idempotencyKey: `webhook-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      responseContext: { source, senderId, senderName },
    }
  },

  async postResponse(
    _pluginInstance: PluginInstance,
    _workItemId: string,
    _content: string,
    _responseContext?: unknown,
    _options?: { hitLimit?: boolean; idempotencyKey?: string }
  ): Promise<PostResponseResult> {
    // Webhooks are fire-and-forget — no response channel
    return { success: true, outcome: 'sent' }
  },

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    return { ok: true }
  },
}

export default definePlugin({ handler })
