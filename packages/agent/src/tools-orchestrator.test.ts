import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeTool, type ToolContext } from './tools'
import { toolHandlers } from './tools/handlers'
import type { ToolHandler, ToolResult } from './tools/types'

vi.mock('./tools/handlers', () => ({
  toolHandlers: {} as Record<string, ToolHandler>,
}))

const baseHandlers = toolHandlers

const context: ToolContext = {
  spriteName: 'test-sprite',
}

describe('executeTool orchestrator', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    for (const key of Object.keys(baseHandlers)) {
      delete baseHandlers[key]
    }
  })

  describe('handler lookup and dispatch', () => {
    it('returns unknown-tool error for unregistered tools', async () => {
      const result = await executeTool('not_a_real_tool', {}, context)

      expect(result).toEqual({
        success: false,
        error: 'Unknown tool: not_a_real_tool',
      })
    })

    it('calls the correct handler from toolHandlers, passes input/context, and returns ToolResult', async () => {
      const input = { message: 'hello' }
      const expected: ToolResult = { success: true, output: 'ok' }
      const handler = vi.fn<ToolHandler>().mockResolvedValue(expected)
      baseHandlers.test_tool = handler

      const result = await executeTool('test_tool', input, context)

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith(input, context)
      expect(result).toBe(expected)
    })

    it('prefers base registry over additionalHandlers when both have the tool', async () => {
      const baseResult: ToolResult = { success: true, output: 'base' }
      const additionalResult: ToolResult = { success: true, output: 'additional' }
      const baseHandler = vi.fn<ToolHandler>().mockResolvedValue(baseResult)
      const additionalHandler = vi.fn<ToolHandler>().mockResolvedValue(additionalResult)
      baseHandlers.shared_tool = baseHandler

      const result = await executeTool('shared_tool', {}, context, {
        shared_tool: additionalHandler,
      })

      expect(baseHandler).toHaveBeenCalledTimes(1)
      expect(additionalHandler).not.toHaveBeenCalled()
      expect(result).toBe(baseResult)
    })

    it("falls back to additionalHandlers when base registry doesn't have the tool", async () => {
      const expected: ToolResult = { success: true, output: 'additional' }
      const additionalHandler = vi.fn<ToolHandler>().mockResolvedValue(expected)

      const result = await executeTool('custom_tool', { id: 1 }, context, {
        custom_tool: additionalHandler,
      })

      expect(additionalHandler).toHaveBeenCalledWith({ id: 1 }, context)
      expect(result).toBe(expected)
    })
  })

  describe('error handling', () => {
    it('catches Error thrown by handler', async () => {
      const handler = vi.fn<ToolHandler>().mockRejectedValue(new Error('boom'))
      baseHandlers.test_tool = handler

      const result = await executeTool('test_tool', {}, context)

      expect(result).toEqual({ success: false, error: 'boom' })
    })

    it('catches non-Error thrown by handler and stringifies it', async () => {
      const handler = vi.fn<ToolHandler>().mockRejectedValue({ code: 500 })
      baseHandlers.test_tool = handler

      const result = await executeTool('test_tool', {}, context)

      expect(result).toEqual({ success: false, error: '[object Object]' })
    })

    it('catches async rejection from handler', async () => {
      baseHandlers.async_tool = () => Promise.reject(new Error('async failure'))

      const result = await executeTool('async_tool', {}, context)

      expect(result).toEqual({ success: false, error: 'async failure' })
    })

    it('does not catch errors from handler lookup', async () => {
      Object.defineProperty(baseHandlers, 'lookup_throw', {
        configurable: true,
        get: () => {
          throw new Error('lookup blew up')
        },
      })

      await expect(executeTool('lookup_throw', {}, context)).rejects.toThrow('lookup blew up')
    })
  })

  describe('ToolResult metadata passthrough', () => {
    it('preserves handler metadata fields unchanged', async () => {
      const expected: ToolResult = {
        success: true,
        output: 'ok',
        _meta: {
          cwd: '/tmp/workspace',
          sessionError: true,
          sessionInvalidated: true,
          sandboxSwitch: {
            sandboxName: 'safe',
            spriteName: 'test-sprite',
          },
          externalApiCost: {
            provider: 'tavily',
            operation: 'search',
            creditsUsed: 7,
            costUsd: 0.014,
            durationMs: 1200,
            metadata: { query: 'nitejar' },
          },
          editOperation: 'apply_patch',
          hashMismatch: true,
        },
      }
      const handler = vi.fn<ToolHandler>().mockResolvedValue(expected)
      baseHandlers.meta_tool = handler

      const result = await executeTool('meta_tool', {}, context)

      expect(result).toEqual(expected)
      expect(result._meta?.cwd).toBe('/tmp/workspace')
      expect(result._meta?.sessionError).toBe(true)
      expect(result._meta?.sessionInvalidated).toBe(true)
      expect(result._meta?.sandboxSwitch).toEqual({
        sandboxName: 'safe',
        spriteName: 'test-sprite',
      })
      expect(result._meta?.externalApiCost).toEqual({
        provider: 'tavily',
        operation: 'search',
        creditsUsed: 7,
        costUsd: 0.014,
        durationMs: 1200,
        metadata: { query: 'nitejar' },
      })
      expect(result._meta?.editOperation).toBe('apply_patch')
      expect(result._meta?.hashMismatch).toBe(true)
    })
  })
})
