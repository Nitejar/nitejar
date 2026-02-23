export interface CursorValue {
  createdAt: number
  id: string
}

export function decodeCursor(cursor: string | undefined): CursorValue | null {
  if (!cursor) return null
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      createdAt?: unknown
      id?: unknown
    }
    if (typeof parsed.createdAt !== 'number' || !Number.isFinite(parsed.createdAt)) return null
    if (typeof parsed.id !== 'string' || parsed.id.trim().length === 0) return null
    return { createdAt: parsed.createdAt, id: parsed.id }
  } catch {
    return null
  }
}

export function encodeCursor(cursor: CursorValue | null): string | null {
  if (!cursor) return null
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}
