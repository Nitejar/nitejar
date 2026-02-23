import { describe, it, expect } from 'vitest'
import {
  createLineHashTag,
  formatFileContent,
  formatFileContentWithHashes,
  generateUnifiedDiff,
  sanitizeFileWriteContent,
} from './tools'

describe('formatFileContent', () => {
  it('formats content with line numbers', () => {
    const content = 'line one\nline two\nline three'
    const result = formatFileContent(content, 1, 500)

    expect(result).toBe('1: line one\n2: line two\n3: line three')
  })

  it('respects start_line offset', () => {
    const content = 'line one\nline two\nline three\nline four\nline five'
    const result = formatFileContent(content, 3, 500)

    expect(result).toContain('... [Lines 1-2 omitted]')
    expect(result).toContain('3: line three')
    expect(result).toContain('4: line four')
    expect(result).toContain('5: line five')
  })

  it('truncates at max_lines', () => {
    const content = 'line one\nline two\nline three\nline four\nline five'
    const result = formatFileContent(content, 1, 2)

    expect(result).toContain('1: line one')
    expect(result).toContain('2: line two')
    expect(result).toContain('... [Truncated. 3 more lines. File has 5 total lines]')
    expect(result).not.toContain('3: line three')
  })

  it('handles empty content', () => {
    const result = formatFileContent('', 1, 500)
    expect(result).toBe('1: ')
  })

  it('handles single line content', () => {
    const result = formatFileContent('hello world', 1, 500)
    expect(result).toBe('1: hello world')
  })

  it('handles start_line beyond file length', () => {
    const content = 'line one\nline two'
    const result = formatFileContent(content, 10, 500)

    // Should show the last line when start exceeds length
    expect(result).toContain('... [Lines 1-1 omitted]')
    expect(result).toContain('2: line two')
  })

  it('combines offset and truncation messages', () => {
    const content = 'one\ntwo\nthree\nfour\nfive\nsix\nseven'
    const result = formatFileContent(content, 3, 2)

    expect(result).toContain('... [Lines 1-2 omitted]')
    expect(result).toContain('3: three')
    expect(result).toContain('4: four')
    expect(result).toContain('... [Truncated. 3 more lines. File has 7 total lines]')
  })
})

describe('hashline formatting', () => {
  it('produces hashline output with line anchors', () => {
    const content = 'alpha\nbeta'
    const result = formatFileContentWithHashes(content, 1, 500)
    expect(result).toMatch(/^1:[a-z0-9]{3}\|alpha\n2:[a-z0-9]{3}\|beta$/)
  })

  it('creates deterministic line hash tags', () => {
    expect(createLineHashTag('const x = 1')).toBe(createLineHashTag('const x = 1'))
    expect(createLineHashTag('const x = 1')).not.toBe(createLineHashTag('const x = 2'))
  })
})

describe('generateUnifiedDiff', () => {
  it('generates a unified diff for changed content', () => {
    const oldContent = 'hello world'
    const newContent = 'hello nitejar'
    const diff = generateUnifiedDiff('test.txt', oldContent, newContent)

    expect(diff).toContain('--- test.txt')
    expect(diff).toContain('+++ test.txt')
    expect(diff).toContain('-hello world')
    expect(diff).toContain('+hello nitejar')
  })

  it('generates diff for multiline changes', () => {
    const oldContent = 'line 1\nline 2\nline 3'
    const newContent = 'line 1\nmodified line 2\nline 3'
    const diff = generateUnifiedDiff('file.ts', oldContent, newContent)

    expect(diff).toContain('-line 2')
    expect(diff).toContain('+modified line 2')
    expect(diff).toContain(' line 1') // Context line (unchanged)
    expect(diff).toContain(' line 3') // Context line (unchanged)
  })

  it('handles added lines', () => {
    const oldContent = 'line 1\nline 3'
    const newContent = 'line 1\nline 2\nline 3'
    const diff = generateUnifiedDiff('file.ts', oldContent, newContent)

    expect(diff).toContain('+line 2')
  })

  it('handles removed lines', () => {
    const oldContent = 'line 1\nline 2\nline 3'
    const newContent = 'line 1\nline 3'
    const diff = generateUnifiedDiff('file.ts', oldContent, newContent)

    expect(diff).toContain('-line 2')
  })

  it('shows no changes for identical content', () => {
    const content = 'same content'
    const diff = generateUnifiedDiff('file.ts', content, content)

    // Diff should exist but have no +/- lines (just headers)
    expect(diff).toContain('--- file.ts')
    expect(diff).not.toMatch(/^[-+][^-+]/m)
  })
})

describe('sanitizeFileWriteContent', () => {
  it('removes a leading SOH byte', () => {
    const result = sanitizeFileWriteContent('\u0001import { x } from "y"')
    expect(result.sanitizedContent).toBe('import { x } from "y"')
    expect(result.removedCount).toBe(1)
  })

  it('keeps tabs and newlines intact', () => {
    const source = 'line1\n\tline2\r\nline3'
    const result = sanitizeFileWriteContent(source)
    expect(result.sanitizedContent).toBe(source)
    expect(result.removedCount).toBe(0)
  })

  it('removes multiple unsupported control characters', () => {
    const result = sanitizeFileWriteContent('a\u0000b\u0007c\u007fd')
    expect(result.sanitizedContent).toBe('abcd')
    expect(result.removedCount).toBe(3)
  })
})
