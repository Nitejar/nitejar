import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeTool, type ToolContext } from './tools'
import * as Database from '@nitejar/database'
import * as Sprites from '@nitejar/sprites'
import * as GitHubHandlers from '@nitejar/plugin-handlers/github'
import * as GitHubCredentialProviderModule from '@nitejar/plugin-handlers/github/credential-provider'

vi.mock('@nitejar/database', async () => {
  const actual = await vi.importActual<typeof Database>('@nitejar/database')
  return {
    ...actual,
    getDb: vi.fn(),
    assertAgentGrant: vi.fn(),
    resolveEffectivePolicy: vi.fn(),
    resolveEffectiveGitHubRepoCapabilities: vi.fn(),
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

vi.mock('@nitejar/plugin-handlers/github', async () => {
  const actual = await vi.importActual<typeof GitHubHandlers>('@nitejar/plugin-handlers/github')
  return {
    ...actual,
    getGitHubAppConfig: vi.fn(),
  }
})

vi.mock('@nitejar/plugin-handlers/github/credential-provider', async () => {
  const actual = await vi.importActual<typeof GitHubCredentialProviderModule>(
    '@nitejar/plugin-handlers/github/credential-provider'
  )
  return {
    ...actual,
    GitHubCredentialProvider: vi.fn(),
  }
})

const mockedGetDb = vi.mocked(Database.getDb)
const mockedResolveEffectivePolicy = vi.mocked(Database.resolveEffectivePolicy)
const mockedResolveEffectiveGitHubRepoCapabilities = vi.mocked(
  Database.resolveEffectiveGitHubRepoCapabilities
)
const mockedWriteFile = vi.mocked(Sprites.writeFile)
const mockedSpriteExec = vi.mocked(Sprites.spriteExec)
const mockedRefreshSpriteNetworkPolicy = vi.mocked(Sprites.refreshSpriteNetworkPolicy)
const mockedGetGitHubAppConfig = vi.mocked(GitHubHandlers.getGitHubAppConfig)
const mockedCredentialProvider = vi.mocked(GitHubCredentialProviderModule.GitHubCredentialProvider)

describe('configure_github_credentials tool', () => {
  beforeEach(() => {
    mockedWriteFile.mockReset()
    mockedSpriteExec.mockReset()
    mockedRefreshSpriteNetworkPolicy.mockReset()
    mockedGetGitHubAppConfig.mockReset()
    mockedCredentialProvider.mockReset()
    mockedResolveEffectivePolicy.mockReset()
    mockedResolveEffectiveGitHubRepoCapabilities.mockReset()

    mockedRefreshSpriteNetworkPolicy.mockResolvedValue({
      policy: { rules: [{ include: 'defaults' }] },
      source: 'existing',
    })
    mockedGetGitHubAppConfig.mockResolvedValue(null)
    mockedResolveEffectivePolicy.mockResolvedValue({
      roles: [],
      grants: [
        {
          action: 'github.repo.read',
          resourceType: '*',
          resourceId: null,
          sources: [],
        },
      ],
      defaults: [],
    })
  })

  it('writes env file and configures git helper', async () => {
    const repoRecord = {
      github_repo_id: 1,
      repo_id: 99,
      installation_id: 555,
      plugin_instance_id: 'github-int-1',
    }

    const repoSelectBuilder = {
      innerJoin: () => repoSelectBuilder,
      select: () => repoSelectBuilder,
      where: () => repoSelectBuilder,
      executeTakeFirst: vi.fn().mockResolvedValue(repoRecord),
      execute: vi.fn().mockResolvedValue([repoRecord]),
    }

    const insertBuilder = {
      values: vi.fn(() => ({
        execute: vi.fn().mockResolvedValue(undefined),
      })),
    }

    const mockDb = {
      selectFrom: vi.fn(() => repoSelectBuilder),
      insertInto: vi.fn(() => insertBuilder),
    }

    mockedGetDb.mockReturnValue(mockDb as never)
    mockedResolveEffectiveGitHubRepoCapabilities.mockResolvedValue(['read_repo'])

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
      expect.stringContaining('export GH_TOKEN=token-123'),
      { session: context.session }
    )
    expect(mockedWriteFile).toHaveBeenCalledWith(
      'sprite-1',
      '/home/sprite/.nitejar/env',
      expect.stringContaining('export GITHUB_TOKEN=token-123'),
      { session: context.session }
    )
    expect(mockedWriteFile).toHaveBeenCalledWith(
      'sprite-1',
      '/home/sprite/.nitejar/git-credential-helper',
      expect.stringContaining('#!/bin/sh\nif [ -z "$GH_TOKEN" ]; then'),
      { session: context.session }
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

    const repoSelectBuilder = {
      innerJoin: () => repoSelectBuilder,
      select: () => repoSelectBuilder,
      where: () => repoSelectBuilder,
      executeTakeFirst: vi.fn().mockResolvedValue(repoRecord),
      execute: vi.fn().mockResolvedValue([repoRecord]),
    }

    const insertBuilder = {
      values: vi.fn(() => ({
        execute: vi.fn().mockResolvedValue(undefined),
      })),
    }

    const mockDb = {
      selectFrom: vi.fn(() => repoSelectBuilder),
      insertInto: vi.fn(() => insertBuilder),
    }

    mockedGetDb.mockReturnValue(mockDb as never)
    mockedResolveEffectiveGitHubRepoCapabilities.mockResolvedValue(['read_repo'])
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

    const repoSelectBuilder = {
      innerJoin: () => repoSelectBuilder,
      select: () => repoSelectBuilder,
      where: () => repoSelectBuilder,
      executeTakeFirst: vi.fn().mockResolvedValue(repoRecord),
      execute: vi.fn().mockResolvedValue([repoRecord]),
    }

    const insertBuilder = {
      values: vi.fn(() => ({
        execute: vi.fn().mockResolvedValue(undefined),
      })),
    }

    const mockDb = {
      selectFrom: vi.fn(() => repoSelectBuilder),
      insertInto: vi.fn(() => insertBuilder),
    }

    mockedGetDb.mockReturnValue(mockDb as never)
    mockedResolveEffectiveGitHubRepoCapabilities.mockResolvedValue(['read_repo', 'open_pr'])
    mockedResolveEffectivePolicy.mockResolvedValue({
      roles: [],
      grants: [
        {
          action: 'github.repo.read',
          resourceType: '*',
          resourceId: null,
          sources: [],
        },
        {
          action: 'github.repo.open_pr',
          resourceType: '*',
          resourceId: null,
          sources: [],
        },
      ],
      defaults: [],
    })

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

    const repoSelectBuilder = {
      innerJoin: () => repoSelectBuilder,
      select: () => repoSelectBuilder,
      where: () => repoSelectBuilder,
      executeTakeFirst: vi.fn().mockResolvedValue(repoRecord),
      execute: vi.fn().mockResolvedValue([repoRecord]),
    }

    const insertBuilder = {
      values: vi.fn(() => ({
        execute: vi.fn().mockResolvedValue(undefined),
      })),
    }

    const mockDb = {
      selectFrom: vi.fn(() => repoSelectBuilder),
      insertInto: vi.fn(() => insertBuilder),
    }

    mockedGetDb.mockReturnValue(mockDb as never)
    mockedResolveEffectiveGitHubRepoCapabilities.mockResolvedValue(['read_repo'])

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

  it('strips higher-risk repo capabilities when matching policy grants are missing', async () => {
    const repoRecord = {
      github_repo_id: 1,
      repo_id: 99,
      installation_id: 555,
      plugin_instance_id: 'github-int-1',
    }

    const repoSelectBuilder = {
      innerJoin: () => repoSelectBuilder,
      select: () => repoSelectBuilder,
      where: () => repoSelectBuilder,
      executeTakeFirst: vi.fn().mockResolvedValue(repoRecord),
      execute: vi.fn().mockResolvedValue([repoRecord]),
    }

    const insertBuilder = {
      values: vi.fn(() => ({
        execute: vi.fn().mockResolvedValue(undefined),
      })),
    }

    mockedGetDb.mockReturnValue({
      selectFrom: vi.fn(() => repoSelectBuilder),
      insertInto: vi.fn(() => insertBuilder),
    } as never)
    mockedResolveEffectiveGitHubRepoCapabilities.mockResolvedValue(['read_repo', 'open_pr'])
    mockedResolveEffectivePolicy.mockResolvedValue({
      roles: [],
      grants: [
        {
          action: 'github.repo.read',
          resourceType: '*',
          resourceId: null,
          sources: [],
        },
      ],
      defaults: [],
    })
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

    const result = await executeTool(
      'configure_github_credentials',
      { repo_name: 'owner/repo' },
      {
        spriteName: 'sprite-1',
        cwd: '/home/sprite',
        session: {} as never,
        agentId: 'agent-1',
      }
    )

    expect(result.success).toBe(true)
    expect(getCredential).toHaveBeenCalledWith(
      expect.objectContaining({
        permissions: {
          contents: 'read',
        },
      })
    )
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
