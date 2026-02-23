# PRD — Model Library & Gateway Configuration

## Summary

Introduce a model library with a dropdown selector (no free-text), backed by a single org-level gateway configuration. Start with OpenRouter as the gateway and source of model metadata, while keeping the architecture extensible for future gateways.

## Goals

- Provide a curated, searchable model dropdown for agents.
- Centralize gateway configuration at the org level (no per-agent overrides).
- Fetch model metadata from OpenRouter and cache it for reliable UI performance.
- Enforce model-specific parameter constraints in the UI.
- Keep the UX simple by default; advanced parameters are optional and gated.

## Non-Goals

- No per-agent gateway overrides in this iteration.
- No end-user configuration of response format (handled internally).
- No multi-tenant provider routing or complex provider preference logic.

## User Stories

- As an admin, I can select a model from a dropdown (no typing) when configuring an agent.
- As an admin, I can see a curated list first, and browse all models if needed.
- As an admin, I can set the gateway once for the org and trust it for all agents.
- As an admin, I can adjust temperature and max tokens safely within valid ranges.

## Requirements

### 1) Org-Level Gateway Settings

- Add a global gateway configuration (initially OpenRouter).
- Store API key securely (reuse existing encryption helpers).
- Admin UI for:
  - Gateway selection (only OpenRouter for now)
  - API key input + verify
  - Base URL override (optional, default OpenRouter URL)

### 2) Model Library

- Model dropdown (required).
- Two tabs/sections:
  - Recommended (curated list)
  - All models (search + tags)
- Each model entry shows:
  - Provider, context length, modalities, cost tier (if available)
  - Tool support and parameters supported

### 3) Model Source & Caching

- Default source: OpenRouter Models API (`/api/v1/models`).
- Cache response server-side (persisted) with TTL (e.g., 24h).
- Provide a “Refresh models” action in admin config.
- If API fails, fall back to a bundled curated list.

### 4) Agent Model Configuration

- Agent config stores:
  - `modelId`
  - `temperature`
  - `maxTokens`
  - (optional) advanced parameters if enabled
- No per-agent gateway override.

### 5) Parameter Controls (UI)

- Basic (visible by default):
  - Model
  - Temperature
  - Max tokens
  - Tool choice
- Advanced (collapsed):
  - top_p
  - frequency_penalty
  - presence_penalty
  - seed
  - stop
- Enforce per-model constraints using metadata from the model library.

### 6) Response Format

- Not exposed in the UI.
- Controlled by internal system policy only (future feature if needed).

## Data Model

- `gateway_settings` (new table)
  - id, provider, api_key_encrypted, base_url, created_at, updated_at
- `model_catalog` (new table)
  - id, name, metadata_json, source, refreshed_at

## UI/UX

- Agent editor:
  - Model dropdown (recommended + all)
  - Basic parameter fields
  - Advanced toggle
- Admin config:
  - Gateway selection (OpenRouter only)
  - API key + base URL + refresh models button

## API

- `GET /api/models` — returns cached model list
- `POST /api/models/refresh` — refreshes model cache
- `GET /api/settings/gateway` — returns gateway config
- `POST /api/settings/gateway` — updates gateway config

## Testing

- Unit: model cache fetch + refresh logic
- Integration: model dropdown loads list + respects constraints
- Manual: change gateway key, refresh models, configure agent model

## Rollout

- Ship with OpenRouter-only gateway.
- Prepare for future gateway additions by abstracting provider interface.

## Open Questions

- Which models go in the initial curated list?
- How often should model cache refresh automatically?
- Should we support per-agent overrides later (separate feature)?
