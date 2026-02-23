import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GitHubCredentialProvider } from './credential-provider'
import { getGitHubAppConfig } from './config'
import { createAppAuth } from '@octokit/auth-app'

vi.mock('./config', () => ({
  getGitHubAppConfig: vi.fn(),
}))

vi.mock('@octokit/auth-app', () => ({
  createAppAuth: vi.fn(),
}))

type MockFetchResponse = {
  ok: boolean
  status?: number
  json?: () => Promise<unknown>
  text?: () => Promise<string>
}
type FetchMock = ReturnType<
  typeof vi.fn<(input: string, init?: RequestInit) => Promise<MockFetchResponse>>
>

const getGitHubAppConfigMock = vi.mocked(getGitHubAppConfig)
const createAppAuthMock = vi.mocked(createAppAuth)

let fetchMock: FetchMock

beforeEach(() => {
  fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<MockFetchResponse>>()
  vi.stubGlobal('fetch', fetchMock)
  getGitHubAppConfigMock.mockReset()
  createAppAuthMock.mockReset()
})

describe('GitHubCredentialProvider', () => {
  it('mints and caches tokens', async () => {
    getGitHubAppConfigMock.mockResolvedValue({
      appId: '123',
      privateKey: 'key',
      tokenTTL: 1800,
    })

    const authFn = vi.fn().mockResolvedValue({ token: 'app-token' })
    createAppAuthMock.mockReturnValue(authFn as unknown as ReturnType<typeof createAppAuth>)

    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token: 'inst-token', expires_at: expiresAt }),
    })

    const provider = new GitHubCredentialProvider({
      pluginInstanceId: 'integration-1',
      now: () => 1000,
    })

    const first = await provider.getCredential({
      installationId: 99,
      repositoryIds: [1],
    })

    const second = await provider.getCredential({
      installationId: 99,
      repositoryIds: [1],
    })

    expect(first.token).toBe('inst-token')
    expect(first.source).toBe('mint')
    expect(second.source).toBe('cache')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('calls GitHub API with app auth token', async () => {
    getGitHubAppConfigMock.mockResolvedValue({
      appId: '123',
      privateKey: 'key',
    })

    const authFn = vi.fn().mockResolvedValue({ token: 'app-token' })
    createAppAuthMock.mockReturnValue(authFn as unknown as ReturnType<typeof createAppAuth>)

    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token: 'inst-token' }),
    })

    const provider = new GitHubCredentialProvider({
      pluginInstanceId: 'integration-1',
      now: () => 1000,
    })

    await provider.getCredential({ installationId: 42 })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const call = fetchMock.mock.calls[0]
    expect(call).toBeDefined()
    if (!call) {
      throw new Error('Expected GitHub token request')
    }
    const [url, init] = call
    expect(url).toBe('https://api.github.com/app/installations/42/access_tokens')
    expect(init?.method).toBe('POST')
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer app-token',
    })
  })

  it('logs actionable metadata when token mint fails', async () => {
    getGitHubAppConfigMock.mockResolvedValue({
      appId: '123',
      privateKey: 'key',
      permissions: {
        preset: 'minimal',
      },
    })

    const authFn = vi.fn().mockResolvedValue({ token: 'app-token' })
    createAppAuthMock.mockReturnValue(authFn as unknown as ReturnType<typeof createAppAuth>)

    const errorBody = JSON.stringify({
      message: 'The permissions requested are not granted to this installation.',
      documentation_url:
        'https://docs.github.com/rest/reference/apps#create-an-installation-access-token-for-an-app',
      status: '422',
    })

    fetchMock.mockResolvedValue({
      ok: false,
      status: 422,
      text: () => Promise.resolve(errorBody),
    })

    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
    }

    const provider = new GitHubCredentialProvider({
      pluginInstanceId: 'integration-2',
      now: () => 1000,
      logger,
    })

    await expect(
      provider.getCredential({
        installationId: 99,
        repositoryIds: [1],
        permissions: { contents: 'read' },
      })
    ).rejects.toThrow('Failed to mint GitHub token (422)')

    expect(logger.warn).toHaveBeenCalledWith(
      '[github-token] Failed to mint token',
      expect.objectContaining({
        pluginInstanceId: 'integration-2',
        installationId: 99,
        repositoryIds: [1],
        requestedPermissions: { contents: 'read' },
        configuredPermissionPreset: 'minimal',
        status: 422,
        message: 'The permissions requested are not granted to this installation.',
      })
    )
  })
})
