import type { Metadata } from 'next'

export const APP_NAME = 'Nitejar'
export const APP_DESCRIPTION = 'The operating system for AI agents doing real team workflows.'

const TITLE_OVERRIDES: Record<string, string> = {
  github: 'GitHub',
  telegram: 'Telegram',
  slack: 'Slack',
  discord: 'Discord',
  webhook: 'Webhook',
}

export function createPageMetadata(title: string): Metadata {
  return { title }
}

export function formatSegmentTitle(segment: string): string {
  const normalized = segment.trim().toLowerCase()
  if (!normalized) return segment
  if (TITLE_OVERRIDES[normalized]) return TITLE_OVERRIDES[normalized]

  return normalized
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function shortTitleId(value: string, length = 8): string {
  return value.slice(0, length)
}
