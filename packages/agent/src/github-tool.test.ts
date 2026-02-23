import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeTool, type ToolContext } from './tools'
import * as Database from '@nitejar/database'
import * as Sprites from '@nitejar/sprites'
import * as Integrations from '@nitejar/plugin-handlers'

vi.mock('@nitejar/database', async () => {
  const actual = await vi.importActual<typeof Database>('@nitejar/database')
  return {
    ...actual,
    getDb: vi.fn(),
  }
})

vi.mock('@nitejar/sprites', async () => {
  const actual = await vi.importActual<typeof Sprites>('@nitejar/sprites')
  return {
    ...actual,
    spriteExec: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    listDir: vi.fn(),
    refreshSpriteNetworkPolicy: vi.fn(),
  }
})

vi.mock('@nitejar/plugin-handlers', async () => {
  const actual = await vi.importActual<typeof Integrations>('@nitejar/plugin-handlers')
  return {
    ...actual,
    GitHubCredentialProvider: vi.fn(),
    getGitHubAppConfig: vi.fn(),
  }
})

const mockedGetDb = vi.mocked(Database.getDb)
const mockedWriteFile = vi.mocked(Sprites.writeFile)
const mockedSpriteExec = vi.mocked(Sprites.spriteExec)
const mockedRefreshSpriteNetworkPolicy = vi.mocked(Sprites.refreshSpriteNetworkPolicy)
const mockedGetGitHubAppConfig = vi.mocked(Integrations.getGitHubAppConfig)
const mockedCredentialProvider = vi.mocked(Integrations.GitHubCredentialProvider)

describe('configure_github_credentials tool', () => {
  beforeEach(() => {
    mockedWriteFile.mockReset()
    mockedSpriteExec.mockReset()
    mockedRefreshSpriteNetworkPolicy.mockReset()
    mockedGetGitHubAppConfig.mockReset()
    mockedCredentialProvider.mockReset()

    mockedRefreshSpriteNetworkPolicy.mockResolvedValue({
      policy: { rules: [{ include: 'defaults' }] },
      source: 'existing',
    })
    mockedGetGitHubAppConfig.mockResolvedValue(null)
  })

  it('writes env file and configures git helper', async () => {
    const repoRecord = {
      github_repo_id: 1,
      repo_id: 99,
      installation_id: 555,
      plugin_instance_id: 'github-int-1',
    }

    const capabilityRecord = {
      capabilities: JSON.stringify(['read_repo']),
    }

    const repoSelectBuilder = {
      innerJoin: () => repoSelectBuilder,
      select: () => repoSelectBuilder,
      where: () => repoSelectBuilder,
      executeTakeFirst: vi.fn().mockResolvedValue(repoRecord),
      execute: vi.fn().mockResolvedValue([repoRecord]),
    }

    const capabilitySelectBuilder = {
      select: () => capabilitySelectBuilder,
      where: () => capabilitySelectBuilder,
      executeTakeFirst: vi.fn().mockResolvedValue(capabilityRecord),
    }

    const insertBuilder = {
      values: vi.fn(() => ({
        execute: vi.fn().mockResolvedValue(undefined),
      })),
    }

    const mockDb = {
      selectFrom: vi.fn((table: string) => {
        if (table === 'github_repos') return repoSelectBuilder
        if (table === 'agent_repo_capabilities') return capabilitySelectBuilder
        return repoSelectBuilder
      }),
      insertInto: vi.fn(() => insertBuilder),
    }

    mockedGetDb.mockReturnValue(mockDb as never)

    const getCredential = vi.fn().mockResolvedValue({
      token: 'token-123',
      expiresAt: new Date().toISOString(),
      scopes: [],
    })

    mockedCredentialProvider.mockImplementation(
      () =>
        ({
          getCredential,
        }) as never
    )

    mockedSpriteExec.mockResolvedValue({
      exitCode: 0,
      stdout: '',
      stderr: '',
      duration: 1,
    })

    const context: ToolContext = {
      spriteName: 'sprite-1',
      cwd: '/home/sprite',
      session: {} as never,
      agentId: 'agent-1',
    }

    const result = await executeTool(
      'configure_github_credentials',
      { repo_name: 'owner/repo', duration: 600 },
      context
    )

    expect(result.success).toBe(true)
    expect(result.output).toContain('Network policy: existing')
    expect(mockedWriteFile).toHaveBeenCalledWith(
      'sprite-1',
      '/home/sprite/.nitejar/env',
      expect.stringContaining('GH_TOKEN=token-123')
    )
    expect(mockedWriteFile).toHaveBeenCalledWith(
      'sprite-1',
      '/home/sprite/.nitejar/env',
      expect.not.stringContaining('\\n')
    )
    expect(mockedWriteFile).toHaveBeenCalledWith(
      'sprite-1',
      '/home/sprite/.nitejar/git-credential-helper',
      expect.stringContaining('#!/bin/sh\nif [ -z "$GH_TOKEN" ]; then')
    )

    const commandCalls = mockedSpriteExec.mock.calls.map((call) => call[1])
    expect(commandCalls.some((cmd) => cmd.includes('git config --global credential.helper'))).toBe(
      true
    )
  })

  it('returns actionable error details when token mint fails with scope mismatch', async () => {
    const repoRecord = {
      github_repo_id: 1,
      repo_id: 99,
      installation_id: 555,
      plugin_instance_id: 'github-int-1',
    }

    const capabilityRecord = {
      capabilities: JSON.stringify(['read_repo']),
    }

    const repoSelectBuilder = {
      innerJoin: () => repoSelectBuilder,
      select: () => repoSelectBuilder,
      where: () => repoSelectBuilder,
      executeTakeFirst: vi.fn().mockResolvedValue(repoRecord),
      execute: vi.fn().mockResolvedValue([repoRecord]),
    }

    const capabilitySelectBuilder = {
      select: () => capabilitySelectBuilder,
      where: () => capabilitySelectBuilder,
      executeTakeFirst: vi.fn().mockResolvedValue(capabilityRecord),
    }

    const insertBuilder = {
      values: vi.fn(() => ({
        execute: vi.fn().mockResolvedValue(undefined),
      })),
    }

    const mockDb = {
      selectFrom: vi.fn((table: string) => {
        if (table === 'github_repos') return repoSelectBuilder
        if (table === 'agent_repo_capabilities') return capabilitySelectBuilder
        return repoSelectBuilder
      }),
      insertInto: vi.fn(() => insertBuilder),
    }

    mockedGetDb.mockReturnValue(mockDb as never)
    mockedGetGitHubAppConfig.mockResolvedValue({
      permissions: {
        preset: 'minimal',
      },
    })

    mockedCredentialProvider.mockImplementation(
      () =>
        ({
          getCredential: vi
            .fn()
            .mockRejectedValue(
              new Error(
                'Failed to mint GitHub token (422): The permissions requested are not granted'
              )
            ),
        }) as never
    )

    const context: ToolContext = {
      spriteName: 'sprite-1',
      cwd: '/home/sprite',
      session: {} as never,
      agentId: 'agent-1',
    }

    const result = await executeTool(
      'configure_github_credentials',
      { repo_name: 'owner/repo', duration: 600 },
      context
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('lacks required scopes')
    expect(result.error).toContain('Current plugin instance preset: minimal')
  })

  it('requests checks/actions read access for PR-capable agents', async () => {
    const repoRecord = {
      github_repo_id: 1,
      repo_id: 99,
      installation_id: 555,
      plugin_instance_id: 'github-int-1',
    }

    const capabilityRecord = {
      capabilities: JSON.stringify(['read_repo', 'open_pr']),
    }

    const repoSelectBuilder = {
      innerJoin: () => repoSelectBuilder,
      select: () => repoSelectBuilder,
      where: () => repoSelectBuilder,
      executeTakeFirst: vi.fn().mockResolvedValue(repoRecord),
      execute: vi.fn().mockResolvedValue([repoRecord]),
    }

    const capabilitySelectBuilder = {
      select: () => capabilitySelectBuilder,
      where: () => capabilitySelectBuilder,
      executeTakeFirst: vi.fn().mockResolvedValue(capabilityRecord),
    }

    const insertBuilder = {
      values: vi.fn(() => ({
        execute: vi.fn().mockResolvedValue(undefined),
      })),
    }

    const mockDb = {
      selectFrom: vi.fn((table: string) => {
        if (table === 'github_repos') return repoSelectBuilder
        if (table === 'agent_repo_capabilities') return capabilitySelectBuilder
        return repoSelectBuilder
      }),
      insertInto: vi.fn(() => insertBuilder),
    }

    mockedGetDb.mockReturnValue(mockDb as never)

    const getCredential = vi.fn().mockResolvedValue({
      token: 'token-123',
      expiresAt: new Date().toISOString(),
      scopes: [],
    })

    mockedCredentialProvider.mockImplementation(
      () =>
        ({
          getCredential,
        }) as never
    )

    mockedSpriteExec.mockResolvedValue({
      exitCode: 0,
      stdout: '',
      stderr: '',
      duration: 1,
    })

    const context: ToolContext = {
      spriteName: 'sprite-1',
      cwd: '/home/sprite',
      session: {} as never,
      agentId: 'agent-1',
    }

    const result = await executeTool(
      'configure_github_credentials',
      { repo_name: 'owner/repo', duration: 600 },
      context
    )

    expect(result.success).toBe(true)
    expect(getCredential).toHaveBeenCalledWith(
      expect.objectContaining({
        permissions: {
          contents: 'read',
          pull_requests: 'write',
          checks: 'read',
          actions: 'read',
        },
      })
    )
  })

  it('tags missing session as a retryable session error', async () => {
    const repoRecord = {
      github_repo_id: 1,
      repo_id: 99,
      installation_id: 555,
      plugin_instance_id: 'github-int-1',
    }

    const capabilityRecord = {
      capabilities: JSON.stringify(['read_repo']),
    }

    const repoSelectBuilder = {
      innerJoin: () => repoSelectBuilder,
      select: () => repoSelectBuilder,
      where: () => repoSelectBuilder,
      executeTakeFirst: vi.fn().mockResolvedValue(repoRecord),
      execute: vi.fn().mockResolvedValue([repoRecord]),
    }

    const capabilitySelectBuilder = {
      select: () => capabilitySelectBuilder,
      where: () => capabilitySelectBuilder,
      executeTakeFirst: vi.fn().mockResolvedValue(capabilityRecord),
    }

    const insertBuilder = {
      values: vi.fn(() => ({
        execute: vi.fn().mockResolvedValue(undefined),
      })),
    }

    const mockDb = {
      selectFrom: vi.fn((table: string) => {
        if (table === 'github_repos') return repoSelectBuilder
        if (table === 'agent_repo_capabilities') return capabilitySelectBuilder
        return repoSelectBuilder
      }),
      insertInto: vi.fn(() => insertBuilder),
    }

    mockedGetDb.mockReturnValue(mockDb as never)

    const result = await executeTool(
      'configure_github_credentials',
      { repo_name: 'owner/repo' },
      {
        spriteName: 'sprite-1',
        cwd: '/home/sprite',
        agentId: 'agent-1',
      }
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('No active sprite session available')
    expect(result._meta?.sessionError).toBe(true)
  })
})

describe('refresh_network_policy tool', () => {
  it('refreshes policy with explicit preset', async () => {
    mockedRefreshSpriteNetworkPolicy.mockResolvedValue({
      policy: { rules: [{ include: 'defaults' }, { domain: '*', action: 'allow' }] },
      source: 'preset',
      preset: 'unrestricted',
    })

    const context: ToolContext = {
      spriteName: 'sprite-1',
      cwd: '/home/sprite',
      agentId: 'agent-1',
    }

    const result = await executeTool('refresh_network_policy', { preset: 'unrestricted' }, context)

    expect(result.success).toBe(true)
    expect(result.output).toContain('preset: unrestricted')
    expect(mockedRefreshSpriteNetworkPolicy).toHaveBeenCalledWith('sprite-1', {
      preset: 'unrestricted',
      fallbackPreset: 'development',
    })
  })
})
