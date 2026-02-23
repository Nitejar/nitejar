import { createHmac, timingSafeEqual } from 'node:crypto'

export const SIGNUP_MARKER_HEADER = 'x-nitejar-signup-marker'

const MARKER_TTL_SECONDS = 120
const FALLBACK_SECRET = 'nitejar-dev-signup-secret'

type SignupPurpose = 'bootstrap' | 'invite'

function getMarkerSecret(): string {
  return process.env.BETTER_AUTH_SECRET ?? process.env.AUTH_SECRET ?? FALLBACK_SECRET
}

export function createSignupMarker(purpose: SignupPurpose): string {
  const timestamp = Math.floor(Date.now() / 1000)
  const payload = `${purpose}.${timestamp}`
  const signature = createHmac('sha256', getMarkerSecret()).update(payload).digest('hex')
  return `${purpose}.${timestamp}.${signature}`
}

export function verifySignupMarker(rawMarker: string | null | undefined): boolean {
  if (!rawMarker) return false

  const [purpose, rawTimestamp, signature] = rawMarker.split('.')
  if (!purpose || !rawTimestamp || !signature) return false
  if (purpose !== 'bootstrap' && purpose !== 'invite') return false

  const timestamp = Number(rawTimestamp)
  if (!Number.isFinite(timestamp)) return false

  const ageSeconds = Math.floor(Date.now() / 1000) - timestamp
  if (ageSeconds < 0 || ageSeconds > MARKER_TTL_SECONDS) return false

  const payload = `${purpose}.${rawTimestamp}`
  const expected = createHmac('sha256', getMarkerSecret()).update(payload).digest('hex')

  const providedBuf = Buffer.from(signature)
  const expectedBuf = Buffer.from(expected)
  if (providedBuf.length !== expectedBuf.length) return false

  return timingSafeEqual(providedBuf, expectedBuf)
}
