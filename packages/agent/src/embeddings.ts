import OpenAI from 'openai'

// Default embedding model (OpenAI's small model is fast and cheap)
const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small'

// OpenRouter embedding model (if using OpenRouter)
const OPENROUTER_EMBEDDING_MODEL = 'openai/text-embedding-3-small'

/**
 * Get the OpenAI client for embedding generation
 * Uses OpenRouter if OPENROUTER_API_KEY is set, otherwise standard OpenAI
 */
function getEmbeddingClient(): { client: OpenAI; model: string } {
  const openRouterKey = process.env.OPENROUTER_API_KEY
  const openAIKey = process.env.OPENAI_API_KEY

  // Prefer OpenAI for embeddings (cheaper, no routing overhead)
  if (openAIKey) {
    return {
      client: new OpenAI({ apiKey: openAIKey }),
      model: DEFAULT_EMBEDDING_MODEL,
    }
  }

  // Fall back to OpenRouter
  if (openRouterKey) {
    return {
      client: new OpenAI({
        apiKey: openRouterKey,
        baseURL: 'https://openrouter.ai/api/v1',
      }),
      model: OPENROUTER_EMBEDDING_MODEL,
    }
  }

  throw new Error('OPENAI_API_KEY or OPENROUTER_API_KEY is required for embeddings')
}

/**
 * Generate an embedding vector for the given text
 * Returns a normalized vector suitable for cosine similarity
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const { client, model } = getEmbeddingClient()

  // Truncate text if too long (embedding models have token limits)
  const truncatedText = text.slice(0, 8000)

  const response = await client.embeddings.create({
    model,
    input: truncatedText,
  })

  const embedding = response.data[0]?.embedding
  if (!embedding) {
    throw new Error('Failed to generate embedding - no data returned')
  }

  return embedding
}

/**
 * Generate embeddings for multiple texts in a batch
 * More efficient than calling generateEmbedding multiple times
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []

  const { client, model } = getEmbeddingClient()

  // Truncate each text
  const truncatedTexts = texts.map((t) => t.slice(0, 8000))

  const response = await client.embeddings.create({
    model,
    input: truncatedTexts,
  })

  return response.data.sort((a, b) => a.index - b.index).map((d) => d.embedding)
}

/**
 * Check if embeddings are available (API key configured)
 */
export function isEmbeddingsAvailable(): boolean {
  return !!(process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY)
}
