import { describe, expect, it } from 'vitest'
import {
  buildSessionCommand,
  createOneShotHandler,
  extractPartialOutputAfterStartMarker,
  sanitizeSessionOutput,
} from '../src/session'

describe('buildSessionCommand', () => {
  it('returns original command when cwd is not provided', () => {
    expect(buildSessionCommand('pwd')).toBe('pwd')
    expect(buildSessionCommand('pwd', '')).toBe('pwd')
    expect(buildSessionCommand('pwd', '   ')).toBe('pwd')
  })

  it('prefixes command with cd when cwd is provided', () => {
    const result = buildSessionCommand('pnpm test', '/home/sprite/repos/nitejar/nitejar')
    expect(result).toBe("cd '/home/sprite/repos/nitejar/nitejar' || exit 1\npnpm test")
  })

  it('shell-quotes cwd paths with single quotes', () => {
    const result = buildSessionCommand('pwd', "/tmp/it's-folder")
    expect(result).toBe("cd '/tmp/it'\\''s-folder' || exit 1\npwd")
  })
})

describe('createOneShotHandler', () => {
  it('only invokes the wrapped handler once', () => {
    let calls = 0
    let lastValue = 0

    const handler = createOneShotHandler((value: number) => {
      calls += 1
      lastValue = value
    })

    handler(1)
    handler(2)
    handler(3)

    expect(calls).toBe(1)
    expect(lastValue).toBe(1)
  })
})

describe('sanitizeSessionOutput', () => {
  it('removes prompt echo artifacts and marker echo lines', () => {
    const endMarker = '__SLOPBOT_EXIT_123__'
    const raw = [
      'sprite@sprite:~$ <f [ -f ~/.nitejar/env ]; then . ~/.nitejar/env; fi',
      `sprite@sprite:~$ echo hello; echo "${endMarker}$?"`,
      'hello',
    ].join('\n')

    expect(sanitizeSessionOutput(raw, endMarker)).toBe('hello')
  })

  it('removes common terminal escape/control fragments', () => {
    const endMarker = '__SLOPBOT_EXIT_123__'
    const raw = '\u001b]11;?\u001b\\\\[6n\u001b[?25l[Kvisible'

    expect(sanitizeSessionOutput(raw, endMarker)).toBe('visible')
  })

  it('preserves normal multiline output', () => {
    const endMarker = '__SLOPBOT_EXIT_123__'
    const raw = ['line1', '', 'line3'].join('\n')

    expect(sanitizeSessionOutput(raw, endMarker)).toBe('line1\n\nline3')
  })
})

describe('extractPartialOutputAfterStartMarker', () => {
  const startMarker = '__SLOPBOT_START_123__'
  const endMarker = '__SLOPBOT_EXIT_123__'

  it('returns only output after the current start marker', () => {
    const raw = [
      '__SLOPBOT_START_122__',
      'old output',
      '__SLOPBOT_EXIT_122__0',
      startMarker,
      'current output',
    ].join('\n')

    expect(extractPartialOutputAfterStartMarker(raw, startMarker, endMarker)).toBe('current output')
  })

  it('returns empty output when current start marker is missing', () => {
    const raw = ['__SLOPBOT_START_122__', 'old output', '__SLOPBOT_EXIT_122__0'].join('\n')

    expect(extractPartialOutputAfterStartMarker(raw, startMarker, endMarker)).toBe('')
  })

  it('handles CRLF marker delimiters', () => {
    const raw = `${startMarker}\r\ncurrent output`

    expect(extractPartialOutputAfterStartMarker(raw, startMarker, endMarker)).toBe('current output')
  })
})
