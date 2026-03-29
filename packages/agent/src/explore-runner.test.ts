import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as SpritesModule from '@nitejar/sprites'

vi.mock('@nitejar/sprites', async () => {
  const actual = await vi.importActual<typeof SpritesModule>('@nitejar/sprites')
  return {
    ...actual,
    listDir: vi.fn(),
    readFile: vi.fn(),
    spriteExec: vi.fn(),
  }
})

import { listDir, readFile, spriteExec } from '@nitejar/sprites'
import { __exploreRunnerTest, formatExploreSummary } from './explore-runner'

const mockedListDir = vi.mocked(listDir)
const mockedReadFile = vi.mocked(readFile)
const mockedSpriteExec = vi.mocked(spriteExec)

describe('formatExploreSummary', () => {
  it('appends encountered tool errors to a parsed explore summary', () => {
    const result = formatExploreSummary(
      JSON.stringify({
        answer: 'Auth lives in the web auth router.',
        keyFiles: [{ path: 'apps/web/server/auth.ts', why: 'entrypoint' }],
        evidence: ['The auth router exports the login handlers.'],
        openQuestions: ['SSO wiring still needs confirmation.'],
      }),
      [
        'explore_search_code: ripgrep (rg) is unavailable in this environment',
        'explore_git_diff: git diff failed with exit code 128',
      ]
    )

    expect(result).toContain('Answer: Auth lives in the web auth router.')
    expect(result).toContain('Errors encountered:')
    expect(result).toContain(
      '- explore_search_code: ripgrep (rg) is unavailable in this environment'
    )
    expect(result).toContain('- explore_git_diff: git diff failed with exit code 128')
  })

  it('appends encountered tool errors even when the model response is not JSON', () => {
    const result = formatExploreSummary('Answer: No structured JSON returned.', [
      'explore_git_status: not a git repository',
    ])

    expect(result).toContain('Answer: No structured JSON returned.')
    expect(result).toContain('Errors encountered:')
    expect(result).toContain('- explore_git_status: not a git repository')
  })

  it('falls back to raw text when parsed JSON sections are empty', () => {
    const result = formatExploreSummary(
      JSON.stringify({
        answer: '   ',
        keyFiles: [{ path: '   ', why: 'ignored' }],
        evidence: ['   '],
        openQuestions: ['   '],
      })
    )

    expect(result).toBe(
      '{"answer":"   ","keyFiles":[{"path":"   ","why":"ignored"}],"evidence":["   "],"openQuestions":["   "]}'
    )
  })
})

describe('__exploreRunnerTest.resolveExplorePath', () => {
  it('returns cwd when candidate is missing or blank', () => {
    expect(__exploreRunnerTest.resolveExplorePath('/repo', undefined)).toBe('/repo')
    expect(__exploreRunnerTest.resolveExplorePath('/repo', '   ')).toBe('/repo')
  })

  it('returns absolute paths untouched and resolves relative paths', () => {
    expect(__exploreRunnerTest.resolveExplorePath('/repo', '/tmp/file.ts')).toBe('/tmp/file.ts')
    expect(__exploreRunnerTest.resolveExplorePath('/repo', 'src/index.ts')).toBe(
      '/repo/src/index.ts'
    )
  })
})

describe('__exploreRunnerTest.buildWorkContextSummary', () => {
  it('includes ticket and goal metadata when present', () => {
    const summary = __exploreRunnerTest.buildWorkContextSummary({
      id: 'work-1',
      plugin_instance_id: null,
      session_key: 'session-1',
      source: 'manual',
      source_ref: 'manual:1',
      status: 'IN_PROGRESS',
      title: 'Explore issue',
      payload: JSON.stringify({
        body: 'Investigate auth flow',
        ticketId: 'ticket-1',
        ticketTitle: 'Auth regression',
        goalId: 'goal-1',
        goalTitle: 'Stabilize login',
      }),
      created_at: 1,
      updated_at: 1,
    })

    expect(summary).toContain('ticket: ticket-1 (Auth regression)')
    expect(summary).toContain('goal: goal-1 (Stabilize login)')
    expect(summary).toContain('payload_body: Investigate auth flow')
  })

  it('omits payload-specific lines when payload is absent or invalid', () => {
    const summary = __exploreRunnerTest.buildWorkContextSummary({
      id: 'work-1',
      plugin_instance_id: null,
      session_key: 'session-1',
      source: 'manual',
      source_ref: 'manual:1',
      status: 'IN_PROGRESS',
      title: 'Explore issue',
      payload: 'not-json',
      created_at: 1,
      updated_at: 1,
    })

    expect(summary).not.toContain('ticket:')
    expect(summary).not.toContain('goal:')
    expect(summary).not.toContain('payload_body:')
  })
})

describe('__exploreRunnerTest.collectGitStatus', () => {
  beforeEach(() => {
    mockedSpriteExec.mockReset()
  })

  it('returns a compact git receipt when stdout is present', async () => {
    mockedSpriteExec.mockResolvedValueOnce({
      stdout: 'branch: feature/test\n## feature/test\n M src/file.ts\n',
      stderr: '',
      exitCode: 0,
      duration: 1,
    })

    const result = await __exploreRunnerTest.collectGitStatus({
      spriteName: 'nitejar-scout',
      cwd: '/repo',
    })

    expect(result).toContain('branch: feature/test')
    expect(result).toContain('## feature/test')
  })

  it('falls back to unavailable when stdout is empty', async () => {
    mockedSpriteExec.mockResolvedValueOnce({
      stdout: '   ',
      stderr: '',
      exitCode: 0,
      duration: 1,
    })

    const result = await __exploreRunnerTest.collectGitStatus({
      spriteName: 'nitejar-scout',
      cwd: '/repo',
    })

    expect(result).toBe('branch: unavailable')
  })
})

describe('__exploreRunnerTest.executeExploreTool', () => {
  beforeEach(() => {
    mockedListDir.mockReset()
    mockedReadFile.mockReset()
    mockedSpriteExec.mockReset()
  })

  const execContext = {
    spriteName: 'nitejar-scout',
    cwd: '/repo',
  }

  it('lists directories', async () => {
    mockedListDir.mockResolvedValueOnce(['src', 'package.json'])

    const result = await __exploreRunnerTest.executeExploreTool(
      'explore_list_directory',
      { path: 'src' },
      execContext
    )

    expect(result).toEqual({
      success: true,
      output: 'Directory: /repo/src\nsrc\npackage.json',
    })
  })

  it('reads files with formatted line numbers', async () => {
    mockedReadFile.mockResolvedValueOnce('first line\nsecond line')

    const result = await __exploreRunnerTest.executeExploreTool(
      'explore_read_file',
      { path: 'src/index.ts', start_line: 2, max_lines: 1 },
      execContext
    )

    expect(result.success).toBe(true)
    expect(result.output).toContain('File: /repo/src/index.ts')
    expect(result.output).toContain('2: second line')
  })

  it('returns an error when search query is missing', async () => {
    const result = await __exploreRunnerTest.executeExploreTool(
      'explore_search_code',
      {},
      execContext
    )

    expect(result).toEqual({ success: false, error: 'query is required' })
  })

  it('returns search results when ripgrep succeeds', async () => {
    mockedSpriteExec.mockResolvedValueOnce({
      stdout: '/repo/src/index.ts:10:1:const auth = true',
      stderr: '',
      exitCode: 0,
      duration: 1,
    })

    const result = await __exploreRunnerTest.executeExploreTool(
      'explore_search_code',
      { query: 'auth', path: 'src', max_results: 5 },
      execContext
    )

    expect(result.success).toBe(true)
    expect(result.output).toContain('Search root: /repo/src')
    expect(result.output).toContain('const auth = true')
  })

  it('returns a no matches receipt when search exits with code 1', async () => {
    mockedSpriteExec.mockResolvedValueOnce({
      stdout: '',
      stderr: '',
      exitCode: 1,
      duration: 1,
    })

    const result = await __exploreRunnerTest.executeExploreTool(
      'explore_search_code',
      { query: 'auth' },
      execContext
    )

    expect(result).toEqual({
      success: true,
      output: 'Search root: /repo\n(no matches)',
    })
  })

  it('returns a hard failure when search exits non-1', async () => {
    mockedSpriteExec.mockResolvedValueOnce({
      stdout: '',
      stderr: 'ripgrep blew up',
      exitCode: 127,
      duration: 1,
    })

    const result = await __exploreRunnerTest.executeExploreTool(
      'explore_search_code',
      { query: 'auth' },
      execContext
    )

    expect(result).toEqual({
      success: false,
      error: 'ripgrep blew up',
    })
  })

  it('returns git status output', async () => {
    mockedSpriteExec.mockResolvedValueOnce({
      stdout: 'branch: feature/test\n## feature/test',
      stderr: '',
      exitCode: 0,
      duration: 1,
    })

    const result = await __exploreRunnerTest.executeExploreTool(
      'explore_git_status',
      {},
      execContext
    )

    expect(result).toEqual({
      success: true,
      output: 'branch: feature/test\n## feature/test',
    })
  })

  it('returns git diff output when present', async () => {
    mockedSpriteExec.mockResolvedValueOnce({
      stdout: 'stat:\n src/file.ts | 1 +\n\npatch:\n+added line',
      stderr: '',
      exitCode: 0,
      duration: 1,
    })

    const result = await __exploreRunnerTest.executeExploreTool(
      'explore_git_diff',
      { max_lines: 20 },
      execContext
    )

    expect(result).toEqual({
      success: true,
      output: 'stat:\n src/file.ts | 1 +\n\npatch:\n+added line',
    })
  })

  it('returns a no diff receipt when git diff is empty', async () => {
    mockedSpriteExec.mockResolvedValueOnce({
      stdout: '   ',
      stderr: '',
      exitCode: 0,
      duration: 1,
    })

    const result = await __exploreRunnerTest.executeExploreTool('explore_git_diff', {}, execContext)

    expect(result).toEqual({
      success: true,
      output: 'No uncommitted diff.',
    })
  })
})
