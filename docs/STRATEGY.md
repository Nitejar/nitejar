# Nitejar Strategy

> A living document. Updated as thinking evolves, reviewed regularly.
>
> Last reviewed: 2026-02-11

---

## Thesis

Software teams will increasingly delegate real work to AI agents — not just code generation in an IDE, but end-to-end workflows: triaging issues, writing and shipping fixes, monitoring CI, managing projects, communicating with stakeholders.

The agents that succeed at this won't be ephemeral prompt-response loops. They'll be **durable identities** — persistent entities with memory, tools, preferences, and history — operating more like junior team members than chatbots.

Nitejar is an open-core platform for running these agents. The bet is:

1. **Durable > ephemeral.** An agent that remembers what it did yesterday, knows the codebase, and has opinions about how to work is dramatically more useful than one that starts fresh every invocation.
2. **Company metaphor > swarm metaphor.** Agents organized like a small company (roles, coordination, shared context, individual identity) will outperform undifferentiated swarms. Humans already know how to manage teams. Agents should fit that mental model.
3. **Autonomy requires trust infrastructure.** Before agents can operate independently, there must be systems for scheduling, outcome tracking, audit trails, and human override. Autonomy without accountability is a liability.
4. **Agent-native by default.** Every capability built into the platform should be accessible to agents, not just humans. If a human can configure an agent through the admin UI, the agent should be able to inspect and adjust that same config through its own tools. If a human tests an integration manually, there should be an agent-accessible way to do the same thing. This is a design constraint, not a nice-to-have: an agent that can't observe, test, or configure its own platform will always depend on a human bottleneck, and "autonomous" becomes a lie. The corollary: humans and agents should be able to collaborate on agent configuration through the same channels they already communicate on (Telegram, GitHub), not just through separate admin interfaces.
5. **Open-core wins the developer layer.** The platform for running agents should be open, self-hostable, and extensible. The hosted multi-tenant version is a business built on top of a community.

---

## Strategic tensions

These are the open questions we keep circling. They don't need to be resolved today — naming them is enough to stop re-litigating them every session.

### Durable agents vs. swarms

**Durable:** Each agent has identity, memory, persistent workspace. Like hiring an employee. Strengths: context accumulation, relationship continuity, learning over time. Weaknesses: state management complexity, harder to scale horizontally.

**Swarms:** Pool of interchangeable agents spun up on demand around a shared knowledge base. Like a staffing agency. Strengths: simple scaling, no state to manage, cheap to replace. Weaknesses: no continuity, cold-start every time, can't build trust with specific humans.

**Current stance:** Durable-first. The architecture (sprites, agent identity, memory system) assumes durable agents. Swarm patterns can be added as an optimization later (e.g., spin up ephemeral sub-agents for parallel tasks within a durable agent's workflow). We don't need to choose one forever — we need to get one working well first.

**Revisit when:** We have 3+ agents running and can observe whether persistent state is actually helping or just creating coordination overhead.

### Agent topology: personal, team, and hybrid

This isn't an either/or tension — it's a configuration axis. The platform should support whatever topology the humans want to run.

**Personal agent:** One agent, one person, one dedicated sprite. The "personal assistant" model. Simple, private, great for individual productivity. Each person gets their own agent with its own memory and workspace. (This is what works well today.)

**Team agent:** One agent serving a whole team. Multiple people make requests. The agent needs to handle concurrency — potentially multiple sprites for parallel work, plus policies for how it handles interruption and prioritization. A shared DevOps bot, a project manager agent, an on-call responder.

**Hybrid:** A team has shared agents for common tasks AND individuals have personal agents. Personal agents can delegate to shared ones. Shared agents can spawn tasks for personal ones. Like having both a helpdesk and individual assistants at a company.

**What this means architecturally:**

The current 1:1 agent:sprite assumption needs to relax. An agent is an identity (brain, memory, personality, tools). A sprite is a workspace (filesystem, shell state, repos). The relationship should be configurable:

- **1:1** — personal agent, dedicated workspace. Current model.
- **1:N** — team agent, sprite pool. Agent gets a sprite per task/session/person. The agent's memory and identity are singular, but its hands can be in multiple workspaces.
- **Ephemeral** — agent spins up a sprite on demand, injects relevant memories/context into it, uses it for a task, and discards it. The agent's durable state lives in the database, not the sprite.

The key insight: **memories and context need to travel with the agent, not live in the sprite.** When a sprite spins up for a task, the agent's relevant memories should be injected so it knows what this workspace is for and what it was doing. The sprite is a tool, not the agent's home. (The agent's home is the database.)

**Interruption and concurrency policies** (per agent, configurable):

| Mode | Behavior | Good for |
|---|---|---|
| Serial | Queue requests, one at a time | Personal assistant, simple tasks |
| Parallel | New sprite per request, work concurrently | Team agent, independent tasks |
| Priority | Interrupt current work for urgent requests | On-call / ops agent |
| Batched | Accumulate requests, process as a group | Digest / review agent |

**Current stance:** Don't redesign the sprite model now, but stop hardening the 1:1 assumption. When building new features, design them so they'd work with 1:N. The immediate implication: agent state (memory, config, context) should always be database-first, sprite-second.

**Revisit when:** Building the second agent, or when the team agent use case becomes concrete.

### Integration identity

Related to agent topology: external platforms (GitHub, Telegram, Slack) aren't designed for multi-agent access. Each platform has its own identity model, and most assume one app = one bot = one identity.

**Shared identity (current):** One GitHub App, one Telegram bot. All agents post as "nitejar." Platform routes internally. Simple to set up, but agents can't have distinct external identities.

**Per-agent identity:** Each agent gets its own platform credentials. Distinct external presence, but onboarding a new agent means walking through GitHub App registration, BotFather, etc. Doesn't scale, can't be automated (platforms gate app creation behind human flows).

**Platform-managed presentation:** One shared infrastructure credential, but the platform presents agent-specific names/avatars where possible. (Slack and Discord support this natively via webhook display names. GitHub and Telegram don't.)

**Current stance:** Shared identity is fine for now. When multi-agent becomes real, the platform should abstract the integration layer so agents share credentials but the system handles routing. Individual identity is a nice-to-have, not a requirement. Provisioning a new agent should mean "create agent in admin, it's immediately connected to all integrations" — not "register 4 new platform apps."

**Revisit when:** Multiple agents need distinct external identities for user trust or clarity.

### Single-agent depth vs. multi-agent breadth

**Depth:** Make one agent extremely good — reliable, autonomous, self-correcting, trustworthy. Then replicate the pattern.

**Breadth:** Get multiple specialized agents working together early — a coder, a reviewer, an ops agent — and figure out coordination.

**Current stance:** Depth first. The single agent can now schedule its own follow-ups (1 of 3 criteria met), but can't yet track outcomes or recover from failures autonomously. Multi-agent coordination on top of unreliable single agents will just multiply the unreliability. Get one agent to the point where you'd trust it to work overnight unsupervised. Then add more.

**Revisit when:** A single agent can: ~~schedule its own follow-ups~~ (done), track whether its actions worked, and recover from failures without human prompting.

### Open-core boundary

**Open:** Core platform, agent runtime, tool framework, integrations, admin UI, single-tenant deployment.

**Closed (SaaS):** Multi-tenant RBAC, billing, managed sprite infrastructure, advanced audit/compliance, SSO, SLAs.

**Current stance:** Everything is open for now. Don't think about the boundary until the open-core is good enough that people actually want to self-host it. The SaaS is a business decision, not an architecture decision — and the architecture already supports both (tiered DB, Docker-first deployment).

**Revisit when:** External users are self-hosting and asking for managed hosting.

### When to deploy

**Ship early:** Get it running on Fly.io, even if rough. Real-world usage reveals problems faster than local dev.

**Build more first:** The agent isn't reliable enough for production use. Deploying now means debugging infrastructure issues instead of building features.

**Current stance:** Deploy soon, but not as a blocker. The Fly.io setup exists, Docker works. A weekend push to get a real deployment running is worthwhile — it forces resolution of config, secrets, and persistence questions that are easy to ignore locally. But don't let "deployment hardening" consume weeks of feature development time.

**Revisit when:** There's a specific reason to have it running 24/7 (heartbeats, external users, demo).

### Inference abstraction: OpenAI SDK vs. ai-sdk

**Current state:** The inference loop uses the OpenAI SDK directly, talking to OpenRouter as an OpenAI-compatible gateway. This works. It's simple, well-understood, and OpenRouter handles model routing.

**ai-sdk (Vercel):** A higher-level abstraction that handles streaming, tool calling, multi-provider routing, structured outputs, and more. Growing ecosystem. Would reduce custom code in `model-client.ts` and potentially simplify adding features like streaming responses, structured tool schemas, and provider-specific capabilities (extended thinking, grounding, built-in web search). But it's a dependency on Vercel's abstractions, and migrating the inference loop has a real cost for unclear gain.

**Current stance:** This is FOMO, not urgency. The OpenAI SDK works. The inference loop isn't the bottleneck — agent capabilities and autonomy are. A migration to ai-sdk would be justified if we hit a specific limitation: needing structured outputs, native streaming to the UI, or multi-provider tool calling that OpenRouter doesn't cover. Until then, it's yak-shaving.

**Revisit when:** We need a capability that ai-sdk provides and our current setup can't do cleanly, or the custom code in `model-client.ts` becomes a maintenance burden.

### Agent capabilities: platform-built vs. provider-native

**The question:** When the agent needs new capabilities — web search, PDF reading, extended reasoning, image generation — should the platform build them as tools, or leverage what inference providers already offer?

**Platform-built:** Add a `web_search` tool that calls a search API, a `read_pdf` tool that extracts text, etc. Portable across any model. Platform controls the UX. Tools can be logged, inspected, and cached. But it's work, and every tool is another thing to maintain.

**Provider-native:** OpenRouter and model providers increasingly ship built-in capabilities — web search, document reading, code execution, extended thinking. These come "for free" with the model, but they're inconsistent across providers, opaque (can't inspect/log the search results the same way), and lock you into specific models or features that may change without notice.

**Current stance:** Lean provider-native for capabilities that are genuinely model-level (extended thinking/reasoning tokens, multimodal input like images and PDFs). Build platform tools for capabilities that need to be logged, cached, or work across models (web search, structured data extraction). The rule of thumb: if the agent needs to *see and reason about* the capability's output (search results, extracted text), build a tool so it's visible in the conversation. If it's about how the model *thinks* (reasoning depth, multimodal understanding), use provider features and pass the right parameters.

**Practical implications:**
- **Reasoning/thinking:** Provider-native. Pass `reasoning_effort` or equivalent params through to the model. Let the model think harder when the task is complex. This is a model config knob, not a tool.
- **Web search:** Probably platform-built. A `web_search` tool that calls a search API (Tavily, Serper, etc.) and returns structured results the agent can cite and reason about. Provider built-in search is a black box.
- **PDF/document reading:** Hybrid. If the model supports multimodal input, send the document directly. For text extraction from PDFs the model can't read natively, a platform tool makes sense.
- **Image generation:** Provider-native if available (DALL-E via tool_use), or platform tool calling an API. Low priority either way.

**Revisit when:** Provider capabilities stabilize enough that the inconsistency tax drops, or when we need capabilities that no single provider offers natively.

---

## Capability layers

How the system's capabilities build on each other. Lower layers enable higher ones. This is the dependency graph of *what the system can do*, not a task list.

```
┌─────────────────────────────────────────────────────────────────┐
│  Layer 5: BUSINESS                                              │
│  Multi-tenant · Billing · SaaS · Growth                         │
│  "Other people pay to use this"                                 │
├─────────────────────────────────────────────────────────────────┤
│  Layer 4: PLATFORM                                              │
│  Security hardening · Deployment · Open-core packaging          │
│  Prompt injection defense · Exfiltration prevention             │
│  "Strangers can run this safely"                                │
├─────────────────────────────────────────────────────────────────┤
│  Layer 3: COORDINATION                                          │
│  Multi-agent routing · Shared knowledge · Org structure         │
│  Task delegation · Parallel work · Agent-to-agent communication │
│  "Agents work together like a team"                             │
├─────────────────────────────────────────────────────────────────┤
│  Layer 2: INTELLIGENCE                                          │
│  Outcome tracking · Learning from experience · Context surfacing│
│  Journal → insights loop · Progressive trust / autonomy         │
│  "Agent gets better over time"                                  │
├─────────────────────────────────────────────────────────────────┤
│  Layer 1: AUTONOMY                                              │
│  Scheduling · Heartbeats · Self-initiated work · CI reaction    │
│  Follow-up loops · Async result polling                         │
│  "Agent acts without being asked"                               │
├─────────────────────────────────────────────────────────────────┤
│  Layer 0: INFRASTRUCTURE (mostly done)                           │
│  Webhooks · Integrations · Sprites · Inference loop · Admin UI  │
│  Message persistence · Session management · Memory (basic)      │
│  Flexible agent:sprite topology · Context injection              │
│  "Stimulus in, response out — however humans configure it"       │
└─────────────────────────────────────────────────────────────────┘
```

**We are here:** Layer 0 works for the personal-agent/1:1 case. The 1:N topology and context injection aren't built yet but the path is clear — keep agent state in the database, treat sprites as disposable workspaces. Layer 1 is partially built — deferred scheduling and response delivery work end-to-end (agent can schedule a follow-up, ticker fires it, response is delivered back to the originating conversation). CI-reactive scheduling is live (`check_run` webhook handler routes completed CI results into the agent's session). Heartbeats are designed but not yet implemented. Layer 2 and above are conceptual.

**The critical insight:** Layers 1 and 2 are where the most value is right now. An agent that can schedule its own follow-ups (L1) and learn from whether they worked (L2) is a qualitative leap from the reactive agent we have today. And these two layers together are what make Layer 3 (multi-agent) actually work — you can't coordinate agents that can't even track their own outcomes. Meanwhile, relaxing the 1:1 agent:sprite assumption at Layer 0 should happen incrementally as we build upward — not as a separate project, but as a design constraint ("would this work if the agent had multiple sprites?").

---

## Current state — honest assessment

**What works well:**
- End-to-end Telegram and GitHub flows
- Agent merges its own PRs
- Sprites provide persistent execution environment
- Session queuing handles concurrent work
- Admin dashboard for visibility
- Memory system (add/remove/update/recall with TASK/FACT conventions)
- Multimodal Telegram support
- Network policy management
- Resilient model fallbacks
- Deferred scheduling — agent schedules follow-ups, ticker fires them, responses delivered to originating channel
- Agent introspection — `get_self_config` tool for reading own config/status
- CWD tracking, AGENTS.md/SKILL.md context injection
- CI-reactive scheduling — `check_run` webhook routes completed CI results into the agent's PR session
- Cost tracking — `inference_calls` table logs every model call (tokens, cost, model, duration, tool calls, finish reason), with per-agent/per-job/per-source aggregation, daily trends, and budget limit enforcement in the inference loop
- Execution tracing — `spans` table captures hierarchical traces (job → turn → model_call/tool_batch → tool_exec), enabling post-hoc debugging of agent behavior
- Admin UI: activity feed homepage, global costs dashboard with charts, per-agent cost section with limits, TraceView for inspecting job execution traces, nav restructured (Activity/Agents/Costs/Settings)

**What's missing or weak:**
- Agent capabilities are thin — no web search, no document reading, no control over reasoning depth
- Feedback loop is partial — agent gets CI notifications but doesn't yet track outcomes structurally
- Memory is basic — no structured learning from outcomes
- Heartbeats/cron scheduling — the `recurrence` column exists but isn't processed yet
- No MCP server — admin UI is the only way to inspect/configure agents; no IDE or programmatic access
- Platform testing requires human interaction (e.g., Telegram can only be tested by a person chatting)
- Human and agent operate through separate interfaces (admin UI vs tools) with limited overlap
- 1:1 agent:sprite assumption — can't run a team agent with parallel workspaces
- Agent state partially lives in sprite filesystem — not fully portable to new sprites
- Integration identity is shared (one GitHub App, one Telegram bot) — no per-agent external identity
- Single agent only — no coordination model
- Not deployed to production (Fly.io setup exists but not actively running)
- No auth system on the web UI (anyone with the URL can access admin)
- No prompt caching (cost optimization)
- No security hardening for untrusted users

**What's over-designed for current needs:**
- The M2-M6 roadmap milestones are good directional markers but too rigid — the actual path will be more organic
- Auth system tasks (better-auth, user/team APIs) were created prematurely — no external users yet

---

## Strategic themes

Grouped by what they enable, roughly ordered by dependency. Each theme has a "smallest next step" — the thing you'd do in a single session to make progress, without committing to the whole theme.

### Theme 1: Close the loop (Layers 1-2)

**Why:** The single biggest unlock. An agent that pushes code and then *checks if it worked* is fundamentally different from one that pushes and hopes.

**Includes:** Agent scheduling, heartbeats, CI webhook events, outcome tracking, journal, expectation/signal matching.

**PRDs exist:** `prd-agent-scheduling.md`, `prd-outcome-tracking.md`

**Done so far:** `scheduled_items` table, server ticker (30s poll), `schedule_check`/`list_schedule`/`cancel_scheduled` tools, response delivery (deferred check fires → ticker awaits agent run → response delivered to originating conversation), and `check_run` webhook handler (completed CI results routed into the agent's PR session so it can react to pass/fail).

**Smallest next step:** Outcome tracking. The agent now *receives* CI results but has no structured way to connect them back to its original intent. Two paths:

- **Lightweight:** A `journal` table where the agent logs intent before acting ("pushing fix for lint error on PR #3, expecting CI to pass") and incoming signals (check_run results) get matched to open journal entries. Simple success/failure tracking. Enough to answer "what % of the agent's actions worked?"
- **Full PRD:** The complete journal system from `prd-outcome-tracking.md` — `journal_entries`, `journal_expectations`, `journal_signals` — with structured expectation/signal matching, assessment lifecycle, and automatic resolution.

Start lightweight. The full system can be layered on later once we understand what patterns emerge from the simple version. The goal is the same either way: bridge from Layer 1 (autonomy) to Layer 2 (intelligence).

### Theme 2: Deploy and run (Layer 4)

**Why:** Running in production forces real-world reliability. Also required before heartbeats are useful (agent needs to be always-on).

**Includes:** Fly.io deployment, persistent SQLite/Postgres, env config, basic uptime.

**Smallest next step:** Do a fresh `fly deploy` with current code. Don't try to make it perfect — just get it running and see what breaks. The deployment guide and Dockerfile already exist.

**After that:** Set up a heartbeat-ready deployment (always-on process, not just request-response).

### Theme 3: Cost tracking & efficiency (standalone)

**Why:** You can't make informed model decisions without knowing what things cost. Running on free models works but limits capability. Before switching to paid models — or letting agents choose their own models — you need to see what inference actually costs per agent, per conversation, per tool call.

**Includes:** Usage logging (tokens in/out per model call), cost estimation, per-agent cost dashboards, prompt caching, model selection per task type, budget caps/alerts.

**Done so far:** `inference_calls` table with per-call logging (job, agent, turn, model, tokens in/out, estimated cost, tool calls, finish reason, duration, fallback flag). Model pricing map for cost estimation. Per-agent and global cost aggregation queries. tRPC router with summary, trend, per-agent, per-source, and top-expensive-jobs endpoints. Global costs dashboard page (`/admin/costs`) with stat cards, daily trend chart, spend-by-agent and spend-by-source bar charts, top expensive jobs table, and all-agents budget limits view. Per-agent cost section on agent detail page with source breakdown, daily trend, and cost limit management (add/delete limits). Cost limit enforcement in the inference loop — checks before each model call, warns the agent at 100% of budget, hard-stops at 150%.

**Smallest next step:** Prompt caching. Add `anthropic-beta: prompt-caching-2024-07-31` header and cache control breakpoints to the system prompt in the inference loop. Immediate cost savings for Anthropic models.

**After that:**
- Per-agent model configuration (cheap model for heartbeats, capable model for complex coding).
- Cost attribution by task type (scheduled check vs. human request vs. CI reaction) — the data is there (`source` field on work items), just needs a dashboard view.
- OpenRouter cost pass-through — use `x-openrouter-cost` header from responses for exact pricing instead of estimated pricing map.

### Theme 4: Security & trust (Layer 4)

**Why:** Required before open-core release. Required before running untrusted agent tasks. The network policy work already started is part of this.

**Includes:** Prompt injection defense, output filtering, exfiltration prevention, tool permission profiles, sandboxing, admin auth.

**Smallest next step:** Add basic auth to the admin UI. Even just a shared secret/password. Prevents anyone with the URL from controlling your agents.

**After that:** Tool permission profiles (read-only vs full access) — this also enables safer heartbeats (Theme 1).

### Theme 5: Integration breadth (Layer 0+)

**Why:** More integrations = more ways agents can interact with the world. But each integration is independent — add them as needed, not as a batch.

**Includes:** GitHub events (check_run, workflow_run), project planning tools, website deployment, analytics, image generation, email, Slack.

**Smallest next step:** `workflow_run` webhook handler for broader CI visibility (e.g., full workflow status beyond individual check runs). Or whichever integration solves a real problem you're hitting. Don't build integrations speculatively.

### Theme 6: Agent-native surfaces (cross-cutting)

**Why:** If the agent can't inspect, test, or configure its own platform, a human is always the bottleneck. Every feature we build with only a human interface is a feature the agent can't use autonomously. This isn't a separate layer — it's a design discipline that applies to every other theme.

**Includes:** Agent self-configuration tools (read/update own config, model, heartbeat settings), platform introspection (health, status, integration state), test harnesses agents can trigger (simulated webhooks, test messages), collaborative config editing through existing channels (Telegram/GitHub), agent-accessible equivalents of admin UI actions.

**How it applies to other themes:**
- **Theme 1 (close the loop):** Agent needs tools to read its own schedule, but also to inspect its own heartbeat config and adjust it based on what it learns.
- **Theme 2 (deploy):** Agent should eventually be able to trigger its own deployment or at least inspect deployment status.
- **Theme 4 (security):** Tool permission profiles need to account for self-configuration (agent can change its own settings but not other agents').
- **Theme 5 (integrations):** Every new integration should have both a human setup path (admin UI) and an agent-accessible surface (tools or API).

**Done so far:** `get_self_config` tool — agent can read its own handle, model, integration count, memory count, sprite, and status. Establishes the pattern that the agent can see its own platform state.

**The MCP server idea:** Instead of building agent-native tools one at a time, expose nitejar's core APIs as an MCP server. This would let any MCP client (Claude Code, other agents, custom tools) interact with live agent config, memories, schedules, and jobs:

- `get_agent_config` / `update_agent_config` — edit agent soul, model, session settings live from your IDE
- `list_memories` / `add_memory` / `search_memories` — manage agent knowledge without opening admin UI
- `list_jobs` / `get_job_log` — inspect what the agent did and how
- `list_scheduled_items` / `create_scheduled_item` — manage the agent's schedule
- `get_sprite_status` — check sandbox health

This bridges the admin UI / developer workflow gap. Instead of switching to a browser to tweak agent config, you do it from your editor. It also dogfoods the "agent-native" principle — the same MCP tools that a human uses from Claude Code could eventually be consumed by other agents.

**Smallest next step:** Build a minimal MCP server exposing read-only endpoints first (`get_agent_config`, `list_memories`, `list_jobs`). This is useful immediately for development and establishes the pattern. Write access comes after, gated by the trust/security story from Theme 4.

### Theme 7: Agent capabilities (Layer 0-1)

**Why:** The agent is only as useful as what it can do. Right now it has bash, file I/O, GitHub, Telegram, and memory. That's enough to write and ship code, but not enough to research, read documents, or think harder about complex problems. Each new capability meaningfully expands what the agent can be trusted with.

**Includes:** Web search, PDF/document reading, extended reasoning/thinking, image understanding, structured data extraction.

**Approach:** See the "Agent capabilities: platform-built vs. provider-native" tension above. In short: build tools for things the agent needs to see and reason about (search results), use provider features for things that affect how the model thinks (reasoning depth, multimodal input).

**Concrete candidates (roughly ordered by value):**

| Capability | Approach | Why it matters |
|---|---|---|
| Web search | Platform tool (Tavily/Serper API) | Agent can research before acting — look up docs, check API references, find solutions. Huge for code quality. |
| Extended reasoning | Provider params (`reasoning_effort`, thinking tokens) | Let the agent think harder on complex tasks. Config knob, not a tool. Pass through to OpenRouter. |
| PDF/document reading | Hybrid — multimodal for supported models, extraction tool as fallback | Agent can read specs, PRDs, documentation shared via Telegram or GitHub. |
| Image understanding | Provider-native (multimodal input) | Already partially works via Telegram multimodal support. Extend to other contexts. |

**Smallest next step:** Web search tool. Call a search API, return structured results (title, snippet, URL), let the agent cite sources. This is a single tool definition + API integration — maybe a session of work — and immediately makes the agent better at every coding task that requires looking something up.

**After that:** Pass reasoning/thinking parameters through the inference loop so the agent (or per-agent config) can control reasoning depth. This is plumbing, not a new tool.

### Theme 8: Multi-agent coordination (Layer 3)

**Why:** The long-term vision. Multiple specialized agents working together. But premature without solid single-agent autonomy.

**Includes:** Agent routing, shared knowledge base, task delegation, org structure, agent-to-agent communication.

**Smallest next step:** Nothing yet. Get single-agent autonomy working first (Themes 1-2). The journal/outcome tracking system from Theme 1 becomes the shared context layer when there are multiple agents.

**Revisit when:** One agent is reliably autonomous (schedules work, tracks outcomes, recovers from failures).

### Theme 9: Open-core & community (Layer 4-5)

**Why:** Eventually the growth path. But there's no community to build for until the product works well enough to demo.

**Includes:** Open-core packaging, documentation, contribution guidelines, security hardening, managed SaaS.

**Smallest next step:** Nothing yet. Focus on making the product good. The codebase is already on GitHub — that's enough open-source presence for now.

**Revisit when:** You have a demo that makes people say "I want to run that."

---

## What to work on now

The high-leverage work falls into two buckets: making the agent smarter/more capable (immediate payoff) and building infrastructure for autonomy (longer-term payoff). Both matter, and single-session tasks from either bucket keep momentum going.

**Immediate wins (single-session each):**

- **Web search tool (Theme 7).** One tool definition + one API integration. Immediately makes the agent better at every task that requires looking something up. High value-to-effort ratio.
- **Reasoning params (Theme 7).** Pass `reasoning_effort` / thinking token params through the inference loop. Config knob, not a new tool. Lets the agent (or per-agent config) think harder on complex tasks.
- **Prompt caching (Theme 3).** System prompt caching via provider headers. Immediate cost savings, low effort.

**Medium-term (multi-session):**

- **MCP server (Theme 6).** Expose nitejar's APIs as an MCP server so you can manage agents from Claude Code. Start read-only. This also establishes the pattern for agent-to-platform communication.
- **Lightweight eval (Theme 1).** The agent receives CI results but can't connect them to intent. Even a simple journal — "I pushed X expecting Y" → "Y happened/didn't" — closes the loop. Start lighter than the full PRD if the full journal system feels heavy.

**Recently completed:**

- **Cost tracking (Theme 3).** Full implementation: `inference_calls` table, model pricing, per-turn logging, cost aggregation, global costs dashboard, per-agent cost section with charts, budget limits with enforcement in the inference loop. The agent now has cost visibility — next step is giving the agent access to its own cost data via tools.
- **Execution tracing.** `spans` table with hierarchical trace capture (job → turn → model_call → tool_exec). TraceView component for post-hoc debugging of agent runs in the admin UI. Moves "session visualization" from the parking lot to shipped.
- **Admin UI refresh.** Activity feed homepage, nav restructured (Activity/Agents/Costs/Settings), work items → Event Log, collapsible details, cost/token metrics throughout.

**Design discipline: Theme 6 (agent-native surfaces).** Still the lens to apply to everything. When building the web search tool, can the agent configure which search provider to use? Cost tracking is now built — can the agent see its own costs via a tool? Every feature gets asked: "can the agent use this too?"

**Avoid for now: Themes 8-9.** Multi-agent and open-core are premature. Theme 5 (integrations) should be demand-driven, not speculative.

---

## Review process

**When starting a session:**

1. Read this doc (or at least the "what to work on now" section)
2. Check where you left off — `task-master next` or recent git log
3. Pick a single-session-sized piece of the current theme
4. Do the work. Update task master. Commit.

**Weekly (or when feeling stuck):**

1. Re-read the strategic tensions section. Has anything changed?
2. Update the "current state" section with what's new
3. Check if any "revisit when" conditions have been met
4. Adjust "what to work on now" if priorities have shifted
5. Note any new ideas in the appropriate theme (don't act on them yet)

**The point of this process isn't to be rigorous.** It's to short-circuit the "what should I work on?" loop that burns an hour at the start of every session. Pick the next small thing in the current theme, do it, ship it. Strategic re-evaluation happens weekly, not every session.

---

## Ideas parking lot

Captured thoughts that don't have a home yet. Move to a theme when they become relevant.

- Shared knowledge base across agents (vector DB? structured memory? just shared file system?)
- Agent personality/voice customization for different contexts
- Analytics dashboard — what is the agent actually accomplishing over time?
- Webhook replay for development/testing (re-process past events)
- Agent "office hours" — configurable availability windows
- Human-in-the-loop approval flows for high-risk actions
- Agent onboarding — when a new agent is created, what's the bootstrap process?
- Self-improvement: agent analyzes its own journal and proposes workflow improvements
- Marketplace for skills/integrations (way future)
- Agent "dry run" mode — run inference without side effects to test prompt/soul changes
- Tool execution analytics — which tools are used most, which fail, how long do bash commands take (data now captured in spans, needs dashboard view)
