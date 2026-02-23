import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Verifies a GitHub webhook signature using HMAC SHA-256.
 *
 * @param body - The raw request body as a string
 * @param signature - The signature from the X-Hub-Signature-256 header
 * @param secret - The webhook secret configured in GitHub
 * @returns true if the signature is valid, false otherwise
 */
export function verifyGithubWebhook(body: string, signature: string, secret: string): boolean {
  if (!signature || !secret) {
    return false
  }

  const expectedSignature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`

  // Use timing-safe comparison to prevent timing attacks
  try {
    const sigBuffer = Buffer.from(signature)
    const expectedBuffer = Buffer.from(expectedSignature)

    if (sigBuffer.length !== expectedBuffer.length) {
      return false
    }

    return timingSafeEqual(sigBuffer, expectedBuffer)
  } catch {
    return false
  }
}
