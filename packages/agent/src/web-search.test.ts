import { describe, expect, it } from 'vitest'
import { formatSearchResults, formatExtractResults } from './web-search'
import type { WebSearchResult, ExtractUrlResult } from './web-search'

describe('web-search formatters', () => {
  describe('formatSearchResults', () => {
    it('formats multiple results with titles, URLs, and scores', () => {
      const result: WebSearchResult = {
        response: {
          query: 'vitest coverage',
          results: [
            {
              title: 'Vitest Docs',
              url: 'https://vitest.dev',
              content: 'Testing framework',
              score: 0.95,
              rawContent: '',
            },
            {
              title: 'Coverage Guide',
              url: 'https://example.com',
              content: 'How to coverage',
              score: 0.82,
              rawContent: '',
            },
          ],
          responseTime: 0.5,
        } as never,
        creditsUsed: 2,
        costUsd: 0.016,
        durationMs: 500,
      }

      const output = formatSearchResults(result)
      expect(output).toContain('Found 2 results for "vitest coverage"')
      expect(output).toContain('[1] "Vitest Docs" (score: 0.95)')
      expect(output).toContain('URL: https://vitest.dev')
      expect(output).toContain('Testing framework')
      expect(output).toContain('[2] "Coverage Guide" (score: 0.82)')
      expect(output).toContain('Search completed in 0.5s')
    })

    it('handles single result with correct pluralization', () => {
      const result: WebSearchResult = {
        response: {
          query: 'single',
          results: [
            {
              title: 'One',
              url: 'https://one.com',
              content: 'Only one',
              score: 0.9,
              rawContent: '',
            },
          ],
          responseTime: 0.2,
        } as never,
        creditsUsed: 2,
        costUsd: 0.016,
        durationMs: 200,
      }

      const output = formatSearchResults(result)
      expect(output).toContain('Found 1 result for "single"')
    })

    it('handles empty results', () => {
      const result: WebSearchResult = {
        response: {
          query: 'nothing',
          results: [],
          responseTime: 0.1,
        } as never,
        creditsUsed: 2,
        costUsd: 0.016,
        durationMs: 100,
      }

      const output = formatSearchResults(result)
      expect(output).toContain('No results found for "nothing"')
    })
  })

  describe('formatExtractResults', () => {
    it('formats extracted content from URLs', () => {
      const result: ExtractUrlResult = {
        response: {
          results: [
            { url: 'https://example.com', title: 'Example', rawContent: 'Page content here' },
          ],
          failedResults: [],
        } as never,
        creditsUsed: 1,
        costUsd: 0.008,
        durationMs: 300,
      }

      const output = formatExtractResults(result)
      expect(output).toContain('Extracted content from 1 URL')
      expect(output).toContain('--- Example ---')
      expect(output).toContain('URL: https://example.com')
      expect(output).toContain('Page content here')
      expect(output).toContain('Extraction completed in 0.3s')
    })

    it('includes failed results', () => {
      const result: ExtractUrlResult = {
        response: {
          results: [],
          failedResults: [{ url: 'https://broken.com', error: 'timeout' }],
        } as never,
        creditsUsed: 1,
        costUsd: 0.008,
        durationMs: 5000,
      }

      const output = formatExtractResults(result)
      expect(output).toContain('Failed to extract 1 URL')
      expect(output).toContain('https://broken.com: timeout')
    })

    it('handles both successes and failures', () => {
      const result: ExtractUrlResult = {
        response: {
          results: [{ url: 'https://good.com', title: 'Good', rawContent: 'content' }],
          failedResults: [{ url: 'https://bad.com', error: '404' }],
        } as never,
        creditsUsed: 2,
        costUsd: 0.016,
        durationMs: 1200,
      }

      const output = formatExtractResults(result)
      expect(output).toContain('Extracted content from 1 URL')
      expect(output).toContain('Failed to extract 1 URL')
      expect(output).toContain('Extraction completed in 1.2s')
    })
  })
})
