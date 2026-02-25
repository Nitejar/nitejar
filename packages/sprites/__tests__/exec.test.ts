import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  spriteExec,
  spriteExecHttp,
  spriteExecMultiple,
  spriteExecOnSprite,
  type ExecResult,
} from '../src/exec'
import { requireSpritesToken } from '../src/token-settings'

vi.mock('../src/token-settings', () => ({
  requireSpritesToken: vi.fn(),
}))

function okResponse(body: string): Response {
  return {
    ok: true,
    status: 200,
    text: vi.fn().mockResolvedValue(body),
  } as unknown as Response
}

function errorResponse(status: number, body: string): Response {
  return {
    ok: false,
    status,
    text: vi.fn().mockResolvedValue(body),
  } as unknown as Response
}

describe('exec', () => {
  const originalFetch = globalThis.fetch
  const mockedRequireSpritesToken = vi.mocked(requireSpritesToken)

  beforeEach(() => {
    vi.restoreAllMocks()
    mockedRequireSpritesToken.mockResolvedValue('test-token')
  })

  afterAll(() => {
    globalThis.fetch = originalFetch
  })

  it('uses session exec when session is provided', async () => {
    const result: ExecResult = {
      exitCode: 0,
      stdout: 'from-session',
      stderr: '',
      duration: 1,
    }
    const execMock = vi.fn().mockResolvedValue(result)
    const session = { exec: execMock } as Parameters<typeof spriteExec>[2] extends {
      session?: infer T
    }
      ? T
      : never

    const output = await spriteExec('sprite-1', 'pwd', { session })
    expect(output).toEqual(result)
    expect(execMock).toHaveBeenCalledWith('pwd', { session })
  })

  it('executes over HTTP and returns stdout on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('hello\n'))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const output = await spriteExecHttp('sprite one', 'echo hello', {
      cwd: '/tmp',
      env: { FOO: 'bar' },
      timeout: 1000,
    })

    expect(output.exitCode).toBe(0)
    expect(output.stdout).toBe('hello\n')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns exit code 1 on non-OK HTTP response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(500, 'boom'))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const output = await spriteExecHttp('sprite-1', 'ls')
    expect(output.exitCode).toBe(1)
    expect(output.stderr).toContain('HTTP 500: boom')
  })

  it('returns timeout exit code on AbortError', async () => {
    const abortError = new Error('aborted')
    abortError.name = 'AbortError'
    const fetchMock = vi.fn().mockRejectedValue(abortError)
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const output = await spriteExecHttp('sprite-1', 'sleep 10', { timeout: 1 })
    expect(output.exitCode).toBe(124)
    expect(output.stderr).toContain('timed out')
  })

  it('throws when sprites token is unavailable', async () => {
    mockedRequireSpritesToken.mockRejectedValue(new Error('Sprites API key not configured'))
    await expect(spriteExecHttp('sprite-1', 'ls')).rejects.toThrow('Sprites API key not configured')
  })

  it('stops spriteExecMultiple at first failure', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse('ok'))
      .mockResolvedValueOnce(errorResponse(400, 'bad command'))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const results = await spriteExecMultiple('sprite-1', ['echo ok', 'bad', 'echo later'])
    expect(results).toHaveLength(2)
    expect(results[0]?.exitCode).toBe(0)
    expect(results[1]?.exitCode).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('supports spriteExecOnSprite wrapper', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('wrapped'))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const output = await spriteExecOnSprite({ name: 'sprite-2' }, 'echo wrapped')
    expect(output.stdout).toBe('wrapped')
  })
})
