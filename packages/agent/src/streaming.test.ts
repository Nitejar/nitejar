import { describe, expect, it, vi } from 'vitest'
import {
  subscribeToJob,
  createEventCallback,
  getBufferedEvents,
  clearBufferedEvents,
  formatSSEEvent,
  createSSEStream,
} from './streaming'
import type { AgentEvent } from './runner'

describe('streaming', () => {
  describe('createEventCallback + getBufferedEvents', () => {
    it('buffers events and retrieves them', () => {
      const cb = createEventCallback('job-1')
      const event: AgentEvent = { type: 'job_started', jobId: 'job-1' }
      cb(event)

      const events = getBufferedEvents('job-1')
      expect(events).toHaveLength(1)
      expect(events[0]).toEqual(event)

      // Clean up
      clearBufferedEvents('job-1')
    })

    it('supports startIndex in getBufferedEvents', () => {
      const cb = createEventCallback('job-2')
      cb({ type: 'job_started', jobId: 'job-2' })
      cb({ type: 'thinking', content: 'hmm' })
      cb({ type: 'message', role: 'assistant', content: 'hello' })

      const from1 = getBufferedEvents('job-2', 1)
      expect(from1).toHaveLength(2)
      expect(from1[0]).toEqual({ type: 'thinking', content: 'hmm' })

      clearBufferedEvents('job-2')
    })

    it('returns empty array for unknown job', () => {
      expect(getBufferedEvents('nonexistent')).toEqual([])
    })
  })

  describe('clearBufferedEvents', () => {
    it('removes all buffered events for a job', () => {
      const cb = createEventCallback('job-3')
      cb({ type: 'job_started', jobId: 'job-3' })
      cb({ type: 'thinking', content: 'planning' })

      clearBufferedEvents('job-3')
      expect(getBufferedEvents('job-3')).toEqual([])
    })
  })

  describe('subscribeToJob', () => {
    it('delivers events to subscribers', () => {
      const received: AgentEvent[] = []
      const unsub = subscribeToJob('job-4', (e) => received.push(e))

      const cb = createEventCallback('job-4')
      cb({ type: 'job_started', jobId: 'job-4' })
      cb({ type: 'thinking', content: 'working' })

      expect(received).toHaveLength(2)
      expect(received[0]!.type).toBe('job_started')

      unsub()
      clearBufferedEvents('job-4')
    })

    it('unsubscribe stops delivery', () => {
      const received: AgentEvent[] = []
      const unsub = subscribeToJob('job-5', (e) => received.push(e))
      const cb = createEventCallback('job-5')

      cb({ type: 'job_started', jobId: 'job-5' })
      unsub()
      cb({ type: 'thinking', content: 'more' })

      expect(received).toHaveLength(1)
      clearBufferedEvents('job-5')
    })

    it('handles subscriber errors without breaking other subscribers', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const received: AgentEvent[] = []

      subscribeToJob('job-6', () => {
        throw new Error('boom')
      })
      const unsub2 = subscribeToJob('job-6', (e) => received.push(e))

      const cb = createEventCallback('job-6')
      cb({ type: 'job_started', jobId: 'job-6' })

      expect(received).toHaveLength(1)
      expect(spy).toHaveBeenCalled()

      unsub2()
      clearBufferedEvents('job-6')
      spy.mockRestore()
    })
  })

  describe('formatSSEEvent', () => {
    it('formats an event as SSE data line', () => {
      const event: AgentEvent = { type: 'message', role: 'assistant', content: 'hello' }
      const formatted = formatSSEEvent(event)
      expect(formatted).toBe(`data: ${JSON.stringify(event)}\n\n`)
    })
  })

  describe('createSSEStream', () => {
    it('produces a ReadableStream', () => {
      // Buffer some events first
      const cb = createEventCallback('job-sse')
      cb({ type: 'job_started', jobId: 'job-sse' })

      const stream = createSSEStream('job-sse')
      expect(stream).toBeInstanceOf(ReadableStream)

      clearBufferedEvents('job-sse')
    })
  })
})
