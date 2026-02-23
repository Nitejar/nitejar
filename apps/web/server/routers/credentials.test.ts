import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@nitejar/database', () => ({
  createCredential: vi.fn(),
  deleteCredential: vi.fn(),
  findAgentById: vi.fn(),
  getCredentialById: vi.fn(),
  getCredentialUsageSummary: vi.fn(),
  isCredentialAliasAvailable: vi.fn(),
  listCredentialAssignments: vi.fn(),
  listCredentialsWithAgents: vi.fn(),
  setAgentCredentialAssignment: vi.fn(),
  updateCredential: vi.fn(),
}))

import {
  createCredential,
  deleteCredential,
  findAgentById,
  getCredentialById,
  getCredentialUsageSummary,
  isCredentialAliasAvailable,
  listCredentialAssignments,
  listCredentialsWithAgents,
  setAgentCredentialAssignment,
  updateCredential,
} from '@nitejar/database'
import { credentialsRouter } from './credentials'

const mockedCreateCredential = vi.mocked(createCredential)
const mockedDeleteCredential = vi.mocked(deleteCredential)
const mockedFindAgentById = vi.mocked(findAgentById)
const mockedGetCredentialById = vi.mocked(getCredentialById)
const mockedGetCredentialUsageSummary = vi.mocked(getCredentialUsageSummary)
const mockedIsCredentialAliasAvailable = vi.mocked(isCredentialAliasAvailable)
const mockedListCredentialAssignments = vi.mocked(listCredentialAssignments)
const mockedListCredentialsWithAgents = vi.mocked(listCredentialsWithAgents)
const mockedSetAgentCredentialAssignment = vi.mocked(setAgentCredentialAssignment)
const mockedUpdateCredential = vi.mocked(updateCredential)

const caller = credentialsRouter.createCaller({
  session: { user: { id: 'user-1' } } as never,
})

function makeCredentialView(overrides?: Record<string, unknown>) {
  return {
    id: 'cred-1',
    alias: 'instagram_graph_api',
    provider: 'instagram',
    allowedHosts: ['graph.facebook.com'],
    enabled: true,
    allowedInHeader: true,
    allowedInQuery: false,
    allowedInBody: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('credentials router', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates and lists credentials without exposing secret', async () => {
    mockedCreateCredential.mockResolvedValue(makeCredentialView())
    mockedListCredentialsWithAgents.mockResolvedValue([
      {
        ...makeCredentialView(),
        agents: [{ id: 'agent-1', name: 'Agent One' }],
        lastUsedAt: 100,
        lastStatus: 'success',
        totalCalls: 5,
      },
    ])

    const created = await caller.create({
      alias: 'instagram_graph_api',
      provider: 'instagram',
      secret: 'hidden-secret',
      allowedHosts: ['graph.facebook.com'],
      enabled: true,
      allowedInHeader: true,
    })

    expect(created.alias).toBe('instagram_graph_api')
    expect('secret' in created).toBe(false)
    expect(mockedCreateCredential).toHaveBeenCalledWith(
      expect.objectContaining({ secret: 'hidden-secret' })
    )

    const listed = await caller.list()
    expect(listed).toHaveLength(1)
    expect(listed[0]?.agents[0]?.id).toBe('agent-1')
    expect(listed[0]?.lastStatus).toBe('success')
    expect(listed[0]?.totalCalls).toBe(5)
  })

  it('updates credential fields and errors for missing credential', async () => {
    mockedUpdateCredential.mockResolvedValue(
      makeCredentialView({
        provider: 'instagram-v2',
        allowedInHeader: false,
        allowedInQuery: true,
        updatedAt: 2,
      })
    )

    const updated = await caller.update({
      credentialId: 'cred-1',
      provider: 'instagram-v2',
      allowedHosts: ['graph.facebook.com'],
      allowedInQuery: true,
    })
    expect(updated.provider).toBe('instagram-v2')
    expect(updated.alias).toBe('instagram_graph_api')

    mockedUpdateCredential.mockResolvedValueOnce(null)
    await expect(
      caller.update({
        credentialId: 'missing',
        provider: 'x',
      })
    ).rejects.toThrow('Credential not found')
  })

  it('handles delete and assignment validation', async () => {
    mockedDeleteCredential.mockResolvedValue(true)
    const deleted = await caller.delete({ credentialId: 'cred-1' })
    expect(deleted.ok).toBe(true)

    mockedDeleteCredential.mockResolvedValueOnce(false)
    await expect(caller.delete({ credentialId: 'missing' })).rejects.toThrow('Credential not found')

    mockedGetCredentialById.mockResolvedValue(makeCredentialView())
    mockedFindAgentById.mockResolvedValue({
      id: 'agent-1',
      handle: 'agent',
      name: 'Agent',
      sprite_id: null,
      config: null,
      status: 'idle',
      created_at: 1,
      updated_at: 1,
    })

    const assigned = await caller.setAgentAssignment({
      credentialId: 'cred-1',
      agentId: 'agent-1',
      enabled: true,
    })
    expect(assigned.ok).toBe(true)
    expect(mockedSetAgentCredentialAssignment).toHaveBeenCalled()
  })

  it('returns assignments list', async () => {
    mockedGetCredentialById.mockResolvedValue(makeCredentialView())
    mockedListCredentialAssignments.mockResolvedValue([
      {
        id: 'agent-1',
        handle: 'agent',
        name: 'Agent',
        sprite_id: null,
        config: null,
        status: 'idle',
        created_at: 1,
        updated_at: 1,
      },
    ])

    const assignments = await caller.listAssignments({ credentialId: 'cred-1' })
    expect(assignments).toEqual([{ id: 'agent-1', name: 'Agent' }])
  })

  it('checks alias availability for create and edit flows', async () => {
    mockedIsCredentialAliasAvailable.mockResolvedValueOnce(true).mockResolvedValueOnce(false)

    const available = await caller.checkAlias({ alias: 'instagram_graph_api' })
    expect(available.available).toBe(true)
    expect(mockedIsCredentialAliasAvailable).toHaveBeenNthCalledWith(
      1,
      'instagram_graph_api',
      undefined
    )

    const unavailable = await caller.checkAlias({
      alias: 'instagram_graph_api',
      excludeCredentialId: 'cred-1',
    })
    expect(unavailable.available).toBe(false)
    expect(mockedIsCredentialAliasAvailable).toHaveBeenNthCalledWith(
      2,
      'instagram_graph_api',
      'cred-1'
    )
  })

  it('returns usage summary and validates credential existence', async () => {
    mockedGetCredentialById.mockResolvedValue(makeCredentialView())
    mockedGetCredentialUsageSummary.mockResolvedValue({
      lastUsedAt: 123,
      lastStatus: 'success',
      successCount: 2,
      failCount: 1,
      deniedCount: 0,
      totalCalls: 3,
    })

    const usage = await caller.getUsageSummary({ credentialId: 'cred-1', windowSeconds: 3600 })
    expect(usage.lastStatus).toBe('success')
    expect(usage.totalCalls).toBe(3)
    expect(mockedGetCredentialUsageSummary).toHaveBeenCalledWith('cred-1', 3600)

    mockedGetCredentialById.mockResolvedValueOnce(null)
    await expect(caller.getUsageSummary({ credentialId: 'missing' })).rejects.toThrow(
      'Credential not found'
    )
  })
})
