# Nitejar Plugin and Extension System Spec

Status: Draft for implementation  
Audience: Core engineering, platform engineering, operator docs  
Last updated: 2026-02-19

## 1. Problem Statement

Nitejar currently has partial extensibility:

1. Integration handlers are code-registered at import time.
2. Integration-specific tools are code-registered at import time.
3. Skills are discovered from repo-local `SKILL.md` files.

This works for built-ins but does not provide:

1. A clear operator install story for the full app.
2. A clear operator install story for third-party extensions.
3. An explicit and honest security posture for running arbitrary extension code on self-host installs.
4. A non-repo skill model.
5. Dynamic integration setup for new types.

We need one coherent model that supports:

1. Open-core self-host installs where operators can run custom plugins.
2. Closed SaaS constraints where arbitrary code is not allowed by default.
3. Strong receipts for everything an extension does.
4. Zero regression to existing integration configs and encrypted keys.
5. Truthful permission semantics in in-process execution.

## 2. Goals

1. Ship Nitejar as a standalone deployable app (not a framework users fork by default).
2. Provide a plugin format that can add integrations, hooks, and non-repo skills.
3. Support install sources: npm package, git repo, upload tarball.
4. Preserve existing Telegram and GitHub integration rows and encrypted config payloads.
5. Make extension behavior inspectable with receipts in run traces and logs.
6. Support both operator-facing UI and CLI workflows.
7. Keep security posture language accurate for in-process execution in this release.

## 3. Non-Goals

1. Building a public plugin marketplace in this iteration.
2. Solving multi-tenant SaaS policy in full detail for all enterprise needs.
3. Removing built-in integrations.
4. Replacing the existing agent/tool runtime.
5. Claiming hard sandbox isolation before isolated execution exists.

## 4. Core Decision Summary

1. Nitejar remains a standalone application that operators run.
2. Canonical runtime distribution is a published Docker image.
3. Plugin code is installed to a durable data directory, not to app source code.
4. Plugins are packages with a manifest (`nitejar.plugin.json`) and code entrypoint.
5. Plugins can contribute:
   1. Integrations.
   2. Hook handlers.
   3. Skills (including non-repo skills).
6. Plugins are disabled by default after install and require explicit enable.
7. Plugin execution is policy-driven:
   1. Self-host open mode may allow arbitrary code plugins.
   2. Guarded/locked modes can require signatures/allowlists and explicit grants.
8. This release runs plugins in-process by default and must not claim hard sandboxing.
9. Existing integration config and keys remain unchanged.

## 5. Full App Install Story

### 5.1 Canonical operator path

Operators run Nitejar from an official image:

1. Pull image from registry.
2. Mount durable `/app/data`.
3. Set required env vars.
4. Start container.
5. Configure integrations and agents in admin UI.

Example:

```bash
docker volume create nitejar-data
docker run -d \
  --name nitejar \
  -p 3000:3000 \
  -v nitejar-data:/app/data \
  -e ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  -e DATABASE_URL="/app/data/nitejar.db" \
  -e SLOPBOT_PLUGINS_DIR="/app/data/plugins" \
  ghcr.io/nitejar/nitejar:latest
```

### 5.2 Optional paths

1. Source install for contributors/plugin authors (`pnpm dev`).
2. Fly deployment with mounted volume at `/app/data`.
3. Optional operator CLI wrapper (`nitejar install`, `nitejar plugin install`, `nitejar update`).

### 5.3 Explicit answer to "Do users fork?"

Default answer: no.  
Fork/clone is for contributors and local development, not normal operators.

## 6. Plugin Install Story

### 6.1 Install sources

1. npm package.
2. Git repository URL.
3. Uploaded tarball (`.tgz`).
4. Local path (dev convenience).

### 6.2 Install flow

1. Fetch artifact.
2. Unpack in staging directory.
3. Read and validate `nitejar.plugin.json`.
4. Validate compatibility (`engine.nitejar` semver range).
5. Compute checksum.
6. Register plugin version in DB.
7. Move to immutable version path.
8. Mark plugin as installed but disabled.
9. Operator reviews declared capabilities plus in-process warning text.
10. Operator accepts explicit consent text and enables plugin.

### 6.3 Upgrade flow

1. Install new version alongside old version.
2. Validate and stage.
3. Flip current pointer atomically.
4. Keep previous version for rollback.
5. Rollback operation flips pointer back.

### 6.4 Uninstall flow

1. Disable plugin.
2. Remove active pointer.
3. Keep or purge files based on `--purge-files`.
4. Keep or purge plugin-specific data based on `--purge-data`.
5. Never delete core integration/job/message data automatically.

## 7. Runtime Modes and Trust Policy

Add runtime policy setting:

1. `SLOPBOT_PLUGIN_TRUST_MODE=self_host_open`
2. `SLOPBOT_PLUGIN_TRUST_MODE=self_host_guarded`
3. `SLOPBOT_PLUGIN_TRUST_MODE=saas_locked`

Behavior:

1. `self_host_open`
   1. Unsigned plugins allowed.
   2. Arbitrary code allowed.
   3. Permission grants are disclosure + operator acknowledgement receipts.
   4. UI language must state: `Declared capabilities; not sandbox-enforced in this mode.`
2. `self_host_guarded`
   1. Signatures or allowlist required (policy-configurable).
   2. Explicit permission grants required before third-party plugin enable.
   3. Enforcement applies only at host-managed API boundaries in this release.
   4. UI language must state: `Partially enforced in current execution mode; plugin code still runs in-process.`
3. `saas_locked`
   1. Only built-in or platform-approved signed plugins.
   2. Arbitrary uploads disabled.
   3. If execution is still in-process, platform copy must not claim full sandbox isolation.

Execution truth model for this release:

1. Execution mode is `in_process`.
2. Permission grants are mandatory for operator consent, governance, and receipts.
3. Permission enforcement is partial in-process (`host_boundary_enforced`) and limited to host-managed APIs.
4. Full sandbox enforcement is a later hardening milestone tied to isolated execution.

Emergency safety:

1. `SLOPBOT_SAFE_MODE=1` loads built-ins only and skips third-party plugins.

## 8. Filesystem Layout

Default under `/app/data`:

```text
/app/data/
  nitejar.db
  plugins/
    _staging/
    _cache/
    <plugin-id>/
      current -> versions/1.2.3
      versions/
        1.2.3/
          nitejar.plugin.json
          dist/
          package/
  logs/
    plugins/
      <plugin-id>.log
```

Env vars:

1. `SLOPBOT_DATA_DIR` default `/app/data`
2. `SLOPBOT_PLUGINS_DIR` default `${SLOPBOT_DATA_DIR}/plugins`
3. `SLOPBOT_PLUGIN_STAGING_DIR` default `${SLOPBOT_PLUGINS_DIR}/_staging`
4. `SLOPBOT_PLUGIN_CACHE_DIR` default `${SLOPBOT_PLUGINS_DIR}/_cache`

Fly requirement:

1. Mount `/app/data` on a persistent Fly volume.
2. SQLite + plugins share same durable mount in single-machine mode.

## 9. Plugin Package Contract

### 9.1 Required files

1. `nitejar.plugin.json` at package root.
2. Entry module referenced by manifest `entry` field.

### 9.2 Manifest schema (v1)

```json
{
  "schemaVersion": 1,
  "id": "com.acme.jira",
  "name": "Acme Jira",
  "version": "1.0.0",
  "description": "Jira integration and triage hooks",
  "entry": "./dist/index.js",
  "engine": {
    "nitejar": ">=0.1.0 <1.0.0",
    "node": ">=24"
  },
  "author": "Acme",
  "license": "MIT",
  "homepage": "https://acme.dev/nitejar-jira",
  "repository": "https://github.com/acme/nitejar-jira",
  "activation": {
    "onStartup": true,
    "onIntegrationTypes": ["jira"],
    "onHooks": ["tool.pre_exec", "response.pre_deliver"]
  },
  "permissions": {
    "network": ["api.atlassian.com", "your-jira-domain.atlassian.net"],
    "secrets": ["jira.api_token"],
    "filesystemRead": [],
    "filesystemWrite": [],
    "allowProcessSpawn": false
  },
  "contributes": {
    "integrations": ["jira"],
    "hooks": [
      "tool.pre_exec",
      "tool.post_exec",
      "response.pre_deliver"
    ],
    "skills": ["jira-triage"]
  }
}
```

### 9.3 Manifest TypeScript contract

```ts
export interface NitejarPluginManifestV1 {
  schemaVersion: 1
  id: string
  name: string
  version: string
  description?: string
  entry: string
  engine: { nitejar: string; node?: string }
  author?: string
  license?: string
  homepage?: string
  repository?: string
  activation?: {
    onStartup?: boolean
    onIntegrationTypes?: string[]
    onHooks?: HookName[]
  }
  permissions?: {
    network?: string[]
    secrets?: string[]
    filesystemRead?: string[]
    filesystemWrite?: string[]
    allowProcessSpawn?: boolean
  }
  contributes?: {
    integrations?: string[]
    hooks?: HookName[]
    skills?: string[]
  }
}
```

## 10. Plugin SDK Contract

Package: `@nitejar/plugin-sdk`

### 10.1 Entry point

```ts
import { definePlugin } from '@nitejar/plugin-sdk'

export default definePlugin({
  integrations: { /* keyed by type */ },
  hooks: { /* keyed by hook event */ },
  skills: [ /* skill descriptors */ ],
})
```

### 10.2 Contribution interfaces

```ts
export interface NitejarPluginModule {
  integrations?: Record<string, IntegrationContribution>
  hooks?: Partial<Record<HookName, HookHandler[]>>
  skills?: SkillContribution[]
}
```

## 11. Contribution Type: Integrations

### 11.1 Integration contribution

```ts
export interface IntegrationContribution {
  type: string
  displayName: string
  description: string
  icon: string
  category: 'messaging' | 'code' | 'productivity'
  responseMode?: 'streaming' | 'final'
  sensitiveFields: string[]
  configSchema: JsonSchema
  validateConfig(config: unknown): { valid: boolean; errors?: string[] }
  parseWebhook(request: Request, integration: Integration): Promise<WebhookParseResult>
  postResponse(
    integration: Integration,
    workItemId: string,
    content: string,
    responseContext?: unknown,
    options?: { hitLimit?: boolean; idempotencyKey?: string }
  ): Promise<PostResponseResult>
  acknowledgeReceipt?(integration: Integration, responseContext?: unknown): Promise<void>
  testConnection?(config: unknown): Promise<{ ok: boolean; error?: string }>
}
```

### 11.2 Dynamic integration setup UI

Admin forms are generated from `configSchema` with optional `uiSchema`.

Server still validates:

1. JSON schema validation.
2. `validateConfig`.
3. Sensitive field encryption using `sensitiveFields`.

No hardcoded `if (type === 'telegram')`/`if (type === 'github')` branches remain in create/update flow.

### 11.3 Backward compatibility

Built-in Telegram/GitHub contributions are shipped as built-in plugins:

1. `builtin.telegram`
2. `builtin.github`

They keep:

1. Existing integration `type` values.
2. Existing config JSON shapes.
3. Existing encrypted key semantics.

## 12. Contribution Type: Hooks

### 12.1 Hook events

V1 hook events:

1. `work_item.pre_create`
2. `work_item.post_create`
3. `run.pre_prompt`
4. `model.pre_call`
5. `model.post_call`
6. `tool.pre_exec`
7. `tool.post_exec`
8. `response.pre_deliver`
9. `response.post_deliver`

### 12.2 Handler signature

```ts
export type HookHandler<TIn, TOut> = (ctx: HookContext<TIn>) => Promise<HookResult<TOut>>
```

### 12.3 Mutation policy

Each hook explicitly declares mutable fields. Example:

1. `model.pre_call` may update `temperature`, `maxTokens`, provider metadata.
2. `tool.pre_exec` may block execution or mutate tool args.
3. `response.pre_deliver` may transform outgoing content.

### 12.4 Ordering and timeout

1. Sort by priority (high to low), then plugin id, then registration order.
2. Per-hook timeout default 1500ms.
3. Per-event chain budget default 8000ms.
4. Timeouts create receipt event with status `timeout`.

### 12.5 Failure behavior

Hook policies:

1. `failOpen` default for observability hooks.
2. `failClosed` required for security hooks.

Policy set per hook registration.

## 13. Contribution Type: Skills

### 13.1 Skill contribution

```ts
export interface SkillContribution {
  id: string
  name: string
  description?: string
  source:
    | { kind: 'inline'; content: string }
    | { kind: 'file'; path: string }
  tags?: string[]
  defaultEnabled?: boolean
}
```

### 13.2 Unified skill resolver

Skill sources merged into one index:

1. Repo discovered skills (`SKILL.md` paths).
2. Plugin skills (file or inline).
3. Admin-created skills (stored in DB).

`use_skill` resolves by stable `skill_id` and supports alias by `name`.

### 13.3 Skill scoping

Skill assignment targets:

1. Global.
2. Team.
3. Agent.
4. Integration type.

## 14. Database Schema

Add tables:

### 14.1 `plugins`

```sql
CREATE TABLE plugins (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  trust_level TEXT NOT NULL DEFAULT 'unknown', -- builtin|trusted|untrusted
  source_kind TEXT NOT NULL,                   -- builtin|npm|git|upload|local
  source_ref TEXT,                             -- package name, git URL, file ref
  current_version TEXT,
  current_checksum TEXT,
  current_install_path TEXT,
  manifest_json TEXT NOT NULL,
  config_json TEXT,
  last_load_error TEXT,
  last_loaded_at INTEGER,
  installed_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### 14.2 `plugin_versions`

```sql
CREATE TABLE plugin_versions (
  plugin_id TEXT NOT NULL,
  version TEXT NOT NULL,
  checksum TEXT NOT NULL,
  install_path TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  signature_json TEXT,
  installed_at INTEGER NOT NULL,
  PRIMARY KEY (plugin_id, version),
  FOREIGN KEY (plugin_id) REFERENCES plugins(id) ON DELETE CASCADE
);
```

### 14.3 `plugin_disclosure_acks`

```sql
CREATE TABLE plugin_disclosure_acks (
  plugin_id TEXT NOT NULL,
  permission TEXT NOT NULL,    -- network:host, secret:key, fs:write:path
  scope TEXT,                  -- optional scope target
  acknowledged INTEGER NOT NULL DEFAULT 0, -- operator acknowledgement of plugin disclosure
  acknowledged_at INTEGER,
  PRIMARY KEY (plugin_id, permission, scope),
  FOREIGN KEY (plugin_id) REFERENCES plugins(id) ON DELETE CASCADE
);
CREATE INDEX idx_plugin_disclosure_acks_plugin_ack ON plugin_disclosure_acks (plugin_id, acknowledged);
```

### 14.4 `plugin_events` (receipts)

```sql
CREATE TABLE plugin_events (
  id TEXT PRIMARY KEY,
  plugin_id TEXT NOT NULL,
  plugin_version TEXT,
  kind TEXT NOT NULL,          -- install|enable|disable|hook|integration|skill
  status TEXT NOT NULL,        -- ok|error|timeout|blocked
  work_item_id TEXT,
  job_id TEXT,
  hook_name TEXT,
  duration_ms INTEGER,
  detail_json TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (plugin_id) REFERENCES plugins(id) ON DELETE CASCADE
);
```

### 14.5 `skills`, `skill_files`, and `skill_assignments`

See `docs/specs/WS3_SKILLS_SYSTEM.md` for the definitive skills schema. WS3 owns the `skills`, `skill_files`, and `skill_assignments` tables.

## 15. API and Router Surface

Add `pluginsRouter` in `apps/web/server/routers/plugins.ts`.

### 15.1 Queries

1. `listPlugins()`
2. `getPlugin({ pluginId })`
3. `listPluginEvents({ pluginId, limit, cursor })`
4. `listAvailableInstallSources()` optional
5. `listSkills({ source?, scope? })`

### 15.2 Mutations

1. `installPlugin({ sourceKind, sourceRef, options })`
2. `enablePlugin({ pluginId })`
3. `disablePlugin({ pluginId })`
4. `upgradePlugin({ pluginId, sourceRef? })`
5. `rollbackPlugin({ pluginId, version })`
6. `uninstallPlugin({ pluginId, purgeFiles?, purgeData? })`
7. `setSkillAssignment({ skillId, scope, scopeId, enabled })`

### 15.3 HTTP endpoints

Optional for direct upload:

1. `POST /api/admin/plugins/upload`
2. `POST /api/admin/plugins/install/npm`
3. `POST /api/admin/plugins/install/git`

### 15.4 Plugin/runtime response metadata

Plugin list/detail responses must include:

1. `executionMode`: `in_process` for this release.
2. `effectiveLimitations`: `string[]` of human-readable caveats for current runtime/security posture.

Plugin detail responses must also separate:

1. `declaredCapabilities` (manifest claims).
2. `hostEnforcedControls` (controls the host can actually block in current mode).

## 16. CLI Surface (optional but recommended)

Command group: `nitejar plugin`

1. `nitejar plugin list`
2. `nitejar plugin install <source>`
3. `nitejar plugin enable <plugin-id>`
4. `nitejar plugin disable <plugin-id>`
5. `nitejar plugin upgrade <plugin-id>`
6. `nitejar plugin rollback <plugin-id> --to <version>`
7. `nitejar plugin uninstall <plugin-id> [--purge-files] [--purge-data]`
8. `nitejar plugin doctor`
9. `nitejar plugin logs <plugin-id>`

## 17. Runtime Architecture

### 17.1 Components

1. Plugin loader.
2. Manifest validator.
3. Plugin execution host.
4. Contribution registries:
   1. Integration registry.
   2. Hook registry.
   3. Skill registry.
5. Permission gate.
6. Receipt emitter.

### 17.2 Boot sequence

1. Load core config and trust mode.
2. Register built-in plugins.
3. Load installed plugins from DB/filesystem.
4. Validate current versions/checksums.
5. Activate enabled plugins allowed by policy.
6. Build merged registries.
7. Publish startup receipt summary.

### 17.3 Execution strategy

V1 default:

1. Built-ins run in process.
2. Third-party plugins run in process.
3. Admin must show a global runtime badge: `In-process (No hard sandbox)`.
4. Install/enable/details flows must show explicit in-process permission caveats.
5. Isolated host execution is a later hardening milestone and not implied in V1 enforcement claims.

## 18. Permission Enforcement

### 18.1 Permission categories

1. Network egress host allowlist.
2. Secret access by named key.
3. Filesystem read allowlist.
4. Filesystem write allowlist.
5. Process spawn permission.

### 18.2 Enforcement points

1. At host-managed API boundaries (hook dispatch policy, host HTTP proxy paths, host secret access APIs, host-managed file/process APIs).
2. Before integration outbound HTTP calls that use host-managed clients.
3. Before plugin access to secrets through host secret APIs.
4. For operations performed directly in plugin code without host mediation, enforcement is not guaranteed in-process.

### 18.3 Enable/consent rules

1. Third-party plugin enable requires explicit consent text acceptance.
2. In `self_host_guarded`, required grants must exist before enable.
3. Denied host-boundary actions must emit receipts that include enforcement scope.

### 18.4 Agent-managed plugin operations

Agent capabilities:

1. `plugins.install`
2. `plugins.enable`
3. `plugins.disable`
4. `plugins.upgrade`
5. `plugins.uninstall`
6. `plugins.edit_source` (high risk, off by default)

These are separate from plugin runtime permissions.

## 19. Receipts and Observability

### 19.1 Required receipts

For each plugin action, record:

1. Plugin id and version.
2. Action kind.
3. Status.
4. Duration.
5. Correlated run context (`work_item_id`, `job_id`) when relevant.
6. `executionMode`.
7. Structured detail payload including declared capability, grant state, and enforcement scope.

### 19.2 Receipt destinations

1. `plugin_events` table.
2. Existing `spans` table with plugin attributes:
   1. `plugin.id`
   2. `plugin.version`
   3. `plugin.hook`
   4. `plugin.status`
3. Optional `external_api_calls` rows for plugin-caused external cost.

### 19.3 Admin visibility

Add `/admin/plugins` and `/admin/plugins/[id]`:

1. Installed versions.
2. Permissions and grants.
3. Recent events.
4. Last error.
5. Enable/disable controls.
6. Rollback control.
7. Runtime posture badge and explicit in-process caveat messaging.

## 20. Existing Data Compatibility (Hard Requirement)

Must preserve:

1. `integrations` table rows.
2. Existing integration IDs.
3. Existing `type` values (`telegram`, `github`).
4. Existing encrypted config JSON blobs.
5. Existing webhook URLs.

Migration strategy:

1. No destructive changes to integration config columns.
2. Introduce plugin system as additional runtime layer.
3. Register Telegram/GitHub built-ins as plugins with identical type keys.
4. Verify before/after config checksums for existing integration rows in tests.

## 21. Failure and Recovery

### 21.1 Plugin load failures

1. Failed plugin does not block app boot unless marked required.
2. Plugin marked `error` with last error message.
3. Startup warning in logs and admin UI.

### 21.2 Runtime failure safeguards

1. Hook timeout isolates plugin failure.
2. `failOpen`/`failClosed` policy applies per hook.
3. Crash loop protection:
   1. N failures in M minutes auto-disable plugin.
   2. Emit plugin event and admin alert.

### 21.3 Safe mode

1. `SLOPBOT_SAFE_MODE=1` loads built-ins only.
2. Used for incident recovery if a plugin breaks boot/runtime.

## 22. Fly and Multi-Instance Operational Notes

### 22.1 Single machine (SQLite)

1. Use one Fly machine.
2. Mount volume at `/app/data`.
3. Store DB and plugins on same volume.

### 22.2 Multiple machines

If scaling beyond one machine:

1. Use Postgres for DB.
2. Use shared artifact source for plugins (object store) or sync process.
3. Ensure each machine materializes same active plugin versions before activation.

## 23. Security Model for Open Core and Closed SaaS

### 23.1 Open-core self-host

1. Full plugin machinery is available.
2. Operator controls trust mode.
3. Arbitrary code allowed in `self_host_open`.
4. Permission grants provide governance/audit controls and host-boundary enforcement only while in-process.

### 23.2 Closed SaaS

1. Trust mode forced to `saas_locked`.
2. Arbitrary plugin uploads disabled.
3. Only platform-signed/allowlisted extensions.
4. Do not claim full sandboxing unless isolated execution is enabled.

This keeps one codepath with policy differences rather than two separate extension systems.

## 24. One-Go Implementation Checklist

This is intentionally single-pass and integration-safe.

### 24.1 Core runtime

1. Add `packages/plugin-sdk`.
2. Add `packages/plugin-runtime`.
3. Implement manifest schema validation.
4. Implement plugin loader and activation manager.
5. Implement permission gate.
6. Implement receipt emitter.
7. Emit runtime metadata (`executionMode`) in plugin APIs.

### 24.2 Registry integration

1. Refactor integration registry to accept plugin contributions.
2. Refactor integration tool provider registry to accept plugin contributions.
3. Add hook registry and dispatcher.
4. Wire hook dispatch into runner lifecycle.

### 24.3 Skills

1. Create DB skill tables.
2. Build unified skill resolver.
3. Update `use_skill` to resolve by merged index.
4. Keep existing repo skill discovery path as one source.

### 24.4 Admin and API

1. Add `pluginsRouter`.
2. Add plugin install/enable/disable/upgrade/uninstall mutations.
3. Add plugin events query.
4. Add `/admin/plugins` pages and forms.
5. Replace hardcoded integration form branches with schema-driven config form.
6. Add in-process warning banner in install/enable/details permission views.
7. Add global runtime badge (`In-process (No hard sandbox)`).

### 24.5 Built-in migration

1. Wrap Telegram as built-in plugin.
2. Wrap GitHub as built-in plugin.
3. Remove hardcoded create/edit branches in integration setup.
4. Keep all existing integration type keys and config formats.

### 24.6 Installer logic

1. Implement npm install path.
2. Implement git install path.
3. Implement upload install path.
4. Add checksum and compatibility checks.
5. Add rollback pointer switch.

### 24.7 Operational controls

1. Add trust mode config.
2. Add safe mode config.
3. Add plugin crash-loop auto-disable.
4. Add plugin doctor diagnostics.

### 24.8 Tests and verification

1. Unit tests for manifest parsing/validation.
2. Unit tests for hook ordering/timeouts/failure policy.
3. Unit tests for host-boundary permission enforcement behavior.
4. Integration tests for install/enable/disable/rollback.
5. Integration tests for built-in compatibility.
6. Compatibility test: existing integration configs unchanged before/after.
7. E2E webhook test with Telegram and GitHub in plugin-backed runtime.
8. UI truthfulness tests for warning text in install/enable/detail views.
9. API contract tests for `executionMode`.
10. Receipt tests for denied host-boundary actions including enforcement scope.
11. Documentation check to prevent hard-sandbox claims in in-process mode.

## 25. Acceptance Criteria

1. Telegram/GitHub and third-party integrations use the same plugin lifecycle/runtime path.
2. Third-party plugin enable requires explicit grants and consent.
3. Product copy does not imply full sandboxing in in-process mode.
4. Receipts capture declared capabilities, grants, denied host-boundary actions, and execution mode.
5. Admin clearly communicates runtime security posture and limitations.
6. Existing Telegram/GitHub connections are carried over where valid; failures are explicit and recoverable.

## 26. Example End-to-End Operator Flow

1. Run Nitejar image with `/app/data` mounted.
2. Open admin UI.
3. Install plugin from npm package.
4. Review declared capabilities with in-process warning banner.
5. Accept explicit consent and required grants.
6. Enable plugin.
7. Add integration of plugin-provided type.
8. Send webhook event.
9. Observe receipts showing plugin hook + integration behavior, including execution mode and enforcement scope.
10. Upgrade plugin.
11. Roll back plugin if issue appears.

This defines a WordPress-style install experience with strong receipts and policy controls suitable for a deployable application.
