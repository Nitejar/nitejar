import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifySlackRequest } from './verify-request'

function sign(secret: string, timestamp: string, body: string): string {
  const base = `v0:${timestamp}:${body}`
  return `v0=${createHmac('sha256', secret).update(base).digest('hex')}`
}

describe('verifySlackRequest', () => {
  it('accepts a valid signature', () => {
    const secret = 'slack-secret'
    const body = JSON.stringify({ hello: 'world' })
    const timestamp = String(Math.floor(Date.now() / 1000))
    const signature = sign(secret, timestamp, body)

    expect(verifySlackRequest(body, signature, timestamp, secret)).toBe(true)
  })

  it('rejects a bad signature', () => {
    const secret = 'slack-secret'
    const body = JSON.stringify({ hello: 'world' })
    const timestamp = String(Math.floor(Date.now() / 1000))

    expect(verifySlackRequest(body, 'v0=bad', timestamp, secret)).toBe(false)
  })

  it('rejects stale timestamps', () => {
    const secret = 'slack-secret'
    const body = JSON.stringify({ hello: 'world' })
    const timestamp = String(Math.floor(Date.now() / 1000) - 3600)
    const signature = sign(secret, timestamp, body)

    expect(verifySlackRequest(body, signature, timestamp, secret)).toBe(false)
  })
})
