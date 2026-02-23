import { describe, it, expect } from 'vitest'
import { createHmac } from 'crypto'
import { verifyGithubWebhook, sessionKeyFromIssue, sourceRefFromComment } from '../src/index'

describe('sessionKeyFromIssue', () => {
  it('should create correct session key format', () => {
    const result = sessionKeyFromIssue({
      owner: 'myorg',
      repo: 'myrepo',
      issueNumber: 42,
    })

    expect(result).toBe('myorg/myrepo#issue:42')
  })

  it('should handle special characters in owner/repo', () => {
    const result = sessionKeyFromIssue({
      owner: 'my-org',
      repo: 'my-repo-123',
      issueNumber: 1,
    })

    expect(result).toBe('my-org/my-repo-123#issue:1')
  })
})

describe('sourceRefFromComment', () => {
  it('should create correct source ref format', () => {
    const result = sourceRefFromComment({
      owner: 'myorg',
      repo: 'myrepo',
      issueNumber: 42,
      commentId: 123456,
    })

    expect(result).toBe('myorg/myrepo#issue:42#comment:123456')
  })

  it('should handle special characters', () => {
    const result = sourceRefFromComment({
      owner: 'my-org',
      repo: 'my-repo-123',
      issueNumber: 999,
      commentId: 789,
    })

    expect(result).toBe('my-org/my-repo-123#issue:999#comment:789')
  })
})

describe('verifyGithubWebhook', () => {
  const secret = 'test-secret'

  function createSignature(body: string, secretKey: string): string {
    return `sha256=${createHmac('sha256', secretKey).update(body).digest('hex')}`
  }

  it('should return true for valid signature', () => {
    const body = '{"test":"data"}'
    const signature = createSignature(body, secret)

    expect(verifyGithubWebhook(body, signature, secret)).toBe(true)
  })

  it('should return false for invalid signature', () => {
    const body = '{"test":"data"}'
    const signature = 'sha256=invalidsignature'

    expect(verifyGithubWebhook(body, signature, secret)).toBe(false)
  })

  it('should return false for wrong secret', () => {
    const body = '{"test":"data"}'
    const signature = createSignature(body, 'wrong-secret')

    expect(verifyGithubWebhook(body, signature, secret)).toBe(false)
  })

  it('should return false for modified body', () => {
    const body = '{"test":"data"}'
    const signature = createSignature(body, secret)

    expect(verifyGithubWebhook('{"test":"modified"}', signature, secret)).toBe(false)
  })

  it('should return false for empty signature', () => {
    const body = '{"test":"data"}'

    expect(verifyGithubWebhook(body, '', secret)).toBe(false)
  })

  it('should return false for empty secret', () => {
    const body = '{"test":"data"}'
    const signature = createSignature(body, secret)

    expect(verifyGithubWebhook(body, signature, '')).toBe(false)
  })

  it('should be safe against timing attacks (different length signatures)', () => {
    const body = '{"test":"data"}'
    const shortSignature = 'sha256=abc'

    expect(verifyGithubWebhook(body, shortSignature, secret)).toBe(false)
  })
})
