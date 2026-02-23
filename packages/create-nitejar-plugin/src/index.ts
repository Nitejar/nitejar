#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

function main(): void {
  const args = process.argv.slice(2)
  const name = args.find((a) => !a.startsWith('--'))

  if (!name) {
    console.error('Usage: create-nitejar-plugin <plugin-name> [--id=<plugin-id>]')
    console.error('')
    console.error('Example:')
    console.error('  npx create-nitejar-plugin my-webhook')
    console.error('  npx create-nitejar-plugin my-webhook --id=myorg.my-webhook')
    process.exit(1)
  }

  const idFlag = args.find((a) => a.startsWith('--id='))
  const pluginId = idFlag ? idFlag.slice('--id='.length) : `nitejar.${name}`

  const dir = resolve(process.cwd(), name)
  const srcDir = join(dir, 'src')

  mkdirSync(srcDir, { recursive: true })

  // package.json
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify(
      {
        name: `nitejar-plugin-${name}`,
        version: '0.1.0',
        private: true,
        type: 'module',
        scripts: {
          build:
            'npx esbuild src/index.ts --bundle --format=esm --outfile=dist/index.js --platform=node --external:@nitejar/plugin-sdk',
          typecheck: 'npx tsc --noEmit',
        },
        dependencies: {
          '@nitejar/plugin-sdk': '^0.1.0',
        },
        devDependencies: {
          '@types/node': '^22.10.5',
          typescript: '^5.7.3',
          vitest: '^2.1.8',
        },
      },
      null,
      2
    ) + '\n'
  )

  // tsconfig.json
  writeFileSync(
    join(dir, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler',
          esModuleInterop: true,
          skipLibCheck: true,
          forceConsistentCasingInFileNames: true,
          resolveJsonModule: true,
          isolatedModules: true,
          noEmit: true,
        },
        include: ['src', '__tests__'],
        exclude: ['node_modules', 'dist'],
      },
      null,
      2
    ) + '\n'
  )

  // nitejar-plugin.json (manifest)
  writeFileSync(
    join(dir, 'nitejar-plugin.json'),
    JSON.stringify(
      {
        id: pluginId,
        name: `nitejar-plugin-${name}`,
        displayName: name.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        version: '0.1.0',
        description: `A Nitejar plugin for ${name}`,
        entry: 'dist/index.js',
        permissions: {},
      },
      null,
      2
    ) + '\n'
  )

  // src/index.ts (skeleton handler)
  writeFileSync(
    join(srcDir, 'index.ts'),
    `import {
  definePlugin,
  type PluginHandler,
  type PluginInstance,
  type WebhookParseResult,
  type PostResponseResult,
  type ConfigValidationResult,
} from '@nitejar/plugin-sdk'

// TODO: Define your plugin's config shape
interface MyConfig {
  // apiKey?: string
}

const handler: PluginHandler<MyConfig> = {
  type: '${name}',
  displayName: '${name.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}',
  description: 'TODO: Describe what this plugin does',
  icon: 'puzzle',
  category: 'productivity',
  sensitiveFields: [],

  // TODO: Add setup fields for the admin UI
  // setupConfig: { fields: [...] },

  validateConfig(config: unknown): ConfigValidationResult {
    // TODO: Validate your plugin's configuration
    return { valid: true }
  },

  async parseWebhook(request: Request, pluginInstance: PluginInstance): Promise<WebhookParseResult> {
    const body = await request.text()

    // TODO: Parse the incoming webhook payload
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(body)
    } catch {
      return { shouldProcess: false }
    }

    return {
      shouldProcess: true,
      workItem: {
        source: '${name}',
        source_ref: \`${name}-\${Date.now()}\`,
        session_key: \`${name}:default\`,
        title: String(payload.message ?? payload.text ?? 'New event'),
        payload: body,
      },
      idempotencyKey: \`${name}-\${Date.now()}\`,
    }
  },

  async postResponse(
    _pluginInstance: PluginInstance,
    _workItemId: string,
    _content: string,
    _responseContext?: unknown,
    _options?: { hitLimit?: boolean; idempotencyKey?: string }
  ): Promise<PostResponseResult> {
    // TODO: Deliver the agent's response back to your service
    return { success: true, outcome: 'sent' }
  },
}

export default definePlugin({ handler })
`
  )

  // .gitignore
  writeFileSync(join(dir, '.gitignore'), 'node_modules/\ndist/\n')

  console.log(`Created plugin scaffold at ./${name}`)
  console.log('')
  console.log('Next steps:')
  console.log(`  cd ${name}`)
  console.log('  npm install')
  console.log('  npm run build')
  console.log('')
  console.log('Then install via Nitejar Admin UI > Plugins > Install Custom Plugin')
}

main()
