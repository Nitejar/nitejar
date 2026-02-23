export interface GitHubEvent {
  eventName: string
  deliveryId: string
  payload: unknown
}

interface Headers {
  get(name: string): string | null
}

/**
 * Parses GitHub webhook event from request headers and body.
 *
 * @param headers - Request headers (must have a get method)
 * @param body - The parsed JSON body
 * @returns The parsed GitHub event
 */
export function parseGithubEvent(headers: Headers, body: unknown): GitHubEvent {
  const eventName = headers.get('x-github-event') ?? 'unknown'
  const deliveryId = headers.get('x-github-delivery') ?? 'unknown'

  return {
    eventName,
    deliveryId,
    payload: body,
  }
}
