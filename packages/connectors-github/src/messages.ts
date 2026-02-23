export interface AcknowledgmentParams {
  workItemId: string
  inboxUrl: string
}

/**
 * Builds an acknowledgment message to reply to a GitHub comment.
 */
export function buildAcknowledgmentMessage(params: AcknowledgmentParams): string {
  return `👋 Got it! I've created work item \`${params.workItemId}\`.

[View in inbox](${params.inboxUrl})`
}
