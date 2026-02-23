# WS3 Skills System Review: Gap Analysis and Capability Model

Status: Review document (not a replacement spec)
Audience: Core engineering, product
Last updated: 2026-02-20

---

## 1. Executive Summary

The current WS3 Skills System spec treats skills as **passive text** — markdown content stored in DB rows or discovered from `SKILL.md` files, injected into system prompts or returned by the `use_skill` tool. Claude Code's skill model demonstrates that skills can be significantly richer: directories with supporting files, executable scripts, dynamic context injection, tool/permission scoping, and subagent execution.

Meanwhile, Nitejar's plugin system (PLUGIN_SYSTEM_SPEC) already occupies the "run arbitrary code" space with hooks, integration handlers, and a full trust/permission model.

This review asks: **what is the right capability boundary for Nitejar skills?** The answer is not "copy Claude Code's model" — Nitejar is a multi-agent server platform, not a single-user CLI tool. Some capabilities translate directly, some need reinterpretation, and some belong in the plugin layer.

---

## 2. Gap Analysis: Current Spec vs Claude Code's Skill Model

### 2.1 Feature Matrix

| Capability | Claude Code | WS3 Spec (Current) | Gap |
|---|---|---|---|
| **SKILL.md entrypoint** with YAML frontmatter | Yes | Yes (repo skills parse frontmatter for name/description) | Partial — frontmatter fields are limited (name, description, version). Claude Code supports `allowed-tools`, model hints, etc. |
| **Supporting files** (references, examples, specs) | Yes — skill directory siblings | No — skills are single text blobs (DB) or single files (repo) | **Major gap.** Existing repo skills already use `references/` and `templates/` subdirectories (agent-browser has 5 reference docs, 3 template scripts). The spec ignores these. |
| **Executable scripts** (bash, python) | Yes — `scripts/` directory, invoked by agent | Not addressed | **Moderate gap.** Existing repo skills already bundle scripts (crawl, search, extract, research all have `scripts/*.sh`). The spec does not model or resolve these. |
| **Dynamic context injection** | Yes — shell commands in frontmatter run before prompt injection | No | **Minor gap.** Useful for CLI (inject git status, current branch). Less useful for server agents where context comes from work items and integrations. |
| **Tool/permission scoping** | Yes — `allowed-tools` frontmatter restricts which tools the skill can use | No | **Moderate gap.** Relevant for Nitejar — skills that teach browser automation should be able to declare that they need the `bash` tool. This is advisory in Nitejar's model (agents already have tool access), but useful for capability documentation. |
| **Model hints** | Yes — frontmatter can suggest which model to use | No | **Minor gap.** Nitejar agents have model config at the agent level. Per-skill model hints are a nice-to-have. |
| **Subagent execution** | Yes — skills can fork into isolated subagent contexts | No | **Not applicable for v1.** Nitejar runs agents as server-side processes, not interactive CLI sessions. Subagent semantics belong in the agent orchestration layer (WS4), not in skills. |
| **Artifact generation** | Yes — skills can produce files, dashboards, reports | Implicit — agent can use tools to create files | **Non-gap.** Nitejar agents already generate artifacts via tools. Skills don't need special support for this. |
| **Directory-as-skill** (not just a single file) | Yes — skill = directory with SKILL.md + siblings | Repo: partially (directory discovered, but only SKILL.md read). DB: No (single content column). | **Major gap.** The spec's data model cannot represent skills with supporting files. |
| **`use_skill` loads supporting files** | Yes — Claude can read any file in the skill directory | No — `use_skill` reads only SKILL.md content | **Major gap.** The agent-browser skill references 5 docs and 3 scripts. Today `use_skill` returns only the SKILL.md text — the agent would need to know the supporting file paths and read them separately. |
| **Portable skill packages** | Partial — `.claude/skills/` directories can be shared | Yes — JSON import/export, but single-text-blob only | **Moderate gap.** Portable format needs to support multi-file skills. |
| **Community/marketplace** | No formal model | Deferred to post-v1 | Aligned. |

### 2.2 What the Existing Repo Skills Already Do

The `.agents/skills/` directory in this repo already demonstrates the "skill as directory" model that the WS3 spec does not account for:

```
.agents/skills/
  agent-browser/
    SKILL.md                          # 358 lines — full command reference
    references/
      authentication.md               # Auth patterns
      session-management.md           # Session docs
      snapshot-refs.md                # Ref lifecycle docs
      video-recording.md              # Recording docs
      proxy-support.md                # Proxy docs
    templates/
      authenticated-session.sh        # Executable script
      form-automation.sh              # Executable script
      capture-workflow.sh             # Executable script
  crawl/
    SKILL.md                          # API reference
    scripts/
      crawl.sh                        # 213-line executable script
  nitejar-dev/
    SKILL.md                          # Dev workflows
    references/
      database.md                     # Schema reference
  tavily-best-practices/
    SKILL.md                          # Overview + routing
    references/
      crawl.md, extract.md, integrations.md, research.md, sdk.md, search.md
```

Key observations:

1. **Skills are already directories**, not single files. The SKILL.md is an entrypoint, not the whole skill.
2. **Supporting files are actively referenced** by the SKILL.md content (e.g., `[references/sdk.md](references/sdk.md)`).
3. **Scripts are functional** — `crawl.sh` is a 213-line production script with OAuth handling, JSON parsing, and file output.
4. **The current `use_skill` tool only returns SKILL.md content.** Supporting files are invisible to the agent unless it happens to discover them through filesystem navigation.
5. **The WS3 spec's DB schema (`content TEXT`) cannot represent any of this.** A multi-file skill would need to be flattened into a single blob, losing structure and breaking relative references.

---

## 3. The Skill vs Plugin Boundary

### 3.1 Current Boundary (from the specs)

| | Skills | Plugins |
|---|---|---|
| **What they add** | Intelligence: knowledge, workflows, prompt fragments | Functionality: tools, webhooks, integrations, code |
| **Authored by** | Humans (admin or repo author) | Developers (code packages) |
| **Mutated at runtime** | No | No |
| **Contains executable code** | No (per spec) | Yes |
| **Trust model** | Implicit (text is safe) | Explicit (trust modes, permission grants, consent) |
| **Storage** | DB rows + repo files | Filesystem + DB (manifest, versions, artifacts) |

### 3.2 Where the Boundary Gets Blurry

The current spec says: *"A skill never contains executable code."* But the existing repo skills **already contain executable scripts**:

- `crawl/scripts/crawl.sh` — a 213-line bash script the agent runs via the bash tool
- `search/scripts/search.sh`, `extract/scripts/extract.sh`, `research/scripts/research.sh` — similar
- `agent-browser/templates/*.sh` — template scripts for browser workflows

These scripts are not "plugins" — they don't register webhooks, contribute tools, or participate in lifecycle hooks. They are **instructional artifacts that the agent can execute**, similar to how a human might follow a skill document that includes "run this command."

The real boundary is not "code vs no code" — it is **who runs the code and how it gets there**:

| | Skills | Plugins |
|---|---|---|
| **Code execution model** | Agent decides to run scripts from skill content, using existing tools (bash, etc.) | Plugin code runs in the host process, invoked by the runtime at hook points |
| **Registration** | Passive — discovered from files or stored in DB | Active — installed, validated, enabled, given permissions |
| **Trust surface** | Script content is visible text the agent interprets; execution happens through the agent's existing tool permissions | Plugin code runs with host-process access; requires explicit trust/permission model |
| **Lifecycle** | No startup/shutdown; loaded on demand | Boot sequence, activation, crash-loop protection |

### 3.3 Proposed Boundary

**Skills = intelligence + instructional resources** (text, references, templates, example scripts). Skills teach an agent *how* to do something. If a skill includes a script, the agent executes it through its own tool capabilities (bash tool, file tools), constrained by the agent's existing permissions. Skills never run code in the host process.

**Plugins = platform functionality** (webhooks, tool definitions, lifecycle hooks, integration handlers). Plugins add *what* an agent can do by extending the platform runtime. Plugin code runs in the host process and requires explicit trust and permission grants.

The key insight: **scripts bundled with a skill are not "skill code" — they are content the agent interprets.** A bash script in a skill directory is no different from a code snippet in the SKILL.md itself. The agent reads it, decides whether to run it, and executes it through the bash tool. The trust boundary is the agent's tool permissions, not the skill system.

This means skills CAN contain scripts without violating the "skills are not plugins" boundary. What skills cannot do is:
- Register themselves as webhook handlers
- Inject code into the host process lifecycle
- Define new tools or modify tool behavior
- Access secrets directly (they go through the agent's credential tool)
- Run at boot time or outside an agent session

---

## 4. Recommended Skill Capabilities for Nitejar v1

### 4.1 Adopt: Directory-Based Skills

**Why:** The repo already has multi-file skills. The spec must model this reality.

**What changes:**
- Skills are directories with a `SKILL.md` entrypoint, not single files.
- DB skills gain a `files_json` column (or a `skill_files` join table) to store supporting files.
- `use_skill` returns the SKILL.md content AND a manifest of available supporting files.
- A new tool or `use_skill` parameter lets the agent load specific supporting files by relative path.

### 4.2 Adopt: Supporting File Resolution

**Why:** Skills like `agent-browser` reference supporting docs (`references/authentication.md`) and templates (`templates/form-automation.sh`). The agent needs to access these.

**What changes:**
- For repo skills: `use_skill` returns a file listing alongside the SKILL.md content. The agent can then use `read_file` to access supporting files at their absolute paths.
- For DB skills: supporting files are stored in a `skill_files` table or as entries in `files_json`. `use_skill` returns them inline or provides a way to load them.
- For plugin-contributed skills: supporting files are read from the plugin's install directory.

### 4.3 Adopt: Extended Frontmatter

**Why:** Claude Code's frontmatter includes useful metadata beyond name/description. Some of these are relevant to Nitejar.

**Adopt for v1:**
- `name` (already supported)
- `description` (already supported)
- `version` (already in DB schema, not parsed from frontmatter)
- `tags` — useful for filtering and discovery
- `category` — useful for catalog organization
- `requires-tools` — advisory list of tools the skill expects the agent to have (e.g., `["bash", "read_file"]`). Not enforced, but shown in admin UI and used for compatibility warnings.

**Defer:**
- `allowed-tools` (tool restriction/scoping) — in Claude Code this restricts which tools a skill can use. In Nitejar, tool access is controlled at the agent level. Per-skill tool scoping adds complexity without clear v1 value.
- `model` hints — agent-level config is sufficient.

### 4.4 Adopt: Script Awareness (Not Execution)

**Why:** Skills already bundle scripts. The system should know about them and present them to the agent in a structured way, even though the agent executes them through its own tools.

**What changes:**
- When `use_skill` resolves a directory skill, it includes a `scripts` section listing available scripts with their paths.
- The SKILL.md content already references these scripts (e.g., `./scripts/crawl.sh`). The resolver translates relative paths to absolute sprite paths.
- No new execution machinery is needed — the agent uses the bash tool to run scripts, exactly as it does today.

### 4.5 Defer: Dynamic Context Injection

**Why:** Claude Code's `context:` frontmatter runs shell commands to inject live data (git status, environment info) before the skill prompt is seen. In Nitejar's server context, this is less useful:
- Agent context comes from work items, integrations, and the prompt builder — not from ad-hoc shell commands.
- Running arbitrary commands at skill-load time introduces unpredictable latency and failure modes in a multi-agent server.
- The same effect can be achieved by the agent running commands after loading the skill.

**Revisit when:** Per-agent runtime contexts become more customizable, or when skills need to adapt their content based on the agent's current state.

### 4.6 Defer: Subagent Execution

**Why:** In Claude Code, a skill can run as a forked subagent context. In Nitejar, agent orchestration is a separate concern (handled by the runner, team context, and future WS4 multi-agent features). Skills should not spawn agents.

### 4.7 Defer: Permission Scoping per Skill

**Why:** In Claude Code, skills can restrict which tools are available. In Nitejar, tool access is controlled at the agent and team level. Adding per-skill permission scoping creates a complex interaction between agent permissions, team permissions, and skill permissions. Not needed for v1.

---

## 5. Schema/Format Implications

### 5.1 DB Schema Changes

The `skills` table needs to accommodate multi-file skills without losing the simplicity of single-text skills.

**Option A: `skill_files` join table (recommended)**

```sql
-- Existing skills table stays mostly the same, but `content` becomes
-- the SKILL.md entrypoint content specifically.
-- Add columns:
--   is_directory INTEGER NOT NULL DEFAULT 0  -- 0 = inline text, 1 = has supporting files

CREATE TABLE skill_files (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL,
  relative_path TEXT NOT NULL,     -- e.g., 'references/database.md', 'scripts/crawl.sh'
  content TEXT NOT NULL,           -- file content
  content_type TEXT,               -- 'text/markdown', 'application/x-sh', etc.
  checksum TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_skill_files_path ON skill_files (skill_id, relative_path);
CREATE INDEX idx_skill_files_skill ON skill_files (skill_id);
```

**Rationale:** A join table is cleaner than a JSON blob for querying, indexing, and individual file updates. It also makes it easy to lazy-load supporting files.

**Option B: `files_json` column on skills table**

Simpler but less flexible. Store supporting files as a JSON array of `{ path, content, contentType }` objects. Harder to query and update individually. Fine if skills rarely have many supporting files.

**Recommendation:** Option A. The existing repo skills already have 3-6 supporting files each. A join table handles this cleanly.

### 5.2 Extended Frontmatter Parsing

The `parseFrontmatter` function in `context-loader.ts` currently extracts only `name` and `description`. Extend to parse:

```yaml
---
name: agent-browser
description: Automates browser interactions...
version: 1.0.0
tags: [browser, automation, testing]
category: testing
requires-tools: [bash]
---
```

The parsed frontmatter should map to `ResolvedSkill` fields so repo skills and DB skills have the same metadata shape.

### 5.3 Skill Resolver Changes

The `ResolvedSkill` interface needs new fields:

```ts
export interface ResolvedSkill {
  // ... existing fields ...

  /** Whether this skill is a directory with supporting files */
  isDirectory: boolean
  /** List of supporting files (relative paths) — populated for directory skills */
  supportingFiles?: Array<{
    relativePath: string
    /** Absolute path on sprite filesystem (repo skills) or null (DB skills) */
    absolutePath?: string
    contentType?: string
  }>
  /** Tools the skill expects the agent to have (advisory, not enforced) */
  requiresTools?: string[]
  /** Version from frontmatter or DB */
  version?: string
}
```

### 5.4 `use_skill` Tool Changes

Current behavior: returns the full SKILL.md content.

New behavior:
1. Return the SKILL.md content (unchanged).
2. Append a structured section listing supporting files:
   ```
   ## Supporting Files

   This skill includes the following reference files:
   - references/database.md — use read_file to view
   - scripts/crawl.sh — executable script, run via bash tool

   File paths are relative to: /home/sprite/project/.agents/skills/crawl/
   ```
3. For DB skills with supporting files, optionally return supporting file content inline (controlled by a parameter or auto-included if the skill is small enough).

This gives the agent the information it needs to access supporting files without requiring a separate discovery step.

### 5.5 Portable Format Changes

The portable JSON format (section 8 of WS3 spec) needs to support multi-file skills:

```json
{
  "schemaVersion": 2,
  "skill": {
    "name": "Agent Browser Automation",
    "slug": "agent-browser",
    "description": "Automates browser interactions...",
    "category": "testing",
    "tags": ["browser", "automation"],
    "version": "1.0.0",
    "content": "---\nname: agent-browser\n...\n\n# Browser Automation...",
    "files": [
      {
        "path": "references/authentication.md",
        "content": "# Authentication\n\n...",
        "contentType": "text/markdown"
      },
      {
        "path": "templates/form-automation.sh",
        "content": "#!/bin/bash\n...",
        "contentType": "application/x-sh"
      }
    ]
  },
  "metadata": {
    "exportedAt": "2026-02-20T12:00:00Z",
    "exportedFrom": "nitejar"
  }
}
```

### 5.6 Admin UI Changes

The skill editor page (`/admin/skills/[id]`) needs to support multi-file skills:

1. **Main editor tab:** SKILL.md content (the entrypoint).
2. **Files tab:** List of supporting files with individual editors. "Add File" button to add a new supporting file with relative path and content.
3. **Preview tab:** Rendered markdown of the SKILL.md with working relative links to supporting files.

For repo skills (read-only in admin), the files tab shows the supporting files discovered from the filesystem.

---

## 6. Security Considerations

### 6.1 Scripts in Skills Are Not a New Attack Surface

Skills can already contain arbitrary text, including bash commands, code snippets, and instructions that tell the agent to do dangerous things. The addition of structured script files does not change the trust model — it merely organizes content that was already embeddable in the SKILL.md text.

The security boundary is the **agent's tool permissions**, not the skill content. If an agent has bash access, it can run any command — whether that command comes from a skill script, a user message, or the agent's own reasoning.

### 6.2 Admin-Created Skills

Admin-created DB skills (including their supporting files) are authored by the operator. The operator controls what goes into skills, just as they control agent configurations and system prompts. No additional trust model is needed beyond the existing admin authentication.

### 6.3 Plugin-Contributed Skills

Plugin-contributed skills carry the trust level of their parent plugin. If a plugin contributes a skill with a script, the script's trustworthiness is that of the plugin. This is already handled by the plugin trust model (self_host_open, self_host_guarded, saas_locked).

No additional permission grants are needed for skill scripts — the permission model for plugin-contributed skills should be:

- Plugin installs and is enabled with its declared permissions.
- Plugin contributes skills (including supporting files).
- Skills are registered in the DB with the plugin's trust level.
- Agent executes skill scripts through its own tool permissions.
- Receipts trace the execution back to the skill, which traces back to the plugin.

### 6.4 Repo Skills

Repo skills are discovered from the filesystem and are under the control of whoever maintains the repo. In Nitejar's model, repos are cloned onto sprites (VMs), so repo skills are sandboxed within the sprite environment. This is the same trust model as any code the agent encounters in a repo.

### 6.5 What NOT to Do

Do not add a skill-level execution engine that bypasses the agent's tool layer. Skills should never:
- Execute scripts automatically (without agent decision)
- Run code in the host process (that is the plugin model)
- Access secrets directly (go through the credential tool)
- Modify agent permissions at runtime

If a skill needs any of these capabilities, it should be a plugin contribution, not a standalone skill.

---

## 7. Proposed Updated Skill Format

### 7.1 Repo Skill (Directory)

```
.agents/skills/deploy/
  SKILL.md                   # Entrypoint — frontmatter + instructions
  references/
    rollback-procedure.md    # Reference doc
    environments.md          # Environment descriptions
  scripts/
    deploy.sh                # Deployment script
    health-check.sh          # Post-deploy health check
  templates/
    deployment-checklist.md  # Template the agent can adapt
```

**SKILL.md frontmatter (extended):**

```yaml
---
name: deploy
description: Deploy the application to production with safety checks
version: 1.2.0
tags: [deployment, ops, production]
category: ops
requires-tools: [bash, read_file]
---
```

### 7.2 DB Skill (Inline, Simple)

For simple skills that are just text instructions (no supporting files), the existing model works fine:

```json
{
  "name": "Jira Triage",
  "slug": "jira-triage",
  "content": "# Jira Triage\n\nWhen triaging tickets...",
  "category": "ops",
  "tags": ["jira", "triage"],
  "is_directory": false
}
```

### 7.3 DB Skill (Directory, With Files)

For DB skills with supporting files:

```json
{
  "name": "API Review Checklist",
  "slug": "api-review",
  "content": "# API Review\n\nSee [references/checklist.md](references/checklist.md)...",
  "category": "coding",
  "tags": ["api", "review"],
  "is_directory": true,
  "files": [
    { "path": "references/checklist.md", "content": "## Checklist\n..." },
    { "path": "references/security.md", "content": "## Security\n..." }
  ]
}
```

### 7.4 Plugin-Contributed Skill

Plugins contribute skills via `SkillContribution` (unchanged interface) plus an optional `files` array:

```ts
export interface SkillContribution {
  id: string
  name: string
  description?: string
  source:
    | { kind: 'inline'; content: string }
    | { kind: 'file'; path: string }          // path to SKILL.md
    | { kind: 'directory'; path: string }      // NEW: path to skill directory
  files?: Array<{                              // NEW: supporting files for inline skills
    path: string
    content: string
  }>
  tags?: string[]
  category?: string                            // NEW
  requiresTools?: string[]                     // NEW
  defaultEnabled?: boolean
}
```

For `source.kind === 'directory'`, the runtime reads the directory, parses SKILL.md as the entrypoint, and registers all sibling files as supporting files.

---

## 8. Impact on WS3 Spec

### 8.1 Sections That Need Changes

**Section 1.2 (How skills differ from plugins):**
Update the comparison table. Skills CAN contain scripts/code, but these are instructional content the agent runs through its own tools, not host-process code. Clarify the execution boundary.

**Section 2.1 (skills table schema):**
Add `is_directory INTEGER NOT NULL DEFAULT 0` column. Add `requires_tools_json TEXT` column (JSON string array). Add `frontmatter_json TEXT` column (parsed frontmatter for extended metadata).

**Section 2 (new table):**
Add `skill_files` table for supporting files (see section 5.1 above).

**Section 2.3 (Kysely types):**
Add `SkillFileTable` type. Add new columns to `SkillTable`. Update `Database` interface.

**Section 3.2 (ResolvedSkill):**
Add `isDirectory`, `supportingFiles`, `requiresTools`, `version` fields.

**Section 4 (tRPC routes):**
Add file management mutations: `skills.addFile`, `skills.updateFile`, `skills.removeFile`, `skills.listFiles`. Update `skills.create` and `skills.update` to accept files. Update `skills.import` and `skills.export` for multi-file format.

**Section 5 (Repository):**
Add `skill_files` repository functions: `createSkillFile`, `listSkillFiles`, `updateSkillFile`, `deleteSkillFile`.

**Section 6 (Admin UI):**
Add files tab to skill editor. Add file management UI for DB skills. Show supporting files for repo/plugin skills in read-only mode.

**Section 7.1 (System prompt injection):**
No change to the summary list — supporting files are not listed in the system prompt. They are accessed via `use_skill` + `read_file`.

**Section 7.2 (use_skill tool):**
Update to return supporting file manifest alongside SKILL.md content. For repo skills, translate relative paths to absolute sprite paths. For DB skills, indicate that files can be loaded via a follow-up call or include inline.

**Section 8 (Portable format):**
Update schema version to 2. Add `files` array to the portable format.

**Section 9 (Repo skill discovery):**
Update `context-loader.ts` to discover supporting files in skill directories (not just SKILL.md). Store these in the `SkillEntry` type so the resolver knows about them.

**Section 10 (Plugin skill contributions):**
Add `directory` source kind. Add `files` array to `SkillContribution`. Update registration flow to handle multi-file skills.

### 8.2 Sections That Do NOT Change

- Section 3.3-3.4 (resolution algorithm, priority rules) — multi-file skills don't change resolution semantics.
- Section 7.4 (prompt size guard) — still applies, only to the SKILL.md entrypoint content.
- Section 11 (categories) — unchanged.
- Section 12 (resolved open questions) — all resolved decisions remain valid.
- Section 13 (implementation sequence) — phases stay the same, but each phase gains file-related work items.
- Section 14 (acceptance criteria) — add criteria for multi-file skills.

### 8.3 New Acceptance Criteria

Add to section 14:

13. Directory-based repo skills are discovered with their supporting files.
14. `use_skill` returns a supporting file manifest for directory skills.
15. DB skills can have supporting files managed through the admin UI.
16. Plugin-contributed skills can include supporting files via `directory` source kind.
17. Portable format v2 supports multi-file skills (import and export).
18. The admin UI shows supporting files for all skill sources (editable for admin, read-only for repo/plugin).
19. Extended frontmatter fields (`tags`, `category`, `requires-tools`) are parsed from repo skills and stored for DB skills.

---

## 9. Open Questions (New)

### 9.1 File Size Limits for DB-Stored Supporting Files

DB skills with supporting files store file content in the `skill_files` table. Should there be per-file and per-skill size limits?

**Recommendation:** Per-file limit of 100KB, per-skill total limit of 1MB. Warn in the admin UI at 50KB per file. These are generous for text/markdown content and prevent accidental storage of binary files.

### 9.2 Binary Files in Skills

Should skills support binary files (images, PDFs)?

**Recommendation:** Defer. Skills are text-based instructional content. If a skill needs binary assets, it should reference them by URL or external path, not embed them. This keeps the DB lean and the portable format simple.

### 9.3 Relative Path Resolution for Repo Skills on Sprites

When `use_skill` returns supporting file paths for a repo skill, the paths need to be absolute sprite filesystem paths so the agent can `read_file` them. The current implementation resolves `absolutePath` for the SKILL.md itself. The same resolution should apply to supporting files.

**Recommendation:** The skill resolver stores the skill directory's absolute path. Supporting file absolute paths are computed as `skillDirAbsolutePath + '/' + relativePath`. This is straightforward.

### 9.4 Skill Files in the use_skill Response

How should `use_skill` present supporting files?

**Option A:** Return only the manifest (file paths) and let the agent decide which to load via `read_file`.
**Option B:** Return the manifest plus auto-include small files (under 2KB) inline.
**Option C:** Add a `include_files` parameter to `use_skill` that lets the agent request specific supporting files in one call.

**Recommendation:** Option A for v1 (simplest, and the agent is good at deciding what to read). Option C as a fast-follow if agents frequently make unnecessary `read_file` round trips.

---

## 10. Summary of Recommendations

| Decision | Recommendation | Rationale |
|---|---|---|
| Skills as directories | **Adopt for v1** | Already the reality in the repo. Spec must model it. |
| Supporting files in DB skills | **Adopt for v1** | Needed for parity between repo and DB skills. |
| Extended frontmatter | **Adopt for v1** | Low effort, high value for discovery and admin UI. |
| Script awareness | **Adopt for v1** | Skills already bundle scripts. System should know about them. |
| Dynamic context injection | **Defer** | Server-side agents get context from the platform, not shell commands. |
| Tool/permission scoping | **Defer** | Agent-level permissions are sufficient for v1. |
| Subagent execution | **Defer** | Belongs in agent orchestration, not skills. |
| Model hints | **Defer** | Agent-level config is sufficient. |
| Portable format v2 | **Adopt for v1** | Multi-file skills need a multi-file portable format. |
| `skill_files` table | **Adopt for v1** | Cleanest way to store supporting files. |
| Skill-level code execution engine | **Do not adopt** | Violates the skill/plugin boundary. Skills teach; plugins execute. |

The core insight: **make the spec match the reality.** Skills are already directories with supporting files and scripts. The spec should model this honestly, while keeping the fundamental distinction: skills are intelligence that agents interpret, plugins are functionality that the platform executes.
