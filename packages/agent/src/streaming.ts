import type { AgentEvent, AgentEventCallback } from './runner'

/**
 * In-memory buffer for streaming events
 * This allows clients to catch up on events they missed
 */
class EventBuffer {
  private events: Map<string, AgentEvent[]> = new Map()
  private maxEventsPerJob = 1000

  /**
   * Add an event to the buffer
   */
  add(jobId: string, event: AgentEvent): void {
    if (!this.events.has(jobId)) {
      this.events.set(jobId, [])
    }

    const jobEvents = this.events.get(jobId)!
    jobEvents.push(event)

    // Trim if too many events
    if (jobEvents.length > this.maxEventsPerJob) {
      jobEvents.shift()
    }
  }

  /**
   * Get all events for a job
   */
  get(jobId: string): AgentEvent[] {
    return this.events.get(jobId) ?? []
  }

  /**
   * Get events starting from an index
   */
  getFrom(jobId: string, startIndex: number): AgentEvent[] {
    const jobEvents = this.events.get(jobId) ?? []
    return jobEvents.slice(startIndex)
  }

  /**
   * Clear events for a job
   */
  clear(jobId: string): void {
    this.events.delete(jobId)
  }

  /**
   * Clear all events
   */
  clearAll(): void {
    this.events.clear()
  }
}

// Global event buffer
const eventBuffer = new EventBuffer()

/**
 * Subscribers for live events
 */
type EventSubscriber = (event: AgentEvent) => void
const subscribers: Map<string, Set<EventSubscriber>> = new Map()

/**
 * Subscribe to events for a job
 */
export function subscribeToJob(jobId: string, callback: EventSubscriber): () => void {
  if (!subscribers.has(jobId)) {
    subscribers.set(jobId, new Set())
  }

  subscribers.get(jobId)!.add(callback)

  // Return unsubscribe function
  return () => {
    const jobSubscribers = subscribers.get(jobId)
    if (jobSubscribers) {
      jobSubscribers.delete(callback)
      if (jobSubscribers.size === 0) {
        subscribers.delete(jobId)
      }
    }
  }
}

/**
 * Broadcast an event to all subscribers
 */
function broadcastEvent(jobId: string, event: AgentEvent): void {
  const jobSubscribers = subscribers.get(jobId)
  if (jobSubscribers) {
    for (const callback of jobSubscribers) {
      try {
        callback(event)
      } catch (error) {
        console.error('Error in event subscriber:', error)
      }
    }
  }
}

/**
 * Create a callback that buffers and broadcasts events
 */
export function createEventCallback(jobId: string): AgentEventCallback {
  return (event: AgentEvent) => {
    // Add to buffer
    eventBuffer.add(jobId, event)

    // Broadcast to subscribers
    broadcastEvent(jobId, event)
  }
}

/**
 * Get buffered events for a job
 */
export function getBufferedEvents(jobId: string, startIndex = 0): AgentEvent[] {
  return eventBuffer.getFrom(jobId, startIndex)
}

/**
 * Clear buffered events for a job
 */
export function clearBufferedEvents(jobId: string): void {
  eventBuffer.clear(jobId)
}

/**
 * Create an SSE stream for a job
 * Returns a ReadableStream that emits SSE-formatted events
 */
export function createSSEStream(jobId: string, startIndex = 0): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()

  return new ReadableStream({
    start(controller) {
      // Send any buffered events first
      const bufferedEvents = getBufferedEvents(jobId, startIndex)
      for (const event of bufferedEvents) {
        const data = `data: ${JSON.stringify(event)}\n\n`
        controller.enqueue(encoder.encode(data))
      }

      // Subscribe to new events
      const unsubscribe = subscribeToJob(jobId, (event) => {
        const data = `data: ${JSON.stringify(event)}\n\n`
        controller.enqueue(encoder.encode(data))

        // Close stream when job completes or fails
        if (event.type === 'job_completed' || event.type === 'job_failed') {
          controller.close()
          unsubscribe()
        }
      })

      // Handle stream cancellation
      return () => {
        unsubscribe()
      }
    },
  })
}

/**
 * Format an event for SSE
 */
export function formatSSEEvent(event: AgentEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`
}
