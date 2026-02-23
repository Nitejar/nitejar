# Task ID: 86

**Title:** Database Schema for Gateway Settings and Model Catalog

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** Create new database tables for storing org-level gateway configuration and caching model metadata.

**Details:**

1. Create a migration to add `gateway_settings` table with columns: `id` (PK), `provider` (string, default 'openrouter'), `api_key_encrypted` (string), `base_url` (string, nullable), `created_at` (timestamp), `updated_at` (timestamp).
2. Create `model_catalog` table with columns: `id` (PK), `external_id` (string, unique), `name` (string), `metadata_json` (JSON/JSONB), `source` (string), `is_curated` (boolean), `refreshed_at` (timestamp).
3. Ensure schema follows existing project conventions (e.g., Prisma/Drizzle/SQL files).

**Test Strategy:**

Run migration locally and verify tables are created with correct columns and constraints.
