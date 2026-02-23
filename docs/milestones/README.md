# Milestone Tracking

This folder contains detailed planning and progress tracking for each milestone.

## How to Use

1. **Start of session**: Read this file + the active milestone doc to understand current state
2. **During work**: Check off completed tasks, add notes
3. **End of session**: Update status, document any blockers or decisions made

---

## Milestone Status

| Milestone                  | Status                      | Doc                                                            |
| -------------------------- | --------------------------- | -------------------------------------------------------------- |
| M0 — Baseline              | **Done**                    | _(no doc, already complete)_                                   |
| M1 — Foundational Platform | **Implementation complete** | [M1-reliable-control-plane.md](./M1-reliable-control-plane.md) |
| M2 — Agent Soul            | Not Started                 | _TBD_                                                          |
| M3 — Workflows             | Not Started                 | _TBD_                                                          |
| M4 — Extensibility         | Not Started                 | _TBD_                                                          |
| M5 — Notifications         | Not Started                 | _TBD_                                                          |
| M6 — SaaS                  | Not Started                 | _TBD_                                                          |

---

## Current Focus

**Active Milestone:** M1 complete, ready for M2
**Status:** All phases implemented, pending end-to-end testing

### Next Actions

1. Test end-to-end Telegram flow
2. Test end-to-end GitHub flow
3. Deploy to Fly.io and verify fresh deploy works
4. Begin M2 planning (Agent Soul)

---

## Session Log

_Record significant decisions and progress here so future sessions have context._

| Date       | Session            | Summary                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-01-31 | Initial            | Created milestone tracking structure. M1 open questions documented.                                                                                                                                                                                                                                                                                                                                            |
| 2026-01-31 | Architecture       | **Major pivot:** Abandoned Vercel due to serverless timeout constraints. New architecture: Fly.io (web server) + Sprites (execution). Key insight: can't classify tools as fast/slow, ALL execution must be unbounded. Updated ROADMAP.md and M1 doc.                                                                                                                                                          |
| 2026-01-31 | M1 Planning        | Answered all 10 open questions. Key decisions: (1) Multi-agent from day 1, pub/sub routing (2) Inference on web server, `sprite exec` for tools (3) Sprites JS SDK (4) No locks, social coordination (5) Tiered DB: SQLite→Postgres→+Redis (6) SSE streaming with in-memory buffer (7) GitHub App auth. Simplest deploy = 1 Fly app + SQLite.                                                                  |
| 2026-01-31 | M1 Expansion       | Expanded M1 scope: (1) Integrations as first-class entities (Telegram first, then GitHub) (2) Master key encryption for secrets (3) Built-in admin dashboard. Renamed M1 to "Foundational Platform." Dockerfile is universal deploy path.                                                                                                                                                                      |
| 2026-01-31 | Roadmap Rewrite    | Consolidated milestones to remove overlap. New structure: M1=Basic responses, M2=Agent Soul (memory, config), M3=Workflows (multi-step, Issue→PR), M4=Extensibility, M5=Notifications, M6=SaaS. Cleaner progression.                                                                                                                                                                                           |
| 2026-01-31 | M1 Implementation  | **Full M1 implementation.** Created: (1) Drizzle ORM schema with SQLite/Postgres support (2) Integrations framework with registry/router (3) Sprites SDK wrapper for agent execution (4) Agent inference loop with Anthropic API (5) Telegram integration handler (6) GitHub integration handler (7) Admin dashboard UI (8) Dockerfile and Fly.io deployment config. All phases complete, pending E2E testing. |
| 2026-01-31 | M1 Polish          | Fixed job detail page import (`listMessagesByJob`). Created integration documentation: `docs/integrations/telegram.md` (BotFather setup) and `docs/integrations/github.md` (GitHub App setup). Fixed build errors: webpack config types, SQLite database types, ESLint issues. Build passes.                                                                                                                   |
| 2026-02-01 | WebSocket Sessions | Implemented session-based Sprite execution: `sprite_sessions` table, `SpriteSessionManager`, session-aware `spriteExec()`. Sessions persist shell state (cd, env vars) across commands within a job. Added cleanup endpoint. Fixed pre-existing lint/type errors across codebase. Documented future tool enhancements (line numbers, glob, grep).                                                              |
