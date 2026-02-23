import type Anthropic from '@anthropic-ai/sdk'
import { getCredentialForAgentByAlias, getDb, listCredentialsForAgent } from '@nitejar/database'
import type { ToolHandler } from '../types'

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_TIMEOUT_MS = 30_000
const MAX_RESPONSE_BODY_CHARS = 50_000
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
// Kept for reference; no longer used for blanket blocking.
// const AUTH_LIKE_HEADERS = new Set([
//   'authorization', 'cookie', 'x-api-key', 'proxy-authorization', 'x-auth-token',
// ])

type HeaderInput = Record<string, string>
type QueryInput = Record<string, string | number | boolean>

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeMethod(input: unknown): string {
  const raw = typeof input === 'string' ? input.trim().toUpperCase() : 'GET'
  return ALLOWED_METHODS.has(raw) ? raw : ''
}

function parseHeaders(input: unknown): HeaderInput {
  if (!isObject(input)) return {}
  const headers: HeaderInput = {}
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string') {
      headers[key] = value
    }
  }
  return headers
}

function parseQuery(input: unknown): QueryInput {
  if (!isObject(input)) return {}
  const query: QueryInput = {}
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      query[key] = value
    }
  }
  return query
}

function matchesHostPattern(host: string, pattern: string): boolean {
  if (pattern === '*') return true
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1) // keeps leading "."
    return host.endsWith(suffix)
  }
  return host === pattern
}

function isHostAllowed(host: string, allowedHosts: string[]): boolean {
  return allowedHosts.some((pattern) => matchesHostPattern(host, pattern))
}

function encodeQuery(url: URL, query: QueryInput): void {
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, String(value))
  }
}

function redactSecret(value: string, secret: string): string {
  if (!secret) return value
  return value.split(secret).join('[REDACTED_SECRET]')
}

function truncate(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) {
    return { text, truncated: false }
  }
  const omitted = text.length - maxChars
  return {
    text: `${text.slice(0, maxChars)}\n\n[response body truncated: omitted ${omitted} chars]`,
    truncated: true,
  }
}

async function writeAuditLog(params: {
  eventType: string
  agentId: string | null
  result: 'allowed' | 'denied' | 'error'
  metadata: Record<string, unknown>
}): Promise<void> {
  const db = getDb()
  await db
    .insertInto('audit_logs')
    .values({
      id: crypto.randomUUID(),
      event_type: params.eventType,
      agent_id: params.agentId,
      github_repo_id: null,
      capability: 'credential_http_request',
      result: params.result,
      metadata: JSON.stringify(params.metadata),
      created_at: now(),
    })
    .execute()
}

/**
 * Replace all occurrences of `{alias}` in a string with the secret value.
 * Returns whether any substitution was made.
 */
function interpolateSecret(
  text: string,
  alias: string,
  secret: string
): { result: string; hadMatch: boolean } {
  const placeholder = `{${alias}}`
  if (!text.includes(placeholder)) return { result: text, hadMatch: false }
  return { result: text.split(placeholder).join(secret), hadMatch: true }
}

export const credentialDefinitions: Anthropic.Tool[] = [
  {
    name: 'list_credentials',
    description:
      'List credentials assigned to the current agent. Returns metadata only and never returns secret values. Use {alias} as a placeholder in headers, query, or body of secure_http_request and the system will interpolate the secret.',
    input_schema: {
      type: 'object' as const,
      properties: {
        provider: {
          type: 'string',
          description: 'Optional provider filter (for example: instagram_graph_api).',
        },
      },
    },
  },
  {
    name: 'secure_http_request',
    description:
      'Make an HTTP request using a named credential. Place {credential_alias} in headers, query params, or body and the system will interpolate the secret. Example: headers: {"Authorization": "Bearer {my_api_key}"}. The credential must be allowed in the location where the placeholder appears.',
    input_schema: {
      type: 'object' as const,
      properties: {
        credential_alias: {
          type: 'string',
          description: 'Alias of the assigned credential to use.',
        },
        url: {
          type: 'string',
          description: 'HTTP or HTTPS URL.',
        },
        method: {
          type: 'string',
          enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
          description: 'HTTP method (default: GET).',
        },
        headers: {
          type: 'object',
          description:
            'Request headers. Use {credential_alias} as placeholder for the secret value.',
        },
        query: {
          type: 'object',
          description:
            'Query parameters. Use {credential_alias} as placeholder for the secret value.',
        },
        body_json: {
          type: 'object',
          description:
            'JSON body. Use {credential_alias} as placeholder for the secret. Cannot be combined with body_text.',
        },
        body_text: {
          type: 'string',
          description:
            'Raw text body. Use {credential_alias} as placeholder for the secret. Cannot be combined with body_json.',
        },
        timeout_ms: {
          type: 'integer',
          description: 'Timeout in milliseconds (default 30000, max 30000).',
        },
      },
      required: ['credential_alias', 'url'],
    },
  },
]

export const listCredentialsTool: ToolHandler = async (input, context) => {
  if (!context.agentId) {
    return { success: false, error: 'Missing agent identity for listing credentials.' }
  }

  const provider = typeof input.provider === 'string' ? input.provider.trim() : undefined
  const credentials = await listCredentialsForAgent(context.agentId, {
    provider: provider || undefined,
  })

  return {
    success: true,
    output: JSON.stringify(
      {
        credentials: credentials.map((credential) => ({
          id: credential.id,
          alias: credential.alias,
          provider: credential.provider,
          placeholder: `{${credential.alias}}`,
          allowedHosts: credential.allowedHosts,
          allowedInHeader: credential.allowedInHeader,
          allowedInQuery: credential.allowedInQuery,
          allowedInBody: credential.allowedInBody,
          enabled: credential.enabled,
        })),
      },
      null,
      2
    ),
  }
}

export const secureHttpRequestTool: ToolHandler = async (input, context) => {
  const startedAt = Date.now()
  const method = normalizeMethod(input.method)
  if (!method) {
    return { success: false, error: 'method must be one of GET, POST, PUT, PATCH, DELETE.' }
  }

  if (!context.agentId) {
    return { success: false, error: 'Missing agent identity for secure_http_request.' }
  }

  const credentialAlias =
    typeof input.credential_alias === 'string' ? input.credential_alias.trim() : ''
  if (!credentialAlias) {
    return { success: false, error: 'credential_alias is required.' }
  }

  const rawUrl = typeof input.url === 'string' ? input.url.trim() : ''
  if (!rawUrl) {
    return { success: false, error: 'url is required.' }
  }

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return { success: false, error: 'url must be a valid absolute URL.' }
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { success: false, error: 'Only http and https URLs are supported.' }
  }

  const credential = await getCredentialForAgentByAlias(context.agentId, credentialAlias)
  if (!credential) {
    await writeAuditLog({
      eventType: 'CREDENTIAL_REQUEST_DENIED',
      agentId: context.agentId,
      result: 'denied',
      metadata: {
        credentialAlias,
        method,
        host: url.hostname,
        path: url.pathname,
        reason: 'credential_not_assigned_or_disabled',
      },
    })
    return {
      success: false,
      error: `Credential "${credentialAlias}" is not assigned or not enabled.`,
    }
  }

  if (!isHostAllowed(url.hostname, credential.allowedHosts)) {
    await writeAuditLog({
      eventType: 'CREDENTIAL_REQUEST_DENIED',
      agentId: context.agentId,
      result: 'denied',
      metadata: {
        credentialId: credential.id,
        credentialAlias: credential.alias,
        method,
        host: url.hostname,
        path: url.pathname,
        allowedHosts: credential.allowedHosts,
        reason: 'host_not_allowed',
      },
    })
    return {
      success: false,
      error: `Host "${url.hostname}" is not allowed for credential "${credential.alias}".`,
    }
  }

  const headers = parseHeaders(input.headers)
  const query = parseQuery(input.query)
  encodeQuery(url, query)

  // --- Interpolate {alias} placeholders with secret ---
  let secretInHeader = false
  let secretInQuery = false
  let secretInBody = false

  for (const [key, value] of Object.entries(headers)) {
    const { result, hadMatch } = interpolateSecret(value, credential.alias, credential.secret)
    if (hadMatch) {
      headers[key] = result
      secretInHeader = true
    }
  }

  // Interpolate in URL query params (already encoded on URL object)
  for (const [key, value] of url.searchParams.entries()) {
    const { result, hadMatch } = interpolateSecret(value, credential.alias, credential.secret)
    if (hadMatch) {
      url.searchParams.set(key, result)
      secretInQuery = true
    }
  }

  let body: string | undefined
  if (input.body_json !== undefined && input.body_text !== undefined) {
    return { success: false, error: 'Provide either body_json or body_text, not both.' }
  }
  if (input.body_json !== undefined) {
    if (!isObject(input.body_json)) {
      return { success: false, error: 'body_json must be an object.' }
    }
    body = JSON.stringify(input.body_json)
    if (!Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = 'application/json'
    }
  } else if (typeof input.body_text === 'string') {
    body = input.body_text
  }

  // Interpolate in body
  if (body) {
    const { result, hadMatch } = interpolateSecret(body, credential.alias, credential.secret)
    if (hadMatch) {
      body = result
      secretInBody = true
    }
  }

  // Validate locations: secret must only appear in allowed locations
  if (secretInHeader && !credential.allowedInHeader) {
    return {
      success: false,
      error: `Credential "${credential.alias}" is not allowed in headers.`,
    }
  }
  if (secretInQuery && !credential.allowedInQuery) {
    return {
      success: false,
      error: `Credential "${credential.alias}" is not allowed in query parameters.`,
    }
  }
  if (secretInBody && !credential.allowedInBody) {
    return {
      success: false,
      error: `Credential "${credential.alias}" is not allowed in request body.`,
    }
  }

  if (!secretInHeader && !secretInQuery && !secretInBody) {
    return {
      success: false,
      error: `No {${credential.alias}} placeholder found in headers, query, or body. Use {${credential.alias}} where the secret should be placed.`,
    }
  }

  const timeoutMs =
    typeof input.timeout_ms === 'number' && Number.isFinite(input.timeout_ms)
      ? Math.max(1, Math.min(MAX_TIMEOUT_MS, Math.floor(input.timeout_ms)))
      : DEFAULT_TIMEOUT_MS

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    await writeAuditLog({
      eventType: 'CREDENTIAL_REQUEST_ALLOWED',
      agentId: context.agentId,
      result: 'allowed',
      metadata: {
        credentialId: credential.id,
        credentialAlias: credential.alias,
        method,
        host: url.hostname,
        path: url.pathname,
        secretInHeader,
        secretInQuery,
        secretInBody,
      },
    })

    const response = await fetch(url, {
      method,
      headers,
      body,
      signal: controller.signal,
    })

    const responseHeaders: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      responseHeaders[key] = redactSecret(value, credential.secret)
    })

    const rawBody = await response.text()
    const redactedBody = redactSecret(rawBody, credential.secret)
    const truncatedBody = truncate(redactedBody, MAX_RESPONSE_BODY_CHARS)

    const sanitizedUrl = new URL(response.url || url.toString())
    // Redact any query params that contain the secret
    for (const [key, value] of sanitizedUrl.searchParams.entries()) {
      if (value.includes(credential.secret)) {
        sanitizedUrl.searchParams.set(key, '[REDACTED_SECRET]')
      }
    }

    const durationMs = Date.now() - startedAt
    const output = {
      status: response.status,
      statusText: response.statusText,
      url: sanitizedUrl.toString(),
      headers: responseHeaders,
      body: truncatedBody.text,
      truncated: truncatedBody.truncated,
      durationMs,
      httpOk: response.ok,
    }

    await writeAuditLog({
      eventType: 'CREDENTIAL_REQUEST_SUCCESS',
      agentId: context.agentId,
      result: 'allowed',
      metadata: {
        credentialId: credential.id,
        credentialAlias: credential.alias,
        method,
        host: url.hostname,
        path: url.pathname,
        status: response.status,
        durationMs,
        truncated: truncatedBody.truncated,
      },
    })

    return {
      success: true,
      output: JSON.stringify(output, null, 2),
      _meta: {
        externalApiCost: {
          provider: credential.provider,
          operation: 'secure_http_request',
          creditsUsed: 0,
          costUsd: 0,
          durationMs,
          metadata: {
            credentialId: credential.id,
            credentialAlias: credential.alias,
            host: url.hostname,
            method,
            status: response.status,
          },
        },
      },
    }
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError'
    const durationMs = Date.now() - startedAt
    await writeAuditLog({
      eventType: 'CREDENTIAL_REQUEST_FAIL',
      agentId: context.agentId,
      result: 'error',
      metadata: {
        credentialId: credential.id,
        credentialAlias: credential.alias,
        method,
        host: url.hostname,
        path: url.pathname,
        timedOut,
        durationMs,
        error: error instanceof Error ? error.message : String(error),
      },
    })

    return {
      success: false,
      error: timedOut
        ? `Request timed out after ${timeoutMs}ms.`
        : error instanceof Error
          ? error.message
          : String(error),
    }
  } finally {
    clearTimeout(timeoutId)
  }
}
