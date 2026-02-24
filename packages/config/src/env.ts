import { z } from 'zod'

export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  APP_BASE_URL: z.string().url().default('http://localhost:3000'),
  // Database
  DATABASE_URL: z.string().optional(),
  // Encryption key for secrets (required in production)
  ENCRYPTION_KEY: z.string().optional(),
  // GitHub webhook verification (optional)
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
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
