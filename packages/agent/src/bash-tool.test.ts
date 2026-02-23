import { describe, expect, it, vi, beforeEach } from 'vitest'
import { executeTool, formatExecResultWithCwd, CWD_MARKER, type ToolContext } from './tools'
import * as Sprites from '@nitejar/sprites'

vi.mock('@nitejar/sprites', async () => {
  const actual = await vi.importActual<typeof Sprites>('@nitejar/sprites')
  return {
    ...actual,
    spriteExec: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    listDir: vi.fn(),
  }
})

const mockedSpriteExec = vi.mocked(Sprites.spriteExec)

beforeEach(() => {
  mockedSpriteExec.mockReset()
})

describe('bash tool', () => {
  it('sources nitejar env before running command', async () => {
    mockedSpriteExec.mockResolvedValue({
      exitCode: 0,
      stdout: `ok\n${CWD_MARKER}/home/sprite`,
      stderr: '',
      duration: 1,
    })

    const context: ToolContext = {
      spriteName: 'sprite-1',
      cwd: '/home/sprite',
    }

    const result = await executeTool('bash', { command: 'echo hello' }, context)

    expect(result.success).toBe(true)
    expect(mockedSpriteExec).toHaveBeenCalled()
    const command = mockedSpriteExec.mock.calls[0]?.[1] as string
    const options = mockedSpriteExec.mock.calls[0]?.[2]
    expect(command).toContain(
      'export CI=true DEBIAN_FRONTEND=noninteractive GIT_TERMINAL_PROMPT=0 NPM_CONFIG_YES=true'
    )
    expect(command).toContain('if [ -f ~/.nitejar/env ]')
    expect(command).toContain('echo hello')
    expect(options).toMatchObject({ cwd: '/home/sprite', session: undefined })
  })

  it('does not force default cwd when running in a session', async () => {
    mockedSpriteExec.mockResolvedValue({
      exitCode: 0,
      stdout: `ok\n${CWD_MARKER}/home/sprite`,
      stderr: '',
      duration: 1,
    })

    const context: ToolContext = {
      spriteName: 'sprite-1',
      cwd: '/home/sprite',
      session: {} as never,
    }

    const result = await executeTool('bash', { command: 'pwd' }, context)

    expect(result.success).toBe(true)
    expect(mockedSpriteExec).toHaveBeenCalled()
    const options = mockedSpriteExec.mock.calls[0]?.[2]
    expect(options).toMatchObject({ session: context.session })
    expect(options?.cwd).toBeUndefined()
  })

  it('passes explicit cwd through in session mode', async () => {
    mockedSpriteExec.mockResolvedValue({
      exitCode: 0,
      stdout: `ok\n${CWD_MARKER}/home/sprite/repos/nitejar/nitejar`,
      stderr: '',
      duration: 1,
    })

    const context: ToolContext = {
      spriteName: 'sprite-1',
      cwd: '/home/sprite',
      session: {} as never,
    }

    const result = await executeTool(
      'bash',
      { command: 'pnpm test', cwd: '/home/sprite/repos/nitejar/nitejar' },
      context
    )

    expect(result.success).toBe(true)
    expect(mockedSpriteExec).toHaveBeenCalled()
    const options = mockedSpriteExec.mock.calls[0]?.[2]
    expect(options).toMatchObject({
      session: context.session,
      cwd: '/home/sprite/repos/nitejar/nitejar',
    })
  })

  it('truncates oversized stdout in tool output', async () => {
    const hugeStdout = 'x'.repeat(50_000)
    mockedSpriteExec.mockResolvedValue({
      exitCode: 0,
      stdout: hugeStdout,
      stderr: '',
      duration: 5,
    })

    const context: ToolContext = {
      spriteName: 'sprite-1',
      cwd: '/home/sprite',
    }

    const result = await executeTool('bash', { command: 'cat huge.log' }, context)

    expect(result.success).toBe(true)
    expect(result.output).toContain('[stdout truncated: omitted')
    expect(result.output).toContain('exit code: 0')
    expect(result.output).toContain('duration: 5ms')
    expect(result.output?.length).toBeLessThan(45_000)
  })

  it('appends CWD capture suffix to every bash command', async () => {
    mockedSpriteExec.mockResolvedValue({
      exitCode: 0,
      stdout: `hello\n${CWD_MARKER}/tmp`,
      stderr: '',
      duration: 1,
    })

    const context: ToolContext = {
      spriteName: 'sprite-1',
      cwd: '/home/sprite',
    }

    await executeTool('bash', { command: 'echo hello' }, context)

    const command = mockedSpriteExec.mock.calls[0]?.[1] as string
    expect(command).toContain(CWD_MARKER)
    expect(command).toContain('__nitejar_ec=$?')
    expect(command).toContain('exit $__nitejar_ec')
  })
})

describe('formatExecResultWithCwd', () => {
  it('extracts cwd and strips marker from stdout', () => {
    const result = formatExecResultWithCwd({
      exitCode: 0,
      stdout: `hello world\n${CWD_MARKER}/home/sprite/project`,
      stderr: '',
      duration: 10,
    })

    expect(result.success).toBe(true)
    expect(result._meta?.cwd).toBe('/home/sprite/project')
    expect(result.output).toContain('hello world')
    expect(result.output).not.toContain(CWD_MARKER)
    expect(result.output).not.toContain('__SLOPBOT_CWD__')
  })

  it('preserves exit code from original command', () => {
    const result = formatExecResultWithCwd({
      exitCode: 1,
      stdout: `error output\n${CWD_MARKER}/tmp`,
      stderr: 'something failed',
      duration: 5,
    })

    expect(result.success).toBe(false)
    expect(result._meta?.cwd).toBe('/tmp')
    expect(result.output).toContain('exit code: 1')
    expect(result.error).toContain('exit code 1')
  })

  it('handles missing marker gracefully', () => {
    const result = formatExecResultWithCwd({
      exitCode: 0,
      stdout: 'just normal output',
      stderr: '',
      duration: 1,
    })

    expect(result.success).toBe(true)
    expect(result._meta).toBeUndefined()
    expect(result.output).toContain('just normal output')
  })

  it('handles empty stdout', () => {
    const result = formatExecResultWithCwd({
      exitCode: 0,
      stdout: '',
      stderr: '',
      duration: 1,
    })

    expect(result.success).toBe(true)
    expect(result._meta).toBeUndefined()
  })

  it('handles marker as only content in stdout', () => {
    const result = formatExecResultWithCwd({
      exitCode: 0,
      stdout: `${CWD_MARKER}/home/sprite`,
      stderr: '',
      duration: 1,
    })

    expect(result.success).toBe(true)
    expect(result._meta?.cwd).toBe('/home/sprite')
  })

  it('uses last marker when multiple appear', () => {
    const result = formatExecResultWithCwd({
      exitCode: 0,
      stdout: `${CWD_MARKER}/first\nsome output\n${CWD_MARKER}/second`,
      stderr: '',
      duration: 1,
    })

    expect(result._meta?.cwd).toBe('/second')
  })

  it('tags sessionError when stderr is "WebSocket error"', () => {
    const result = formatExecResultWithCwd({
      exitCode: 1,
      stdout: '',
      stderr: 'WebSocket error',
      duration: 800,
    })

    expect(result.success).toBe(false)
    expect(result._meta?.sessionError).toBe(true)
  })

  it('tags sessionError when stderr is "WebSocket keepalive timeout"', () => {
    const result = formatExecResultWithCwd({
      exitCode: 1,
      stdout: '',
      stderr: 'WebSocket keepalive timeout',
      duration: 60000,
    })

    expect(result.success).toBe(false)
    expect(result._meta?.sessionError).toBe(true)
  })

  it('tags sessionError when stderr is "Timeout connecting to session"', () => {
    const result = formatExecResultWithCwd({
      exitCode: 1,
      stdout: '',
      stderr: 'Timeout connecting to session',
      duration: 10000,
    })

    expect(result.success).toBe(false)
    expect(result._meta?.sessionError).toBe(true)
  })

  it('tags sessionError when stderr indicates missing start marker', () => {
    const result = formatExecResultWithCwd({
      exitCode: 124,
      stdout: '',
      stderr: 'Command timed out before start marker was observed',
      duration: 120000,
    })

    expect(result.success).toBe(false)
    expect(result._meta?.sessionError).toBe(true)
  })

  it('tags sessionInvalidated when stderr indicates timeout-triggered reset', () => {
    const result = formatExecResultWithCwd({
      exitCode: 124,
      stdout: '',
      stderr: 'Command timed out\nSession reset after timeout to avoid a wedged shell.',
      duration: 120000,
    })

    expect(result.success).toBe(false)
    expect(result._meta?.sessionInvalidated).toBe(true)
    expect(result._meta?.sessionError).toBeUndefined()
  })

  it('does not tag sessionInvalidated when timeout was recovered in-place', () => {
    const result = formatExecResultWithCwd({
      exitCode: 124,
      stdout: '',
      stderr: 'Command timed out\nSession recovered via interrupt after timeout.',
      duration: 120000,
    })

    expect(result.success).toBe(false)
    expect(result._meta?.sessionInvalidated).toBeUndefined()
    expect(result._meta?.sessionError).toBeUndefined()
  })

  it('tags sessionError when stderr is "Session is closed"', () => {
    const result = formatExecResultWithCwd({
      exitCode: 1,
      stdout: '',
      stderr: 'Session is closed',
      duration: 1,
    })

    expect(result.success).toBe(false)
    expect(result._meta?.sessionError).toBe(true)
  })

  it('does not tag sessionError for normal command failures', () => {
    const result = formatExecResultWithCwd({
      exitCode: 1,
      stdout: '',
      stderr: 'command not found: foo',
      duration: 10,
    })

    expect(result.success).toBe(false)
    expect(result._meta?.sessionError).toBeUndefined()
  })

  it('does not tag sessionError when output mentions websocket but stderr differs', () => {
    const result = formatExecResultWithCwd({
      exitCode: 1,
      stdout: 'WebSocket error in logs',
      stderr: 'some other error',
      duration: 10,
    })

    expect(result._meta?.sessionError).toBeUndefined()
  })
})
