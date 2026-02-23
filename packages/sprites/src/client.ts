import { SpritesClient, type Sprite } from '@fly/sprites'

let client: SpritesClient | null = null

/**
 * Get the Sprites client singleton
 */
export function getSpritesClient(): SpritesClient {
  if (client) {
    return client
  }

  const token = process.env.SPRITES_TOKEN
  if (!token) {
    throw new Error('SPRITES_TOKEN environment variable is required')
  }

  client = new SpritesClient(token)
  return client
}

/**
 * Get or create a sprite by name
 */
export async function getOrCreateSprite(
  name: string,
  options?: {
    ramMB?: number
    cpus?: number
    region?: string
  }
): Promise<Sprite> {
  const spritesClient = getSpritesClient()

  // Try to get existing sprite first
  try {
    const sprite = await spritesClient.getSprite(name)
    return sprite
  } catch {
    // Sprite doesn't exist, create it
  }

  // Create new sprite
  return spritesClient.createSprite(name, {
    ramMB: options?.ramMB ?? 512,
    cpus: options?.cpus ?? 1,
    region: options?.region ?? 'ord',
  })
}

/**
 * Get a sprite by name
 */
export async function getSpriteByName(name: string): Promise<Sprite | null> {
  const spritesClient = getSpritesClient()

  try {
    return await spritesClient.getSprite(name)
  } catch {
    return null
  }
}

/**
 * Get a sprite handle (doesn't check if it exists)
 */
export function getSprite(name: string): Sprite {
  const spritesClient = getSpritesClient()
  return spritesClient.sprite(name)
}

/**
 * List all sprites
 */
export async function listSprites(prefix?: string): Promise<Sprite[]> {
  const spritesClient = getSpritesClient()
  return spritesClient.listAllSprites(prefix)
}

/**
 * Delete a sprite by name
 */
export async function deleteSprite(name: string): Promise<boolean> {
  const spritesClient = getSpritesClient()

  try {
    await spritesClient.deleteSprite(name)
    return true
  } catch (error) {
    console.error('Failed to delete sprite:', error)
    return false
  }
}
