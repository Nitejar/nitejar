import { randomUUID } from 'node:crypto'

export interface UploadCacheEntry {
  tgzBuffer: Buffer
  manifestJson: string
  pluginId: string
  version: string
  name: string
  description: string
  isUpdate: boolean
  createdAt: number
}

const TTL_MS = 15 * 60 * 1000 // 15 minutes

const cache = new Map<string, UploadCacheEntry>()

function purgeExpired() {
  const now = Date.now()
  for (const [key, entry] of cache) {
    if (now - entry.createdAt > TTL_MS) {
      cache.delete(key)
    }
  }
}

export function storeUpload(entry: Omit<UploadCacheEntry, 'createdAt'>): string {
  purgeExpired()
  const token = randomUUID()
  cache.set(token, { ...entry, createdAt: Date.now() })
  return token
}

/**
 * Retrieve and delete a cached upload entry. Returns null if expired or missing.
 */
export function consumeUpload(token: string): UploadCacheEntry | null {
  const entry = cache.get(token)
  if (!entry) return null
  cache.delete(token)
  if (Date.now() - entry.createdAt > TTL_MS) return null
  return entry
}
