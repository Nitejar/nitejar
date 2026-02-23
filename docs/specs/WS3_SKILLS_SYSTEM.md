# WS3: Skills System Spec

Status: Draft for implementation
Audience: Core engineering, platform engineering
Last updated: 2026-02-20

---

## 1. Overview

### 1.1 What skills are

A skill is a **directory** — containing knowledge, workflows, scripts, templates, and reference material — that is synced to an agent's **sandbox filesystem** at save-time and read by the agent during a run. The entrypoint is always a `SKILL.md` file. Supporting files (references, scripts, templates) live alongside it.

Skills teach an agent *how* to do something. They are not executable code that runs in the host process — that is the plugin model. If a skill includes a script, the agent reads it from its sandbox and runs it through its own tool capabilities (bash, read_file), constrained by the agent's existing sandbox permissions.

### 1.2 The model

| Primitive | What it adds | Where it lives | Who runs it | Scope |
|-----------|-------------|---------------|-------------|-------|
| **Plugin** | Functionality: tools, webhooks, integrations | Host filesystem + DB manifest | Host process (platform runtime) | Global runtime |
| **Skill** | Intelligence: knowledge, workflows, scripts, templates | Skill store on host + agent sandbox filesystem | Agent (reads files, decides what to execute via its own tools) | Per-agent, per-team, or global |
| **Memory** | Experience: learned facts, task state, session context | DB rows with embeddings | Agent (creates/updates/decays) | Per-agent only |

Key distinctions:

- **Plugins connect to external stuff** (webhooks, OAuth, APIs). They are platform-level. Their code runs in the host process. They require explicit trust and permission models.
- **Skills teach the agent stuff** (knowledge, workflows, scripts, templates). They are agent-level. Their content lives in the agent's sandbox filesystem. They can only do what the agent can already do.
- **Memories are ephemeral and personal** — they decay, they're per-agent, and agents create them. Skills are **durable and shared** — they persist until removed, can be assigned across agents, and are authored by humans or plugins.
- Skills CAN contain scripts without violating the "skills are not plugins" boundary. A bash script in a skill directory is content the agent interprets — no different from a code snippet in SKILL.md. The trust boundary is the agent's sandbox permissions, not the skill content. What skills cannot do: register webhook handlers, inject code into the host process, define new tools, access secrets directly, or run at boot time.

### 1.3 Execution model

1. Admin creates or imports a skill (a directory with `SKILL.md` + optional supporting files).
2. Admin attaches the skill to an agent via agent config (skill assignment).
3. The skill directory is **synced to the agent's sandbox filesystem** at save-time — written to a well-known path inside the sprite.
4. When the agent runs, the system prompt includes a brief summary of available skills with pointers to their sandbox paths. The agent reads `SKILL.md`, discovers supporting files, and runs scripts through its own bash/filesystem tools.
5. Admin detaches skill or deletes it — files are removed from the agent's sandbox on the next sync.

### 1.4 Skill sources

Skills come from three sources, unified into a single index:

1. **Repo skills** — `SKILL.md` files discovered from `.agents/skills/*/SKILL.md` and `skills/*/SKILL.md` directories when the agent navigates into a project. These already exist and work today. They are read directly from the project filesystem — they are NOT synced to the sandbox.
2. **DB skills** — Skills created through the admin UI. Metadata tracked in the `skills` table, files stored on the host filesystem at `/app/data/skills/<skill-id>/`. Synced to agent sandboxes when assigned.
3. **Plugin skills** — Skills contributed by installed plugins via the `SkillContribution` interface. Content extracted from the plugin and stored in the skill filesystem, then synced to sandboxes like any other DB skill.

---

## 2. Database Schema

### 2.1 `skills` table

Stores metadata and content for all non-repo skills (admin-created and plugin-contributed). Repo skills are ephemeral (discovered at runtime from the project filesystem) and are NOT stored in this table.

**The database is the authoritative store for skill content.** The `content` column holds the SKILL.md content and is `NOT NULL` for DB-managed skills (admin and plugin sources). The host filesystem (`/app/data/skills/`) is a materialized cache derived from DB rows, and the agent sandbox (`/home/sprite/.skills/`) is a deployment target derived from the cache. See section 3 for the full persistence model.

```sql
CREATE TABLE skills (
  id TEXT PRIMARY KEY,                   -- UUID
  name TEXT NOT NULL,                    -- human-readable name, unique per source
  slug TEXT NOT NULL,                    -- url/lookup-safe identifier (e.g., 'jira-triage')
  description TEXT,                      -- brief description for catalog display and system prompt summaries
  category TEXT NOT NULL DEFAULT 'general', -- grouping: general, coding, ops, writing, research, custom
  source_kind TEXT NOT NULL,             -- 'admin' | 'plugin'
  plugin_id TEXT,                        -- FK to plugins.id for plugin-contributed skills (NULL for admin)
  source_ref TEXT,                       -- plugin-relative path (for plugin-contributed skills)
  content TEXT NOT NULL,                  -- SKILL.md content (DB is the authoritative store)
  is_directory INTEGER NOT NULL DEFAULT 0, -- 0 = single SKILL.md, 1 = directory with supporting files
  version TEXT,                          -- semantic version (optional)
  checksum TEXT,                         -- sha256 of SKILL.md content for change detection
  enabled INTEGER NOT NULL DEFAULT 1,    -- 0/1, global kill switch
  tags_json TEXT,                        -- JSON string[] for filtering (e.g., ["python", "deployment"])
  requires_tools_json TEXT,              -- JSON string[] of tools the skill expects (advisory, not enforced)
  metadata_json TEXT,                    -- JSON object for extensible metadata
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (plugin_id) REFERENCES plugins(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX idx_skills_slug ON skills (slug);
CREATE INDEX idx_skills_source_kind ON skills (source_kind);
CREATE INDEX idx_skills_plugin_id ON skills (plugin_id);
CREATE INDEX idx_skills_category ON skills (category);
CREATE INDEX idx_skills_enabled ON skills (enabled);
```

### 2.2 `skill_files` table

Stores the content of supporting files within a skill directory. Each row represents one file relative to the skill's root directory. Like the `skills` table, this table is the authoritative store — file content is `NOT NULL`. The host filesystem is a materialized cache derived from these rows.

```sql
CREATE TABLE skill_files (
  id TEXT PRIMARY KEY,                   -- UUID
  skill_id TEXT NOT NULL,                -- FK to skills.id
  relative_path TEXT NOT NULL,           -- e.g., 'references/database.md', 'scripts/crawl.sh'
  content TEXT NOT NULL,                 -- file content (DB is the authoritative store)
  content_type TEXT,                     -- 'text/markdown', 'application/x-sh', etc.
  size_bytes INTEGER,                    -- file size for display and budget enforcement
  checksum TEXT,                         -- sha256 for change detection
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_skill_files_path ON skill_files (skill_id, relative_path);
CREATE INDEX idx_skill_files_skill ON skill_files (skill_id);
```

### 2.3 `skill_assignments` table

Controls which skills are attached to which agents, teams, or globally. When an assignment is created or removed, a sandbox sync is triggered (see section 4).

```sql
CREATE TABLE skill_assignments (
  id TEXT PRIMARY KEY,                   -- UUID
  skill_id TEXT NOT NULL,                -- FK to skills.id
  skill_slug TEXT NOT NULL,              -- denormalized slug for display/lookup
  scope TEXT NOT NULL,                   -- 'global' | 'team' | 'agent'
  scope_id TEXT,                         -- NULL for global; team_id or agent_id otherwise
  priority INTEGER NOT NULL DEFAULT 0,   -- higher = listed earlier in prompt summary
  auto_inject INTEGER NOT NULL DEFAULT 0, -- 0/1: if 1, SKILL.md summary injected into system prompt
  enabled INTEGER NOT NULL DEFAULT 1,    -- 0/1: assignment-level toggle
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_skill_assignments_unique ON skill_assignments (skill_id, scope, scope_id);
CREATE INDEX idx_skill_assignments_scope ON skill_assignments (scope, scope_id);
CREATE INDEX idx_skill_assignments_skill ON skill_assignments (skill_id);
```

### 2.4 Kysely type definitions

Add to `packages/database/src/types.ts`:

```ts
// ============================================================================
// Skills
// ============================================================================

export interface SkillTable {
  id: Generated<string>
  name: string
  slug: string
  description: string | null
  category: Generated<string>
  source_kind: string          // 'admin' | 'plugin'
  plugin_id: string | null
  source_ref: string | null
  content: string              // SKILL.md content (DB is the authoritative store)
  is_directory: Generated<number> // 0/1
  version: string | null
  checksum: string | null
  enabled: Generated<number>   // 0/1
  tags_json: string | null     // JSON string[]
  requires_tools_json: string | null // JSON string[]
  metadata_json: string | null // JSON object
  created_at: Generated<number>
  updated_at: Generated<number>
}

export type Skill = Selectable<SkillTable>
export type NewSkill = Insertable<SkillTable>
export type SkillUpdate = Updateable<SkillTable>

export interface SkillFileTable {
  id: Generated<string>
  skill_id: string
  relative_path: string
  content: string             // file content (DB is the authoritative store)
  content_type: string | null
  size_bytes: number | null
  checksum: string | null
  created_at: Generated<number>
  updated_at: Generated<number>
}

export type SkillFile = Selectable<SkillFileTable>
export type NewSkillFile = Insertable<SkillFileTable>
export type SkillFileUpdate = Updateable<SkillFileTable>

export interface SkillAssignmentTable {
  id: Generated<string>
  skill_id: string
  skill_slug: string
  scope: string                // 'global' | 'team' | 'agent'
  scope_id: string | null
  priority: Generated<number>
  auto_inject: Generated<number> // 0/1
  enabled: Generated<number>   // 0/1
  created_at: Generated<number>
  updated_at: Generated<number>
}

export type SkillAssignment = Selectable<SkillAssignmentTable>
export type NewSkillAssignment = Insertable<SkillAssignmentTable>
export type SkillAssignmentUpdate = Updateable<SkillAssignmentTable>
```

Add to the `Database` interface:

```ts
skills: SkillTable
skill_files: SkillFileTable
skill_assignments: SkillAssignmentTable
```

### 2.5 Migration file

File: `packages/database/migrations/20260301_000000_skills.ts`

Follow existing patterns (see `20260224_000000_collections.ts` and `20260226_000000_credentials.ts`). Use `ifNotExists()` on all `CREATE TABLE` and `CREATE INDEX` calls. Support both SQLite and Postgres timestamps via the `isPostgres` check pattern.

---

## 3. Storage Model

### 3.0 Persistence model

The database is the source of truth for skill content. The host filesystem is a materialized cache. The agent sandbox is a deployment target.

```
DB (durable)  →  Host filesystem (cache)  →  Agent sandbox (deployment)
skills table       /app/data/skills/           /home/sprite/.skills/
skill_files table
```

**Why this model:** Containers are ephemeral. Cloud environments do not guarantee persistent volumes. The DB (SQLite file or Postgres) is always durable and survives container restarts. This is the same pattern used by the plugin system, where `plugin_artifacts` stores tgz blobs in the DB and extracts them to the filesystem on install.

**The three layers:**

1. **DB (durable store):** The `skills` table stores SKILL.md content in its `content` column. The `skill_files` table stores supporting file contents in its `content` column. These are the authoritative copies. The admin UI reads from and writes to the DB, never the filesystem.
2. **Host filesystem (materialized cache):** `/app/data/skills/<skill-id>/` is a cache materialized from DB rows. On a cold start (container restart), this directory is empty. Skills are materialized from DB on demand — when a skill is first needed for sandbox sync or when the admin UI requests a file listing. The cache can be blown away at any time and reconstructed from DB.
3. **Agent sandbox (deployment target):** `/home/sprite/.skills/<slug>/` is where skills are deployed for agent consumption. Files are synced from the host filesystem cache to the sandbox. The agent reads from here at runtime.

**Materialization:** Reading `skills` + `skill_files` rows from DB and writing the corresponding files to `/app/data/skills/<skill-id>/`. This happens lazily (when a skill is first needed) or can be done eagerly at boot time. Lazy materialization is recommended for faster startup.

**Repo skills are the exception:** Skills discovered from `.agents/skills/` in a project repo are the opposite model — the filesystem IS the source of truth. They have no DB rows, are not materialized, and are ephemeral. They are discovered at runtime and disappear when the agent leaves the project.

### 3.1 Host filesystem layout (cache)

Skills are materialized from DB to directories on the host filesystem:

```
/app/data/skills/
  <skill-id>/
    SKILL.md                    # Entrypoint (materialized from skills.content)
    references/                 # Optional supporting docs (from skill_files rows)
      database.md
      security.md
    scripts/                    # Optional scripts (from skill_files rows)
      deploy.sh
    templates/                  # Optional templates (from skill_files rows)
      checklist.md
```

Each skill directory is identified by the skill's UUID from the `skills` table. This directory is a **cache** derived from DB content. If the directory is missing (e.g., after a container restart), it is re-materialized from DB rows on demand.

### 3.2 Lifecycle

**Creation:** When an admin creates a skill via the admin UI or tRPC, the handler:
1. Creates the `skills` row with metadata and SKILL.md content.
2. For multi-file skills, creates `skill_files` rows with file contents.
3. Computes and stores checksums.
4. Materializes the skill directory to `/app/data/skills/<skill-id>/` (writes files from DB content).

**Update:** When skill content is edited:
1. Updates the `skills` row (content, checksum, updated_at) and/or `skill_files` rows in the DB.
2. Invalidates the filesystem cache: deletes and re-materializes `/app/data/skills/<skill-id>/` from DB.
3. Triggers sandbox re-sync for all agents assigned to this skill (see section 4).

**Deletion:** When a skill is deleted:
1. Deletes the `skills` row (cascades to `skill_files` and `skill_assignments`).
2. Removes the cached directory at `/app/data/skills/<skill-id>/`.
3. Triggers sandbox cleanup for all agents that had this skill assigned.

### 3.3 Boot and cold start behavior

On a cold start (container restart, fresh deployment), the `/app/data/skills/` directory may be empty. The platform does NOT need to eagerly materialize all skills at boot time. Instead:

- **Lazy materialization (recommended):** When a skill is first needed — assigned to an agent that is about to run, or requested for sandbox sync — check if `/app/data/skills/<skill-id>/` exists. If not, materialize it from DB rows. This keeps startup fast regardless of how many skills are stored.
- **Eager materialization (optional):** Materialize all enabled skills at boot time. Simpler logic but slower startup with many skills. Not recommended for production.

The platform should check for cache staleness by comparing the `checksum` column in the DB against the materialized files. If they diverge (e.g., a partial write), re-materialize from DB.

### 3.4 Simple vs directory skills

**Simple skills** (`is_directory = 0`): Just a `SKILL.md` file. No `skill_files` rows. The admin UI shows a single markdown editor. This covers the common case of a text-only skill.

**Directory skills** (`is_directory = 1`): `SKILL.md` plus one or more supporting files tracked in `skill_files`. The admin UI shows a file browser alongside the main editor.

The distinction is ergonomic, not architectural. Both are stored as directories on the filesystem. A simple skill is just a directory with one file.

---

## 4. Sandbox Sync Mechanism

### 4.1 Concept

Skills are synced to agent sandboxes at **save-time**, not at run-time. The full sync chain is:

```
DB → host filesystem (materialize) → sandbox (sync)
```

When an admin changes skill assignments or edits skill content, the platform materializes the skill from DB to the host filesystem cache (if not already cached), then syncs the files to the agent's sprite filesystem. When the agent runs, the skill files are already present — no download, no resolution, no latency.

### 4.2 Sandbox skill path

Skills are synced to a well-known directory on the agent's sprite:

```
/home/sprite/.skills/
  <skill-slug>/
    SKILL.md
    references/
    scripts/
    ...
```

Using the slug (not the UUID) as the directory name makes paths human-readable and stable for the agent to reference. Slugs are guaranteed unique across DB skills.

### 4.3 Sync triggers

A sandbox sync is triggered when:

1. **Admin assigns a skill to an agent** (creates a `skill_assignment` row with `scope='agent'`) — materialize the skill to host filesystem if not already cached, then sync that skill's directory to the agent's sandbox.
2. **Admin removes a skill assignment** — delete the skill directory from the agent's sandbox.
3. **Admin edits skill content** — update DB rows, invalidate the host filesystem cache (delete and re-materialize from DB), then re-sync to all sandboxes of agents assigned to this skill.
4. **Admin assigns a skill globally or to a team** — materialize if needed, sync to all matching agent sandboxes.
5. **Agent sandbox is created** (e.g., `ensureHomeSandboxForAgent`) — materialize and sync all assigned skills to the new sandbox.

### 4.4 Sync implementation

New module: `packages/agent/src/skill-sync.ts`

```ts
/**
 * Sync all assigned skills to an agent's sandbox.
 * Called at assignment changes and sandbox creation.
 */
export async function syncSkillsToSandbox(
  agentId: string,
  spriteName: string,
  teamId?: string | null
): Promise<{ synced: string[]; removed: string[]; errors: string[] }>

/**
 * Ensure a skill is materialized on the host filesystem.
 * Reads skills + skill_files rows from DB and writes to /app/data/skills/<id>/.
 * No-ops if the cache directory already exists and checksums match.
 */
export async function materializeSkill(skillId: string): Promise<string>

/**
 * Sync a single skill directory to a sprite.
 * Materializes from DB to host filesystem if needed, then writes
 * SKILL.md + all supporting files from /app/data/skills/<id>/
 * to /home/sprite/.skills/<slug>/ on the sprite.
 */
export async function syncSkillToSprite(
  skillId: string,
  skillSlug: string,
  spriteName: string
): Promise<void>

/**
 * Remove a skill directory from a sprite.
 */
export async function removeSkillFromSprite(
  skillSlug: string,
  spriteName: string
): Promise<void>
```

The sync uses the existing `writeFile` and `spriteExec` functions from `@nitejar/sprites` (see `packages/sprites/src/filesystem.ts`) to write files to the sprite. For directories, it creates the directory structure first (`mkdir -p`) then writes each file.

### 4.5 Sync on agent save

The agent config save flow (in the agent tRPC router) should call `syncSkillsToSandbox` after persisting assignment changes. This is an async operation — if the sprite is not running, the sync is deferred until the sprite starts (the runner calls `syncSkillsToSandbox` at run initialization if a full sync has not occurred).

### 4.6 Sync tracking

The `skill_assignments` table is the source of truth for what should be synced. The sync operation compares assignments against what exists on the sprite filesystem:

1. List all skill assignments for the agent (including global and team-scoped).
2. List all directories in `/home/sprite/.skills/` on the sprite.
3. Sync = write directories for assigned skills that are missing or have stale checksums.
4. Cleanup = remove directories for skills that are no longer assigned.

No additional "sync state" table is needed — the assignments table plus the filesystem state are sufficient.

---

## 5. Unified Skill Resolver

### 5.1 Concept

The skill resolver produces a merged index from all three sources. It is consumed:

1. **At prompt-build time** — to list available skills in the system prompt with sandbox paths.
2. **At tool-call time** — when `use_skill` is invoked, to find the skill's sandbox path so the agent can read it.
3. **In the admin UI** — to show the complete skill catalog with source attribution.

### 5.2 Merged skill entry shape

```ts
export interface ResolvedSkill {
  /** Stable lookup identifier. For DB skills, this is the slug. For repo skills, derived from directory name. */
  id: string
  name: string
  description: string
  source: 'repo' | 'db' | 'plugin'
  /** Source detail: file path for repo, skill DB id for db, plugin id for plugin */
  sourceRef: string
  /** Whether this skill is a directory with supporting files */
  isDirectory: boolean
  /** List of supporting files (relative paths) */
  supportingFiles?: Array<{
    relativePath: string
    contentType?: string
  }>
  /** Sandbox path where this skill lives (for DB/plugin skills synced to sandbox) */
  sandboxPath?: string
  /** Absolute path on sprite filesystem (repo skills — from project tree, not .skills/) */
  absolutePath?: string
  /** Tags for filtering */
  tags: string[]
  /** Category for grouping */
  category: string
  /** Whether this skill is enabled */
  enabled: boolean
  /** Tools the skill expects the agent to have (advisory, not enforced) */
  requiresTools?: string[]
  /** Version from frontmatter or DB */
  version?: string
}
```

### 5.3 Resolution algorithm

```
resolveSkillsForAgent(agentId, teamId?, repoSkills?):

  1. Load DB skills where enabled=1
  2. Load skill_assignments where:
     - (scope='global') OR
     - (scope='team' AND scope_id=teamId) OR
     - (scope='agent' AND scope_id=agentId)
     AND enabled=1
  3. Build assigned DB skills set (skills that have matching assignments)
     - For each, set sandboxPath = '/home/sprite/.skills/<slug>'
     - Load skill_files to populate supportingFiles
  4. If repoSkills provided (from context-loader scan):
     - Convert each SkillEntry to ResolvedSkill with source='repo'
     - Repo skills use absolutePath (from project tree), not sandboxPath
  5. Merge all sources into unified index keyed by id/slug
  6. Apply priority rules (see 5.4)
  7. Return merged index
```

### 5.4 Priority and override rules

When multiple sources provide a skill with the same slug:

1. **DB skill (admin-created)** overrides plugin skill with same slug.
2. **Plugin skill** overrides repo skill with same slug.
3. **Repo skill** is the lowest priority source.

Rationale: Admin always wins (they're the operator). Plugins are more explicit than repo convention. Repo is the ambient baseline.

Within the same source, assignment `priority` field controls ordering in the prompt.

### 5.5 Implementation location

New file: `packages/agent/src/skill-resolver.ts`

This module exports:

```ts
export async function resolveSkillsForAgent(
  agentId: string,
  teamId?: string | null,
  repoSkills?: SkillEntry[]
): Promise<ResolvedSkill[]>

export async function resolveSkillBySlug(
  slug: string,
  agentId: string,
  teamId?: string | null,
  repoSkills?: SkillEntry[]
): Promise<ResolvedSkill | null>
```

---

## 6. tRPC Routes

Add `skillsRouter` in `apps/web/server/routers/skills.ts` and wire into `_app.ts` as `skills: skillsRouter`.

### 6.1 Queries

```ts
// List all skills (catalog view). Supports filtering by source, category, tags, search.
skills.list(input?: {
  source?: 'admin' | 'plugin'
  category?: string
  search?: string        // full-text search on name + description
  enabled?: boolean
})

// Get a single skill by ID (includes file listing for directory skills)
skills.get(input: { skillId: string })

// List skill assignments. Filter by skill, scope, or agent.
skills.listAssignments(input?: {
  skillId?: string
  scope?: 'global' | 'team' | 'agent'
  scopeId?: string       // agent_id or team_id
})

// List skills assigned to a specific agent (including global and team)
skills.listForAgent(input: { agentId: string })

// List available categories (for filter dropdowns)
skills.listCategories()

// Get the content of a specific file within a skill (reads from DB, not filesystem)
skills.getFile(input: { skillId: string; relativePath: string })
```

### 6.2 Mutations

```ts
// Create a new admin skill (simple — single SKILL.md)
skills.create(input: {
  name: string
  slug: string           // validated: lowercase, alphanumeric + hyphens
  description?: string
  category?: string
  content: string        // SKILL.md content
  tags?: string[]
  requiresTools?: string[]
  metadata?: Record<string, unknown>
})

// Create a new admin skill (directory — SKILL.md + files)
skills.createDirectory(input: {
  name: string
  slug: string
  description?: string
  category?: string
  content: string        // SKILL.md content
  files: Array<{ path: string; content: string; contentType?: string }>
  tags?: string[]
  requiresTools?: string[]
  metadata?: Record<string, unknown>
})

// Update an existing skill's metadata and/or SKILL.md content
skills.update(input: {
  skillId: string
  name?: string
  description?: string
  category?: string
  content?: string       // SKILL.md content
  tags?: string[]
  requiresTools?: string[]
  enabled?: boolean
  metadata?: Record<string, unknown>
})

// Add a supporting file to a directory skill
skills.addFile(input: {
  skillId: string
  relativePath: string   // e.g., 'references/auth.md'
  content: string
  contentType?: string
})

// Update a supporting file
skills.updateFile(input: {
  skillId: string
  relativePath: string
  content: string
})

// Remove a supporting file
skills.removeFile(input: {
  skillId: string
  relativePath: string
})

// Delete a skill (cascades to assignments, removes filesystem directory, triggers sandbox cleanup)
skills.delete(input: { skillId: string })

// Assign a skill to an agent, team, or globally (triggers sandbox sync)
skills.assign(input: {
  skillId: string
  scope: 'global' | 'team' | 'agent'
  scopeId?: string       // required for team/agent scope
  priority?: number
  autoInject?: boolean
})

// Update an assignment (toggle enable, change priority, toggle auto-inject)
skills.updateAssignment(input: {
  assignmentId: string
  enabled?: boolean
  priority?: number
  autoInject?: boolean
})

// Remove an assignment (triggers sandbox cleanup)
skills.removeAssignment(input: { assignmentId: string })

// Duplicate an existing skill (copies directory and creates new DB rows)
skills.duplicate(input: { skillId: string; newSlug: string })

// Import a skill from portable format (see section 9)
skills.import(input: { skill: PortableSkillFormat })

// Export a skill to portable format
skills.export(input: { skillId: string })
```

### 6.3 Validation rules

- `slug`: must match `/^[a-z][a-z0-9-]*$/`, max 64 chars, must be unique across DB skills.
- `name`: 1-128 chars.
- `content`: 1 char minimum for SKILL.md, no upper limit (but warn in UI above 50KB).
- `category`: one of a predefined set or `'custom'`.
- `tags`: each tag must match `/^[a-z0-9-]+$/`, max 20 tags.
- `scopeId`: must reference a valid agent or team when scope is `'agent'` or `'team'`.
- `relativePath` for files: must not contain `..`, must not start with `/`, max 256 chars. No binary files (text content only for v1).

---

## 7. Database Repository

New file: `packages/database/src/repositories/skills.ts`

### 7.1 Core functions

```ts
// CRUD — skills
export async function createSkill(data): Promise<Skill>
export async function findSkillById(id: string): Promise<Skill | null>
export async function findSkillBySlug(slug: string): Promise<Skill | null>
export async function listSkills(filters?): Promise<Skill[]>
export async function updateSkill(id: string, data): Promise<Skill | null>
export async function deleteSkill(id: string): Promise<boolean>
export async function isSkillSlugAvailable(slug: string, excludeId?: string): Promise<boolean>

// CRUD — skill files
export async function createSkillFile(data): Promise<SkillFile>
export async function listSkillFiles(skillId: string): Promise<SkillFile[]>
export async function findSkillFile(skillId: string, relativePath: string): Promise<SkillFile | null>
export async function updateSkillFile(id: string, data): Promise<SkillFile | null>
export async function deleteSkillFile(id: string): Promise<boolean>
export async function deleteSkillFilesBySkillId(skillId: string): Promise<number>

// Assignments
export async function createSkillAssignment(data): Promise<SkillAssignment>
export async function listSkillAssignments(filters?): Promise<SkillAssignment[]>
export async function getSkillAssignmentsForAgent(
  agentId: string,
  teamId?: string | null
): Promise<Array<SkillAssignment & { skill: Skill }>>
export async function updateSkillAssignment(id: string, data): Promise<SkillAssignment | null>
export async function deleteSkillAssignment(id: string): Promise<boolean>

// Bulk operations
export async function getSkillsWithAssignmentCounts(): Promise<Array<Skill & { assignmentCount: number }>>
export async function listCategories(): Promise<string[]>
export async function getAgentIdsForSkill(skillId: string): Promise<string[]>
```

Follow the pattern in `packages/database/src/repositories/memories.ts` and `packages/database/src/repositories/credentials.ts`: use `getDb()`, UUID generation via `crypto.randomUUID()`, Unix timestamps via `Math.floor(Date.now() / 1000)`.

---

## 8. Agent Runtime Integration

### 8.1 System prompt injection

During `buildSystemPrompt` in `packages/agent/src/prompt-builder.ts`:

1. After the memory section and before the capabilities section, insert an "Available Skills" section.
2. Query `getSkillAssignmentsForAgent(agent.id, teamId)` to get all assigned skills.
3. For each assigned skill, include a **brief summary and sandbox path** in the system prompt. The agent reads the full SKILL.md from its sandbox when it needs the skill — the system prompt is a directory listing, not a content dump.
4. Merge with repo-discovered skills (from `discoveredSkills` in the runner). Repo skills show their project-relative path.

**Prompt format:**

```
## Available Skills

You have the following skills installed in your sandbox. Each skill directory contains a SKILL.md with full instructions and may include supporting files (references, scripts, templates). Use `read_file` to read the SKILL.md for any skill you want to use.

Sandbox skills (in /home/sprite/.skills/):
- **jira-triage** — Triage incoming Jira tickets using priority rules. Read: /home/sprite/.skills/jira-triage/SKILL.md [admin]
- **code-review** — Structured code review checklist with supporting references. Read: /home/sprite/.skills/code-review/SKILL.md [plugin: acme-toolkit]

Project skills (discovered from repo):
- **deploy** — Deploy the application to production. Read: /home/sprite/project/.agents/skills/deploy/SKILL.md [repo]
```

For skills with `auto_inject = 1`, additionally inject a brief skill description (NOT the full SKILL.md content) into the system prompt with a pointer to the sandbox path for full details:

```
<skill name="jira-triage" path="/home/sprite/.skills/jira-triage/SKILL.md">
Triage incoming Jira tickets using priority and severity rules. When you need to triage a ticket, read the full SKILL.md at the path above for detailed instructions.
</skill>
```

This approach is vastly more token-efficient than the old model of injecting full skill content into the system prompt (which was capped at 20K chars). The agent reads what it needs on demand.

### 8.2 `use_skill` tool updates

Current state: `use_skill` in `packages/agent/src/tools/handlers/filesystem.ts` reads SKILL.md content from `context.discoveredSkills` (repo skills only).

New behavior: `use_skill` becomes a convenience wrapper that points the agent to the right skill directory. The agent can then use `read_file` to access the content.

1. Resolve the skill by name/slug (case-insensitive match).
2. For **sandbox skills** (DB/plugin): Return the sandbox path and a listing of files in the skill directory. The agent uses `read_file` on the SKILL.md and any supporting files it needs.
3. For **repo skills**: Return the absolute path (existing behavior) and read the SKILL.md content from the sprite filesystem.
4. For both: Include a manifest of supporting files so the agent knows what is available.

**Updated tool description:**

```
Look up a skill by name and get its location and file listing. For sandbox-installed skills,
returns the path to the skill directory in /home/sprite/.skills/. For project skills,
returns the path in the project tree. Use read_file to load the SKILL.md and any
supporting files you need.
```

**Updated response format:**

```
Skill: jira-triage
Location: /home/sprite/.skills/jira-triage/
Entrypoint: /home/sprite/.skills/jira-triage/SKILL.md

Files:
  SKILL.md (entrypoint)
  references/priority-matrix.md
  references/severity-guide.md
  scripts/triage-report.sh

Use read_file to load the SKILL.md for full instructions.
```

**Updated input schema:** Keep `skill_name` as the only required parameter (case-insensitive match against name or slug).

**Updated error messages:**

```
- No skills: "No skills available. Skills can be installed by an admin from the skill catalog,
  contributed by plugins, or discovered from SKILL.md files in project repos."
- Not found: "Skill "{name}" not found. Available skills: {list}"
```

### 8.3 ToolContext changes

Add to `ToolContext` in `packages/agent/src/tools/types.ts`:

```ts
/** Resolved DB/plugin skills for this agent (loaded at run start) */
resolvedDbSkills?: ResolvedSkill[]
```

In the runner (`packages/agent/src/runner.ts`), at run initialization (before the main loop):

1. Resolve DB skills once: `const resolvedDbSkills = await resolveSkillsForAgent(agent.id, teamId)`
2. Optionally verify sandbox sync is current (compare resolved skills against `/home/sprite/.skills/` contents — if stale, trigger a quick sync).
3. Pass `resolvedDbSkills` into `getToolContext()` alongside `discoveredSkills`.

### 8.4 Prompt size guard

Since skills are no longer injected as full content, the prompt size concern is greatly reduced. The system prompt now contains only summaries and paths. Guard rails:

- **Summary list**: Cap at 50 skills in the summary list to avoid prompt bloat. If an agent has more than 50 assigned skills, show the first 50 by priority and add a note: `[{n} more skills available — use use_skill to discover them]`.
- **Auto-inject descriptions**: Maximum 5,000 characters total for auto-inject skill descriptions. These are brief descriptions, not full content. If exceeded, truncate lowest-priority skill descriptions.

---

## 9. Skill Format (Portable Import/Export)

### 9.1 JSON structure (format version 2)

The portable format embeds all files from a skill directory. Uses `formatVersion` (not `schemaVersion`) to match the convention established by the agent profile format in WS5.

```json
{
  "formatVersion": 2,
  "skill": {
    "name": "Jira Triage",
    "slug": "jira-triage",
    "description": "Triage incoming Jira tickets using priority and severity rules",
    "category": "ops",
    "tags": ["jira", "triage", "ops"],
    "version": "1.0.0",
    "requiresTools": ["bash"],
    "content": "---\nname: jira-triage\n...\n\n# Jira Triage\n\n...",
    "files": [
      {
        "path": "references/priority-matrix.md",
        "content": "# Priority Matrix\n\n...",
        "contentType": "text/markdown"
      },
      {
        "path": "scripts/triage-report.sh",
        "content": "#!/bin/bash\n...",
        "contentType": "application/x-sh"
      }
    ]
  },
  "metadata": {
    "exportedAt": "2026-02-20T12:00:00Z",
    "exportedFrom": "nitejar",
    "author": "operator@example.com"
  }
}
```

For simple skills (no supporting files), the `files` array is empty or omitted.

### 9.2 Tarball alternative

For large or binary-adjacent skills, export as a `.tar.gz` of the skill directory. The tarball contains the directory structure as-is. On import, extract to `/app/data/skills/<new-id>/` and create DB rows from the extracted files.

The JSON format is the primary portable format. Tarballs are offered as a convenience for skills with many files.

### 9.3 Import behavior

Import writes to the DB first (source of truth), then materializes to the host filesystem cache:

1. Parse the portable format (JSON or tarball).
2. Create the `skills` row with content and metadata in the DB.
3. Create `skill_files` rows for each supporting file with their content in the DB.
4. Materialize the skill directory to `/app/data/skills/<new-id>/` from the DB rows.

Additional rules:
- If slug exists: prompt to overwrite or skip.
- If slug is new: create the skill.
- Assignments are NOT included in the portable format (they're deployment-specific).
- Content is imported as `source_kind = 'admin'`.

### 9.4 Export behavior

Export reads from the DB, not the filesystem. The `skills.content` column and `skill_files.content` rows are serialized into the portable format. This guarantees exports are consistent even if the filesystem cache is stale or missing.

### 9.5 SKILL.md compatibility

The portable JSON format is separate from the SKILL.md file format. Repo skills continue to use SKILL.md with YAML frontmatter. The admin UI can "import from directory" by reading a skill directory (SKILL.md + siblings) and packaging it into the portable format.

---

## 10. Migration Path: Repo Skills Continue to Work

### 10.1 No breaking changes

Existing repo skill discovery (`packages/agent/src/context-loader.ts`) is completely unchanged. The `scanDirectoryContext` function continues to find `SKILL.md` files, parse frontmatter, and return `SkillEntry[]`.

Repo skills are NOT synced to `/home/sprite/.skills/`. They live in the project tree where they were discovered and are accessed via their absolute paths on the sprite filesystem. This keeps the boundary clean: repo skills belong to the repo, sandbox skills belong to the platform.

### 10.2 Coexistence model

```
Repo skills:
  - Discovered at runtime when agent navigates into a project
  - Ephemeral (not in DB, not synced to sandbox)
  - Appear in "Project skills" section of system prompt
  - Agent reads SKILL.md + supporting files from project tree via read_file
  - Not manageable from admin UI (they live in the repo)

DB skills (admin-created):
  - Created in admin UI or imported
  - Content stored durably in DB (skills + skill_files tables)
  - Materialized to host filesystem cache at /app/data/skills/<id>/
  - Synced to agent sandboxes at /home/sprite/.skills/<slug>/
  - Appear in "Sandbox skills" section of system prompt
  - Agent reads SKILL.md + supporting files from sandbox via read_file
  - Admin UI reads from and writes to DB, never the filesystem
  - Fully manageable from admin UI

Plugin skills:
  - Contributed by plugins via definePlugin()
  - Content stored in DB when plugin is enabled
  - Materialized to /app/data/skills/<id>/ and synced to sandboxes like any other DB skill
  - Content read-only in admin UI (managed by plugin)
```

### 10.3 Slug collision between repo and DB

If a repo skill and a DB skill have the same derived slug, the DB skill takes priority (see section 5.4). Both appear in the system prompt, but the DB/sandbox version is listed first. The agent can access both — the repo version via its project path, the DB version via the sandbox path.

---

## 11. Security Model

### 11.1 Core principle: skills can only do what the agent can already do

Skills run in the agent's sandbox. They do not introduce new capabilities or permissions. A skill's scripts execute through the agent's existing tools (bash, read_file, write_file) and are constrained by the agent's sandbox environment:

- **Network policy**: The agent's network policy (from agent config) applies to all commands, including those from skill scripts.
- **Filesystem isolation**: Skills live in the sprite's filesystem. They cannot escape the sprite sandbox.
- **Tool permissions**: The agent's tool set determines what a skill can accomplish. A skill that references the `bash` tool only works if the agent has bash access.
- **Credential access**: Skills cannot access secrets directly. They go through the agent's credential tool, which is controlled by admin-configured credential assignments.

### 11.2 Admin-created skills

Admin-created DB skills are authored by the operator. The operator controls what goes into skills, just as they control agent configurations and system prompts. No additional trust model is needed beyond the existing admin authentication.

### 11.3 Plugin-contributed skills

Plugin-contributed skills carry the trust level of their parent plugin. If a plugin contributes a skill with a script, the script's trustworthiness is that of the plugin. This is already handled by the plugin trust model (`self_host_open`, `self_host_guarded`, `saas_locked`).

### 11.4 Repo skills

Repo skills are discovered from the project filesystem and are under the control of whoever maintains the repo. In Nitejar's model, repos are cloned onto sprites (VMs), so repo skills are sandboxed within the sprite environment. This is the same trust model as any code the agent encounters in a repo.

### 11.5 What skills cannot do

Skills must never:
- Execute scripts automatically (the agent decides whether to run them)
- Run code in the host process (that is the plugin model)
- Access secrets directly (go through the credential tool)
- Modify agent permissions at runtime
- Register webhook handlers
- Define new tools or modify tool behavior
- Run at boot time or outside an agent session

If a capability requires any of these, it belongs in a plugin, not a skill.

---

## 12. Admin UI Pages

### 12.1 Skills catalog page — `/admin/skills`

**Route:** `apps/web/app/admin/skills/page.tsx`

**Layout:** Grid of skill cards with filtering sidebar.

**Components:**
- **Filter bar**: Category dropdown, source filter (All / Admin / Plugin), search input, tags filter.
- **Skill cards**: Each card shows name, description, category badge, source badge (admin/plugin), tag pills, file count indicator (for directory skills), assignment count, enabled/disabled indicator.
- **Empty state**: "No skills yet" with CTA to create first skill.
- **Actions**: "New Skill" button, "Import Skill" button in header.

**Data flow:** `trpc.skills.list.useQuery(filters)` consumed via tRPC client.

### 12.2 Skill detail/editor page — `/admin/skills/[id]`

**Route:** `apps/web/app/admin/skills/[id]/page.tsx`

**Layout:** Two-column: editor on left, metadata + assignments on right.

**Left column — simple skills:**
- **Name** field (editable for admin skills, read-only for plugin skills).
- **Content** editor: Full markdown editor with preview toggle for the SKILL.md content.
- **Description** field.
- **Save** button.

**Left column — directory skills:**
- **File browser sidebar**: Tree view of the skill directory. Click a file to open it in the editor. "Add File" button to create a new file with a relative path. "Delete" button per file.
- **SKILL.md** editor: Always shows the entrypoint. Other files show when selected in the file browser.
- **Description** field.
- **Save** button (saves all modified files).

**Right column:**
- **Metadata card**: Source (admin/plugin), slug (read-only after creation), category dropdown, tags editor, requires-tools editor, version, file count, total size.
- **Assignments card**: List of current assignments (global, team, agent) with scope badges. "Assign" button opens a modal with scope picker + agent/team selector.
- **Danger zone**: Delete button (admin skills only, plugin skills show "managed by plugin" note).

**Data flow:** The admin UI always reads from and writes to the DB via tRPC, never the host filesystem. When saving edits, the tRPC mutation updates DB rows, invalidates the filesystem cache (delete and re-materialize), and triggers sandbox re-sync for affected agents.

**Read-only mode:** Plugin-contributed skills show content as read-only with a note: "This skill is managed by plugin [plugin-name]. Edit the plugin source to modify."

### 12.3 Skill builder (create new) — `/admin/skills/new`

**Route:** `apps/web/app/admin/skills/new/page.tsx`

**Layout:** Guided form.

**Steps (single page, not a wizard):**
1. **Name + Slug**: Name field, slug auto-generated from name (editable). Live slug availability check.
2. **Category + Tags**: Category dropdown, tag input, requires-tools input.
3. **Skill Type Toggle**: "Simple" (single SKILL.md) or "Directory" (SKILL.md + supporting files).
4. **Content**: Markdown editor for SKILL.md. If "Directory" selected, also show an "Add Files" section to add supporting files with relative paths.
5. **Create** button.

After creation, redirect to the detail page.

### 12.4 Skill attachment in agent config — `/admin/agents/[id]`

Add a **Skills** section to the agent detail page. The SkillsSection is placed in position 4 of the canonical agent detail page section order:

1. Identity
2. Soul / Personality
3. Model Configuration
4. **Skills (WS3)**
5. Memory
6. Session
7. Network Policy
8. Triage
9. Capabilities / Plugins
10. Cost Limits
11. Eval Performance (WS4)

**Component:** `SkillsSection` (new file at `apps/web/app/admin/agents/[id]/SkillsSection.tsx`).

**Layout:**
- Header: "Skills" with icon, "Attach Skill" button.
- List of currently attached skills (from `skills.listForAgent`), showing:
  - Skill name and description.
  - Source badge (admin / plugin).
  - Scope badge (global / team / agent — global/team assignments are shown but not editable here).
  - File count indicator (for directory skills).
  - Auto-inject toggle (for agent-scope assignments only).
  - Priority drag handle or up/down buttons.
  - Remove button (agent-scope only; global/team show "inherited" label).
- "Attach Skill" modal: searchable skill picker, filtered to skills not already assigned to this agent.
- **Sync status indicator**: Shows whether the agent's sandbox is in sync with the assigned skills. "Sync Now" button to force a re-sync.

### 12.5 Navigation

Add "Skills" to the admin nav `mainNavItems` array in `apps/web/app/admin/AdminNav.tsx`:

```ts
{ label: 'Skills', href: '/admin/skills', icon: IconBook2 }
```

Position it after "Plugins" in the nav order.

---

## 13. Plugin Skill Contributions

### 13.1 Updated interface

Extends the existing `SkillContribution` to support directory skills:

```ts
export interface SkillContribution {
  id: string
  name: string
  description?: string
  source:
    | { kind: 'inline'; content: string }
    | { kind: 'file'; path: string }          // path to SKILL.md relative to plugin install dir
    | { kind: 'directory'; path: string }      // path to skill directory relative to plugin install dir
  files?: Array<{                              // supporting files for inline skills
    path: string
    content: string
  }>
  tags?: string[]
  category?: string
  requiresTools?: string[]
  defaultEnabled?: boolean
}
```

### 13.2 Registration flow

When a plugin is enabled:

1. Iterate over the plugin module's `skills` array.
2. For each `SkillContribution`:
   - Derive slug from `id`.
   - Upsert into `skills` table with `source_kind = 'plugin'`, `plugin_id` set, and `content` populated:
     - For `inline` kind: Use `content` directly as the SKILL.md content.
     - For `file` kind: Read the referenced SKILL.md from the plugin's install path.
     - For `directory` kind: Read the SKILL.md from the directory in the plugin's install path.
   - Create `skill_files` rows for any supporting files (with file content stored in the DB):
     - For `inline` kind: Create rows from the `files` array.
     - For `directory` kind: Read supporting files from the plugin's install path.
   - Materialize the skill directory to `/app/data/skills/<new-uuid>/` from DB rows.
   - If `defaultEnabled` is true, create a global assignment if one doesn't exist.
3. When a plugin is disabled, set `enabled = 0` on its contributed skills (do NOT delete — preserve assignments for re-enable).
4. When a plugin is uninstalled, delete its contributed skills (cascades assignments) and remove skill directories.

### 13.3 Content updates on plugin upgrade

On plugin upgrade:
1. Re-read skill content from the plugin's install path.
2. Compare checksums against stored values in the DB.
3. If changed, update DB rows (`skills.content`, `skill_files.content`, checksums), invalidate the filesystem cache (delete and re-materialize from DB), and re-sync to all assigned agent sandboxes.

---

## 14. Categories

### 14.1 Predefined categories

```ts
export const SKILL_CATEGORIES = [
  'general',       // catch-all
  'coding',        // programming, code review, debugging
  'ops',           // deployment, infrastructure, monitoring
  'writing',       // documentation, copywriting, communication
  'research',      // web research, data analysis
  'design',        // UI/UX, visual design
  'testing',       // QA, test strategies
  'security',      // security practices, auditing
  'custom',        // user-defined
] as const

export type SkillCategory = (typeof SKILL_CATEGORIES)[number]
```

### 14.2 Category in UI

Category is a dropdown in the skill editor and a filter in the catalog. The `custom` category is available for skills that don't fit predefined buckets.

---

## 15. Open Questions

### 15.1 Skill versioning — RESOLVED

Should DB skills have full version history (like plugins) or is the current single-row-with-checksum sufficient? A `skill_versions` table would enable rollback but adds complexity.

**Decision:** Deferred to post-v1. Single-row with checksum is sufficient. The `version` and `checksum` fields on the `skills` table handle change detection. A `skill_versions` table can be added later if operators need rollback.

### 15.2 Skill sharing / community catalog — RESOLVED

Should there be a public skill catalog (like a marketplace) or is import/export sufficient for sharing?

**Decision:** Deferred to post-v1. Import/export JSON only for v1. Cross-instance sharing is important — the portable skill format (section 9) should be designed with sharing in mind, similar to the agent profile `.nitejar-agent.json` format from WS5. A community catalog (curated GitHub repo, catalog endpoint, etc.) can be layered on top of the portable format later.

### 15.3 Skill embeddings for semantic matching — RESOLVED

Should skills have embeddings for semantic search (like memories do)?

**Decision:** Deferred to post-v1. Names, descriptions, and tags are sufficient for skill lookup in v1. Semantic search adds value when the catalog is large (100+ skills). An `embedding` column can be added later if needed.

### 15.4 Agent self-service skill creation — RESOLVED

Should agents be able to create skills (via a tool), similar to how they create memories?

**Decision:** Deferred to post-v1. Skills are admin-authored for v1. Agent-created skills blur the line with memories and need careful product thinking around trust and curation. Revisit after the admin workflow is stable.

### 15.5 Skill composition — RESOLVED

Should skills be able to reference other skills (e.g., "import" or "extend" another skill)?

**Decision:** Deferred to post-v1. Skills are flat, self-contained directories. Composition can be handled by the operator including relevant content in the skill files.

### 15.6 Auto-inject token budget — RESOLVED

The old 20,000-character budget for auto-injected skill content is obsolete now that skills are sandbox-deployed. Auto-inject now adds brief descriptions, not full content.

**Decision:** 5,000-character budget for auto-inject descriptions is sufficient. Per-agent configurable later if needed.

### 15.7 Repo skill registration in DB — RESOLVED

Should repo skills be automatically registered in the DB when first discovered, creating a "shadow" DB row?

**Decision:** Deferred to post-v1. Repo skills stay ephemeral by design — they belong to the repo, not to the platform. If an operator wants a repo skill to be managed, they can import it into the DB manually via the admin UI. This keeps the boundary clean.

### 15.8 Plugin skill scope — RESOLVED

Who owns the skill tables and registration — WS3 (Skills System) or WS7 (Plugin Runtime)?

**Decision:** WS3 owns skill tables and registration. WS7 defers to WS3 for plugin-contributed skill wiring. When a plugin contributes skills via `SkillContribution`, the plugin runtime calls into WS3's registration flow (section 13.2) rather than managing its own skill storage.

### 15.9 File size limits for DB-stored supporting files — RESOLVED

**Decision:** Per-file limit of 100KB, per-skill total limit of 1MB. Warn in the admin UI at 50KB per file. These are generous for text/markdown content and prevent accidental storage of binary files.

### 15.10 Binary files in skills — RESOLVED

**Decision:** Deferred to post-v1. Skills are text-based instructional content. If a skill needs binary assets, it should reference them by URL or external path, not embed them. This keeps the filesystem lean and the portable format simple.

---

## 16. Implementation Sequence

### Phase 1: Database + Repository + Storage (foundation)

1. Add `SkillTable`, `SkillFileTable`, and `SkillAssignmentTable` types to `packages/database/src/types.ts`.
2. Add tables to the `Database` interface.
3. Create migration `packages/database/migrations/20260301_000000_skills.ts`.
4. Create repository `packages/database/src/repositories/skills.ts` (includes skill file CRUD with content stored in DB).
5. Export from `packages/database/src/repositories/index.ts` and `packages/database/src/index.ts`.
6. Create skill materialization module for host-side cache at `/app/data/skills/` (reads from DB, writes to filesystem).
7. Write repository tests.

### Phase 2: Sandbox sync

1. Create `packages/agent/src/skill-sync.ts` with `syncSkillsToSandbox`, `syncSkillToSprite`, `removeSkillFromSprite`.
2. Integrate sync into the agent save flow (tRPC mutation for assignment changes).
3. Integrate sync into `ensureHomeSandboxForAgent` in `packages/agent/src/sandboxes.ts`.
4. Add sync verification to the runner initialization path.
5. Write sync tests.

### Phase 3: tRPC routes

1. Create `apps/web/server/routers/skills.ts` with all queries and mutations.
2. Wire into `apps/web/server/routers/_app.ts`.
3. Mutations that change content or assignments trigger sandbox sync.
4. Write router tests.

### Phase 4: Skill resolver + runtime integration

1. Create `packages/agent/src/skill-resolver.ts`.
2. Update `use_skill` handler in `packages/agent/src/tools/handlers/filesystem.ts` to resolve from sandbox paths.
3. Update `ToolContext` to carry `resolvedDbSkills`.
4. Update runner to resolve DB skills at run start and pass through context.
5. Update `buildSystemPrompt` to include skill summaries with sandbox paths.
6. Update tool description for `use_skill`.
7. Write resolver tests and update `use_skill` tests.

### Phase 5: Admin UI

1. Add `/admin/skills` catalog page.
2. Add `/admin/skills/[id]` detail/editor page with file browser for directory skills.
3. Add `/admin/skills/new` creation page with simple/directory toggle.
4. Add `SkillsSection` to agent detail page with sync status indicator.
5. Add "Skills" to admin nav.

### Phase 6: Plugin skill registration

1. Wire plugin enable/disable to extract skill directories and create DB rows from `SkillContribution`.
2. Wire plugin uninstall to delete contributed skills and clean up filesystem.
3. Mark plugin skills as read-only in the admin UI.

### Phase 7: Import/export

1. Add `skills.import` and `skills.export` tRPC mutations.
2. Support JSON (schema version 2) and tarball formats.
3. Add import/export buttons in the admin UI.

---

## 17. Acceptance Criteria

1. Admin can create, edit, and delete skills (both simple and directory) from the admin UI.
2. Admin can assign skills to agents, teams, or globally.
3. Assigned skills are synced to agent sandboxes at `/home/sprite/.skills/<slug>/` when assignments change.
4. The agent's system prompt includes a summary of available skills with sandbox paths, not full content.
5. Agent can `use_skill` to look up a skill and get its sandbox path and file manifest.
6. Agent can read SKILL.md and supporting files from its sandbox via `read_file`.
7. DB skills override plugin skills override repo skills when slugs collide.
8. Existing repo skill discovery continues to work with zero changes (repo skills are NOT synced to sandbox).
9. Plugin-contributed skills are extracted to the skill filesystem and registered in the DB when the plugin is enabled.
10. Skills can be exported as JSON (with embedded files) and imported on another instance.
11. The admin UI shows a unified skill catalog with source attribution and file counts.
12. Skill assignments cascade-delete when a skill is deleted. Sandbox cleanup is triggered.
13. Plugin skills are set to disabled (not deleted) when the plugin is disabled.
14. Directory-based skills display a file browser in the admin UI editor.
15. Supporting files in skills are accessible to the agent through the sandbox filesystem.
16. Sandbox sync is triggered on skill content changes, assignment changes, and sandbox creation.
17. Extended frontmatter fields (`tags`, `category`, `requires-tools`) are parsed from repo skills and stored for DB skills.
18. The admin UI shows sync status for skill assignments on the agent config page.
