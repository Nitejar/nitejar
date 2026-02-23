export interface PageInfo {
  offset: number
  limit: number
  returned: number
  total: number
  hasMore: boolean
}

export function normalizeOffset(value: number | undefined): number {
  return Math.max(0, value ?? 0)
}

export function resolvePageLimit(
  total: number,
  offset: number,
  requestedLimit: number | undefined,
  hardMax: number
): number {
  if (typeof requestedLimit === 'number') {
    return Math.min(Math.max(requestedLimit, 1), hardMax)
  }
  return Math.max(0, total - offset)
}

export function buildPageInfo(input: {
  offset: number
  limit: number
  returned: number
  total: number
}): PageInfo {
  return {
    offset: input.offset,
    limit: input.limit,
    returned: input.returned,
    total: input.total,
    hasMore: input.offset + input.returned < input.total,
  }
}

export function truncateUtf8(
  input: string,
  maxBytes: number
): { text: string; truncated: boolean } {
  const encoded = Buffer.from(input, 'utf8')
  if (encoded.length <= maxBytes) {
    return { text: input, truncated: false }
  }
  return {
    text: encoded.subarray(0, maxBytes).toString('utf8'),
    truncated: true,
  }
}

export function getUtf8Chunk(
  input: string,
  chunkIndex: number,
  chunkSize: number
): {
  chunk: string
  chunkIndex: number
  chunkSize: number
  totalBytes: number
  totalChunks: number
  startByte: number
  endByte: number
  hasPrev: boolean
  hasNext: boolean
} {
  const encoded = Buffer.from(input, 'utf8')
  const safeChunkSize = Math.max(1, chunkSize)
  const totalChunks = Math.max(1, Math.ceil(encoded.length / safeChunkSize))
  const safeChunkIndex = Math.max(0, Math.min(chunkIndex, totalChunks - 1))
  const startByte = safeChunkIndex * safeChunkSize
  const endByte = Math.min(startByte + safeChunkSize, encoded.length)
  const chunk = encoded.subarray(startByte, endByte).toString('utf8')

  return {
    chunk,
    chunkIndex: safeChunkIndex,
    chunkSize: safeChunkSize,
    totalBytes: encoded.length,
    totalChunks,
    startByte,
    endByte,
    hasPrev: safeChunkIndex > 0,
    hasNext: safeChunkIndex < totalChunks - 1,
  }
}
