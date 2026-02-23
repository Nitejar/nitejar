import { describe, it, expect, afterEach } from 'vitest'
import {
  encrypt,
  decrypt,
  isEncrypted,
  encryptConfig,
  decryptConfig,
  generateEncryptionKey,
} from '../src/encryption'

const ORIGINAL_KEY = process.env.ENCRYPTION_KEY

afterEach(() => {
  if (ORIGINAL_KEY === undefined) {
    delete process.env.ENCRYPTION_KEY
  } else {
    process.env.ENCRYPTION_KEY = ORIGINAL_KEY
  }
})

describe('encryption utilities', () => {
  it('returns plaintext when no key is set', () => {
    delete process.env.ENCRYPTION_KEY
    const result = encrypt('secret')
    expect(result).toBe('secret')
  })

  it('encrypts and decrypts round-trip with a valid key', () => {
    process.env.ENCRYPTION_KEY = generateEncryptionKey()

    const encrypted = encrypt('secret')
    expect(encrypted).not.toBe('secret')
    expect(encrypted.startsWith('enc:')).toBe(true)
    expect(isEncrypted(encrypted)).toBe(true)

    const decrypted = decrypt(encrypted)
    expect(decrypted).toBe('secret')
  })

  it('throws on decrypt when key is missing', () => {
    process.env.ENCRYPTION_KEY = generateEncryptionKey()
    const encrypted = encrypt('secret')

    delete process.env.ENCRYPTION_KEY
    expect(() => decrypt(encrypted)).toThrow('ENCRYPTION_KEY')
  })

  it('throws on invalid key length', () => {
    process.env.ENCRYPTION_KEY = 'short-key'
    expect(() => encrypt('secret')).toThrow('ENCRYPTION_KEY must be 32 bytes')
  })

  it('encryptConfig only encrypts sensitive fields', () => {
    process.env.ENCRYPTION_KEY = generateEncryptionKey()

    const alreadyEncrypted = encrypt('existing')
    const config = {
      apiKey: 'plain-secret',
      name: 'bot',
      token: alreadyEncrypted,
    }

    const result = encryptConfig(config, ['apiKey', 'token'])

    expect(result.apiKey).not.toBe('plain-secret')
    expect(isEncrypted(result.apiKey)).toBe(true)
    expect(result.name).toBe('bot')
    expect(result.token).toBe(alreadyEncrypted)
  })

  it('decryptConfig only decrypts encrypted fields', () => {
    process.env.ENCRYPTION_KEY = generateEncryptionKey()

    const encrypted = encrypt('plain-secret')
    const config = { apiKey: encrypted, name: 'bot' }

    const result = decryptConfig(config, ['apiKey'])

    expect(result.apiKey).toBe('plain-secret')
    expect(result.name).toBe('bot')
  })
})
