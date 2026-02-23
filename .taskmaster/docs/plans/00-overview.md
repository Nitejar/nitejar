# Integration Plans — Overview

This directory contains implementation plans for 8 capabilities split into independently-assignable work units. Slack and Notion are handled in separate worktrees.

## Work Units

| File | Scope | Steps | Can Start Immediately? |
|---|---|---|---|
| `01-media-tools.md` | Image gen, STT, TTS + migration + admin UI | Steps 1-3 | Yes |
| `02-discord.md` | Discord handler + integration provider | Steps 4-5 | Yes |
| `03-google-oauth.md` | Shared OAuth substrate (tables, token refresh, routes) | Step 6 | Yes |
| `04-google-calendar.md` | Google Calendar plugin handler + tools | Step 7 | After `03-google-oauth.md` |
| `05-google-drive.md` | Google Drive plugin handler + tools | Step 8 | After `03-google-oauth.md` |
| `06-google-docs.md` | Google Docs plugin handler + tools | Step 9 | After `03-google-oauth.md` + `05-google-drive.md` |
| `07-gmail.md` | Gmail plugin handler + tools | Step 10 | After `03-google-oauth.md` |
| `08-plugin-catalog-ui.md` | Add all new plugins to catalog | Step 11 | After all others |

## Dependency Graph

```
01-media-tools ─────────────────────────────────────┐
02-discord ─────────────────────────────────────────┤
03-google-oauth ──┬── 04-google-calendar ───────────┤
                  ├── 05-google-drive ── 06-docs ───┤
                  └── 07-gmail ─────────────────────┤
                                                    └──► 08-plugin-catalog-ui
```

**Parallelism:** `01`, `02`, and `03` can all start simultaneously. `04`, `05`, and `07` can start as soon as `03` lands. `06` needs both `03` and `05`.

## Shared Context

- Nitejar routes all LLM calls through OpenRouter (`packages/agent/src/model-client.ts` → `https://openrouter.ai/api/v1`)
- Plugin handlers live in `packages/plugin-handlers/src/`
- Integration providers live in `packages/agent/src/integrations/`
- Tool definitions in `packages/agent/src/tools/definitions.ts`, handlers in `packages/agent/src/tools/handlers/`
- The `IntegrationProvider` interface (`packages/agent/src/integrations/registry.ts`) supports `toolDefinitions` + `toolHandlers`. The runner merges these via `extractIntegrationTools()` at `runner.ts:258`.
- PRD: `.taskmaster/docs/prd-integrations-media-tools.md`
- Tech spec: `.taskmaster/docs/tech-spec-integrations-media-tools.md`

## Verification (every plan)

1. `pnpm format && pnpm lint && pnpm run typecheck` — zero errors
2. `pnpm test` — all tests pass
3. Run migration if applicable: `pnpm --filter @nitejar/database db:migrate`
