# Task ID: 108

**Title:** Token Broker Service

**Status:** done

**Dependencies:** 105 ✓

**Priority:** high

**Description:** Implement a generic Credential Provider / Token Service to mint and manage access tokens. Primary implementation focuses on GitHub App installation tokens, but the interface must be reusable for other integrations.

**Details:**

Refactor the planned `TokenBrokerService` to implement a `CredentialProvider` interface.
- **Interface:** Define `ICredentialProvider` with methods like `getCredential(target, scopes, context)`.
- **GitHub Implementation:** Create a provider specifically for GitHub that:
  - Uses `octokit` (or JWT signing) to authenticate as the App.
  - Calls `POST /app/installations/{installation_id}/access_tokens` to mint tokens scoped to specific repositories.
- **Caching:** Implement in-memory caching (e.g., `NodeCache` or `Map`) for tokens based on TTL. Remove Redis requirements. TTL should be configurable per integration.
- **Audit Logging:** distinct logging for token generation events (e.g., 'Token minted for repo X', 'Token served from cache').
- **Output:** The service should return the raw token, intended for consumption by internal tools (e.g., Sandbox environment).

**Test Strategy:**

Mock the GitHub API/Octokit to verify token minting. Create unit tests for the generic interface and the GitHub-specific implementation. specific test cases for:
- Cache hits vs. misses (verify API isn't called if cached).
- TTL expiration.
- Audit log verification (mock logger).

## Subtasks

### 108.1. Define ICredentialProvider Interface

**Status:** done  
**Dependencies:** None  

Create a TypeScript interface for credential providers that supports generic targets and scopes.

**Details:**

Interface should handle variable return types or a standard token envelope.

### 108.2. Implement GitHubCredentialProvider

**Status:** done  
**Dependencies:** 108.1  

Implement the GitHub-specific logic to mint installation tokens using App private key.

**Details:**

Must handle authentication via JWT/Octokit and scope tokens to repo.

### 108.3. Implement In-Memory Caching and Configuration

**Status:** done  
**Dependencies:** 108.2  

Add caching layer to the provider with configurable TTL.

**Details:**

Use simple in-memory storage. Allow TTL to be passed in config or derived from integration settings.

### 108.4. Add Audit Logging

**Status:** done  
**Dependencies:** 108.2  

Integrate logging for all token generation and access events.

**Details:**

Ensure sensitive token data is NOT logged, only metadata (repo, installationId, timestamp).
