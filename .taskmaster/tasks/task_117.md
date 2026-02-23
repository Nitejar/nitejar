# Task ID: 117

**Title:** Enhance GitHub Service for PR Creation and Review Request

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** Update the GitHub integration configuration and system prompt to support a CLI-first approach for PR creation and review requests. Instead of strict internal checks or wrappers, this task ensures GH_TOKEN is exposed and the Agent is explicitly instructed via the system prompt to use the `gh` CLI (installing if necessary) or fallback to `curl`.

**Details:**

Refactor the GitHub integration strategy to rely on Agent autonomy guided by system prompt instructions rather than code-level guardrails.

1.  **Environment Setup**: Verify that when the GitHub integration is enabled, the necessary environment variables (`GH_TOKEN` or `GITHUB_TOKEN`) are exposed to the Agent's runtime shell.
2.  **System Prompt Injection**: When the GitHub integration is enabled, append instructions to the system prompt. These instructions must explicitly tell the Agent: "GitHub credentials are set in GH_TOKEN. Use `gh` CLI. If missing, install it or use `curl`."
3.  **No Code Checks**: Do not implement pre-flight checks for `gh` installation in the integration code. Rely entirely on the Agent to detect the environment state and react accordingly.
4.  **No Wrapper Layer**: The Agent will execute these as shell commands directly.

**Test Strategy:**

Integration test within `packages/integrations`.
1.  Verify that enabling the GitHub integration injects `GH_TOKEN` into the Agent's environment variables.
2.  Verify that the system prompt builder includes the specific GitHub instructions when the integration is active.
3.  End-to-end simulation: Ensure the Agent can successfully execute a `gh` command or `curl` fallback given the environment and instructions.

## Subtasks

### 117.1. Implement Environment Token Injection

**Status:** done  
**Dependencies:** None  

Ensure the GitHub Integration service retrieves and decrypts the stored token, then exposes it as `GH_TOKEN` and `GITHUB_TOKEN` in the Agent's shell environment.

**Details:**

Modify the integration setup to export these variables. This allows standard tools like `gh` to work out-of-the-box without explicit login commands.

### 117.2. Update System Prompt with Tool Instructions

**Status:** done  
**Dependencies:** 117.1  

Modify the system prompt construction logic to inject specific guidance when the GitHub integration is enabled.

**Details:**

Add logic to append a section to the system prompt: "GitHub Integration Enabled: `GH_TOKEN` is available. You may use the `gh` CLI. If `gh` is not found, you are authorized to install it or use `curl` as a fallback."

### 117.3. Verify Agent Shell Execution Path

**Status:** done  
**Dependencies:** 117.1, 117.2  

Create a verification script or test case where the Agent (mocked) receives the prompt and executes a raw shell command.

**Details:**

Ensure that the Agent utilizes the injected tokens to perform a simple read operation (e.g., `gh auth status` or `curl /user`) without requiring valid internal tool definitions.
