import { describe, expect, it } from 'vitest'
import { formatExploreSummary } from './explore-runner'

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
})
