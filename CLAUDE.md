# Nitejar Development Guide

> **Rename in progress.** The repo, org, and all internal references are migrating from "Nitejar" to **Nitejar**. When you see "Nitejar" in code, config, or docs, treat it as the old name. New code and copy should use "Nitejar." The rename will happen across the codebase — don't block on it, just use the new name going forward.

## Product Doctrine (Voice + Trust)

We build Nitejar with **mischief with receipts** and **chaos is the UI, trust is the API**.

### Mischief (what it means)

- **Playful framing, precise meaning.** You can be weird in tone, never vague in content.
- **Concrete > abstract.** Prefer specific nouns/verbs ("opened PR, ran CI, posted diff") over generalities ("automation", "platform").
- **Human, not corpo.** Short sentences. Strong opinions. Minimal buzzwords.

### Receipts (what it means)

Every bold claim and every surprising behavior should have an **inspectable artifact** ("receipt") somewhere in the system.

- **Receipts are observable, not vibes.** Examples: a timeline, an attempt/run log, a message transcript, a cost entry, a PR/check, a replayable webhook/test harness.
- **Receipts are addressable.** When writing docs/UI, name where to look (the page, the receipts, the cost tab/ledger), not "we log it".
- **Receipts scale trust.** If the UI copy is spicy, the receipts must be boring and deterministic.

### Chaos Is The UI; Trust Is The API (operational rules)

- **UI/copy can be mischievous.** Product surfaces can feel alive, opinionated, a little unhinged.
- **APIs/data are sober.** Types, routes, DB schema, tool names, logs, and error messages should be plain, explicit, and stable.
- **No jokes in dangerous moments.** Deletes, secrets, permissions, network policy, budget limits, and irreversible actions use clear, serious language.

### Public Lexicon vs Internal Plumbing (code/DB)

User-facing nouns should be human and natural. Internal precision stays internal. We can swap public terms later without changing the plumbing.

Established public vocabulary:
- **Fleet** — a user's collection of agents (used in app + marketing)
- **Agent** — an AI worker with identity, skills, and config
- **Skills** — reusable knowledge/workflow packs
- **Plugins** — channel integrations (GitHub, Telegram, webhooks)
- **Collections** — shared structured data
- **Sessions** — in-app conversations with agents

Rules:

- **Public surfaces do not leak internal nouns.** No table names, type names, route slugs, or implementation terms in UI labels, README copy, or docs.
- **Internal precision stays internal.** Code can keep `WorkItem`, `inference_calls`, "span", etc.; outward copy uses natural language.
- **If you must show internals, translate.** Show the public term, with the internal identifier as a secondary detail (e.g. tooltip, debug panel, "advanced" disclosure).

### Myth Layer (brand/community without lying)

Nitejar gives people an *escape hatch* from the raw truth of "agent automation." The nightjar bird is the mascot — it makes serious systems feel safe to touch.

Operationally:

- **Lead with story, ground in capabilities.** Public copy uses concrete verbs ("triage," "draft," "sync," "alert") and real features. A features section works great when each card maps to a real capability.
- **Two-layer UI:** playful default + boring "under the hood". The playful layer invites; the boring layer earns trust.
- **Never gaslight.** The myth layer is about framing and accessibility, not hiding consequences. Dangerous actions are always plain language.

### Community Loop (design target)

Nitejar is a centralized product with a decentralized culture orbiting it. Design features and docs so they naturally produce shareable artifacts.

- **Make every episode narratable.** The unit of work should produce a clean recap a human can post.
- **Make every recap provable.** Recaps link to activity timelines, cost breakdowns, and execution logs.
- **Reward craft, not vibes.** The community status object is a high-signal artifact (a reproducible setup, a replayable harness, a clean execution trail).

### Copy bar (defaults)

- Avoid: "AI-powered", "leveraging", "seamless", "enterprise-grade", "best-in-class", "next-gen".
- Prefer: "does X", "shows X", "here’s the diff", "here’s the trace", "here’s the cost".
- If a sentence makes a claim, back it up with a concrete artifact ("Check the activity timeline," "See the cost breakdown").

### How to apply this (lightweight, not process)

- When adding a capability, also add or extend at least one receipt path (persisted record, admin view, replayable harness, or deterministic log).
- When writing docs/README/admin copy, include a "where to verify" hint for any non-trivial claim, using the Public Lexicon.

## Public Identity & Marketing

### Nitejar (public name)

The public-facing product name is **Nitejar** (nitejar.dev). Nitejar remains the internal/repo name. The nightjar bird is the mascot. GitHub org: `nitejar/nitejar`.

### Product positioning

Nitejar is a **self-hosted AI agent fleet**. One-liner: *"The operating system for AI agents doing real team workflows."*

Target audience: tech-savvy experimenters, indie hackers, small dev teams. People who'd use n8n or Zapier but want LLM-powered agents that make decisions, summarize, produce content, and take action across channels.

Capability map (maps to app sidebar sections):
- **Command Center:** live fleet health, activity, queue, and cost posture
- **Activity:** cross-channel run history and execution details
- **Agents:** builder + full config (identity, soul, model, skills, plugins, network policy, budgets)
- **Collections:** shared structured data with schema governance and per-agent access
- **Costs:** spend trends, source/agent breakdowns, and budget controls
- **Plugins:** integrations (GitHub, Telegram, webhooks) plus installable custom plugins
- **Skills:** reusable knowledge/workflow/script packs synced to agent sandboxes
- **Evals:** scoring pipelines, evaluator management, and quality trends
- **Sessions:** in-app conversations with one or more agents

Use the word **fleet** when referring to a user's collection of agents. It's used in the app and the marketing site.

### Two-layer aesthetic (marketing vs app)

The marketing site and the app are **intentionally different aesthetics**. This is the two-layer philosophy applied to surfaces:

- **Marketing site** (`apps/marketing`) = the playful brand layer. Dark+gold palette, Instrument Serif display font, starfields, the nightjar bird. It invites people in. Warm and mythic.
- **App** (`apps/web`) = the operational layer. Neutral whites-on-dark, monospace data, shadcn/ui components. It earns trust. Dense and precise.

The contrast is the point. Don't bleed the gold/serif aesthetic into the app, and don't make the marketing site look like a dashboard.

Small bridges that connect them: the bird icon (favicon, empty states), the "Nitejar" wordmark, and sparingly the gold accent color.

### Marketing site design system (`apps/marketing`)

**Stack:** Next.js 15, React 19, Tailwind v4, Motion v12, lucide-react, static export to `out/`

**Palette** (oklch, dark-only — no light mode):
- Night: `night-950` (page bg) through `night-600` (muted text)
- Gold: `gold-500` (primary), `gold-400` (hover), `gold-300` (subtle)
- Moon: `moon-100` (body text), `moon-200` (secondary text)
- Ember: `ember-500` (rare accent, badges)

**Fonts:** Instrument Serif (display/headings), Inter (body), Geist Mono (code/data)

**Logo assets** in `apps/marketing/public/logos/`:
- `wordmark.png` — ornate gold text, used in navbar
- `nitejar-plain.png` — bird+moon illustration, used in hero (transparent bg, trimmed)
- `nitejar-words.png` — bird+moon+text lockup (for OG images, about pages)
- `icon.png` — bird icon, used in footer and as favicon

**Pattern: faux UI** — When showcasing product features on the marketing site, build mock UI panels that mirror the actual app's visual language (`white/[0.06]` borders, `tabular-nums`, uppercase tracking labels, gradient avatar backgrounds, status dots). Pull data patterns from `apps/web/app/(app)/fleet/FleetDashboard.tsx` and related components.

### Marketing copy guidelines

- **Human, not corpo.** Short sentences. Concrete verbs ("triage," "draft," "sync," "alert"). No buzzwords.
- **Action-first.** Lead with what happens, not what the product is. "Your agents triage bugs" not "AI-powered bug management."
- **Don't parrot the design brief.** Copy should sound like a person wrote it, not like it's explaining internal design decisions to a colleague. If a line reads like it came from a product spec, rewrite it.
- **Use "fleet" naturally.** It's our word for a user's agents. "What your fleet does while you're away."
- **Don't overuse "receipts."** The internal doctrine leans on this word heavily. Marketing copy should vary — say "activity timeline," "cost breakdown," "execution log," "here's what it did" instead of repeating "receipts."
- **Personality is the product's, not ours.** Agents are fully customizable. Don't describe them as mischievous — describe the product as giving users full control and visibility.
- **Tone line:** *"A mischievous teammate on the outside, an exacting operator underneath"* — this describes the **brand**, not the agents. Use it for brand voice, not product descriptions.

## Agent Conversation Tenets

These are default behavior rules for multi-agent conversations across plugin-backed channels (Telegram, GitHub, etc.).

- Canonical problem framing + non-negotiable autonomy tenants live in `docs/AGENT_AUTONOMY_PROBLEM.md`.
- **Agents communicate like humans in shared channels.** Agent-to-agent and human-to-agent dialogue in public threads is valid behavior, not an edge case.
- **Agents must self-filter relevance.** If a message is not relevant to an agent, it should defer and continue without unnecessary output.
- **Silent pass is the default.** Do not emit "Not for me" style replies in shared channels unless explicitly requested by product behavior.
- **Steer-first operation.** Default lane mode should favor steer behavior so in-progress work can be redirected instead of spawning fragmented follow-up runs.
- **In-progress handling:** while an agent is running, new messages can arrive and may alter course. The running agent decides whether to continue, adjust strategy, or stop.
- **Addressed-message handling is intent-first, not handle-first.** `@agent` mentions are signals, not hard routing locks.
- **Do not enforce hard platform rules on "other-agent addressee".** Mentions can be referential (for example, "Yeah, @johndoe did that last week") and should not automatically force everyone else to ignore the message.
- **Use semantic triage over username heuristics.** Agents should infer whether a message is a request, reference, or coordination update, then decide to act or silently pass.
- **Do not hard-code decision heuristics.** Avoid brittle string/keyword rewrite rules for agent decisions; prefer model judgment plus explicit state/context, with deterministic guards only for safety-critical constraints.
- **Public handoffs first.** Inter-agent collaboration should be visible in public thread context before introducing private/DM handoff semantics.
- **Receipts over assumptions.** Any routing/steer decision should remain auditable in traces/logs so behavior can be debugged and tuned.

### Local-only execution note

- For autonomy/routing improvements in local development, prefer shipping complete one-go changes (implementation + tests + eval updates) rather than staged rollout flags.

## Development Workflow

**Run things yourself.** Don't ask the user to start servers or run commands - just do it. Use background tasks for long-running processes like `pnpm dev`.

**Dev server policy.**

- In the main repo checkout (non-worktree), always use the existing dev server if one is already running.
- Only start a new `pnpm dev` server when working from a git worktree (or when no server exists in the main checkout).

**Be proactive and independent.** When you encounter issues:

- **Fix type errors and lint issues yourself** - don't report them and wait, just fix them
- **Run migrations automatically** after schema changes (once user has confirmed the changes)
- **Unrelated issues go on a todo list** - add them to the task list and address after completing core priorities
- **Don't stop for fixable problems** - if you can solve it, solve it and move on
- **Fully update impacted areas** - when changing a feature, update the relevant UI, routes, and supporting logic together
- **Remove unnecessary code** as we iterate, especially unused routes, components, and styles
- **Remove legacy cruft** - delete obsolete routes, docs, configs, and code when iterating
- **Use tRPC for admin UI data flows** - add procedures in `apps/web/server/routers`, wire through `apps/web/server/routers/_app.ts`, and consume via `apps/web/lib/trpc.ts` + `apps/web/app/(app)/Providers.tsx`
- **For publishable package changes, add a changeset** - if you change user-facing behavior in `@nitejar/cli`, `@nitejar/plugin-sdk`, or `create-nitejar-plugin`, add a `.changeset/*.md` entry via `pnpm changeset`

**Verifying changes:**

1. `pnpm format` — format all code
2. `pnpm lint` — fix any lint errors
3. `pnpm run typecheck` — zero type errors (do NOT run `pnpm build` while dev server is running)
4. `pnpm test` — all tests pass
5. `pnpm test:coverage` — coverage thresholds met (per-package vitest configs set minimums)
6. If publishable package behavior changed, add/update a changeset: `pnpm changeset`
7. Run migrations if schema changed: `pnpm --filter @nitejar/database db:migrate`
8. End-to-end test: send a realistic Telegram webhook to the dev server
   (`http://localhost:3000/api/webhooks/plugins/telegram/<PLUGIN_INSTANCE_ID>`) and verify
   the agent responds. Check work items and logs. For async features (scheduling),
   sleep and re-check database state.

## Critical Warnings

**DO NOT CHANGE THE AGENT MODEL** unless the user explicitly asks. The default free model (`arcee-ai/trinity-large-preview:free`) works fine. Changing to paid models causes rate limit and cost issues.

**DO NOT RUN BUILDS WHILE DEV SERVER IS RUNNING.** Running `pnpm build` while `pnpm dev` is active corrupts the `.next` cache and causes 500 errors. Stop the dev server first, or use `pnpm run typecheck` for type checking instead.

## Environment

Apps read from `apps/web/.env` (not root `.env`).

Database: `packages/database/data/nitejar.db` (SQLite for local dev). **This is local-only — there is no production database.** Destructive migrations (drop columns, recreate tables) are fine. Transactional data (jobs, messages, inference calls, spans, work items) can be wiped freely. **Do NOT destroy configuration data** (agents, plugin instances, teams, gateway settings, model catalog, etc.).

## Dev Commands & Testing

For all development commands, testing procedures, database inspection, telegram setup, and debugging - use the **nitejar-dev skill** which has comprehensive documentation.

Key test file: `packages/sprites/tests/e2e/session-manual.ts`

## Task Master AI Instructions

**Import Task Master's development workflow commands and guidelines, treat as if import is in the main CLAUDE.md file.**
@./.taskmaster/CLAUDE.md

## UI Verification

After UI or styling changes, use the **agent-browser** skill to confirm the UI renders as expected.
Delete any temporary screenshots captured for debugging instead of committing them.

Note: `AGENTS.md` is a symlink to this file. Updating either updates both.
