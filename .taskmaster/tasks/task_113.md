# Task ID: 113

**Title:** End-to-End Verification & API Wrapper

**Status:** done

**Dependencies:** 110 ✓, 112 ✓

**Priority:** medium

**Description:** Validate the entire flow with a real agent using git credentials configured by the token tool and implement a lightweight Octokit wrapper.

**Details:**

Update the verification strategy to use CI-safe integration tests with mocks instead of live E2E testing. The goal is to validate the token tool's environment configuration and the agent's interaction logic without external dependencies.

Key Implementation Areas:
1. **Environment Configuration**: Verify the token tool correctly writes `GH_TOKEN`/`GITHUB_TOKEN` to the expected environment files and configures the git credential helper locally.
2. **Octokit Wrapper**: Implement `GithubClient` in `@nitejar/connectors-github` to handle API interactions, ensuring it respects the mocked environment tokens.
3. **Mocked Interactions**: Use a mock server (e.g., MSW or Nock) to simulate GitHub API responses for token minting and TTL checks. Mock Telegram webhook payloads to verify reply metadata injection into the agent context.
4. **Audit**: Verify that audit logs correctly record credential configuration and mocked API activities.

**Test Strategy:**

Create a suite of integration tests in `packages/agent` or `packages/e2e` that:
1. Mocks GitHub API endpoints (installation token, PR creation).
2. Executes the token tool logic and asserts that `.git-credentials` (or equivalent config) and env files are updated correctly.
3. Simulates a Telegram webhook event containing approval metadata.
4. Verifies the agent receives the correct context without making outbound network calls.

## Subtasks

### 113.1. Implement Octokit Wrapper in connectors-github

**Status:** done  
**Dependencies:** None  

Create a `GithubClient` abstraction in `@nitejar/connectors-github` that accepts an installation token and exposes methods for `createPullRequest` and `getRepoDetails`.

**Details:**

Ensure it handles Octokit instantiation using environment variables configured by the token tool. It must be testable with mocked network requests.

### 113.2. Validate Token Tool Configuration (Mocked)

**Status:** done  
**Dependencies:** None  

Create an integration test that runs the token tool logic and verifies side effects on the filesystem/environment.

**Details:**

Instead of a real git push, verify that:
1. `GH_TOKEN` or `GITHUB_TOKEN` is written to the specified env file.
2. Git credential helper is configured locally.
3. GitHub API calls for token minting are successfully mocked.

### 113.3. Verify Mocked Refresh and Context Injection

**Status:** done  
**Dependencies:** 113.1, 113.2  

Test the token refresh logic and Telegram context injection using mocks.

**Details:**

Simulate a token expiry via the mock server to trigger the refresh flow. Additionally, inject a mock Telegram webhook payload to ensure the agent correctly parses reply metadata.
