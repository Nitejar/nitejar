import { createHmac, timingSafeEqual } from 'node:crypto'

const MAX_ALLOWED_DRIFT_SECONDS = 60 * 5

/**
 * Verify a Slack webhook request signature.
 */
export function verifySlackRequest(
  rawBody: string,
  signature: string,
  timestamp: string,
  signingSecret: string
): boolean {
  if (!rawBody || !signature || !timestamp || !signingSecret) {
    return false
  }

  const timestampSeconds = Number.parseInt(timestamp, 10)
  if (!Number.isFinite(timestampSeconds)) {
    return false
  }

  const nowSeconds = Math.floor(Date.now() / 1000)
  if (Math.abs(nowSeconds - timestampSeconds) > MAX_ALLOWED_DRIFT_SECONDS) {
    return false
  }

  const basestring = `v0:${timestamp}:${rawBody}`
  const digest = createHmac('sha256', signingSecret).update(basestring).digest('hex')
  const expectedSignature = `v0=${digest}`

  try {
    const left = Buffer.from(signature)
    const right = Buffer.from(expectedSignature)

    if (left.length !== right.length) {
      return false
    }

    return timingSafeEqual(left, right)
  } catch {
    return false
  }
}
