# Task ID: 107

**Title:** GitHub Webhook Handler for Installations

**Status:** done

**Dependencies:** 104 ✓, 105 ✓

**Priority:** high

**Description:** Implement a webhook endpoint to listen for GitHub App installation events and sync repository data.

**Details:**

Update the existing webhook route at `apps/web/app/api/github/webhook/route.ts` to handle GitHub App installation events.

Key Requirements:
- **Signature Validation**: Use `decryptConfig` to retrieve the stored webhook secret from the GitHub integration configuration and validate the `X-Hub-Signature-256` header.
- **Event Handling**:
  - `installation.created`: Create a new `GithubInstallation` record linking the GitHub App installation ID to the user/org.
  - `installation.deleted`: Remove the corresponding `GithubInstallation` record and associated data.
  - `installation_repositories.added`: specific repos added to an installation -> Sync/Create `GithubRepo` records.
  - `installation_repositories.removed`: specific repos removed -> Archive or delete `GithubRepo` records.
- **Idempotency**: Ensure that receiving the same event multiple times does not corrupt data (check for existence before create/update).
- **Integration Config**: Retrieve the relevant `Integration` record to access credentials. Since webhooks may not carry the internal Integration ID directly, determine the strategy for looking up the correct Integration config (likely via the Installation ID if mapped, or a global/tenant lookup strategy if applicable).

**Test Strategy:**

Use `smee-client` to forward local webhooks or valid payload replays.
- Verify that `GithubInstallation` table reflects rows after `installation.created`.
- Verify `GithubRepo` rows appear after `installation_repositories.added`.
- Test signature validation failure cases.

## Subtasks

### 107.1. Implement Webhook Signature Validation

**Status:** done  
**Dependencies:** None  

Update `apps/web/app/api/github/webhook/route.ts` to validate incoming requests.

**Details:**

Import `verifySignature` from Octokit or implementing custom logic. Fetch the webhook secret using `decryptConfig` from the stored Integration config. Return 401/403 if signature is invalid.

### 107.2. Handle Installation Events

**Status:** done  
**Dependencies:** 107.1  

Implement logic for `installation.created` and `installation.deleted`.

**Details:**

In the webhook handler, switch on `x-github-event` header = `installation`. Parse payload to get `installation.id` and `account` info. Upsert `GithubInstallation` using Prisma on creation; delete on deletion.

### 107.3. Handle Repository Selection Events

**Status:** done  
**Dependencies:** 107.2  

Implement logic for `installation_repositories` events.

**Details:**

Handle `installation_repositories.added` and `removed`. Iterate through `repositories_added` array to create `GithubRepo` entries. Iterate through `repositories_removed` to delete them.
