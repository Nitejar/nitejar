import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getNetworkPolicyPreset,
  getSpriteNetworkPolicy,
  refreshSpriteNetworkPolicy,
  setSpriteNetworkPolicy,
  syncAgentNetworkPolicy,
} from '../src/policy'
import { getSprite } from '../src/client'

vi.mock('../src/client', () => ({
  getSprite: vi.fn(),
}))

const getSpriteMock = vi.mocked(getSprite)

type MockSprite = {
  getNetworkPolicy: ReturnType<typeof vi.fn>
  updateNetworkPolicy: ReturnType<typeof vi.fn>
}

function createMockSprite(initialRules: Array<Record<string, string>> = []): MockSprite {
  return {
    getNetworkPolicy: vi.fn().mockResolvedValue({ rules: initialRules }),
    updateNetworkPolicy: vi.fn().mockResolvedValue(undefined),
  }
}

beforeEach(() => {
  getSpriteMock.mockReset()
})

describe('policy helpers', () => {
  it('returns independent copies of presets', () => {
    const a = getNetworkPolicyPreset('development')
    const b = getNetworkPolicyPreset('development')

    a.rules.push({ domain: 'example.com', action: 'allow' })
    expect(b.rules.some((rule) => rule.domain === 'example.com')).toBe(false)
  })

  it('gets and sets sprite policy', async () => {
    const sprite = createMockSprite([{ domain: '*', action: 'allow' }])
    getSpriteMock.mockReturnValue(sprite as never)

    const policy = await getSpriteNetworkPolicy('sprite-1')
    expect(policy.rules).toHaveLength(1)

    await setSpriteNetworkPolicy('sprite-1', { rules: [{ domain: '*', action: 'deny' }] })
    expect(sprite.updateNetworkPolicy).toHaveBeenCalledWith({
      rules: [{ domain: '*', action: 'deny' }],
    })
  })

  it('refreshes existing non-empty policy when no preset is requested', async () => {
    const sprite = createMockSprite([{ domain: '*.github.com', action: 'allow' }])
    getSpriteMock.mockReturnValue(sprite as never)

    const result = await refreshSpriteNetworkPolicy('sprite-1')

    expect(result.source).toBe('existing')
    expect(sprite.updateNetworkPolicy).toHaveBeenCalledWith({
      rules: [{ domain: '*.github.com', action: 'allow' }],
    })
  })

  it('applies fallback preset when current policy is empty', async () => {
    const sprite = createMockSprite([])
    getSpriteMock.mockReturnValue(sprite as never)

    const result = await refreshSpriteNetworkPolicy('sprite-1')

    expect(result.source).toBe('fallback')
    expect(result.preset).toBe('development')
    expect(result.policy.rules.length).toBeGreaterThan(1)
  })

  it('applies explicit preset when requested', async () => {
    const sprite = createMockSprite([])
    getSpriteMock.mockReturnValue(sprite as never)

    const result = await refreshSpriteNetworkPolicy('sprite-1', { preset: 'github-only' })

    expect(result.source).toBe('preset')
    expect(result.preset).toBe('github-only')
    expect(result.policy.rules.some((rule) => rule.domain === 'api.github.com')).toBe(true)
    expect(result.policy.rules.at(-1)).toEqual({ domain: '*', action: 'deny' })
  })

  it('syncs policy to sprite when sprite exists', async () => {
    const sprite = createMockSprite([])
    getSpriteMock.mockReturnValue(sprite as never)

    const result = await syncAgentNetworkPolicy('sprite-1', {
      rules: [{ domain: '*', action: 'deny' }],
    })

    expect(result).toEqual({ synced: true })
    expect(sprite.updateNetworkPolicy).toHaveBeenCalledWith({
      rules: [{ domain: '*', action: 'deny' }],
    })
  })

  it('returns a sync error when sprite name is missing', async () => {
    const result = await syncAgentNetworkPolicy(null, {
      rules: [{ domain: '*', action: 'deny' }],
    })

    expect(result.synced).toBe(false)
    expect(result.error).toContain('No sprite assigned')
  })
})
