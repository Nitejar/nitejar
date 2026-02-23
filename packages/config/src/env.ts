import { z } from 'zod'

export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  APP_BASE_URL: z.string().url().default('http://localhost:3000'),
  // Database
  DATABASE_URL: z.string().optional(),
  // Encryption key for secrets (required in production)
  ENCRYPTION_KEY: z.string().optional(),
  // Sprites API
  SPRITES_TOKEN: z.string().optional(),
  // GitHub App authentication (for production)
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_PRIVATE_KEY: z.string().optional(),
})

export type Config = z.infer<typeof configSchema>

let cachedConfig: Config | null = null

export function loadConfig(): Config {
  if (cachedConfig) {
    return cachedConfig
  }

  const result = configSchema.safeParse(process.env)

  if (!result.success) {
    console.error('Invalid environment configuration:')
    console.error(result.error.format())
    throw new Error('Invalid environment configuration')
  }

  cachedConfig = result.data
  return cachedConfig
}
