import { describe, expect, it, vi } from 'vitest'
import {
  getConversationHistory,
  getThreadReplies,
  listConversations,
  searchConversationHistory,
} from './conversations'
import type { SlackApiInvoker } from './types'

describe('conversations helpers', () => {
  it('returns paged thread replies with cursor metadata', async () => {
    const invoke = vi.fn(async () => ({
      messages: [{ type: 'message', ts: '1.0', text: 'hello' }],
      has_more: true,
      response_metadata: { next_cursor: 'cursor-1' },
    })) as unknown as SlackApiInvoker

    const page = await getThreadReplies(invoke as unknown as SlackApiInvoker, 'C1', '1.0', {
      limit: 10,
      cursor: 'cursor-0',
    })

    expect(page.items).toHaveLength(1)
    expect(page.hasMore).toBe(true)
    expect(page.nextCursor).toBe('cursor-1')
  })

  it('returns paged channel history', async () => {
    const invoke = vi.fn(async () => ({
      messages: [{ type: 'message', ts: '1.0', text: 'status' }],
      has_more: false,
      response_metadata: { next_cursor: '' },
    })) as unknown as SlackApiInvoker

    const page = await getConversationHistory(invoke as unknown as SlackApiInvoker, 'C1', {
      limit: 5,
    })

    expect(page.items[0]?.text).toBe('status')
    expect(page.hasMore).toBe(false)
    expect(page.nextCursor).toBeUndefined()
  })

  it('returns paged channel list', async () => {
    const invoke = vi.fn(async () => ({
      channels: [{ id: 'C1', name: 'general' }],
      response_metadata: { next_cursor: 'cursor-2' },
    })) as unknown as SlackApiInvoker

    const page = await listConversations(invoke as unknown as SlackApiInvoker, {
      types: ['public_channel', 'private_channel'],
      limit: 20,
    })

    expect(page.items[0]?.id).toBe('C1')
    expect(page.nextCursor).toBe('cursor-2')
  })

  it('searches within a bounded history page', async () => {
    const invoke = vi.fn(async () => ({
      messages: [
        { type: 'message', ts: '1.0', text: 'prod deploy started' },
        { type: 'message', ts: '2.0', text: 'random chatter' },
        { type: 'message', ts: '3.0', text: 'prod deploy finished' },
      ],
      response_metadata: { next_cursor: 'cursor-3' },
    })) as unknown as SlackApiInvoker

    const page = await searchConversationHistory(
      invoke as unknown as SlackApiInvoker,
      'C1',
      'prod',
      { limit: 1 }
    )

    expect(page.items).toHaveLength(1)
    expect(page.matchedCount).toBe(2)
    expect(page.scannedCount).toBe(3)
    expect(page.hasMore).toBe(true)
    expect(page.nextCursor).toBe('cursor-3')
  })
})
