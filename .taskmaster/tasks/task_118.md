# Task ID: 118

**Title:** Implement Reviewer Agent Logic for Submitting Reviews

**Status:** done

**Dependencies:** 117 ✓

**Priority:** medium

**Description:** Enable the Reviewer Agent to analyze a PR and submit a formal GitHub review using CLI tools (`gh` or `curl`). This replaces direct Octokit API usage with a shell-execution model for agent actions.

**Details:**

1. **Define CLI Tool Interface**: Ensure the agent has access to a generic shell execution tool or a specific `run_gh_command` tool.
2. **Implement Review Logic**: Create a prompt or action sequence where the agent:
   - Fetches PR details/diff via `gh pr diff <PR_URL>` or `curl`.
   - Generates a review decision (APPROVE/REQUEST_CHANGES).
   - Submits the review using `gh pr review <PR_URL> --approve` or `--request-changes -b "<body">`.
3. **Environment Setup**: Ensure the runtime environment (Docker/local) has `gh` installed or authenticated access via `GITHUB_TOKEN` for `curl`.
4. **Security**: Validate that shell commands are sandboxed or strictly typed if using a custom tool wrapper.

**Test Strategy:**

1. **Mock Execution**: Mock the underlying shell execution function to capture `gh` commands.
2. **Integration Test**: Verify that calling the agent action results in the correct command string (e.g., `gh pr review 123 --approve`).
3. **Live Test (Optional)**: Run against a dummy PR in a sandbox repository if environment permits.

## Subtasks

### 118.1. Verify/Install GitHub CLI in Runtime Environment

**Status:** done  
**Dependencies:** None  

Ensure the `gh` CLI tool is available in the agent's execution environment or Docker container. If not feasible, prepare `curl` command templates.

**Details:**

Check Dockerfile or setup scripts. Add `gh` installation if missing. Verify `GH_TOKEN` or `GITHUB_TOKEN` is correctly propagated to the shell environment.

### 118.2. Create Shell Execution Tool for Agent

**Status:** done  
**Dependencies:** 118.1  

Expose a tool that allows the agent to execute specific shell commands safely.

**Details:**

Define a tool (e.g., `execute_gh_command`) that wraps `child_process.exec` or similar. Restrict it to `gh` commands or specific subcommands if possible to prevent arbitrary code execution.

### 118.3. Implement 'Review PR' Agent Action

**Status:** done  
**Dependencies:** 118.2  

Develop the high-level agent logic to fetch diffs and submit reviews using the shell tool.

**Details:**

Sequence: 
1. `gh pr diff {url}` to get context.
2. Analyze diff (noop/mock for now).
3. `gh pr review {url} --approve` (or comment/request-changes).
