import { describe, expect, it, vi, beforeEach } from 'vitest'
import OpenAI from 'openai'
import * as Database from '@nitejar/database'
import type * as ModelClient from './model-client'

vi.mock('@nitejar/database', async () => {
  const actual = await vi.importActual<typeof Database>('@nitejar/database')
  return {
    ...actual,
    getDb: vi.fn(),
    decrypt: vi.fn(),
  }
})

const mockedGetDb = vi.mocked(Database.getDb)
const mockedDecrypt = vi.mocked(Database.decrypt)

describe('isLikelyImageInputUnsupportedError', () => {
  let isLikelyImageInputUnsupportedError: typeof ModelClient.isLikelyImageInputUnsupportedError

  beforeEach(async () => {
    ;({ isLikelyImageInputUnsupportedError } = await import('./model-client'))
  })

  it('detects "image" + "support" in error message', () => {
    expect(isLikelyImageInputUnsupportedError(new Error('image input is not supported'))).toBe(true)
  })

  it('detects "multimodal" in error message', () => {
    expect(isLikelyImageInputUnsupportedError(new Error('multimodal not available'))).toBe(true)
  })

  it('detects "invalid content type" in error message', () => {
    expect(isLikelyImageInputUnsupportedError(new Error('invalid content type for request'))).toBe(
      true
    )
  })

  it('detects "content parts" in error message', () => {
    expect(isLikelyImageInputUnsupportedError(new Error('content parts not allowed'))).toBe(true)
  })

  it('returns false for unrelated errors', () => {
    expect(isLikelyImageInputUnsupportedError(new Error('rate limit exceeded'))).toBe(false)
  })

  it('handles non-Error values', () => {
    expect(isLikelyImageInputUnsupportedError('multimodal failure')).toBe(true)
    expect(isLikelyImageInputUnsupportedError('some other error')).toBe(false)
  })
})

describe('isLikelyToolUseUnsupportedError', () => {
  let isLikelyToolUseUnsupportedError: typeof ModelClient.isLikelyToolUseUnsupportedError

  beforeEach(async () => {
    ;({ isLikelyToolUseUnsupportedError } = await import('./model-client'))
  })

  it('detects "support tool use"', () => {
    expect(isLikelyToolUseUnsupportedError(new Error("This model doesn't support tool use"))).toBe(
      true
    )
  })

  it('detects "tools unavailable"', () => {
    expect(isLikelyToolUseUnsupportedError(new Error('tools unavailable for this model'))).toBe(
      true
    )
  })

  it('detects "tool use is not supported"', () => {
    expect(isLikelyToolUseUnsupportedError(new Error('tool use is not supported'))).toBe(true)
  })

  it('detects "function calling is not supported"', () => {
    expect(isLikelyToolUseUnsupportedError(new Error('function calling is not supported'))).toBe(
      true
    )
  })

  it('detects "no endpoints found that support tool use"', () => {
    expect(
      isLikelyToolUseUnsupportedError(new Error('no endpoints found that support tool use'))
    ).toBe(true)
  })

  it('returns false for unrelated errors', () => {
    expect(isLikelyToolUseUnsupportedError(new Error('timeout'))).toBe(false)
  })
})

describe('getOpenAITools', () => {
  let getOpenAITools: typeof ModelClient.getOpenAITools

  beforeEach(async () => {
    ;({ getOpenAITools } = await import('./model-client'))
  })

  it('returns array of OpenAI tool objects', () => {
    const tools = getOpenAITools()
    expect(Array.isArray(tools)).toBe(true)
    expect(tools.length).toBeGreaterThan(0)
    for (const tool of tools) {
      expect(tool.type).toBe('function')
      const fn = tool as { type: string; function: { name: string; description: string } }
      expect(fn.function.name).toBeDefined()
      expect(fn.function.description).toBeDefined()
    }
  })

  it('includes bash tool', () => {
    const tools = getOpenAITools()
    const bash = tools.find((t) => {
      const fn = t as { type: string; function: { name: string } }
      return fn.function.name === 'bash'
    })
    expect(bash).toBeDefined()
  })

  it('uses hashline edit schema by default', () => {
    const tools = getOpenAITools()
    const edit = tools.find((t) => {
      const fn = t as { type: string; function: { name: string } }
      return fn.function.name === 'edit_file'
    }) as { type: string; function: { parameters: { properties?: Record<string, unknown> } } }

    expect(edit).toBeDefined()
    expect(edit.function.parameters.properties).toHaveProperty('edits')
    expect(edit.function.parameters.properties).not.toHaveProperty('old_string')
  })

  it('uses replace edit schema when editToolMode=replace', () => {
    const tools = getOpenAITools({ editToolMode: 'replace' })
    const edit = tools.find((t) => {
      const fn = t as { type: string; function: { name: string } }
      return fn.function.name === 'edit_file'
    }) as { type: string; function: { parameters: { properties?: Record<string, unknown> } } }

    expect(edit).toBeDefined()
    expect(edit.function.parameters.properties).toHaveProperty('old_string')
    expect(edit.function.parameters.properties).not.toHaveProperty('edits')
  })

  it('includes create_ephemeral_sandbox by default', () => {
    const tools = getOpenAITools()
    const names = tools.map(
      (t) => (t as { type: string; function: { name: string } }).function.name
    )
    expect(names).not.toContain('create_ephemeral_sandbox')
  })

  it('includes ephemeral sandbox tools when sandbox grant access is enabled', () => {
    const tools = getOpenAITools({
      runtimeToolAccess: {
        grantedActions: ['sandbox.ephemeral.create'],
        sandboxEphemeralCreate: true,
      },
    })
    const names = tools.map(
      (t) => (t as { type: string; function: { name: string } }).function.name
    )
    expect(names).toContain('create_ephemeral_sandbox')
    expect(names).toContain('delete_sandbox')
  })

  it('excludes routine write tools by default', () => {
    const tools = getOpenAITools()
    const names = tools.map(
      (t) => (t as { type: string; function: { name: string } }).function.name
    )
    expect(names).toContain('get_routine')
    expect(names).not.toContain('create_routine')
    expect(names).not.toContain('update_routine')
    expect(names).not.toContain('pause_routine')
    expect(names).not.toContain('delete_routine')
    expect(names).not.toContain('run_routine_now')
    expect(names).toContain('list_routines')
  })

  it('includes routine write tools when routine manage access is enabled', () => {
    const tools = getOpenAITools({
      runtimeToolAccess: {
        grantedActions: ['routine.manage'],
        routineManage: true,
      },
    })
    const names = tools.map(
      (t) => (t as { type: string; function: { name: string } }).function.name
    )
    expect(names).toContain('get_routine')
    expect(names).toContain('create_routine')
    expect(names).toContain('update_routine')
    expect(names).toContain('pause_routine')
    expect(names).toContain('delete_routine')
    expect(names).toContain('run_routine_now')
    expect(names).toContain('list_routines')
  })

  it('excludes platform control tools by default', () => {
    const tools = getOpenAITools()
    const names = tools.map(
      (t) => (t as { type: string; function: { name: string } }).function.name
    )
    expect(names).not.toContain('list_agents')
    expect(names).not.toContain('get_agent_config')
    expect(names).not.toContain('create_agent')
    expect(names).not.toContain('set_agent_status')
  })

  it('includes only the matching platform control tools for each grant group', () => {
    const tools = getOpenAITools({
      runtimeToolAccess: {
        grantedActions: [
          'fleet.agent.read',
          'fleet.agent.create',
          'fleet.agent.control',
          'fleet.agent.delete',
          'fleet.agent.write',
        ],
        fleetAgentRead: true,
        fleetAgentCreate: true,
        fleetAgentControl: true,
        fleetAgentDelete: true,
        fleetAgentWrite: true,
      },
    })
    const names = tools.map(
      (t) => (t as { type: string; function: { name: string } }).function.name
    )
    expect(names).toContain('list_agents')
    expect(names).toContain('get_agent_config')
    expect(names).toContain('get_agent_soul')
    expect(names).toContain('create_agent')
    expect(names).toContain('set_agent_status')
    expect(names).toContain('delete_agent')
    expect(names).toContain('update_agent_config')
    expect(names).toContain('update_agent_soul')
  })

  it('keeps unrelated gated tools hidden when only one policy grant group is enabled', () => {
    const tools = getOpenAITools({
      runtimeToolAccess: {
        grantedActions: ['fleet.agent.read'],
        fleetAgentRead: true,
      },
    })
    const names = tools.map(
      (t) => (t as { type: string; function: { name: string } }).function.name
    )
    expect(names).toContain('list_agents')
    expect(names).toContain('get_agent_config')
    expect(names).toContain('get_agent_soul')
    expect(names).not.toContain('create_agent')
    expect(names).not.toContain('set_agent_status')
    expect(names).not.toContain('delete_agent')
    expect(names).not.toContain('update_agent_config')
    expect(names).not.toContain('create_ephemeral_sandbox')
    expect(names).not.toContain('create_routine')
  })

  it('keeps granted work tools while excluding sandbox tools', () => {
    const tools = getOpenAITools({
      excludeSandboxTools: true,
      runtimeToolAccess: {
        grantedActions: ['work.ticket.read', 'work.goal.write'],
      },
    })
    const names = tools.map(
      (t) => (t as { type: string; function: { name: string } }).function.name
    )

    expect(names).not.toContain('bash')
    expect(names).not.toContain('read_file')
    expect(names).not.toContain('create_service')
    expect(names).not.toContain('create_ephemeral_sandbox')
    expect(names).toContain('search_tickets')
    expect(names).toContain('post_work_update')
    expect(names).not.toContain('run_ticket_now')
    expect(names).not.toContain('link_ticket_receipt')
    expect(names).toContain('query_activity')
  })

  it('shows ticket receipt linking only with ticket write access', () => {
    const names = getOpenAITools({
      excludeSandboxTools: true,
      runtimeToolAccess: {
        grantedActions: ['work.ticket.write'],
      },
    }).map((t) => (t as { function: { name: string } }).function.name)

    expect(names).toContain('link_ticket_receipt')
    expect(names).toContain('run_ticket_now')
  })

  it('shows GitHub and media tools only when their grants are present', () => {
    const names = getOpenAITools({
      runtimeToolAccess: {
        grantedActions: [
          'github.repo.read',
          'capability.web_search',
          'capability.image_generation',
          'capability.speech_to_text',
          'capability.text_to_speech',
        ],
      },
    }).map((t) => (t as { function: { name: string } }).function.name)

    expect(names).toContain('configure_github_credentials')
    expect(names).toContain('web_search')
    expect(names).toContain('extract_url')
    expect(names).toContain('generate_image')
    expect(names).toContain('transcribe_audio')
    expect(names).toContain('synthesize_speech')
  })

  it('keeps collection tools hidden by default', () => {
    const names = getOpenAITools().map((t) => (t as { function: { name: string } }).function.name)

    expect(names).not.toContain('collection_describe')
    expect(names).not.toContain('collection_insert')
    expect(names).not.toContain('define_collection')
  })

  it('shows only collection read tools for collection.read', () => {
    const names = getOpenAITools({
      runtimeToolAccess: {
        grantedActions: ['collection.read'],
      },
    }).map((t) => (t as { function: { name: string } }).function.name)

    expect(names).toContain('collection_describe')
    expect(names).toContain('collection_query')
    expect(names).toContain('collection_search')
    expect(names).toContain('collection_get')
    expect(names).not.toContain('collection_insert')
    expect(names).not.toContain('define_collection')
  })

  it('shows collection admin tools for collection.admin.write', () => {
    const names = getOpenAITools({
      runtimeToolAccess: {
        grantedActions: ['collection.admin.write'],
      },
    }).map((t) => (t as { function: { name: string } }).function.name)

    expect(names).toContain('define_collection')
    expect(names).toContain('collection_update_schema')
    expect(names).toContain('collection_list_reviews')
    expect(names).toContain('collection_review_schema')
    expect(names).toContain('collection_update_permission')
    expect(names).not.toContain('collection_insert')
    expect(names).not.toContain('collection_describe')
  })

  it('keeps plugin instance tools hidden by default', () => {
    const names = getOpenAITools().map((t) => (t as { function: { name: string } }).function.name)

    expect(names).not.toContain('list_plugin_instances')
    expect(names).not.toContain('get_plugin_instance')
    expect(names).not.toContain('set_plugin_instance_agent_assignment')
  })

  it('shows plugin instance read tools for plugins.instances.read', () => {
    const names = getOpenAITools({
      runtimeToolAccess: {
        grantedActions: ['plugins.instances.read'],
      },
    }).map((t) => (t as { function: { name: string } }).function.name)

    expect(names).toContain('list_plugin_instances')
    expect(names).toContain('get_plugin_instance')
    expect(names).not.toContain('set_plugin_instance_agent_assignment')
  })

  it('shows plugin instance write tool for plugins.instances.write', () => {
    const names = getOpenAITools({
      runtimeToolAccess: {
        grantedActions: ['plugins.instances.write'],
      },
    }).map((t) => (t as { function: { name: string } }).function.name)

    expect(names).toContain('set_plugin_instance_agent_assignment')
    expect(names).not.toContain('list_plugin_instances')
    expect(names).not.toContain('get_plugin_instance')
  })
})

// ---------------------------------------------------------------------------
// isRetryableProviderError
// ---------------------------------------------------------------------------

describe('isRetryableProviderError', () => {
  let isRetryableProviderError: typeof ModelClient.isRetryableProviderError

  beforeEach(async () => {
    ;({ isRetryableProviderError } = await import('./model-client'))
  })

  function makeAPIError(status: number, message = 'error'): InstanceType<typeof OpenAI.APIError> {
    return new OpenAI.APIError(status, { message }, message, new Headers())
  }

  it('retries 429 rate limit errors', () => {
    expect(isRetryableProviderError(makeAPIError(429, 'rate limit exceeded'))).toBe(true)
  })

  it('retries 500 server errors', () => {
    expect(isRetryableProviderError(makeAPIError(500, 'internal server error'))).toBe(true)
  })

  it('retries 502 bad gateway', () => {
    expect(isRetryableProviderError(makeAPIError(502, 'bad gateway'))).toBe(true)
  })

  it('retries 503 service unavailable', () => {
    expect(isRetryableProviderError(makeAPIError(503, 'service unavailable'))).toBe(true)
  })

  it('retries generic 400 from OpenRouter (transient upstream)', () => {
    expect(isRetryableProviderError(makeAPIError(400, 'upstream provider error'))).toBe(true)
  })

  it('does NOT retry 400 with "invalid" in message', () => {
    expect(isRetryableProviderError(makeAPIError(400, 'invalid request body'))).toBe(false)
  })

  it('does NOT retry 400 with "malformed" in message', () => {
    expect(isRetryableProviderError(makeAPIError(400, 'malformed JSON'))).toBe(false)
  })

  it('does NOT retry 400 with "missing required" in message', () => {
    expect(isRetryableProviderError(makeAPIError(400, 'missing required field: model'))).toBe(false)
  })

  it('does NOT retry 401 unauthorized', () => {
    expect(isRetryableProviderError(makeAPIError(401, 'unauthorized'))).toBe(false)
  })

  it('does NOT retry 403 forbidden', () => {
    expect(isRetryableProviderError(makeAPIError(403, 'forbidden'))).toBe(false)
  })

  it('retries ECONNRESET errors', () => {
    expect(isRetryableProviderError(new Error('read ECONNRESET'))).toBe(true)
  })

  it('retries ETIMEDOUT errors', () => {
    expect(isRetryableProviderError(new Error('connect ETIMEDOUT'))).toBe(true)
  })

  it('retries socket hang up', () => {
    expect(isRetryableProviderError(new Error('socket hang up'))).toBe(true)
  })

  it('retries fetch failed', () => {
    expect(isRetryableProviderError(new Error('fetch failed'))).toBe(true)
  })

  it('does NOT retry generic errors', () => {
    expect(isRetryableProviderError(new Error('something else broke'))).toBe(false)
  })

  it('does NOT retry non-error values', () => {
    expect(isRetryableProviderError('string error')).toBe(false)
    expect(isRetryableProviderError(null)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// withProviderRetry
// ---------------------------------------------------------------------------

describe('withProviderRetry', () => {
  let withProviderRetry: typeof ModelClient.withProviderRetry

  beforeEach(async () => {
    ;({ withProviderRetry } = await import('./model-client'))
  })

  function makeAPIError(status: number, message = 'error'): InstanceType<typeof OpenAI.APIError> {
    return new OpenAI.APIError(status, { message }, message, new Headers())
  }

  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    const result = await withProviderRetry(fn, { maxRetries: 2, baseDelayMs: 1 })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries on retryable error and succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(makeAPIError(429, 'rate limit'))
      .mockResolvedValueOnce('ok after retry')

    const result = await withProviderRetry(fn, { maxRetries: 2, baseDelayMs: 1 })

    expect(result).toBe('ok after retry')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('retries up to maxRetries then throws', async () => {
    const error = makeAPIError(500, 'server error')
    const fn = vi.fn().mockRejectedValue(error)

    await expect(withProviderRetry(fn, { maxRetries: 2, baseDelayMs: 1 })).rejects.toThrow(
      'server error'
    )
    expect(fn).toHaveBeenCalledTimes(3) // 1 initial + 2 retries
  })

  it('does NOT retry non-retryable errors', async () => {
    const error = makeAPIError(401, 'unauthorized')
    const fn = vi.fn().mockRejectedValue(error)

    await expect(withProviderRetry(fn, { maxRetries: 2, baseDelayMs: 1 })).rejects.toThrow(
      'unauthorized'
    )
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('does NOT retry generic errors', async () => {
    const error = new Error('something weird')
    const fn = vi.fn().mockRejectedValue(error)

    await expect(withProviderRetry(fn, { maxRetries: 2, baseDelayMs: 1 })).rejects.toThrow(
      'something weird'
    )
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('defaults to 2 retries', async () => {
    const error = makeAPIError(502, 'bad gateway')
    const fn = vi.fn().mockRejectedValue(error)

    await expect(withProviderRetry(fn, { baseDelayMs: 1 })).rejects.toThrow()
    expect(fn).toHaveBeenCalledTimes(3) // 1 initial + 2 default retries
  })
})

describe('loadGatewayConfig', () => {
  let loadGatewayConfig: typeof ModelClient.loadGatewayConfig

  beforeEach(async () => {
    vi.clearAllMocks()
    ;({ loadGatewayConfig } = await import('./model-client'))
  })

  it('returns empty config when no gateway settings exist', async () => {
    const mockExecuteTakeFirst = vi.fn().mockResolvedValue(undefined)
    const mockWhere = vi.fn().mockReturnValue({ executeTakeFirst: mockExecuteTakeFirst })
    const mockSelectAll = vi.fn().mockReturnValue({ where: mockWhere })
    const mockSelectFrom = vi.fn().mockReturnValue({ selectAll: mockSelectAll })
    mockedGetDb.mockReturnValue({ selectFrom: mockSelectFrom } as never)

    const result = await loadGatewayConfig()
    expect(result).toEqual({ apiKey: null, baseUrl: null, hasSettings: false })
  })

  it('decrypts API key when settings exist', async () => {
    const mockSettings = {
      api_key_encrypted: 'encrypted-key',
      base_url: 'https://custom.api.com',
    }
    const mockExecuteTakeFirst = vi.fn().mockResolvedValue(mockSettings)
    const mockWhere = vi.fn().mockReturnValue({ executeTakeFirst: mockExecuteTakeFirst })
    const mockSelectAll = vi.fn().mockReturnValue({ where: mockWhere })
    const mockSelectFrom = vi.fn().mockReturnValue({ selectAll: mockSelectAll })
    mockedGetDb.mockReturnValue({ selectFrom: mockSelectFrom } as never)
    mockedDecrypt.mockReturnValue('decrypted-key')

    const result = await loadGatewayConfig()
    expect(result).toEqual({
      apiKey: 'decrypted-key',
      baseUrl: 'https://custom.api.com',
      hasSettings: true,
    })
    expect(mockedDecrypt).toHaveBeenCalledWith('encrypted-key')
  })

  it('handles DB errors gracefully', async () => {
    mockedGetDb.mockImplementation(() => {
      throw new Error('DB connection failed')
    })

    const result = await loadGatewayConfig()
    expect(result).toEqual({ apiKey: null, baseUrl: null, hasSettings: false })
  })
})
