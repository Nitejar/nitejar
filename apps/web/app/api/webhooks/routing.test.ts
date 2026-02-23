import { describe, expect, it } from 'vitest'
import type { Agent } from '@nitejar/database'
import { filterOriginAgent, resolveOriginAgentId } from './routing'

function makeAgent(id: string, handle: string): Agent {
  const ts = Math.floor(Date.now() / 1000)
  return {
    id,
    handle,
    name: handle,
    sprite_id: null,
    config: null,
    status: 'idle',
    created_at: ts,
    updated_at: ts,
  }
}

describe('origin-agent routing helpers', () => {
  const agents = [makeAgent('a-1', 'slopper'), makeAgent('a-2', 'pixel')]

  it('resolves origin by explicit agentId when actor kind is agent', () => {
    const origin = resolveOriginAgentId(
      {
        kind: 'agent',
        agentId: 'a-2',
        handle: 'pixel',
      },
      agents
    )
    expect(origin).toBe('a-2')
  })

  it('resolves origin by handle (case-insensitive) when agentId is absent', () => {
    const origin = resolveOriginAgentId(
      {
        kind: 'agent',
        handle: 'SLOPPER',
      },
      agents
    )
    expect(origin).toBe('a-1')
  })

  it('does not resolve origin for non-agent actors', () => {
    const origin = resolveOriginAgentId(
      {
        kind: 'human',
        handle: 'slopper',
      },
      agents
    )
    expect(origin).toBeNull()
  })

  it('filters out origin agent when present', () => {
    const filtered = filterOriginAgent(agents, 'a-1')
    expect(filtered.map((agent) => agent.id)).toEqual(['a-2'])
  })
})
