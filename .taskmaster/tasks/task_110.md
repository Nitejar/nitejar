# Task ID: 110

**Title:** Agent Token Tooling (Sprite Integration)

**Status:** done

**Dependencies:** 109 ✓

**Priority:** high

**Description:** Expose a tool for the agent (via Sprite/Sandbox) to request credentials and configure git.

**Details:**

Create a new tool definition (e.g., `github_auth_tool` or `configure_git_credentials`) that implements a secure, environment-variable-based authentication flow for the agent sandbox.

Key Requirements:
- **Input**: `repo_name` (optional if global), `duration` (optional TTL).
- **Logic**: Call the Credential Provider / Token Service to mint a short-lived GitHub installation token.
- **Action**: Instead of writing to a static credential store:
  1. Use the Sprite/Sandbox execution API to persist the token in an environment file (e.g., `~/.nitejar/env`) as `GH_TOKEN` and `GITHUB_TOKEN`.
  2. Ensure shell sessions (`.bashrc` / `.profile`) source this file automatically.
  3. Configure a custom git credential helper (e.g., a script or function) that dynamically reads these environment variables to supply credentials to git commands (Username: `x-access-token`, Password: `$GH_TOKEN`).
  4. Ensure `gh` CLI works automatically via the presence of `GH_TOKEN`.
- **Security**: The token is never stored in plaintext in `.git-credentials`. It resides only in the environment context which can be refreshed.
- **Return**: A success message indicating git and GH CLI are configured. Do NOT return the token string to the LLM.
- **Refresh**: On 401 or expiry, re-running the tool updates the environment variables.

**Test Strategy:**

Integration test: 
1. Start a sandbox instance.
2. Invoke the tool to configure credentials.
3. Execute `git clone <private-repo-url>` inside the sandbox.
4. Verify the clone succeeds without password prompts.
5. Verify `gh auth status` reports active login.
6. Verify the token does not appear in the tool's output to the LLM.

## Subtasks

### 110.1. Implement Token Generation Logic via Credential Provider

**Status:** done  
**Dependencies:** None  

Integrate with the Credential Provider / Token Service to mint installation tokens with specific permissions and TTL.

**Details:**

Use the service established in Task 108 to request tokens. Ensure the service supports configurable TTL per integration/agent and maps permissions correctly (e.g., contents:write).

### 110.2. Create Environment-Based Auth Tool

**Status:** done  
**Dependencies:** 110.1  

Develop the agent tool that sets up persistent environment variables and dynamic git credential helpers in the sandbox.

**Details:**

Define the tool schema (zod). In the handler:
1. Call Credential Provider for token.
2. Execute sandbox commands to:
   - Create/Update `~/.nitejar/env` with `export GH_TOKEN=...` and `export GITHUB_TOKEN=...`.
   - Ensure `.bashrc` sources this file.
   - Configure `git config --global credential.helper` to use a script that echoes the env var token.
3. Return success status only.

### 110.3. Verify Secure Token Handling

**Status:** done  
**Dependencies:** 110.2  

Ensure token strings are masked or never logged in the agent trace/context.

**Details:**

Review logging and context storage to guarantee the raw token from the Credential Provider is not stored in the agent's memory or logs, only used within the ephemeral execution command.
