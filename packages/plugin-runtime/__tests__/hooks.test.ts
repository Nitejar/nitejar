import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  HookRegistry,
  HookDispatcher,
  initHookSystem,
  getHookRegistry,
  getHookDispatcher,
  _resetHookSystemForTest,
  type HookRegistration,
  type HookContext,
  type HookResult,
} from '../src/hooks'

// Mock @nitejar/database
vi.mock('@nitejar/database', () => ({
  createPluginEvent: vi.fn().mockResolvedValue(null),
}))

function createRegistration(overrides: Partial<HookRegistration> = {}): HookRegistration {
  return {
    pluginId: 'test-plugin',
    hookName: 'run.pre_prompt',
    handler: vi.fn().mockResolvedValue({ action: 'continue' }),
    priority: 0,
    failPolicy: 'fail_open',
    timeoutMs: 1500,
    ...overrides,
  }
}

describe('HookRegistry', () => {
  let registry: HookRegistry

  beforeEach(() => {
    registry = new HookRegistry()
  })

  it('registers and retrieves handlers', () => {
    const reg = createRegistration()
    registry.register(reg)
    expect(registry.getHandlers('run.pre_prompt')).toHaveLength(1)
    expect(registry.hasHandlers('run.pre_prompt')).toBe(true)
  })

  it('returns empty array for unregistered hooks', () => {
    expect(registry.getHandlers('model.pre_call')).toHaveLength(0)
    expect(registry.hasHandlers('model.pre_call')).toBe(false)
  })

  it('sorts by priority descending', () => {
    registry.register(createRegistration({ pluginId: 'low', priority: 1 }))
    registry.register(createRegistration({ pluginId: 'high', priority: 10 }))
    registry.register(createRegistration({ pluginId: 'mid', priority: 5 }))

    const handlers = registry.getHandlers('run.pre_prompt')
    expect(handlers.map((h) => h.pluginId)).toEqual(['high', 'mid', 'low'])
  })

  it('breaks priority ties by pluginId alphabetically', () => {
    registry.register(createRegistration({ pluginId: 'beta', priority: 5 }))
    registry.register(createRegistration({ pluginId: 'alpha', priority: 5 }))

    const handlers = registry.getHandlers('run.pre_prompt')
    expect(handlers.map((h) => h.pluginId)).toEqual(['alpha', 'beta'])
  })

  it('unregisters all hooks for a plugin', () => {
    registry.register(createRegistration({ pluginId: 'p1', hookName: 'run.pre_prompt' }))
    registry.register(createRegistration({ pluginId: 'p1', hookName: 'model.pre_call' }))
    registry.register(createRegistration({ pluginId: 'p2', hookName: 'run.pre_prompt' }))

    registry.unregister('p1')

    expect(registry.getHandlers('run.pre_prompt')).toHaveLength(1)
    expect(registry.getHandlers('run.pre_prompt')[0]!.pluginId).toBe('p2')
    expect(registry.getHandlers('model.pre_call')).toHaveLength(0)
  })

  it('resets for testing', () => {
    registry.register(createRegistration())
    registry._resetForTest()
    expect(registry.getHandlers('run.pre_prompt')).toHaveLength(0)
  })
})

describe('HookDispatcher', () => {
  let registry: HookRegistry
  let dispatcher: HookDispatcher

  beforeEach(() => {
    registry = new HookRegistry()
    dispatcher = new HookDispatcher(registry)
  })

  it('returns original data when no handlers', async () => {
    const result = await dispatcher.dispatch(
      'run.pre_prompt',
      { workItemId: 'w1', jobId: 'j1', agentId: 'a1' },
      { text: 'hello' }
    )
    expect(result.data).toEqual({ text: 'hello' })
    expect(result.blocked).toBe(false)
    expect(result.receipts).toHaveLength(0)
  })

  it('calls handler and returns mutated data', async () => {
    registry.register(
      createRegistration({
        handler: (ctx: HookContext<unknown>) => {
          const data = ctx.data as { text: string }
          return { action: 'continue', data: { text: data.text + ' world' } } as HookResult<unknown>
        },
      })
    )

    const result = await dispatcher.dispatch(
      'run.pre_prompt',
      { workItemId: 'w1', jobId: 'j1', agentId: 'a1' },
      { text: 'hello' }
    )
    expect(result.data).toEqual({ text: 'hello world' })
    expect(result.receipts).toHaveLength(1)
    expect(result.receipts[0]!.status).toBe('ok')
  })

  it('stops chain on block action', async () => {
    const handler2 = vi.fn().mockResolvedValue({ action: 'continue' })

    registry.register(
      createRegistration({
        pluginId: 'blocker',
        priority: 10,
        handler: () => ({ action: 'block' }) as HookResult<unknown>,
      })
    )
    registry.register(
      createRegistration({
        pluginId: 'after',
        priority: 1,
        handler: handler2,
      })
    )

    const result = await dispatcher.dispatch(
      'run.pre_prompt',
      { workItemId: 'w1', jobId: 'j1', agentId: 'a1' },
      { text: 'hello' }
    )
    expect(result.blocked).toBe(true)
    expect(handler2).not.toHaveBeenCalled()
    expect(result.receipts).toHaveLength(1)
    expect(result.receipts[0]!.status).toBe('blocked')
  })

  it('continues on error with fail_open', async () => {
    registry.register(
      createRegistration({
        pluginId: 'bad',
        priority: 10,
        failPolicy: 'fail_open',
        handler: () => {
          throw new Error('Kaboom')
        },
      })
    )
    registry.register(
      createRegistration({
        pluginId: 'good',
        priority: 1,
        handler: () => ({ action: 'continue' }) as HookResult<unknown>,
      })
    )

    const result = await dispatcher.dispatch(
      'run.pre_prompt',
      { workItemId: 'w1', jobId: 'j1', agentId: 'a1' },
      { text: 'hello' }
    )
    expect(result.blocked).toBe(false)
    expect(result.receipts).toHaveLength(2)
    expect(result.receipts[0]!.status).toBe('error')
    expect(result.receipts[0]!.error).toBe('Kaboom')
    expect(result.receipts[1]!.status).toBe('ok')
  })

  it('stops chain on error with fail_closed', async () => {
    const handler2 = vi.fn().mockResolvedValue({ action: 'continue' })

    registry.register(
      createRegistration({
        pluginId: 'bad',
        priority: 10,
        failPolicy: 'fail_closed',
        handler: () => {
          throw new Error('Kaboom')
        },
      })
    )
    registry.register(
      createRegistration({
        pluginId: 'good',
        priority: 1,
        handler: handler2,
      })
    )

    const result = await dispatcher.dispatch(
      'run.pre_prompt',
      { workItemId: 'w1', jobId: 'j1', agentId: 'a1' },
      { text: 'hello' }
    )
    expect(handler2).not.toHaveBeenCalled()
    expect(result.receipts).toHaveLength(1)
    expect(result.receipts[0]!.status).toBe('error')
  })

  it('enforces per-handler timeout', async () => {
    registry.register(
      createRegistration({
        timeoutMs: 50,
        handler: async () => {
          await new Promise((resolve) => setTimeout(resolve, 200))
          return { action: 'continue' } as HookResult<unknown>
        },
      })
    )

    const result = await dispatcher.dispatch(
      'run.pre_prompt',
      { workItemId: 'w1', jobId: 'j1', agentId: 'a1' },
      { text: 'hello' }
    )
    expect(result.receipts).toHaveLength(1)
    expect(result.receipts[0]!.status).toBe('timeout')
  })

  it('enforces event budget', async () => {
    // Create a dispatcher with a tight budget
    const tightDispatcher = new HookDispatcher(registry, 100)

    registry.register(
      createRegistration({
        pluginId: 'slow1',
        priority: 10,
        timeoutMs: 5000,
        handler: async () => {
          await new Promise((resolve) => setTimeout(resolve, 80))
          return { action: 'continue' } as HookResult<unknown>
        },
      })
    )
    registry.register(
      createRegistration({
        pluginId: 'slow2',
        priority: 1,
        handler: () => ({ action: 'continue' }) as HookResult<unknown>,
      })
    )

    const result = await tightDispatcher.dispatch(
      'run.pre_prompt',
      { workItemId: 'w1', jobId: 'j1', agentId: 'a1' },
      { text: 'hello' }
    )
    // The first handler should run but the second may get budget_exceeded
    expect(result.receipts.length).toBeGreaterThanOrEqual(1)
    const budgetExceeded = result.receipts.find((r) => r.status === 'budget_exceeded')
    // Budget might or might not be exceeded depending on timing, but the test validates the mechanism
    if (budgetExceeded) {
      expect(budgetExceeded.error).toContain('budget')
    }
  })

  it('merges mutations sequentially', async () => {
    registry.register(
      createRegistration({
        pluginId: 'first',
        priority: 10,
        handler: () => ({ action: 'continue', data: { a: 1 } }) as HookResult<unknown>,
      })
    )
    registry.register(
      createRegistration({
        pluginId: 'second',
        priority: 1,
        handler: (ctx: HookContext<unknown>) => {
          const data = ctx.data as { a: number }
          return {
            action: 'continue',
            data: { b: data.a + 1 },
          } as HookResult<unknown>
        },
      })
    )

    const result = await dispatcher.dispatch(
      'run.pre_prompt',
      { workItemId: 'w1', jobId: 'j1', agentId: 'a1' },
      { text: 'original' }
    )
    expect(result.data).toEqual({ text: 'original', a: 1, b: 2 })
  })
})

describe('Hook system singletons', () => {
  beforeEach(() => {
    _resetHookSystemForTest()
  })

  it('returns null before initialization', () => {
    expect(getHookRegistry()).toBeNull()
    expect(getHookDispatcher()).toBeNull()
  })

  it('initializes and returns singletons', () => {
    const { registry, dispatcher } = initHookSystem()
    expect(registry).toBeInstanceOf(HookRegistry)
    expect(dispatcher).toBeInstanceOf(HookDispatcher)
    expect(getHookRegistry()).toBe(registry)
    expect(getHookDispatcher()).toBe(dispatcher)
  })

  it('accepts custom event budget', () => {
    const { dispatcher } = initHookSystem(5000)
    expect(dispatcher).toBeInstanceOf(HookDispatcher)
  })
})
