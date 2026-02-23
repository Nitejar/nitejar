import { createHash } from 'node:crypto'

export function createInviteToken(): string {
  return `${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
