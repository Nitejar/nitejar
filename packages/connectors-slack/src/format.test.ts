import { describe, expect, it } from 'vitest'
import { markdownToSlackMrkdwn } from './format'

describe('markdownToSlackMrkdwn', () => {
  it('converts common markdown styles', () => {
    const output = markdownToSlackMrkdwn('**Bold** ~~Gone~~ [Docs](https://example.com)')
    expect(output).toContain('*Bold*')
    expect(output).toContain('~Gone~')
    expect(output).toContain('<https://example.com|Docs>')
  })

  it('keeps inline and block code blocks intact', () => {
    const output = markdownToSlackMrkdwn('Use `pnpm test`\n```bash\necho ok\n```')
    expect(output).toContain('`pnpm test`')
    expect(output).toContain('```bash\necho ok```')
  })
})
