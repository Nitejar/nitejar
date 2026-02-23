# Open Source Sprint — Ship Weekend

Status: Planning
Last updated: 2026-02-20

## Context

Airtable launched Hyperagent — a closed, enterprise agent platform with the same architecture we've been building independently: fleet management, skills, memories, evals, multi-channel deployment, cost tracking. The convergence validates the market. The move: open source before they can, build community they never will.

## Workstreams

These are parallelizable. Each can be owned by a separate session/worktree.

---

### WS-1: Open Source Readiness

**Goal:** Repo is safe, licensed, and cloneable by strangers.

- [ ] **Secrets audit** — scan git history for leaked keys, tokens, .env values. Tools: `trufflehog`, `gitleaks`, or manual grep for patterns (`sk-`, `ghp_`, `ENCRYPTION_KEY=`, bearer tokens).
- [ ] **License** — pick and add `LICENSE` file. Candidates: AGPL-3.0 (copyleft, protects against closed forks) or MIT (max adoption). Recommendation: **AGPL-3.0** — keeps the playing field level against enterprises wrapping your code.
- [ ] **.gitignore audit** — ensure `.env`, `*.db`, `/data`, credentials, and local plugin artifacts are excluded.
- [ ] **Strip internal references** — remove any internal URLs, Slack webhooks, personal config, hardcoded IDs.
- [ ] **Docker image builds** — verify `Dockerfile` produces a working image from clean clone.
- [ ] **First-run experience** — clone → `pnpm install` → `pnpm dev` → working admin UI + bot. Document minimum env vars.

**Deliverable:** Someone clones, follows README, gets a running Nitejar in < 10 minutes.

---

### WS-2: README & Landing Copy

**Goal:** The README is the landing page. Mischief with receipts.

- [ ] **Hero section** — one sentence: what Nitejar is, why it exists.
- [ ] **Architecture diagram** — visual showing: Channels (Telegram/Slack/GitHub) → Agent Runtime → Plugins/Skills/Memory → Admin UI + Receipts.
- [ ] **Quickstart** — 5 steps to running locally. Docker path + source path.
- [ ] **Feature inventory** — what works today (not aspirational). Agents, memory, plugins, cost tracking, routines, collections, credentials, admin dashboard.
- [ ] **Plugin SDK teaser** — show `definePlugin()` and the manifest format. Link to SDK README.
- [ ] **Contributing guide** — how to run tests, how to add a plugin, how to add a skill.
- [ ] **Comparison section** (optional, spicy) — "How is this different from [X]?" Open source. Self-hosted. Extensible. Receipts for everything.

**Tone:** Human, not corpo. Short sentences. Strong opinions. Show the receipts.

---

### WS-3: Skills System

**Goal:** Skills are a first-class primitive distinct from plugins. Skills provide intelligence; plugins provide functionality.

#### What exists today
- Repo-local skills: `.agents/skills/**/*.md` auto-discovered
- `use_skill` tool in agent runtime
- Plugin spec mentions skills as a contribution type

#### What to build

- [ ] **Skills table** — `skills` table with: id, name, description, content (text/markdown), category, tags, source (repo | plugin | admin | community), agent_id (nullable — global vs agent-scoped), created_at, updated_at.
- [ ] **Unified skill resolver** — merges repo skills + DB skills + plugin-contributed skills into one index. Priority: agent-scoped > global > repo.
- [ ] **Admin UI: Skill catalog** — list all skills, filter by category/source. View/edit content.
- [ ] **Admin UI: Skill builder** — guided form: name, description, content editor (markdown), category picker, attach to agent(s).
- [ ] **Agent config: Skill attachment** — select skills to attach to an agent. Attached skills get injected into system prompt context.
- [ ] **Skill import/export** — JSON or markdown format for sharing skills between instances.

#### Deferred (post-launch)
- Community skill marketplace
- Skill versioning
- Skill performance tracking (which skills improve eval scores)
- AI-assisted skill generation ("learn the Stripe API")

---

### WS-4: Eval & Rubric System

**Goal:** Every agent run gets scored. Receipts, not vibes.

#### What exists today
- Spans capture execution metadata
- Inference calls track cost/tokens
- Activity log tracks status (starting/completed/failed)
- No quality metrics or rubrics

#### What to build

- [ ] **Rubrics table** — `rubrics` with: id, name, description, agent_id (nullable), criteria (JSON array of {name, description, weight, scale}).
- [ ] **Eval runs table** — `eval_runs` with: id, rubric_id, work_item_id, scores (JSON), overall_score, judge_model, created_at.
- [ ] **Auto-eval hook** — after work item completes, optionally run eval against attached rubric using a judge model (not the same model that did the work).
- [ ] **Admin UI: Rubric builder** — create rubrics with weighted criteria. Each criterion: name, description, weight (%), 1-5 scale with level descriptions.
- [ ] **Admin UI: Eval dashboard** — per-agent score trends, per-rubric breakdown, run history.
- [ ] **Agent detail: Eval section** — score trend chart, last N eval results, "Run Evaluation" button, "Suggest Improvements" button.
- [ ] **Suggested improvements** — after eval, generate improvement suggestions (skill additions, prompt tweaks, memory updates). Store as pending actions.

#### Deferred (post-launch)
- A/B model comparison with eval gates
- Eval-driven auto-tuning (auto-accept improvements above threshold)
- Community rubric sharing
- Regression detection alerts

---

### WS-5: Agent Builder & Shareable Agents

**Goal:** Build agents interactively. Share them as portable profiles.

#### What exists today
- Full agent CRUD in admin UI (identity, soul/config, model, memory, network policy, cost, sandboxes)
- Agent config stored in DB
- No interactive builder flow
- No export/import

#### What to build

- [ ] **Agent profiles format** — portable JSON/YAML that captures: name, description, system prompt, model preference, attached skills, attached memories (templates), tool access list, plugin requirements, budget limits.
- [ ] **Export agent** — "Export Profile" button on agent detail page. Downloads `.nitejar-agent.json`.
- [ ] **Import agent** — "Import Profile" in agent list. Upload file → preview → create agent with config.
- [ ] **Agent builder flow** — guided wizard: (1) Name & purpose, (2) System prompt with AI assist, (3) Select skills, (4) Configure tools, (5) Set model & budget, (6) Test conversation, (7) Save.
- [ ] **Community agent gallery** (stretch) — curated list of agent profiles in repo or registry.

#### Deferred (post-launch)
- Try-before-save (temp instance you chat with to iterate on config)
- One-click deploy to Slack/Discord
- Agent forking (clone someone else's agent, customize)
- Agent performance comparison

---

### WS-6: Command Center Dashboard

**Goal:** Fleet-level visibility. The Hyperagent "Command Center" but with receipts.

#### What exists today
- Admin dashboard shows recent work items, agent stats, costs
- Individual agent detail pages with run history
- Cost dashboard with limits

#### What to build

- [ ] **Fleet overview cards** — total agents, active now, total runs, avg score, total cost, pending improvements. Top of dashboard.
- [ ] **Agent roster table** — sortable by: runs, avg score, cost, last active. Sparkline trend per agent. Status indicator (active/idle/error).
- [ ] **Active operations sidebar** — currently running agents with duration timers.
- [ ] **Cost breakdown panel** — per-agent cost bar chart. Period selector (today/week/month).
- [ ] **Needs attention panel** — agents with declining scores, pending improvements, error rates above threshold.

#### Deferred
- Real-time WebSocket updates for active operations
- Custom dashboard layouts
- Team-scoped fleet views

---

### WS-7: Plugin System Completion

**Goal:** Get the plugin system from 40% to shippable.

#### Critical path items
- [ ] **Hook lifecycle wiring** — connect the 9 hook points into the agent runner. work_item.pre_create, run.pre_prompt, model.pre_call, tool.pre_exec, response.pre_deliver, etc.
- [ ] **Plugin install E2E** — npm install path working: `nitejar plugin install <package>` or admin UI "Install from npm".
- [ ] **Built-in plugin wrappers** — wrap existing Telegram and GitHub handlers as proper plugins (backward-compatible).
- [ ] **Permission enforcement** — host-boundary checks enforced at runtime, not just documented.
- [ ] **Plugin crash-loop auto-disable** — if a plugin throws N times in M minutes, auto-disable with receipt.

#### Nice to have for launch
- [ ] Git install path (clone from repo URL)
- [ ] `create-nitejar-plugin` scaffolding CLI (partially exists)
- [ ] Plugin event log in admin UI (audit trail of plugin actions)

---

### WS-8: Documentation Site

**Goal:** Public docs site using Fumadocs (Next.js) at `apps/docs`.

#### Structure
```
apps/docs/
  content/             ← public-facing docs (markdown)
    getting-started/
    guides/
    plugins/
    skills/
    api/
  app/                 ← Next.js app routes
  ...
```

Internal specs stay at `docs/specs/` (not published). Public docs live in `apps/docs/content/`.

#### What to build
- [ ] **Fumadocs scaffold** — `apps/docs` with pnpm workspace integration, shared tsconfig
- [ ] **Getting Started** — install, configure, first agent, first conversation
- [ ] **Architecture Overview** — system diagram, how pieces fit together, design philosophy
- [ ] **Plugin SDK Guide** — `definePlugin()`, manifest format, handler/hook/skill contributions, testing
- [ ] **Skills Authoring Guide** — directory structure, SKILL.md format, frontmatter, supporting files, scripts
- [ ] **Admin Guide** — agents, teams, credentials, routines, costs, collections
- [ ] **Eval System Guide** — rubrics, evaluators, pipeline, scoring model
- [ ] **Agent Builder Guide** — wizard, profiles, import/export, sharing
- [ ] **API Reference** — tRPC routes, webhook formats (can be partially generated)
- [ ] **Contributing Guide** — repo setup, testing, PR process, plugin development

#### Deferred
- Auto-generated API reference from tRPC schemas
- Versioned docs (per release)
- Search integration
- i18n

---

## Priority Order

Build the product first, then prep it for public eyes.

### Phase 1: Build (parallel)

1. **WS-3: Skills System** — biggest feature gap vs Hyperagent, new primitive
2. **WS-4: Eval & Rubric System** — receipts doctrine made real, differentiator
3. **WS-6: Command Center** — visual wow factor, fleet-level story
4. **WS-7: Plugin Completion** — already 60-70% done, finish the last mile
5. **WS-5: Agent Builder** — shareable agents, import/export, guided wizard
6. **WS-8: Documentation Site** — Fumadocs scaffold + core docs (can run in parallel)

### Phase 2: Ship (sequential, after code lands)

7. **WS-1: Open Source Readiness** — secrets audit, license, .gitignore, first-run test
8. **WS-2: README & Landing Copy** — write it after you know what you're describing

## Parallelization Plan

All Phase 1 workstreams run concurrently:

| Session | Workstream | Dependencies |
|---------|-----------|-------------|
| Agent A | WS-3: Skills system (DB + backend + resolver + sandbox sync) | None |
| Agent B | WS-3: Skills system (admin UI + builder) | Blocked on A's schema |
| Agent C | WS-4: Eval system (DB + backend + pipeline runner) | None |
| Agent D | WS-4: Eval system (admin UI + evaluator builder) | Blocked on C's schema |
| Agent E | WS-6: Command Center dashboard | None |
| Agent F | WS-7: Plugin system completion (hooks + E2E) | None |
| Agent G | WS-5: Agent builder + shareable profiles | None |
| Agent H | WS-8: Fumadocs scaffold + architecture/SDK/skills docs | None |

Phase 2 starts when Phase 1 lands:

| Session | Workstream | Dependencies |
|---------|-----------|-------------|
| You (product/copy) | WS-2: README | Phase 1 complete |
| Agent I | WS-1: Secrets audit + license + first-run | Phase 1 complete |
| Agent J | WS-8: Remaining docs (admin, eval, agent builder guides) | Features complete |

## Non-Negotiables for Public Launch

1. No secrets in git history
2. License file present
3. Clean first-run path documented and tested
4. Existing features work (no regressions from sprint)
5. README tells a compelling story with honest feature inventory
6. Docs site deploys with at least: Getting Started, Architecture, Plugin SDK, Contributing
