import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Database from '@nitejar/database'
import * as WebSearch from './web-search'
import type { ToolContext } from './tools'
import { extractUrlTool, webSearchTool } from './tools/handlers/web'

vi.mock('@nitejar/database', async () => {
  const actual = await vi.importActual<typeof Database>('@nitejar/database')
  return {
    ...actual,
    assertAgentGrant: vi.fn(),
  }
})

vi.mock('./web-search', async () => {
  const actual = await vi.importActual<typeof WebSearch>('./web-search')
  return {
    ...actual,
    webSearch: vi.fn(),
    extractUrls: vi.fn(),
  }
})

const mockedAssertAgentGrant = vi.mocked(Database.assertAgentGrant)
const mockedWebSearch = vi.mocked(WebSearch.webSearch)
const mockedExtractUrls = vi.mocked(WebSearch.extractUrls)

const context: ToolContext = {
  agentId: 'agent-1',
  spriteName: 'nitejar-agent-1',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('web tools', () => {
  it('rejects web_search when capability.web_search is denied', async () => {
    mockedAssertAgentGrant.mockRejectedValue(new Error('missing capability.web_search'))

    await expect(webSearchTool({ query: 'nitejar' }, context)).rejects.toThrow(
      'capability.web_search'
    )
  })

  it('runs web_search when capability.web_search is granted', async () => {
    mockedAssertAgentGrant.mockResolvedValue(undefined)
    mockedWebSearch.mockResolvedValue({
      response: {
        query: 'nitejar',
        results: [{ title: 'Nitejar', url: 'https://nitejar.dev', content: 'hello', score: 0.9 }],
      } as never,
      creditsUsed: 1,
      costUsd: 0.0015,
      durationMs: 42,
    })

    const result = await webSearchTool({ query: 'nitejar' }, context)

    expect(result.success).toBe(true)
    expect(mockedAssertAgentGrant).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'capability.web_search' })
    )
    expect(result.output).toContain('Nitejar')
  })

  it('runs extract_url behind the same capability grant', async () => {
    mockedAssertAgentGrant.mockResolvedValue(undefined)
    mockedExtractUrls.mockResolvedValue({
      response: {
        results: [{ url: 'https://nitejar.dev', title: 'Nitejar', rawContent: 'hello' }],
        failedResults: [],
      } as never,
      creditsUsed: 1,
      costUsd: 0.0015,
      durationMs: 42,
    })

    const result = await extractUrlTool({ urls: ['https://nitejar.dev'] }, context)

    expect(result.success).toBe(true)
    expect(mockedAssertAgentGrant).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'capability.web_search' })
    )
  })
})
