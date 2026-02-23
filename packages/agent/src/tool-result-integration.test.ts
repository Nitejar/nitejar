import { describe, expect, it } from 'vitest'
import { buildToolResultContent, truncateWithNotice } from './message-utils'

describe('tool result truncation integration', () => {
  it('applies truncateWithNotice to buildToolResultContent output', () => {
    const resultText = buildToolResultContent({
      success: true,
      output: 'x'.repeat(1000),
    })
    const compacted = truncateWithNotice(resultText, 200, 'tool output')

    expect(compacted).toContain('[tool output truncated: omitted')
  })

  it('truncates long tool output before model sees it', () => {
    const resultText = buildToolResultContent({
      success: true,
      output: 'a'.repeat(1500),
    })
    const compacted = truncateWithNotice(resultText, 220, 'tool result')

    expect(compacted.length).toBeLessThan(resultText.length)
    expect(compacted).toContain('[tool result truncated: omitted')
  })

  it('preserves head and tail around truncation notice', () => {
    const output = 'HEAD-' + 'x'.repeat(1000) + '-TAIL'
    const maxChars = 180
    const resultText = buildToolResultContent({ success: true, output })
    const compacted = truncateWithNotice(resultText, maxChars, 'tool output')

    const reserved = Math.min(240, Math.floor(maxChars * 0.35))
    const keep = Math.max(0, maxChars - reserved)
    const head = Math.max(0, Math.floor(keep * 0.75))
    const tail = Math.max(0, keep - head)

    expect(compacted.startsWith(resultText.slice(0, head))).toBe(true)
    expect(compacted.endsWith(resultText.slice(resultText.length - tail))).toBe(true)
  })

  it('passes short tool output through unchanged', () => {
    const resultText = buildToolResultContent({ success: true, output: 'done' })
    const compacted = truncateWithNotice(resultText, 200, 'tool output')

    expect(compacted).toBe('done')
  })

  it('also truncates very long error output', () => {
    const resultText = buildToolResultContent({
      success: false,
      output: 'partial output',
      error: 'E'.repeat(1200),
    })
    const compacted = truncateWithNotice(resultText, 240, 'tool error')

    expect(compacted).toContain('[tool error truncated: omitted')
    expect(compacted).toContain('partial output')
  })
})
