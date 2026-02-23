# Sprite Services Integration PRD

## Overview

Enable agents to create, manage, and share web services running on their Sprites. This gives agents the ability to spin up web servers, APIs, or previews and share public URLs with their team users. Additionally, provide visibility into running services through the admin UI and inject service context into agent prompts.

## Problem Statement

Currently, agents can execute commands on their Sprites but have no structured way to:

- Run persistent services (web servers, APIs) that survive beyond a single command
- Get a public URL to share with users
- Know what services are already running on their Sprite
- Expose work products (previews, demos, tools) to their team

This limits agents' ability to collaborate effectively and share their work.

## Goals

1. **Agent Capability**: Give agents tools to create web services and share URLs
2. **Context Awareness**: Agents should know what services are running on their Sprite
3. **Visibility**: Admins should see service status in the agent detail UI
4. **Simplicity**: URL sharing should "just work" without complex auth configuration

## Non-Goals

- Service templates/presets (v1 will be raw command configuration)
- Service health monitoring/alerting
- Service logs in the UI (agents can access logs via bash)
- Private/authenticated URL sharing (default to public for simplicity)
- Multiple Sprites per agent

---

## User Stories

### Agent Stories

1. **As an agent**, I want to start a web server and get a URL I can share with my team
2. **As an agent**, I want to know what services are already running on my Sprite so I don't duplicate work
3. **As an agent**, I want to know my Sprite's URL so I can tell users where to find my services

### Administrator Stories

1. **As an admin**, I want to see what services an agent is running
2. **As an admin**, I want to see the agent's Sprite URL for debugging
3. **As an admin**, I want to know if services are healthy or failed

---

## Detailed Requirements

### 1. New Agent Tools

#### Tool: `get_sprite_url`

Returns the agent's Sprite public URL.

```typescript
{
  name: 'get_sprite_url',
  description: 'Get the public URL of your sprite environment. The URL provides direct HTTP access to services running on your sprite.',
  input_schema: {
    type: 'object',
    properties: {},
    required: []
  }
}
```

**Behavior:**

- Ensures Sprite URL auth is set to `public`
- Returns the URL like `https://nitejar-abc123.fly.dev`

**Example output:**

```
Your sprite URL: https://nitejar-abc123.fly.dev
```

#### Tool: `create_web_service`

Creates and starts a named web service on the Sprite.

```typescript
{
  name: 'create_web_service',
  description: 'Create and start a web service on your sprite. The service will be accessible via a public URL. Use this to run web servers, APIs, or other HTTP services.',
  input_schema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Name for the service (e.g., "web", "api", "preview")'
      },
      cmd: {
        type: 'string',
        description: 'Command to run (e.g., "python", "node", "npm")'
      },
      args: {
        type: 'array',
        items: { type: 'string' },
        description: 'Arguments for the command (e.g., ["-m", "http.server", "8080"])'
      },
      http_port: {
        type: 'integer',
        description: 'Port the service listens on (e.g., 8080, 3000)'
      }
    },
    required: ['name', 'cmd', 'http_port']
  }
}
```

**Behavior:**

1. Calls Sprites API to create the service
2. Waits for service to start (consumes startup log stream)
3. Ensures URL auth is public
4. Returns the service URL and status

**Example output:**

```
Service "preview" is running!

Public URL: https://nitejar-abc123.fly.dev
Port: 8080
Status: running
```

**Error handling:**

- Service fails to start: Return error message from Sprites API
- Service name already exists: Sprites API updates the existing service (acceptable behavior)
- Timeout waiting for start: Return partial status with warning

### 2. System Prompt Context Injection

Inject current Sprite services into the agent's system prompt so it knows what's running.

**Location in prompt:** After integrations section, before closing

**Format:**

```
## Your Sprite
URL: https://nitejar-abc123.fly.dev

Running services:
- preview (port 8080)
- api (port 3000)
```

Or if no services:

```
## Your Sprite
URL: https://nitejar-abc123.fly.dev
No services currently running.
```

**Implementation:**

- Query Sprites API during `buildSystemPrompt()` (already async)
- Filter to only show `status: 'running'` services
- Gracefully handle API failures (log warning, omit section)
- Skip if `SPRITES_TOKEN` not configured

### 3. Admin UI - Services Section

New section on agent detail page showing:

**Sprite URL Card:**

- Display URL with copy button
- Link icon to open in new tab

**Services List:**

- Service name
- Status badge (running/stopped/starting/failed)
- Port number
- Refresh button

**Empty State:**

- "No services running" message
- Brief explanation: "Services started by this agent will appear here"

**Location:** Right sidebar, after Integrations card

**Data source:** REST API route that calls Sprites API directly (no caching needed for v1)

### 4. Sprites Package Helpers

New file `packages/sprites/src/services.ts` with helper functions:

```typescript
export interface ServiceInfo {
  name: string
  status: "stopped" | "starting" | "running" | "stopping" | "failed"
  httpPort?: number
  cmd: string
  args: string[]
  pid?: number
  error?: string
}

// List all services on a sprite
export async function listSpriteServices(spriteName: string): Promise<ServiceInfo[]>

// Get the sprite's public URL (ensures auth is public)
export async function getSpritePublicUrl(spriteName: string): Promise<string>

// Create and start a web service, returns URL when ready
export async function createAndStartService(
  spriteName: string,
  serviceName: string,
  config: { cmd: string; args?: string[]; httpPort: number }
): Promise<{ url: string; service: ServiceInfo }>

// Stop a running service
export async function stopSpriteService(spriteName: string, serviceName: string): Promise<void>
```

---

## Implementation Plan

### Phase 1: Sprites Package Helpers

1. Create `packages/sprites/src/services.ts`
2. Implement `listSpriteServices()` using SDK's `sprite.listServices()`
3. Implement `getSpritePublicUrl()` - fetch sprite, call `updateURLSettings({ auth: 'public' })`, return `sprite.url`
4. Implement `createAndStartService()` - create service, consume stream until started/error
5. Export from `packages/sprites/src/index.ts`
6. Add basic tests

### Phase 2: Agent Tools

1. Add `get_sprite_url` to `toolDefinitions` array
2. Add `create_web_service` to `toolDefinitions` array
3. Implement handlers in `executeTool()` switch
4. Handle missing SPRITES_TOKEN gracefully
5. Test via Telegram integration

### Phase 3: System Prompt Context

1. Add `buildServicesContext()` helper to prompt-builder
2. Call during `buildSystemPrompt()` after integrations
3. Handle errors gracefully (warn, don't fail)
4. Test that agents see their services in context

### Phase 4: Admin UI

1. Create `apps/web/app/api/agents/[id]/services/route.ts`
2. Create `apps/web/app/admin/agents/[id]/ServicesSection.tsx`
3. Add ServicesSection to agent detail page
4. Style consistently with existing sections
5. Test UI displays correctly

---

## Technical Considerations

### Stream Consumption

The Sprites SDK returns `ServiceLogStream` for create/start/stop operations. We need to consume these streams to get final status:

```typescript
const stream = await sprite.createService(name, config)
let started = false
let error: string | undefined

await stream.processAll((event) => {
  if (event.type === "started") started = true
  if (event.type === "error") error = event.data
})

if (!started) throw new Error(error || "Service failed to start")
```

### URL Auth Transition

When calling `getSpritePublicUrl`:

1. Get sprite info via `client.getSprite(name)`
2. If `urlSettings?.auth !== 'public'`, call `sprite.updateURLSettings({ auth: 'public' })`
3. Return `sprite.url`

This ensures URLs are always shareable.

### Error Handling

| Scenario               | Handling                                                    |
| ---------------------- | ----------------------------------------------------------- |
| SPRITES_TOKEN not set  | Tools return "Sprites not configured" error                 |
| Sprite doesn't exist   | Let error bubble up (should be provisioned earlier)         |
| Service fails to start | Return error message from Sprites API                       |
| URL update fails       | Log warning, return URL anyway (might work with token auth) |
| API timeout            | Return partial status with warning                          |

### Caching

No caching for v1:

- Services state changes frequently
- Sprites API is fast enough for real-time queries
- UI can implement manual refresh button

---

## API Reference

### Sprites SDK Methods Used

```typescript
// Get sprite instance
const sprite = client.sprite(spriteName);
// or with data
const sprite = await client.getSprite(spriteName);

// Sprite properties
sprite.url?: string
sprite.urlSettings?: { auth?: 'public' | 'sprite' }

// Service methods
sprite.listServices(): Promise<ServiceWithState[]>
sprite.createService(name, config, duration?): Promise<ServiceLogStream>
sprite.stopService(name, timeout?): Promise<ServiceLogStream>
sprite.updateURLSettings({ auth: 'public' | 'sprite' }): Promise<void>
```

### ServiceWithState Type

```typescript
interface ServiceWithState {
  name: string
  cmd: string
  args: string[]
  needs: string[]
  httpPort?: number
  state?: {
    status: "stopped" | "starting" | "running" | "stopping" | "failed"
    pid?: number
    startedAt?: string
    error?: string
  }
}
```

### ServiceLogEvent Types

```typescript
interface ServiceLogEvent {
  type: "stdout" | "stderr" | "exit" | "error" | "complete" | "started" | "stopping" | "stopped"
  data?: string
  exitCode?: number
  timestamp: number
}
```

---

## Success Metrics

1. **Tool Usage**: Agents successfully using `create_web_service` tool
2. **URL Sharing**: URLs being shared in Telegram/GitHub conversations
3. **Context Accuracy**: Agents correctly aware of running services
4. **Admin Visibility**: Admins using services section for debugging

---

## Decisions

| Decision            | Choice                  | Rationale                                                     |
| ------------------- | ----------------------- | ------------------------------------------------------------- |
| URL auth mode       | Always public           | Simplicity; private URLs can be managed via Sprites dashboard |
| Service persistence | No local DB             | Sprites API is source of truth; avoids sync issues            |
| Stream handling     | Server-side consumption | Tools need simple success/failure, not streams                |
| Default behavior    | No services             | Agents create services on demand                              |
| Service templates   | Out of scope v1         | Keep it simple; raw commands work fine                        |

---

## Files to Create/Modify

| File                                                 | Action | Description              |
| ---------------------------------------------------- | ------ | ------------------------ |
| `packages/sprites/src/services.ts`                   | Create | Service helper functions |
| `packages/sprites/src/index.ts`                      | Modify | Export new functions     |
| `packages/agent/src/tools.ts`                        | Modify | Add 2 new tools          |
| `packages/agent/src/prompt-builder.ts`               | Modify | Add services context     |
| `apps/web/app/admin/agents/[id]/ServicesSection.tsx` | Create | UI component             |
| `apps/web/app/api/agents/[id]/services/route.ts`     | Create | API route                |
| `apps/web/app/admin/agents/[id]/page.tsx`            | Modify | Import and add component |

---

## Exit Criteria

- [ ] `get_sprite_url` tool works and returns public URL
- [ ] `create_web_service` tool creates service and returns URL
- [ ] System prompt includes services context when agent has running services
- [ ] Admin UI shows services section with URL and service list
- [ ] Services section handles empty state gracefully
- [ ] All changes pass typecheck (`pnpm run typecheck`)
- [ ] Agent can tell a user "Check out the preview at {url}"
