# Task ID: 104

**Title:** Database Schema for GitHub Integration

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** Create Kysely schema migrations to support GitHub App integration, storing installation data, repository access maps, and agent capabilities.

**Details:**

Create a new Kysely migration file in `packages/database/migrations` (e.g., `YYYYMMDDHHMMSS_github_integration.ts`) and update `packages/database/src/types.ts`.

1. **New Tables:**
   - `github_installations`: `id` (PK, integer), `installation_id` (integer, not null), `account_login` (varchar), `account_id` (integer), `integration_id` (FK to `integrations.id`), `created_at`, `updated_at`.
   - `github_repos`: `id` (PK, integer), `repo_id` (integer, not null), `full_name` (varchar, not null), `html_url` (varchar), `installation_id` (FK to `github_installations.id`), `created_at`, `updated_at`.
   - `agent_repo_capabilities`: `agent_id` (FK to `agents.id`), `github_repo_id` (FK to `github_repos.id`), `capabilities` (json/text array, e.g., `['read_repo', 'open_pr']`).

2. **Configuration Storage:**
   - Utilize the existing `integrations` table. The GitHub App credentials (appId, clientId, clientSecret, webhookSecret, privateKey) along with `permissions_preset` and `token_ttl` should be stored in the `config` JSON column.
   - Ensure the implementation respects the encryption pattern used for other integrations (referencing `encryptConfig` and `sensitiveFields` patterns if present in the service layer, though the schema just needs to support the JSON structure).

3. **Type Definitions:**
   - Update `packages/database/src/types.ts` to include interfaces for `GithubInstallation`, `GithubRepo`, and `AgentRepoCapability`.
   - Update the `Database` interface to include these new tables.

**Test Strategy:**

Run `pnpm --filter @nitejar/database db:migrate` to apply changes to the SQLite database. Inspect the database using a SQLite viewer or the Kysely CLI to ensure tables `github_installations`, `github_repos`, and `agent_repo_capabilities` are created with correct columns and foreign key constraints.

## Subtasks

### 104.1. Create Kysely Migration for GitHub Tables

**Status:** done  
**Dependencies:** None  

Create a new migration file in `packages/database/migrations` to define `github_installations`, `github_repos`, and `agent_repo_capabilities` tables.

**Details:**

File should export `up` and `down` functions using the `Kysely` instance. Define foreign keys referencing `integrations` and `agents` tables correctly. Use SQLite compatible types (e.g., `integer`, `text`, `datetime`).

### 104.2. Update Database Types

**Status:** done  
**Dependencies:** 104.1  

Add TypeScript interfaces for the new tables in `packages/database/src/types.ts`.

**Details:**

Export interfaces `GithubInstallationTable`, `GithubRepoTable`, and `AgentRepoCapabilityTable`. Add them to the main `Database` interface mapping.
