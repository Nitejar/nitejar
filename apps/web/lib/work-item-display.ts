export function isGenericDeferredWorkItemTitle(title: string | null | undefined): boolean {
  return title?.trim().toLowerCase() === 'scheduled: deferred'
}

export function getWorkItemSourceLabel(input: {
  source: string | null | undefined
  linkedTicketTitle?: string | null
  linkedGoalTitle?: string | null
}): string {
  if (input.source?.toLowerCase() === 'routine') {
    if (input.linkedTicketTitle) return 'ticket'
    if (input.linkedGoalTitle) return 'goal'
  }

  return input.source?.trim() || 'unknown'
}

export function getWorkItemDisplayTitle(input: {
  title: string | null | undefined
  linkedTicketTitle?: string | null
}): string {
  if (isGenericDeferredWorkItemTitle(input.title) && input.linkedTicketTitle) {
    return `Scheduled ticket: ${input.linkedTicketTitle}`
  }

  return input.title?.trim() || 'Untitled event'
}
