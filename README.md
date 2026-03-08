<h1 align="center">Nitejar</h1>

<p align="center">
  <strong>Your agents are sloppy. Ours have receipts.</strong>
</p>

<p align="center">
  Self-hosted agent orchestration that does the work, tracks the cost, scores the quality, and shows you everything. Open source. Runs on your hardware. No "enterprise plan" upsell.
</p>

<p align="center">
  <a href="https://nitejar.dev">Website</a> &middot;
  <a href="https://nitejar.dev/docs">Docs</a> &middot;
  <a href="#quickstart">Quickstart</a> &middot;
  <a href="#the-receipts">The Receipts</a> &middot;
  <a href="#architecture">Architecture</a> &middot;
  <a href="#plugin-sdk">Plugin SDK</a> &middot;
  <a href="#skills">Skills</a> &middot;
  <a href="#evals">Evals</a> &middot;
  <a href="#contributing">Contributing</a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="License" /></a>
</p>

---

## Why

Every AI agent platform makes the same pitch: *deploy intelligent agents that automate your workflows.* Then you ask three questions and they all fall apart:

1. **What did it actually do?** "It completed the task." Cool. *What did it do.*
2. **How much did that cost?** "We offer transparent pricing tiers." That's not what I asked.
3. **Was it any good?** "Our agents are powered by state-of-the-art—" Stop.

Nitejar answers all three with artifacts you can inspect. We call them receipts. Every run produces a trace of what happened, a ledger of what it cost, and a score of how well it performed. You can replay them. You can trend them. You can show them to your boss when they ask why you gave a robot access to production.

The name is the point. Agents are sloppy. That's fine. What's not fine is sloppy agents with no paper trail.

## Quickstart

### One command (recommended)

```bash
npx --yes @nitejar/cli@latest up
```

What happens:

1. Downloads the right runtime bundle for your OS/arch
2. Creates local state at `~/.nitejar`
3. Runs migrations before boot
4. Starts Nitejar as a background daemon and prints the URL/log path

First boot opens a short setup wizard (TTY only) for access mode/base URL/port.
Use `--no-wizard` to skip it.

Useful commands:

```bash
npx --yes @nitejar/cli@latest status
npx --yes @nitejar/cli@latest logs --follow
npx --yes @nitejar/cli@latest down
```

By default, state lives in:

- `~/.nitejar/data/nitejar.db`
- `~/.nitejar/config/env`
- `~/.nitejar/logs/server.log`
- `~/.nitejar/receipts/migrations/*.json`

### Docker (secondary path)

```bash
docker run -d \
  --name nitejar \
  -p 3000:3000 \
  -v nitejar-data:/app/data \
  -e ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  ghcr.io/nitejar/nitejar:latest
```

Open [localhost:3000](http://localhost:3000). You're running.

### From source (advanced)

```bash
git clone https://github.com/nitejar/nitejar.git && cd nitejar
pnpm install
cp apps/web/.env.example apps/web/.env   # set ENCRYPTION_KEY
pnpm db:migrate && pnpm dev
```

Same URL. Same dashboard.

### Environment (source installs)

| Variable | Required | What it does |
|----------|----------|--------------|
| `ENCRYPTION_KEY` | Yes (source/prod) | Encrypts secrets at rest. `openssl rand -hex 32` |
| `DATABASE_URL` | No | SQLite by default. Postgres URL for production. |
| `APP_BASE_URL` | No (required for public webhooks) | Public URL used for webhook/invite/callback links. |
| `BETTER_AUTH_SECRET` | Yes (source/prod) | Stable auth signing secret. |

Full list in `apps/web/.env.example`.

## The Receipts

Everything below works today. Not a roadmap — click through and check.

**Agents**
- Deploy agents across Telegram, GitHub, Discord, and webhooks from a single config
- Each agent gets its own sandbox, filesystem, tools, and network policy
- Build new agents with an 8-step wizard: name, soul, model, skills, tools, budget, test conversation, save
- Export agents as `.nitejar-agent.json` and import them on another instance

**Operations**
- Command Center for live attention: fleet metrics, hot queues, blocked work, and intervention posture
- Company for structural portfolio management: board summary, saved views, staffing matrix, and team load
- Work for goals, tickets, heartbeats, and queue movement without collapsing everything into sessions
- Per-agent, per-model cost ledger with budget limits — follow the money in Costs
- Routines for scheduled and event-driven runs (cron, webhook triggers, on-event)
- Full execution traces: spans, tool calls, inference calls, messages, errors — follow the breadcrumbs in Activity

**Intelligence**
- Skills: directory packages with markdown, scripts, and reference files deployed to agent sandboxes
- Memory: agents remember across sessions with configurable decay
- Collections: structured data stores agents read and write, with schema validation
- Credentials: encrypted vault with scoped access per agent

**Quality**
- Evals: score every run against rubrics with LLM judges. Gates that must pass. Scores that compose.
- Trend charts, per-criterion breakdowns, improvement suggestions
- Built-in rubric templates: General Assistant, Code Review, Customer Support, Research & Analysis

**Extensibility**
- Plugin system: install from npm, git, or upload. 9-point hook lifecycle. Crash-loop auto-disable.
- Plugin SDK with zero workspace dependencies — `npx create-nitejar-plugin` and go
- Skill authoring through the app or via plugin contributions

## Architecture

```
                  ┌────────────────────────────────────────────┐
                  │                 Dashboard                   │
                  │  Command Center · Company · Work · Agents   │
                  │   Evals · Skills · Plugins · Costs          │
                  │        Routines · Collections               │
                  └─────────────────────┬──────────────────────┘
                                        │
      ┌──────────────────┬──────────────────┬──────────────────┐
      │                  │                  │                  │
┌─────▼──────┐    ┌──────▼──────┐    ┌─────▼──────┐    ┌─────▼──────┐
│  Telegram  │    │   GitHub    │    │  Discord   │    │  Webhooks  │
│  Plugin    │    │   Plugin    │    │  Plugin    │    │  Plugin    │
└─────┬──────┘    └──────┬──────┘    └─────┬──────┘    └─────┬──────┘
      │                  │                  │                  │
      └──────────────────┴──────────────────┴──────────────────┘
                                        │
                               ┌────────▼──────────┐
                               │  Plugin Runtime    │
                               │  Hooks · Loader    │
                               │  Crash Guard       │
                               └────────┬──────────┘
                                        │
                               ┌────────▼──────────┐
                               │  Agent Runtime     │
                               │  Tools · Memory    │
                               │  Skills · Sandbox  │
                               └────────┬──────────┘
                                        │
                  ┌─────────────────────┼──────────────────────┐
                  │                     │                      │
         ┌───────▼───────┐    ┌────────▼────────┐    ┌───────▼───────┐
         │   Database     │    │  Eval Worker    │    │  Cost Ledger  │
         │   SQLite /     │    │  LLM Judge      │    │  Per-agent    │
         │   Postgres     │    │  Rubrics         │    │  Per-model    │
         └───────────────┘    └─────────────────┘    └───────────────┘
```

### Inside the box

```
nitejar/
├── apps/
│   ├── web/                    # Next.js 15 — app UI, webhook API, tRPC server
│   ├── docs/                   # Documentation site (Fumadocs)
│   └── marketing/              # Marketing site (nitejar.dev)
├── packages/
│   ├── nitejar-cli/            # @nitejar/cli — `npx @nitejar/cli up` entry point
│   ├── agent/                  # The agent engine — tools, memory, skill resolver
│   ├── database/               # Kysely ORM, migrations, 50+ tables
│   ├── plugin-sdk/             # Public SDK for third-party plugins
│   ├── plugin-runtime/         # Plugin loader, hook dispatcher, crash guard
│   ├── plugin-handlers/        # Built-in handlers (Telegram, GitHub, Discord, Webhook)
│   ├── runner-sandbox/         # Sandbox execution runtime
│   ├── sprites/                # Sandbox orchestration via Fly.io Machines
│   ├── create-nitejar-plugin/  # npx create-nitejar-plugin
│   └── ...                     # core, config, connectors, shared configs
└── plugins/
    └── nitejar-plugin-webhook/ # A working example plugin
```

## Plugin SDK

Plugins are how Nitejar talks to the outside world. Each plugin handles a channel (Telegram, GitHub, Discord, generic webhooks, your custom thing), and the SDK is fully self-contained — no monorepo required.

```bash
npx create-nitejar-plugin my-plugin
```

That gives you a handler, tests, manifest, and build config. Ship it to npm or install from git.

### The shape of a plugin

```typescript
import { definePlugin } from '@nitejar/plugin-sdk'

export default definePlugin({
  handler: {
    type: 'my-channel',
    displayName: 'My Channel',
    description: 'Nitejar, but in your channel',
    icon: 'brand-slack',
    category: 'messaging',
    sensitiveFields: ['apiToken'],

    validateConfig(config) {
      return { valid: !!config.apiToken }
    },

    async parseWebhook(request, pluginInstance) {
      const body = await request.json()
      return {
        shouldProcess: true,
        workItem: {
          session_key: body.channelId,
          source: 'my-channel',
          source_ref: body.messageId,
          title: body.text.slice(0, 80),
        },
      }
    },

    async postResponse(pluginInstance, workItemId, content) {
      await myChannelApi.send(content)
      return { success: true, outcome: 'sent' }
    },
  },
})
```

Three methods are required: `validateConfig`, `parseWebhook`, and `postResponse`.
Optional methods like `testConnection` and `acknowledgeReceipt` are available for richer setup/runtime UX.

### Manifest (`nitejar-plugin.json`)

```json
{
  "schemaVersion": 1,
  "id": "nitejar.my-plugin",
  "name": "My Plugin",
  "version": "0.1.0",
  "entry": "dist/index.js",
  "permissions": {
    "network": ["api.example.com"],
    "secrets": ["MY_PLUGIN_API_KEY"]
  }
}
```

### Hooks

Plugins can tap into 9 points in the agent execution pipeline:

```
work_item.pre_create → work_item.post_create
  → run.pre_prompt
    → model.pre_call → model.post_call
    → tool.pre_exec → tool.post_exec
  → response.pre_deliver → response.post_deliver
```

Each hook returns `continue` or `block`. If your plugin starts throwing, the crash guard auto-disables it before it takes the system down. You'll find the receipt in the plugin event log.

Full reference: [packages/plugin-sdk/README.md](packages/plugin-sdk/README.md)

## Skills

Agents are only as good as what they know. Skills are how you teach them.

A skill is a directory — a `SKILL.md` with instructions, plus whatever supporting files the agent needs. Scripts it can run. Checklists it can follow. Reference data it can search. The whole directory gets deployed to the agent's sandbox.

```
skills/
  code-review/
    SKILL.md              # What to do, how to do it
    review-checklist.md   # Reference the agent reads
    run-linter.sh         # Script the agent executes
  api-docs/
    SKILL.md
    openapi-spec.json     # Data the agent consults
```

Attach skills to agents globally, per-team, or per-agent. Create them in the app, import/export as `.nitejar-skill.json`, or ship them inside plugins.

## Evals

"The agent is good" is a vibe. "The agent scored 4.2/5.0 on accuracy across 47 runs this week, up from 3.8 after the soul prompt change" is a receipt.

Nitejar's eval system scores agent runs through an extensible pipeline:

```
Run completes
  → Gate evaluators (must-pass checks — did it go off the rails?)
  → Scorer evaluators (weighted quality scores — how well did it do?)
  → Composite score + per-criterion breakdown
  → Improvement suggestions (what to fix next)
```

v1 ships LLM judge evaluators: you define rubrics with weighted criteria and 5-level scale descriptions, and a separate judge model scores each run against them. Four rubric templates to start from: General Assistant, Code Review, Customer Support, Research & Analysis.

The pipeline schema already supports `programmatic`, `statistical`, `safety`, and `custom` evaluator types. The execution logic ships as contributors build them.

Scores, trends, and suggestions live in Evals and on each agent's detail page.

## Development

```bash
pnpm install          # Install dependencies
pnpm dev              # Start dev server
pnpm test             # Run all tests
pnpm test:coverage    # With coverage thresholds
pnpm typecheck        # Type check all packages
pnpm lint             # Lint
pnpm format           # Format with Prettier
pnpm db:migrate       # Run migrations
pnpm db:studio        # Poke around the database
```

### What's under the hood

Node.js 24 &middot; pnpm &middot; Turborepo &middot; Next.js 15 &middot; React 19 &middot; TypeScript &middot; tRPC &middot; Kysely (SQLite or Postgres) &middot; Radix UI &middot; Tabler Icons &middot; Vitest &middot; AES-256-GCM encryption &middot; Fly.io Machines for sandboxes

## Contributing

We need people who build things.

1. Fork it
2. Branch it (`git checkout -b the-thing`)
3. Build the thing
4. `pnpm format && pnpm lint && pnpm typecheck && pnpm test`
5. If you changed a publishable package (`@nitejar/cli`, `@nitejar/plugin-sdk`, `create-nitejar-plugin`), add a changeset: `pnpm changeset`
6. PR it

Maintainers: npm publish for `@nitejar/cli` uses GitHub OIDC Trusted Publishing (no `NPM_TOKEN`). Setup details are in `CONTRIBUTING.md`.

### Good first moves

- **Build a plugin.** `npx create-nitejar-plugin` scaffolds everything. `plugins/nitejar-plugin-webhook/` is a working example.
- **Write a skill.** A directory with `SKILL.md` and supporting files. Teach an agent something new.
- **Add an evaluator type.** Schema supports `programmatic`, `statistical`, `safety`, `custom`. Only `llm_judge` ships today. Pick one and wire it up.
- **Touch up the UI.** `apps/web/app/(app)/` — it's React, it's tRPC, it's all there.
- **Write docs.** `apps/docs/content/` — we use Fumadocs.
- **Find a bug.** Open an issue. Include steps to reproduce. We'll get to it.

## License

[Apache License 2.0](LICENSE) — use it, fork it, ship it, sell things built on it. Keep the attribution.

---

<p align="center">
  Sloppy agents are inevitable. Unaccountable ones aren't.<br/>
  <strong>Follow the receipts.</strong>
</p>
