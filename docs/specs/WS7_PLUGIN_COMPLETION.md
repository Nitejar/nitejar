# WS7: Plugin System Completion

Status: Design spec (no implementation)
Audience: Core engineering
Last updated: 2026-02-20

## 1. Current State Inventory

### 1.1 What is built and working

| Component | Location | Status |
|---|---|---|
| Plugin SDK types | `packages/plugin-sdk/src/types.ts` | Complete. `PluginHandler`, `PluginExport`, `PluginProvider`, `SetupConfig`, all handler result types. Zero workspace dependencies. |
| `definePlugin()` | `packages/plugin-sdk/src/define-plugin.ts` | Complete. Validates handler shape at export time. |
| SDK testing utilities | `packages/plugin-sdk/src/testing.ts` | Complete. `testHandler()`, `createMockPluginInstance()`, `createMockRequest()`. |
| Plugin handler registry | `packages/plugin-handlers/src/registry.ts` | Complete. Singleton `pluginHandlerRegistry` with register/unregister/has/get/getAll. |
| Webhook router | `packages/plugin-handlers/src/router.ts` | Complete. `routeWebhook()` decrypts config, parses webhook, creates work item, idempotency dedup. |
| Telegram handler | `packages/plugin-handlers/src/telegram/` | Complete. Full `PluginHandler` implementation with `parseWebhook`, `postResponse`, `acknowledgeReceipt`, `testConnection`, `setupConfig`. |
| GitHub handler | `packages/plugin-handlers/src/github/` | Complete. Full `PluginHandler` implementation with webhook parsing, response posting. |
| Auto-registration of builtins | `packages/plugin-handlers/src/index.ts` | Complete. `telegramHandler` and `githubHandler` registered at import time. |
| Plugin runtime types | `packages/plugin-runtime/src/types.ts` | Complete. `LoadResult`, `BootResult`, `InstallResult`, `HandlerRegistry`, `ProviderRegistry`. |
| Plugin loader | `packages/plugin-runtime/src/loader.ts` | Complete. Dynamic import of plugin entry, handler/provider registration, DB event logging. |
| Plugin installer | `packages/plugin-runtime/src/installer.ts` | Complete. npm (`npm pack` + extract), tgz (buffer), local path flows. Validates manifest, stores artifact in DB, swaps current symlink. |
| Filesystem layout | `packages/plugin-runtime/src/fs-layout.ts` | Complete. `getPluginDir()`, versioned dirs, atomic symlink swap, removal. |
| Manifest validation | `packages/plugin-runtime/src/validation.ts` | Complete. `parseManifest()`, `findManifestInDir()`, `validatePluginEntry()`, checksum computation, path traversal guard. |
| Boot sequence | `packages/plugin-runtime/src/boot.ts` | Complete. `bootPlugins()` queries DB for enabled non-builtins, hydrates cache from artifact, loads. Called at startup. |
| Plugin catalog (static) | `packages/plugin-runtime/src/catalog.ts` | Stub. `PLUGIN_CATALOG` is an empty array. |
| Database: `plugins` table | `packages/database/src/repositories/plugins.ts` | Complete. CRUD, upsert, enable/disable, delete (cascade to versions/acks/events/artifacts). |
| Database: `plugin_versions` table | Same repo | Complete. Upsert, list by plugin. |
| Database: `plugin_disclosure_acks` table | Same repo | Complete. Ensure rows, bulk acknowledge, list. |
| Database: `plugin_events` table | Same repo | Complete. Cursor-based pagination, create event. |
| Database: `plugin_artifacts` table | `packages/database/src/repositories/` | Complete. Blob storage for tgz artifacts. |
| Runtime posture service | `apps/web/server/services/plugins/runtime-posture.ts` | Complete. `resolvePluginTrustMode()`, `getPluginRuntimePosture()` with trust mode, execution mode, limitations, badge label. |
| Manifest service | `apps/web/server/services/plugins/manifest.ts` | Complete. `parsePluginManifest()`, `buildDeclaredCapabilities()`, `capabilityKey()`, `hostEnforcedControls()`. |
| tRPC plugins router | `apps/web/server/routers/plugins.ts` | Complete. `catalog`, `resolveSource`, `listPlugins`, `getPlugin`, `listPluginEvents`, `installPlugin`, `installFromUpload`, `enablePlugin`, `disablePlugin`, `deletePlugin`. Includes builtin manifest registration, source resolution (npm/github/local), hot-load on install/enable, unload on disable/delete. |
| Admin UI: Plugin catalog page | `apps/web/app/admin/plugins/PluginCatalogClient.tsx` | Complete. Grid of installed plugin types + coming soon cards, links to type detail page. |
| Admin UI: Custom plugins section | `apps/web/app/admin/plugins/CustomPluginsSection.tsx` | Complete. Lists non-builtin plugins with source kind, version, disclosure counts. |
| Admin UI: Plugin type detail | `apps/web/app/admin/plugins/[type]/PluginTypeClient.tsx` | Complete. Shows handler metadata, links to instances, setup form. |
| Admin UI: Plugin setup form | `apps/web/app/admin/plugins/[type]/PluginSetupForm.tsx` | Complete. Dynamic field rendering from `setupConfig`. |
| Admin UI: Instance detail | `apps/web/app/admin/plugins/instances/[id]/InstanceDetailClient.tsx` | Complete. Instance config view, enable/disable, assigned agents. |
| Admin UI: Custom plugin detail | `apps/web/app/admin/plugins/custom/[pluginId]/CustomPluginDetailClient.tsx` | Complete. Plugin metadata, permissions, versions, events timeline, enable/disable/delete. |
| Admin UI: Install wizard | `apps/web/app/admin/plugins/install/PluginInstallWizard.tsx` | Complete. Source input (npm/github/local/upload), drag-and-drop tgz, preview with permissions, configure step, update confirmation. |
| Admin UI: Permissions list | `apps/web/app/admin/plugins/components/PermissionsList.tsx` | Complete. Renders network/secrets/fs/spawn permissions with icons. |
| Admin UI: Update confirmation | `apps/web/app/admin/plugins/components/UpdateConfirmationPanel.tsx` | Complete. Side-by-side comparison for updates. |
| Admin UI: Dynamic fields | `apps/web/app/admin/plugins/components/DynamicFields.tsx` | Complete. Renders setup fields from schema. |
| Upload endpoint | `apps/web/app/api/admin/plugins/upload/` | Complete. Tgz upload to in-memory cache, returns preview token. |
| `create-nitejar-plugin` scaffolding | `packages/create-nitejar-plugin/src/index.ts` | Complete. Generates package.json, tsconfig, nitejar-plugin.json manifest, handler skeleton, gitignore. |
| Example plugin | `plugins/nitejar-plugin-webhook/` | Complete. Working webhook handler with tests. |
| Agent provider registry | `packages/agent/src/integrations/registry.ts` | Complete. `registerIntegrationProvider()`, `unregisterIntegrationProvider()`, `providerRegistry` object matching `ProviderRegistry` interface. |
| Telegram agent provider | `packages/agent/src/integrations/telegram.ts` | Complete. Tools (send_telegram_message, list_telegram_threads, read_telegram_thread, send_file) + system prompt section. |
| GitHub agent provider | `packages/agent/src/integrations/github.ts` | Complete. GitHub-specific tools + context injection. |

### 1.2 What is partially built

| Component | What exists | What is missing |
|---|---|---|
| Hook system types | The spec defines 9 hook events. `HookName` type and `HookHandler` signature are described in spec section 12 but no implementation exists. | Hook registry, hook dispatcher, hook handler types, hook context types, hook result types, timeout/budget enforcement, fail-open/fail-closed policy, ordering logic. |
| Plugin `contributes.hooks` | Manifest schema in spec section 9.2 includes `contributes.hooks` field. | No code reads or validates this field. The `PluginManifest` interface in validation.ts does not include `contributes`, `activation`, `engine`, or hooks-related fields. |
| Skill contributions | Spec sections 13 and 14.5 define skill tables and resolver. | No `skills` or `skill_assignments` tables exist. No unified skill resolver. `use_skill` does not resolve plugin skills. |
| Plugin `contributes.integrations` | Manifest schema references integration contributions. | No code reads this. Plugin loader only registers `handler` from the export, not a keyed set of multiple integration contributions. |
| Boot-time provider registration | `bootPlugins()` loads non-builtin plugins and registers handlers. | Provider registry injection is passed as `null` in all callsites (`new PluginLoader(integrationRegistry, null)`). No agent-side provider is registered at boot for third-party plugins. |
| Crash-loop auto-disable | Spec section 21.2 describes N failures in M minutes auto-disable. | No failure tracking exists. `plugin_events` records errors but nothing reads them to trigger auto-disable. |
| Permission enforcement at runtime | `PluginManifest.permissions` is declared and stored. Disclosure acks are tracked. | No runtime enforcement at host-managed API boundaries. No network egress checks. No secret access gating. No filesystem checks. |
| Safe mode | Spec section 7 describes `SLOPBOT_SAFE_MODE=1`. | Not implemented. `bootPlugins()` checks trust mode but not safe mode. |

### 1.3 What is not built at all

| Component | Spec reference |
|---|---|
| Hook registry and dispatcher | Spec sections 12.1-12.5 |
| Hook wiring into agent runner | Spec section 24.2 |
| Hook context and result types | Spec section 12.2-12.3 |
| `skills` and `skill_assignments` DB tables | Spec section 14.5 |
| Unified skill resolver | Spec section 13.2 |
| Plugin skill scoping (global/team/agent/integration) | Spec section 13.3 |
| Upgrade flow (version pointer swap) | Spec section 6.3 |
| Rollback flow (flip pointer back) | Spec section 6.3 |
| Engine/nitejar semver compatibility check | Spec section 6.2 step 4 |
| Git install path | Spec section 6.1 |
| Receipt emitter (structured plugin event emitter for hook dispatch) | Spec section 19 |
| Plugin doctor diagnostics | Spec section 16 |
| CLI surface (`nitejar plugin *`) | Spec section 16 |
| Plugin signature verification | Spec section 7 (guarded mode) |

---

## 2. Hook Lifecycle Wiring

This is the critical path. The 9 hook points must be inserted into the agent runner execution flow. Each hook has a specific location in the code, a data contract, and a mutation policy.

### 2.1 Architecture: Hook registry and dispatcher

Create a new module at `packages/plugin-runtime/src/hooks.ts` with these core types:

```ts
type HookName =
  | 'work_item.pre_create'
  | 'work_item.post_create'
  | 'run.pre_prompt'
  | 'model.pre_call'
  | 'model.post_call'
  | 'tool.pre_exec'
  | 'tool.post_exec'
  | 'response.pre_deliver'
  | 'response.post_deliver'

interface HookContext<TData> {
  hookName: HookName
  pluginId: string
  workItemId: string
  jobId: string
  agentId: string
  data: TData
}

interface HookResult<TData> {
  /** 'continue' proceeds, 'block' stops the chain (tool.pre_exec can block execution) */
  action: 'continue' | 'block'
  /** Optional mutations to the data payload (merged on top of input) */
  data?: Partial<TData>
}

interface HookRegistration {
  pluginId: string
  hookName: HookName
  handler: HookHandler<unknown, unknown>
  priority: number  // higher = runs first
  failPolicy: 'fail_open' | 'fail_closed'
  timeoutMs: number // default 1500
}

class HookRegistry {
  register(reg: HookRegistration): void
  unregister(pluginId: string): void
  getHandlers(hookName: HookName): HookRegistration[]
}

class HookDispatcher {
  constructor(registry: HookRegistry, eventBudgetMs?: number)
  async dispatch<TIn, TOut>(
    hookName: HookName,
    context: Omit<HookContext<TIn>, 'pluginId' | 'hookName'>,
    data: TIn
  ): Promise<{ data: TOut; blocked: boolean; receipts: HookReceipt[] }>
}
```

The dispatcher:
1. Gets handlers sorted by priority (descending), then pluginId, then registration order.
2. Runs each handler with its per-handler timeout (default 1500ms).
3. Tracks cumulative budget (default 8000ms per event chain).
4. On timeout: emits receipt with `status: 'timeout'`, continues if `fail_open`, stops if `fail_closed`.
5. On error: same logic as timeout.
6. Merges mutations from each handler sequentially (later handlers see earlier mutations).
7. Returns final data, blocked flag, and receipt array.

### 2.2 Insertion points in the agent runner

Each hook maps to a specific location in the codebase. All file paths are absolute from the project root.

#### Hook 1: `work_item.pre_create`

**Location:** `packages/plugin-handlers/src/router.ts`, function `routeWebhook()`, line ~156 (before `createWorkItem()`).

**Insertion point:** After `parseResult` is validated and before `createWorkItem()` is called.

**Data in:** `{ workItem: NewWorkItemData, parseResult: WebhookParseResult, pluginType: string, pluginInstanceId: string }`

**Mutable fields:** `workItem.title`, `workItem.payload`, `workItem.session_key`

**Action:** Can `block` to prevent work item creation (return 200 with `{ ignored: true }`).

**Rationale:** Allows plugins to filter, transform, or reject incoming webhooks before a work item is created.

#### Hook 2: `work_item.post_create`

**Location:** `packages/plugin-handlers/src/router.ts`, function `routeWebhook()`, line ~168 (after `createWorkItem()` and idempotency key recording).

**Insertion point:** After workItem is created and idempotencyKey is stored, before return.

**Data in:** `{ workItem: WorkItem, pluginType: string, pluginInstanceId: string, parseResult: WebhookParseResult }`

**Mutable fields:** None (observability only).

**Action:** Always `continue`.

**Rationale:** Observability hook for logging, external notifications, audit trails.

#### Hook 3: `run.pre_prompt`

**Location:** `packages/agent/src/runner.ts`, function `runInferenceLoop()`, approximately line ~625 (after `buildSystemPrompt()` and `buildUserMessage()` are called, before the messages array is assembled).

**Insertion point:** After `systemPrompt` and `userMessage` are computed, before they are pushed into the `messages` array.

**Data in:** `{ systemPrompt: string, userMessage: string, agent: Agent, workItem: WorkItem, sessionContext: SessionContext }`

**Mutable fields:** `systemPrompt` (append sections), `userMessage` (transform).

**Action:** Always `continue`. Blocking here would prevent the agent from running, which is not the intent.

**Rationale:** Allows plugins to inject context into the prompt, add guardrails, or modify the user message.

#### Hook 4: `model.pre_call`

**Location:** `packages/agent/src/runner.ts`, function `runInferenceLoop()`, approximately line ~1192 (inside the `while (turns < maxTurns)` loop, right before `client.chat.completions.create()`).

**Insertion point:** After `preparedMessages` is computed and `activeTools` is resolved, before the model API call.

**Data in:** `{ model: string, temperature: number, maxTokens: number, messages: ChatCompletionMessageParam[], tools: ChatCompletionTool[], turn: number }`

**Mutable fields:** `temperature`, `maxTokens`, `model` (provider override). NOT messages or tools (those are too complex to safely mutate mid-flight).

**Action:** Can `block` to skip the model call and force the loop to end with the current `finalResponse`.

**Rationale:** Cost control, model routing, parameter adjustment per turn.

#### Hook 5: `model.post_call`

**Location:** `packages/agent/src/runner.ts`, function `runInferenceLoop()`, approximately line ~1211 (after `logCall()` and before processing the response choice).

**Insertion point:** After the model response is received and logged, before the assistant message is processed.

**Data in:** `{ response: ChatCompletion, model: string, turn: number, durationMs: number, usage: { promptTokens, completionTokens, costUsd } }`

**Mutable fields:** None (observability only).

**Action:** Always `continue`.

**Rationale:** Observability, cost tracking, response auditing.

#### Hook 6: `tool.pre_exec`

**Location:** `packages/agent/src/runner.ts`, function `runInferenceLoop()`, approximately line ~1403 (inside the tool call loop, after `toolInput` is parsed and `onEvent({ type: 'tool_use' })` is emitted, before `executeTool()` is called).

**Insertion point:** After the tool name and input are known, before execution.

**Data in:** `{ toolName: string, toolInput: Record<string, unknown>, toolCallId: string, turn: number }`

**Mutable fields:** `toolInput` (transform arguments).

**Action:** Can `block` to skip tool execution and return a synthetic "blocked by plugin" tool result.

**Rationale:** Security policy enforcement, argument sanitization, tool access control.

#### Hook 7: `tool.post_exec`

**Location:** `packages/agent/src/runner.ts`, function `runInferenceLoop()`, approximately line ~1538 (after `executeTool()` returns and session retries are resolved, before the tool result is appended to messages).

**Insertion point:** After the tool result is finalized (including retries), before it is converted to `toolResultContent` and pushed to `messages`.

**Data in:** `{ toolName: string, toolInput: Record<string, unknown>, result: ToolResult, durationMs: number, turn: number }`

**Mutable fields:** `result.output` (transform output text).

**Action:** Always `continue`.

**Rationale:** Output filtering (redact secrets in tool output), observability, compliance logging.

#### Hook 8: `response.pre_deliver`

**Location:** `apps/web/app/api/webhooks/plugins/[type]/[instanceId]/route.ts`, function `processWorkItemForAgent()`, inside `sendAssistantUpdate()`, approximately line ~230 (before `handler.postResponse()` is called).

Also in `apps/web/server/services/run-dispatch-worker.ts` wherever the response is delivered (the durable dispatch worker path).

**Insertion point:** After the assistant content is normalized and prefix-formatted, before it is sent to the integration handler.

**Data in:** `{ content: string, pluginType: string, pluginInstanceId: string, workItemId: string, responseMode: 'streaming' | 'final', hitLimit: boolean }`

**Mutable fields:** `content` (transform outgoing text).

**Action:** Can `block` to suppress delivery.

**Rationale:** Content moderation, format transformation, delivery gating.

#### Hook 9: `response.post_deliver`

**Location:** Same files as hook 8, after `handler.postResponse()` returns.

**Insertion point:** After the response is delivered and the `PostResponseResult` is available.

**Data in:** `{ content: string, result: PostResponseResult, pluginType: string, pluginInstanceId: string, workItemId: string }`

**Mutable fields:** None (observability only).

**Action:** Always `continue`.

**Rationale:** Delivery confirmation logging, external notification triggers.

### 2.3 Wiring strategy

1. The `HookDispatcher` is instantiated once at boot time (alongside plugin boot) and made available as a module-level singleton or injected via the existing registry pattern.
2. Each insertion point calls `dispatcher.dispatch(hookName, ctx, data)` and handles the returned `blocked` flag and mutated `data`.
3. All hook calls are wrapped in try/catch at the callsite so a dispatcher failure never crashes the agent run.
4. Hook receipts are batch-written to `plugin_events` after each dispatch (non-blocking, fire-and-forget).
5. The `HookRegistry` is populated during `bootPlugins()` by reading the loaded plugin's `contributes.hooks` from the manifest and binding to handlers from the plugin export.

### 2.4 Manifest extension for hooks

The current `PluginManifest` type in `packages/plugin-runtime/src/validation.ts` must be extended:

```ts
interface PluginManifest {
  // ... existing fields ...
  activation?: {
    onStartup?: boolean
    onIntegrationTypes?: string[]
    onHooks?: HookName[]
  }
  contributes?: {
    integrations?: string[]
    hooks?: HookName[]
    skills?: string[]
  }
}
```

The `PluginExport` type in `packages/plugin-sdk/src/types.ts` must add a `hooks` field:

```ts
interface PluginExport {
  handler: PluginHandler
  provider?: PluginProvider
  hooks?: Partial<Record<HookName, HookHandler>>
}
```

---

## 3. E2E Install Flow

### 3.1 npm install path (working)

User clicks "Install Plugin" in admin UI (`/admin/plugins/install`).

1. User pastes npm package name or URL into source input.
2. UI calls `trpc.plugins.resolveSource` which hits npm registry for metadata (version, description, nitejar config).
3. User reviews resolved metadata (name, version, permissions).
4. User clicks "Install".
5. UI calls `trpc.plugins.installPlugin({ sourceKind: 'npm', sourceRef: packageName, ... })`.
6. Server: `PluginInstaller.installFromNpm()` runs `npm pack packageName@version` in a temp dir, reads the tgz.
7. Server: Computes SHA-256 checksum of tgz.
8. Server: Stores tgz blob in `plugin_artifacts` table (for offline boot hydration).
9. Server: Extracts tgz to `<SLOPBOT_PLUGIN_DIR>/<pluginId>/<version>/`.
10. Server: Reads and validates `nitejar-plugin.json` (or `nitejar` key in `package.json`).
11. Server: Validates entry file exists and is .js/.mjs/.cjs.
12. Server: Writes `.metadata.json` to version dir.
13. Server: Atomically swaps `current` symlink to point at new version.
14. Server: Upserts `plugins` row (disabled by default for third-party).
15. Server: Upserts `plugin_versions` row.
16. Server: Creates `plugin_disclosure_acks` rows from manifest permissions.
17. Server: Creates `plugin_events` row (kind=install, status=ok).
18. UI redirects to custom plugin detail page.
19. User reviews permissions and clicks "Enable" (requires consent checkbox for third-party).
20. Server: Acknowledges all disclosures, enables plugin, hot-loads via `PluginLoader.loadPlugin()`.

### 3.2 Upload (tgz) path (working)

1. User drags a `.tgz` file onto the install wizard or clicks to select.
2. UI POSTs to `/api/admin/plugins/upload` with the file.
3. Server: Reads tgz, extracts to temp dir, reads manifest, checks for existing plugin (update case).
4. Server: Stores in in-memory cache with a short-lived upload token.
5. Server: Returns preview (pluginId, version, name, permissions, isUpdate).
6. UI shows preview with permissions list and optional update confirmation.
7. User clicks "Install" (or "Confirm Update").
8. UI calls `trpc.plugins.installFromUpload({ uploadToken, confirmUpdate })`.
9. Server: Consumes cached upload, runs `PluginInstaller.installFromTgz()`, same steps as npm path from step 7 onward.
10. Server: Auto-acknowledges disclosures for upload flow (operator is explicitly uploading code they trust).
11. Server: Hot-loads immediately.

### 3.3 Local path (working)

1. User types an absolute filesystem path in the install wizard.
2. `resolveSource` reads `nitejar-plugin.json` or `package.json` from that path.
3. User clicks "Install".
4. `PluginInstaller.installFromLocal()` validates the path exists, reads manifest, validates entry.
5. `installPath` is set to the local path directly (no copy). This is dev convenience only.
6. Plugin is registered in DB with `source_kind=local`.

### 3.4 Git install path (NOT built)

The spec (section 6.1) lists git repo URL as an install source. The `resolveSource` function in the plugins router already classifies GitHub URLs and attempts to resolve them (checks npm first, then reads `nitejar-plugin.json` from raw GitHub). However, the actual `installFromGit()` method does not exist on `PluginInstaller`.

**Design for git install:**

1. `resolveFromGitHub()` already works for preview.
2. Add `PluginInstaller.installFromGit(repoUrl: string, ref: string, pluginId: string)`:
   a. `git clone --depth 1 --branch <ref> <repoUrl> <tmpDir>`
   b. Run `npm install --production` in tmpDir (or skip if dist is committed).
   c. Run `npm pack` in tmpDir to produce a tgz.
   d. Delegate to `installFromTgz()`.
3. The tgz artifact is stored in DB for boot hydration.
4. If the repo has a build step, the operator must build before uploading (or the plugin must ship pre-built).

---

## 4. Built-in Plugin Wrappers

### 4.1 Current state

Telegram and GitHub are already implemented as `PluginHandler` instances in `packages/plugin-handlers/`. They are auto-registered at import time in `packages/plugin-handlers/src/index.ts`. They are also registered as `IntegrationProvider` instances in `packages/agent/src/integrations/telegram.ts` and `packages/agent/src/integrations/github.ts` at import time.

The plugins router already creates `builtin.telegram` and `builtin.github` rows in the `plugins` table via `ensureBuiltinPluginsRegistered()`, with manifests, versions, and auto-acknowledged disclosures.

The `PluginLoader` explicitly skips builtins (`source_kind === 'builtin'`) because they are statically imported.

### 4.2 What this means

The builtins are already wrapped. The key design decision was made: builtins are registered via static imports (not dynamic loading), and the `plugins` table tracks them for governance/visibility. This is correct for v1.

### 4.3 Migration strategy for existing integration rows

Existing `plugin_instances` (formerly `integrations`) rows are NOT migrated to a new schema. The `plugins` table is an *additional* layer on top of the existing `plugin_instances` table. The relationship is:

- A `plugins` row describes a **plugin type** (e.g., `builtin.telegram`).
- A `plugin_instances` row describes a **configured connection** (e.g., "My Telegram Bot" with encrypted bot token).
- The `plugin_instances.plugin_id` column links instances to their plugin.

Existing encrypted config payloads, webhook URLs, integration IDs, and type values are preserved exactly. No destructive migration.

### 4.4 Gap: Third-party plugin provider registration

When `PluginLoader.loadPlugin()` runs, it passes `this.providerRegistry` which is always `null` in current callsites:

```ts
// apps/web/server/routers/plugins.ts, line ~824
const loader = new PluginLoader(integrationRegistry, null)
```

This means third-party plugins that export a `provider` (with tools and prompt sections) will have their handler registered but NOT their provider. The agent runner will not see their tools or context.

**Fix:** Pass the real `providerRegistry` from `packages/agent/src/integrations/registry.ts` into the PluginLoader:

```ts
import { providerRegistry } from '@nitejar/agent'
const loader = new PluginLoader(integrationRegistry, providerRegistry)
```

This requires the provider registry to be importable from the agent package without pulling in the entire agent runtime. The `providerRegistry` object already has the right shape (`{ register, unregister, has }`).

Also update `bootPlugins()` to accept and forward the provider registry. The `BootOptions` type already has `providerRegistry` as an optional field.

---

## 5. Permission Enforcement

### 5.1 What exists

- Manifest declares permissions (network hosts, secrets, filesystem paths, process spawn).
- Permissions are parsed into `DeclaredCapability` entries.
- Disclosure ack rows are created and tracked.
- Operator must acknowledge disclosures before enabling (third-party plugins).
- Runtime posture reports "declared capabilities" vs "host-enforced controls" in API responses.
- UI shows permissions list with icons and warning variants.

### 5.2 What is missing

No runtime enforcement exists. The disclosure/ack system is governance and consent only. Per the spec: "Permission enforcement is partial in-process (`host_boundary_enforced`) and limited to host-managed APIs."

**What to implement for v1 (host-boundary enforcement):**

1. **Secret access gating.** The credential provider in `packages/plugin-handlers/src/credential-provider.ts` (and `apps/web/server/services/credential-provider.ts`) should check the requesting plugin's declared `secrets` permissions before returning a decrypted secret. If the plugin has not declared access to that secret key, deny and emit a receipt.

2. **Network egress advisory.** When a plugin calls a host-managed HTTP client (if we provide one), check the target host against the plugin's declared `network` list. For v1, this is logging-only since plugins can bypass it with their own `fetch`. Document this honestly.

3. **Process spawn check.** If we provide a host-managed exec helper, check `allowProcessSpawn`. For v1, this is N/A since plugins run in-process and can call `child_process` directly.

4. **Denied action receipts.** When a host-boundary check denies an action, create a `plugin_events` row with `kind: 'permission_denied'`, `status: 'blocked'`, and detail JSON including the permission, scope, and enforcement level.

### 5.3 What to NOT claim

Per spec section 18.2: "For operations performed directly in plugin code without host mediation, enforcement is not guaranteed in-process." The UI already shows "In-process (No hard sandbox)" badge. This is correct.

---

## 6. Crash-Loop Auto-Disable

### 6.1 Design

Track consecutive failures per plugin. A "crash" is any of:
- Plugin load failure (dynamic import throws).
- Hook handler throws an uncaught exception.
- Hook handler times out more than N times in M minutes.
- Plugin's `parseWebhook` or `postResponse` throws (in the router).

### 6.2 Implementation

Add a failure tracker in `packages/plugin-runtime/src/hooks.ts` (or a new `crash-guard.ts`):

```ts
interface CrashGuard {
  /** Record a failure. Returns true if the plugin should be auto-disabled. */
  recordFailure(pluginId: string): boolean
  /** Reset failure count (called on successful execution). */
  recordSuccess(pluginId: string): void
  /** Check if a plugin is in crash-loop state. */
  isDisabled(pluginId: string): boolean
}
```

**Parameters (configurable via env):**
- `SLOPBOT_PLUGIN_CRASH_THRESHOLD`: Number of failures before auto-disable. Default: 5.
- `SLOPBOT_PLUGIN_CRASH_WINDOW_MS`: Time window for counting failures. Default: 300000 (5 minutes).

**Behavior:**
1. On failure: increment counter with timestamp in an in-memory ring buffer per plugin.
2. Prune entries older than window.
3. If count >= threshold: call `setPluginEnabled(pluginId, false)` and create a `plugin_events` row with `kind: 'auto_disable'`, `status: 'error'`, detail explaining the crash loop.
4. On success: clear the ring buffer for that plugin.
5. Re-enable: operator manually re-enables via admin UI. The ring buffer resets on enable.

### 6.3 Where to instrument

1. **PluginLoader.loadPlugin()** already catches errors and records them. Add `crashGuard.recordFailure()` in the catch block.
2. **HookDispatcher.dispatch()** wraps each handler call in try/catch with timeout. Add `crashGuard.recordFailure()` on timeout or error, `crashGuard.recordSuccess()` on success.
3. **routeWebhook()** in the router catches `parseWebhook` errors. Add failure tracking there for the plugin's handler.

---

## 7. Admin UI Gaps

### 7.1 What exists

The admin UI has a complete install/configure/enable/disable/delete flow for both builtin and custom plugins:

- `/admin/plugins` - Catalog grid with builtin types (Telegram, GitHub) and custom plugins section.
- `/admin/plugins/install` - Full install wizard with npm/github/local/upload source resolution.
- `/admin/plugins/[type]` - Builtin plugin type detail with setup form.
- `/admin/plugins/custom/[pluginId]` - Custom plugin detail with metadata, permissions, versions timeline, events, enable/disable/delete.
- `/admin/plugins/instances/[id]` - Instance detail with config and agent assignment.

### 7.2 What is missing

| Gap | Priority | Description |
|---|---|---|
| Upgrade flow UI | High | No "Check for updates" or "Upgrade" button on custom plugin detail page. The backend `installPlugin` mutation can re-install with a new version, but there is no dedicated upgrade UX. |
| Rollback UI | Medium | No rollback control. The `plugin_versions` table tracks versions but there is no `rollbackPlugin` mutation or UI to select a previous version. |
| Global runtime badge | Medium | The spec requires a global runtime badge "In-process (No hard sandbox)" visible on the plugins page. The data is available (`runtimeBadgeLabel`) but it is not rendered as a persistent banner. |
| Hook events in timeline | Medium | The plugin events timeline on the detail page shows install/enable/disable/load events but does not yet show hook execution events (because hooks are not implemented). Once hooks exist, the timeline should show hook events with duration, status, and detail. |
| Crash-loop alert | Medium | No visual indicator when a plugin has been auto-disabled due to crash loop. The events timeline would show it, but there should be a prominent alert banner on the plugin detail page. |
| Uninstall with purge options | Low | The delete mutation removes all DB data and cached files. The spec describes `--purge-files` and `--purge-data` flags for selective cleanup. Current implementation always purges everything. |
| Skills management UI | Low | No UI for viewing, assigning, or managing plugin-contributed skills (because the skill system is not built). |
| Plugin doctor page | Low | No diagnostics page. The spec describes a `plugin doctor` command. A minimal UI equivalent would show: all plugins, their load status, last error, permission grants, and filesystem health. |

### 7.3 Recommendations

1. Add an "Upgrade" button to `CustomPluginDetailClient.tsx` that calls `installPlugin` with the new version. Show the `UpdateConfirmationPanel` for side-by-side diff.
2. Add a "Rollback" dropdown (populated from `versions`) that swaps the current symlink via a new `rollbackPlugin` mutation.
3. Add the runtime badge as a small pill in the plugins page header next to "Plugins".
4. The crash-loop alert can be derived from `plugin_events` with `kind: 'auto_disable'` in the last N minutes.

---

## 8. Testing Strategy

### 8.1 No real npm registry needed

The `PluginInstaller.installFromNpm()` calls `npm pack`. For tests:

1. **Local fixture plugins.** The `plugins/nitejar-plugin-webhook/` directory already exists as a working example plugin. Create additional fixture plugins under `packages/plugin-runtime/__fixtures__/` with pre-built dist and manifest.

2. **Tgz fixtures.** Run `npm pack` on fixture plugins ahead of time and store the `.tgz` files as test fixtures. `installFromTgz()` can be tested directly without network.

3. **Mock npm registry.** For integration tests that exercise the full npm flow, use `verdaccio` (local npm registry) or mock `execFile('npm', ['pack', ...])` to return a local tgz path.

### 8.2 Hook testing

1. **Unit tests for HookRegistry.** Register multiple handlers with different priorities, verify ordering. Test unregister clears all handlers for a plugin.

2. **Unit tests for HookDispatcher.**
   - Test timeout enforcement: handler that sleeps > timeout gets receipt with status `timeout`.
   - Test chain budget: 6 handlers each taking 1500ms should hit the 8000ms budget.
   - Test fail_open: handler throws, next handler still runs.
   - Test fail_closed: handler throws, chain stops.
   - Test mutation propagation: handler A mutates data, handler B sees mutation.
   - Test block action: tool.pre_exec returns `{ action: 'block' }`, dispatcher returns `blocked: true`.

3. **Integration tests for hook wiring.** Load a fixture plugin that registers hooks. Run the agent loop with a mock model client. Verify hook handlers are called at the right points with the right data.

### 8.3 Plugin lifecycle testing

The existing test files provide patterns:

- `apps/web/server/routers/plugins.test.ts` - Router mutation tests.
- `apps/web/server/services/plugins/runtime-posture.test.ts` - Trust mode resolution.
- `packages/plugin-runtime/` (needs test files) - Loader, installer, boot.

Add:

1. **Loader tests.** Mock dynamic import to return a fixture plugin export. Verify handler is registered. Verify provider is registered when providerRegistry is non-null. Verify DB is updated on load/error.

2. **Installer tests.** Use pre-built tgz fixtures. Verify extraction, manifest validation, symlink swap, artifact storage.

3. **Boot tests.** Insert plugin rows in test DB, run `bootPlugins()`, verify loaded/skipped/errors arrays.

4. **Crash guard tests.** Record N failures in window, verify auto-disable triggers. Record success, verify counter resets.

5. **Compatibility tests.** Verify existing Telegram and GitHub integration configs are unchanged after plugin system boot. Compare config checksums before and after.

### 8.4 E2E webhook test

1. Boot the system with a fixture third-party plugin installed and enabled.
2. Send a webhook to `/api/webhooks/plugins/<fixture-type>/<instanceId>`.
3. Verify: work item created, hook events fired (once hooks are wired), agent processes work item, response delivered.
4. Check `plugin_events` table for install, enable, load, and hook events with correct plugin_id, version, and execution mode.

### 8.5 Mock manifests

Create a `packages/plugin-runtime/__fixtures__/` directory with:

```
__fixtures__/
  valid-plugin/
    nitejar-plugin.json   # valid manifest with hooks declared
    package.json
    dist/
      index.js            # minimal definePlugin export
  invalid-plugin/
    nitejar-plugin.json   # missing required fields
  no-entry-plugin/
    nitejar-plugin.json   # valid manifest, entry file missing
  traversal-plugin/
    nitejar-plugin.json   # entry: "../../etc/passwd"
```

---

## 9. Open Questions

### 9.1 Blocking — all resolved

1. **Provider registry import graph.** RESOLVED. `registry.ts` is a standalone leaf module that does not import the runner. Importing `providerRegistry` from it directly is safe — no side effects are triggered. No re-export restructuring needed.

2. **Hook dispatch in the webhook route vs the durable worker.** RESOLVED. Module-level singleton in `@nitejar/plugin-runtime`, initialized during `bootPlugins()`. Both the webhook route and run-dispatch worker import from the same module. No duplication.

3. **Plugin `contributes.integrations` cardinality.** RESOLVED. One handler per plugin for v1. Multiple integration types = multiple plugin packages. This matches the existing `PluginExport` type which has a singular `handler` field.

### 9.2 Design decisions — resolved or deferred

4. **Skill system scope.** Resolved by WS3. The skill tables (`skills`, `skill_files`, `skill_assignments`) and the skills repository are owned by WS3 (Skills System). When implementing plugin skill registration in `PluginLoader.loadPlugin()`, call into `createSkill()` / `updateSkill()` from the WS3 skills repository (`packages/database/src/repositories/skills.ts`) for each `SkillContribution` in the plugin export. See WS3 section 13 (Plugin Skill Contributions) for the registration flow.

5. **Engine compatibility check.** DEFERRED for v1. The manifest has `engine.nitejar` semver range and `engine.node` range. Neither is checked during install. Enforcement is future work. When implemented, a `SLOPBOT_VERSION` constant in `packages/plugin-runtime/src/version.ts` (synced from the root `package.json`) would provide the comparison target.

6. **Upgrade notification.** RESOLVED for v1. Manual upgrades only — operator re-installs via the admin UI. "Check for updates" button (calling `npm view <package> version` for npm-sourced plugins) is future work.

7. **Hook handler hot-reload.** DEFERRED. Must be addressed before the upgrade flow ships, but not blocking initial hook implementation. When a plugin is upgraded, `PluginLoader.unloadPlugin()` must call `hookRegistry.unregister(pluginId)` and the new version's hooks must be re-registered during `loadPlugin()`.

### 9.3 Not blocking — resolved or noted

8. **Thread safety of in-memory registries.** RESOLVED for v1. Single machine, in-memory registries are fine. Multi-machine shared state is future work.

9. **Plugin events table growth.** DEFERRED. Add a 30-day cleanup job as future work. For v1, cursor-based pagination already limits query cost.

10. **`create-nitejar-plugin` scaffolding update.** BUG — fix required. The scaffolding generates `entrypoint` (should be `entry`) and `permissions: []` (should be `permissions: {}`). The field name mismatch causes validation to miss the entry file. Fix in `packages/create-nitejar-plugin/src/index.ts`.
