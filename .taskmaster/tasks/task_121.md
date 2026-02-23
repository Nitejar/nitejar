# Task ID: 121

**Title:** Connect Telegram Approval to Merge Action

**Status:** done

**Dependencies:** 116 ✓

**Priority:** high

**Description:** Enable the agent to execute GitHub merge operations based on affirmative Telegram responses. This can be achieved either through a dedicated merge tool wrapping API calls or by empowering the agent to use `gh` CLI/curl commands via a shell execution capability.

**Details:**

1. **Tooling Strategy**: Instead of strictly requiring a new `Octokit`-based tool, allow the agent to perform merges using available methods. This includes defining a `mergePullRequest` tool that wraps standard API calls OR ensuring the agent has access to a shell/command tool capable of running `gh pr merge` or `curl` requests against the GitHub API.
2. **Environment Configuration**: Ensure the runtime environment (where the agent executes) has necessary credentials (`GH_TOKEN` or `GITHUB_TOKEN`) exposed to support CLI or raw API calls if the agent chooses that path.
3. **Contextual Execution**: The agent's loop must interpret Telegram replies (e.g., "merge it") as intents to execute the merge. The agent should use the conversation history to identify the target PR and select the appropriate method (tool call or command execution) to finalize the merge.

**Test Strategy:**

1. **Tool/Command Verification**: Verify that the chosen method (tool or shell command) successfully executes a merge against a mock or test repository.
2. **Integration Simulation**: Feed a mock conversation history into the agent (PR notification -> User: 'Yes, merge it') and assert that the agent outputs a valid merge action (either calling a `mergePullRequest` tool or generating a valid `gh`/`curl` command string).

## Subtasks

### 121.1. Enable Merge Capability (Tool or CLI Access)

**Status:** done  
**Dependencies:** None  

Provide the agent with the means to merge pull requests, either via a specific tool or configured CLI access.

**Details:**

Update `packages/agent/src/tools/githubTools.ts` to either:
- Implement `mergePullRequest` using `Octokit`/`githubService`.
- OR ensure an `executeCommand` style tool is available and `gh` CLI is installed/configured in the environment with `GH_TOKEN`.

If implementing a specific tool, it should be flexible enough to handle the merge logic. If relying on CLI, ensure the agent's system prompt or context is aware of this capability.

### 121.2. Register Capabilities with Agent

**Status:** done  
**Dependencies:** 121.1  

Ensure the agent's runtime has access to the merge tool or command execution tools.

**Details:**

Update the tool dictionary passed to the LLM (e.g., in `packages/agent/src/agent.ts`) to include the new `mergePullRequest` tool or verify existing shell tools are active. Ensure `GH_TOKEN` is passed to the agent's execution context if relying on CLI operations.

### 121.3. Verify Telegram Reply to Merge Action

**Status:** done  
**Dependencies:** 121.2  

Confirm that an incoming Telegram message triggers the agent loop and results in a merge action.

**Details:**

Simulate a Telegram webhook event with a user reply like 'merge it'. Ensure the agent processes this message with history and generates the correct action (tool call `mergePullRequest` or shell command `gh pr merge ...`) targeting the PR discussed in the history.
