import { describe, expect, it } from 'vitest'
import { markdownToTelegramHtml } from './format'

describe('markdownToTelegramHtml', () => {
  it('renders inline code without leaking internal placeholder tokens', () => {
    const html = markdownToTelegramHtml(
      'Committing the fix in `/home/sprite/repos/nitejar/nitejar`.'
    )

    expect(html).toContain('<code>/home/sprite/repos/nitejar/nitejar</code>')
    expect(html).not.toContain('SLOPBOT_INLINE_CODE')
  })

  it('renders code blocks and inline code together', () => {
    const html = markdownToTelegramHtml(
      [
        'Committing the fix:',
        '```bash',
        'git commit -m "Fix sort order"',
        '```',
        'Next step: push `main`.',
      ].join('\n')
    )

    expect(html).toContain(
      '<pre><code class="language-bash">git commit -m "Fix sort order"</code></pre>'
    )
    expect(html).toContain('<code>main</code>')
    expect(html).not.toContain('SLOPBOT_CODE_BLOCK')
    expect(html).not.toContain('SLOPBOT_INLINE_CODE')
  })

  it('preserves bold formatting while keeping inline code intact', () => {
    const html = markdownToTelegramHtml('**Summary:** cloned `apps/web` and updated `_app.ts`.')

    expect(html).toContain('<b>Summary:</b>')
    expect(html).toContain('<code>apps/web</code>')
    expect(html).toContain('<code>_app.ts</code>')
  })
})
