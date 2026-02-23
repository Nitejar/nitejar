import { randomBytes } from 'node:crypto'

import * as p from '@clack/prompts'

export interface WizardResult {
  appBaseUrl: string
  port: number
  encryptionKey: string
  betterAuthSecret: string
  openRouterApiKey?: string
}

export function shouldRunWizard(
  envFileExists: boolean,
  noWizard: boolean,
  isTTY: boolean
): boolean {
  return !envFileExists && !noWizard && isTTY
}

export async function runWizard(defaultPort: number): Promise<WizardResult | null> {
  p.intro('Welcome to Nitejar')

  const accessMode = await p.select({
    message: 'How will you access Nitejar?',
    options: [
      { value: 'local', label: 'Local only', hint: 'http://localhost' },
      { value: 'internet', label: 'Internet-reachable', hint: 'ngrok, tunnel, or public URL' },
    ],
  })

  if (p.isCancel(accessMode)) {
    p.cancel('Setup cancelled.')
    return null
  }

  let appBaseUrl: string | undefined

  if (accessMode === 'internet') {
    const urlInput = await p.text({
      message: 'Base URL (where Nitejar will be reachable)',
      placeholder: 'https://your-subdomain.ngrok-free.app',
      validate(value) {
        if (!value) return 'A URL is required for internet-reachable mode.'
        try {
          new URL(value)
        } catch {
          return 'Enter a valid URL (e.g. https://example.ngrok-free.app).'
        }
      },
    })

    if (p.isCancel(urlInput)) {
      p.cancel('Setup cancelled.')
      return null
    }

    appBaseUrl = urlInput
  }

  const portInput = await p.text({
    message: 'Port',
    placeholder: String(defaultPort),
    defaultValue: String(defaultPort),
    validate(value) {
      const n = Number.parseInt(value, 10)
      if (!Number.isFinite(n) || n < 1 || n > 65535) return 'Enter a valid port (1-65535).'
    },
  })

  if (p.isCancel(portInput)) {
    p.cancel('Setup cancelled.')
    return null
  }

  const port = Number.parseInt(portInput, 10)

  const apiKeyInput = await p.text({
    message: 'OpenRouter API key (optional — the free model works without one)',
    placeholder: 'sk-or-...',
    defaultValue: '',
  })

  if (p.isCancel(apiKeyInput)) {
    p.cancel('Setup cancelled.')
    return null
  }

  const encryptionKey = randomBytes(32).toString('hex')
  const betterAuthSecret = randomBytes(32).toString('base64')

  p.outro('Configuration saved. Starting Nitejar...')

  return {
    appBaseUrl: appBaseUrl ?? `http://localhost:${port}`,
    port,
    encryptionKey,
    betterAuthSecret,
    openRouterApiKey: apiKeyInput || undefined,
  }
}
