import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ENCRYPTION_PREFIX = 'enc:'
const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16 // 128 bits
const AUTH_TAG_LENGTH = 16 // 128 bits

function getEncryptionKey(): Buffer | null {
  const key = process.env.ENCRYPTION_KEY
  if (!key) {
    return null
  }

  // Key should be 32 bytes (256 bits) for AES-256
  // Accept hex-encoded (64 chars) or base64-encoded (44 chars)
  if (key.length === 64) {
    return Buffer.from(key, 'hex')
  } else if (key.length === 44) {
    return Buffer.from(key, 'base64')
  } else if (key.length === 32) {
    return Buffer.from(key, 'utf8')
  }

  throw new Error('ENCRYPTION_KEY must be 32 bytes (as utf8), 44 chars (base64), or 64 chars (hex)')
}

let hasWarnedAboutMissingKey = false

/**
 * Encrypt a string value using AES-256-GCM
 * Returns a prefixed base64 string: "enc:base64(iv + authTag + ciphertext)"
 * If no encryption key is set, returns the plaintext with a warning (dev mode)
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey()
  if (!key) {
    if (!hasWarnedAboutMissingKey) {
      console.warn(
        '[SECURITY WARNING] ENCRYPTION_KEY not set - sensitive data will NOT be encrypted. Set ENCRYPTION_KEY in production!'
      )
      hasWarnedAboutMissingKey = true
    }
    return plaintext
  }

  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])

  const authTag = cipher.getAuthTag()

  // Combine: iv (16) + authTag (16) + ciphertext
  const combined = Buffer.concat([iv, authTag, encrypted])

  return ENCRYPTION_PREFIX + combined.toString('base64')
}

/**
 * Decrypt a value if it's encrypted (has "enc:" prefix)
 * Returns the original value if not encrypted
 */
export function decrypt(value: string): string {
  if (!value.startsWith(ENCRYPTION_PREFIX)) {
    return value
  }

  const key = getEncryptionKey()
  if (!key) {
    throw new Error('Cannot decrypt: ENCRYPTION_KEY environment variable is required')
  }
  const combined = Buffer.from(value.slice(ENCRYPTION_PREFIX.length), 'base64')

  const iv = combined.subarray(0, IV_LENGTH)
  const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
  const ciphertext = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH)

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])

  return decrypted.toString('utf8')
}

/**
 * Check if a value is encrypted
 */
export function isEncrypted(value: string): boolean {
  return value.startsWith(ENCRYPTION_PREFIX)
}

/**
 * Encrypt specific fields in a config object
 * @param config - The config object
 * @param sensitiveFields - Array of field names to encrypt
 */
export function encryptConfig<T extends Record<string, unknown>>(
  config: T,
  sensitiveFields: string[]
): T {
  const result = { ...config }

  for (const field of sensitiveFields) {
    const value = result[field]
    if (typeof value === 'string' && !isEncrypted(value)) {
      ;(result as Record<string, unknown>)[field] = encrypt(value)
    }
  }

  return result
}

/**
 * Decrypt specific fields in a config object
 * @param config - The config object
 * @param sensitiveFields - Array of field names to decrypt
 */
export function decryptConfig<T extends Record<string, unknown>>(
  config: T,
  sensitiveFields: string[]
): T {
  const result = { ...config }

  for (const field of sensitiveFields) {
    const value = result[field]
    if (typeof value === 'string' && isEncrypted(value)) {
      ;(result as Record<string, unknown>)[field] = decrypt(value)
    }
  }

  return result
}

/**
 * Generate a new encryption key (for initial setup)
 */
export function generateEncryptionKey(): string {
  return randomBytes(32).toString('hex')
}
