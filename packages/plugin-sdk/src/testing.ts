import type {
  PluginInstance,
  PluginExport,
  WebhookParseResult,
  PostResponseResult,
  ConfigValidationResult,
} from './types'
import { definePlugin } from './define-plugin'

/**
 * Create a mock PluginInstance with sensible defaults, merged with overrides.
 */
export function createMockPluginInstance(overrides?: Partial<PluginInstance>): PluginInstance {
  return {
    id: 'test-001',
    type: 'test',
    config: null,
    ...overrides,
  }
}

/**
 * Create a mock Request from a JSON body and optional headers.
 */
export function createMockRequest(
  body: unknown,
  options?: { headers?: Record<string, string>; method?: string }
): Request {
  const headers = new Headers(options?.headers)
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }
  return new Request('http://localhost/webhook', {
    method: options?.method ?? 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

/** Result from testHandler */
export interface TestHandlerResult {
  definePlugin: { pass: boolean; error?: string }
  validateConfig: { pass: boolean; result?: ConfigValidationResult; error?: string }
  parseWebhook?: { pass: boolean; result?: WebhookParseResult; error?: string }
  postResponse?: { pass: boolean; result?: PostResponseResult; error?: string }
}

/**
 * Run a full contract test against a plugin export.
 * Validates definePlugin, validateConfig, and optionally parseWebhook and postResponse.
 */
export async function testHandler(
  pluginExport: PluginExport,
  options?: {
    config?: unknown
    webhookBody?: unknown
    webhookHeaders?: Record<string, string>
    pluginInstance?: Partial<PluginInstance>
    postResponseArgs?: {
      workItemId: string
      content: string
      responseContext?: unknown
    }
  }
): Promise<TestHandlerResult> {
  const result: TestHandlerResult = {
    definePlugin: { pass: false },
    validateConfig: { pass: false },
  }

  // Step 1: Validate definePlugin
  try {
    definePlugin(pluginExport)
    result.definePlugin = { pass: true }
  } catch (err) {
    result.definePlugin = {
      pass: false,
      error: err instanceof Error ? err.message : String(err),
    }
    return result // Can't proceed if definePlugin fails
  }

  const { handler } = pluginExport
  const instance = createMockPluginInstance({
    type: handler.type,
    ...options?.pluginInstance,
  })

  // Step 2: validateConfig
  try {
    const configResult = handler.validateConfig(options?.config ?? {})
    result.validateConfig = { pass: configResult.valid, result: configResult }
  } catch (err) {
    result.validateConfig = {
      pass: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }

  // Step 3: parseWebhook (optional)
  if (options?.webhookBody !== undefined) {
    try {
      const request = createMockRequest(options.webhookBody, {
        headers: options.webhookHeaders,
      })
      if (instance.config === null && options?.config) {
        instance.config = JSON.stringify(options.config)
      }
      const parseResult = await handler.parseWebhook(request, instance)
      result.parseWebhook = { pass: true, result: parseResult }
    } catch (err) {
      result.parseWebhook = {
        pass: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  // Step 4: postResponse (optional)
  if (options?.postResponseArgs) {
    try {
      const { workItemId, content, responseContext } = options.postResponseArgs
      const postResult = await handler.postResponse(instance, workItemId, content, responseContext)
      result.postResponse = { pass: true, result: postResult }
    } catch (err) {
      result.postResponse = {
        pass: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  return result
}
