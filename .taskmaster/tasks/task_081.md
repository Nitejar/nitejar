# Task ID: 81

**Title:** Introduce Versioned Migration System

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** Replace the single migrate.ts approach with a versioned, folder-based migration system (no down migrations), and add a migrations tracking table.

**Details:**

Create a /migrations folder (e.g., packages/database/migrations) with ordered timestamped migration files. Add a migrations runner that applies pending migrations in order and records them in a schema_migrations table. Keep forward-only migrations (no down). Update docs/scripts so `db:migrate` runs the new runner and can target SQLite/Postgres. Ensure the runner is idempotent and safe for CI.

**Test Strategy:**

Create a couple of migrations locally, run the new runner twice, and verify only new migrations are applied. Verify schema_migrations records applied versions.
