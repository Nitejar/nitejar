# @nitejar/plugin-sdk

Build plugins that connect Nitejar to anything that speaks HTTP.

A plugin receives webhooks, turns them into work items, and posts agent responses back to the source. This SDK gives you the types, the validation helper, and test utilities to ship one.

## Quick Start

```bash
npx create-nitejar-plugin my-plugin
cd my-plugin && npm install && npm run build
```

This scaffolds a working plugin with types, tests, and build config. Install it through the admin UI: **Plugins > Install Custom Plugin** and point to your local directory or published npm package.

## Handler Reference

Every plugin exports a `PluginHandler`. Here is every field and method.

### Metadata

```ts
import type { PluginHandler } from '@nitejar/plugin-sdk'

const handler: PluginHandler<MyConfig> = {
  type: 'my-plugin',           // Unique identifier. Lowercase, no spaces.
  displayName: 'My Plugin',    // Shown in the admin catalog.
  description: 'Does the thing.', // One-liner for the catalog card.
  icon: 'brand-slack',         // Tabler icon name (https://tabler.io/icons).
  category: 'messaging',       // 'messaging' | 'code' | 'productivity'
  sensitiveFields: ['apiKey'], // Field keys that get encrypted at rest.
  // ...methods
}
```

### `responseMode`

Optional. Controls when the agent's response is delivered.

- `'streaming'` (default) — Posts each intermediate assistant message as the agent works. Good for chat-like integrations where users expect typing indicators.
- `'final'` — Waits for the agent to finish, then posts a single response. Good for webhooks, email, or anything where partial updates are noise.

```ts
responseMode: 'final',
```

### `setupConfig`

Optional. Tells the admin UI how to render a setup form when someone creates a new plugin instance. Each field becomes a form input.

```ts
setupConfig: {
  fields: [
    {
      key: 'apiKey',
      label: 'API Key',
      type: 'password',      // 'text' | 'password' | 'select' | 'boolean'
      required: true,
      placeholder: 'sk-...',
      helpText: 'Create one at https://example.com/settings/keys',
    },
    {
      key: 'channel',
      label: 'Default Channel',
      type: 'select',
      options: [
        { label: '#general', value: 'general' },
        { label: '#alerts', value: 'alerts' },
      ],
    },
  ],
  credentialHelpUrl: 'https://example.com/docs/api-keys',
  credentialHelpLabel: 'How to get an API key',
  supportsTestBeforeSave: true,  // Show "Test Connection" button
},
```

**`SetupField` shape:**

| Field         | Type                                           | Required | Description                           |
| ------------- | ---------------------------------------------- | -------- | ------------------------------------- |
| `key`         | `string`                                       | yes      | Config object key this field maps to  |
| `label`       | `string`                                       | yes      | Form label                            |
| `type`        | `'text' \| 'password' \| 'select' \| 'boolean'` | yes      | Input type                            |
| `required`    | `boolean`                                      | no       | Whether the field must be filled      |
| `placeholder` | `string`                                       | no       | Input placeholder text                |
| `helpText`    | `string`                                       | no       | Hint shown below the input            |
| `options`     | `{ label: string; value: string }[]`           | no       | Choices for `select` type             |

### `validateConfig(config)`

Called with the parsed JSON config object. Return `{ valid: true }` or `{ valid: false, errors: ['...'] }`.

```ts
validateConfig(config: unknown): ConfigValidationResult {
  const c = config as MyConfig
  if (!c.apiKey) {
    return { valid: false, errors: ['apiKey is required'] }
  }
  return { valid: true }
},
```

### `parseWebhook(request, pluginInstance)`

Called when a webhook hits your plugin's endpoint. You get the raw `Request` and a `PluginInstance`.

**`PluginInstance` shape:**

```ts
interface PluginInstance {
  id: string            // Instance ID
  type: string          // Plugin type (matches handler.type)
  config: string | null // JSON string — you parse it yourself
}
```

Return a `WebhookParseResult`:

```ts
async parseWebhook(request: Request, pluginInstance: PluginInstance): Promise<WebhookParseResult> {
  const body = await request.json()
  const config = pluginInstance.config ? JSON.parse(pluginInstance.config) as MyConfig : {}

  return {
    shouldProcess: true,
    workItem: {
      session_key: `my-plugin:${body.user_id}`,  // Groups messages into conversations
      source: 'my-plugin',
      source_ref: `msg-${body.id}`,               // Unique per message
      title: body.text.slice(0, 120),
      payload: JSON.stringify(body),               // Optional, stored as-is
    },
    idempotencyKey: `my-plugin-${body.id}`,        // Prevents duplicate processing
    responseContext: { channelId: body.channel },   // Passed to postResponse later
  }
}
```

Return `{ shouldProcess: false }` to silently drop the webhook (e.g., bad signature, irrelevant event type).

### `postResponse(pluginInstance, workItemId, content, responseContext?, options?)`

Called to deliver the agent's response back to whatever sent the webhook.

```ts
async postResponse(
  pluginInstance: PluginInstance,
  workItemId: string,
  content: string,
  responseContext?: unknown,
  options?: { hitLimit?: boolean; idempotencyKey?: string }
): Promise<PostResponseResult> {
  const config = JSON.parse(pluginInstance.config!) as MyConfig
  const ctx = responseContext as { channelId: string }

  await sendToApi(config.apiKey, ctx.channelId, content)

  return { success: true, outcome: 'sent' }
}
```

**`PostResponseResult` shape:**

| Field         | Type                                   | Description                           |
| ------------- | -------------------------------------- | ------------------------------------- |
| `success`     | `boolean`                              | Whether delivery worked               |
| `outcome`     | `'sent' \| 'failed' \| 'unknown'`     | More specific status                  |
| `retryable`   | `boolean`                              | Hint for retry logic                  |
| `providerRef` | `string`                               | External message ID if available      |
| `error`       | `string`                               | Error message on failure              |

### `testConnection(config)` (optional)

Called from the admin UI "Test Connection" button. Receives the parsed config. Hit your external API and report back.

```ts
async testConnection(config: MyConfig): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch('https://api.example.com/me', {
    headers: { Authorization: `Bearer ${config.apiKey}` },
  })
  if (!res.ok) return { ok: false, error: `API returned ${res.status}` }
  return { ok: true }
}
```

Set `setupConfig.supportsTestBeforeSave: true` to show the button.

### `acknowledgeReceipt(pluginInstance, responseContext?)` (optional)

Called right after a webhook is accepted, before the agent starts working. Use it to react with an emoji, send a "thinking..." indicator, or similar.

```ts
async acknowledgeReceipt(pluginInstance: PluginInstance, responseContext?: unknown): Promise<void> {
  const config = JSON.parse(pluginInstance.config!) as MyConfig
  const ctx = responseContext as { messageId: string }
  await addReaction(config.apiKey, ctx.messageId, 'eyes')
}
```

## Manifest Format

Every plugin needs a `nitejar-plugin.json` at its root:

```json
{
  "schemaVersion": 1,
  "id": "nitejar.my-plugin",
  "name": "My Plugin",
  "description": "What this plugin does",
  "entry": "dist/index.js",
  "permissions": []
}
```

| Field           | Description                                                        |
| --------------- | ------------------------------------------------------------------ |
| `schemaVersion` | Always `1`. Will increment if the manifest format changes.         |
| `id`            | Globally unique plugin ID. Convention: `nitejar.<type>`.           |
| `name`          | Human-readable name. Shown in the admin catalog.                   |
| `description`   | One-liner. Keep it concrete.                                       |
| `entry`         | Path to the built ESM entry point, relative to the plugin root.    |
| `permissions`   | Array of permission strings. Currently for risk-visibility only -- not enforced at runtime. Declare what your plugin accesses so admins can make informed decisions. |

## Building

Plugins bundle to a single ESM file. Keep `@nitejar/plugin-sdk` as an external -- the runtime provides it.

One-liner with esbuild:

```bash
npx esbuild src/index.ts --bundle --format=esm --outfile=dist/index.js --platform=node --external:@nitejar/plugin-sdk
```

Or use the template config in your `package.json`:

```json
{
  "scripts": {
    "build": "npx esbuild src/index.ts --bundle --format=esm --outfile=dist/index.js --platform=node --external:@nitejar/plugin-sdk"
  }
}
```

Why external? The host runtime already has `@nitejar/plugin-sdk` loaded. Bundling it in would create duplicate types and break `instanceof` checks.

## Testing

The SDK ships three test utilities.

### `testHandler(pluginExport, options?)`

Runs a full contract test: validates `definePlugin()`, calls `validateConfig()`, and optionally exercises `parseWebhook()` and `postResponse()`.

```ts
import { describe, it, expect } from 'vitest'
import { testHandler } from '@nitejar/plugin-sdk'
import plugin from '../src/index'

describe('my plugin contract', () => {
  it('passes all contract checks', async () => {
    const result = await testHandler(plugin, {
      config: { apiKey: 'test-key' },
      webhookBody: { text: 'hello', user_id: 'u1' },
      postResponseArgs: {
        workItemId: 'wi-1',
        content: 'Here is the answer.',
      },
    })

    expect(result.definePlugin.pass).toBe(true)
    expect(result.validateConfig.pass).toBe(true)
    expect(result.parseWebhook?.pass).toBe(true)
    expect(result.postResponse?.pass).toBe(true)
  })
})
```

**Options:**

| Option              | Type                                                         | Description                                |
| ------------------- | ------------------------------------------------------------ | ------------------------------------------ |
| `config`            | `unknown`                                                    | Passed to `validateConfig`                 |
| `webhookBody`       | `unknown`                                                    | JSON body for `parseWebhook` (skipped if omitted) |
| `webhookHeaders`    | `Record<string, string>`                                     | Extra headers for the mock request         |
| `pluginInstance`    | `Partial<PluginInstance>`                                    | Overrides for the mock instance            |
| `postResponseArgs`  | `{ workItemId: string; content: string; responseContext?: unknown }` | Args for `postResponse` (skipped if omitted) |

### `createMockRequest(body, options?)`

Creates a `Request` with JSON content-type defaults:

```ts
import { createMockRequest } from '@nitejar/plugin-sdk'

const req = createMockRequest({ text: 'hello' })
// POST http://localhost/webhook with JSON body

const custom = createMockRequest('raw body', {
  method: 'PUT',
  headers: { 'x-custom': 'yes' },
})
```

### `createMockPluginInstance(overrides?)`

Creates a `PluginInstance` with sensible defaults:

```ts
import { createMockPluginInstance } from '@nitejar/plugin-sdk'

const instance = createMockPluginInstance()
// { id: 'test-001', type: 'test', config: null }

const configured = createMockPluginInstance({
  type: 'my-plugin',
  config: JSON.stringify({ apiKey: 'sk-test' }),
})
```

## Local Development

1. Build your plugin: `npm run build`
2. Open the admin UI: **Plugins > Install Custom Plugin**
3. Enter the absolute path to your plugin directory (the one containing `nitejar-plugin.json`)
4. The admin loads your manifest and built entry point directly from disk
5. Edit, rebuild, and the next webhook uses your latest code -- no restart needed

## Publishing

1. Make sure `nitejar-plugin.json` and `dist/index.js` are included in your npm package
2. Set up your `package.json`:
   ```json
   {
     "name": "nitejar-plugin-my-plugin",
     "version": "0.1.0",
     "type": "module",
     "files": ["dist", "nitejar-plugin.json"],
     "dependencies": {
       "@nitejar/plugin-sdk": "^0.1.0"
     }
   }
   ```
3. `npm publish`
4. Users install via admin UI: **Plugins > Install from npm** and enter your package name

## `definePlugin()`

Wrap your export with `definePlugin()` for runtime validation. It checks that your handler has the required fields and methods, and that a provider's `integrationType` matches the handler's `type`.

```ts
import { definePlugin } from '@nitejar/plugin-sdk'
import type { PluginHandler } from '@nitejar/plugin-sdk'

const handler: PluginHandler<MyConfig> = {
  type: 'my-plugin',
  // ...all fields and methods
}

export default definePlugin({ handler })
```

If you also provide agent-side tooling (custom tools, system prompt sections), pass a `provider`:

```ts
export default definePlugin({
  handler,
  provider: {
    integrationType: 'my-plugin', // Must match handler.type
    toolDefinitions: [...],
    toolHandlers: { ... },
  },
})
```

## Example

See [`plugins/nitejar-plugin-webhook/`](../../plugins/nitejar-plugin-webhook/) for a complete, working plugin. It accepts any JSON POST, optionally verifies HMAC signatures, and creates work items. Simple enough to read in five minutes.
