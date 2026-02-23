# Task ID: 119

**Title:** Implement Authoring Agent PR Lifecycle Management

**Status:** done

**Dependencies:** 117 ✓

**Priority:** high

**Description:** Orchestrate the Authoring Agent's workflow: Create Branch -> Commit -> Push -> Open PR -> Request Review.

**Details:**

1. Update the Authoring Agent's logic to manage the PR lifecycle using CLI tools instead of library calls.
2. Ensure `GH_TOKEN` or `GITHUB_TOKEN` is available in the environment for authentication.
3. Implement the sequence using shell command execution:
   - `git checkout -b <branch_name>`
   - `git commit -am '<message>'`
   - `git push -u origin <branch_name>`
   - Use `gh pr create` (preferred) or `curl` to create the PR.
   - Use `gh pr request-review` (preferred) or `curl` to assign reviewers.
4. Capture command output (stdout/stderr) to extract `pr_url` or `pr_number`.
5. Store the `pr_number` and `repo_info` in the agent's context/memory for subsequent state tracking.

**Test Strategy:**

End-to-end test on a sandbox repo. 1. Configure a mock or sandbox environment with `git` and `gh` installed. 2. Verify the agent successfully executes the shell commands to create a branch, push changes, and open a PR. 3. Confirm the PR exists using the CLI or API and that a reviewer is assigned.

## Subtasks

### 119.1. Implement Git CLI Wrapper or Tool

**Status:** done  
**Dependencies:** None  

Create or update a tool/function that allows the agent to execute git commands (checkout, commit, push) via a child process.

**Details:**

Use Node.js `child_process.exec` or `spawn` (or existing project utilities) to run git commands. Ensure proper error handling for non-zero exit codes.

### 119.2. Implement GitHub CLI (gh) Wrapper or Tool

**Status:** done  
**Dependencies:** 119.1  

Create a tool/function for the agent to interact with GitHub via the `gh` CLI (or curl as fallback).

**Details:**

Implement commands for `gh pr create` and `gh pr request-review`. Ensure the tool parses the output to return the PR URL/Number. Verify environment variables for auth.

### 119.3. Integrate Lifecycle into Authoring Agent Workflow

**Status:** done  
**Dependencies:** 119.1, 119.2  

Update the Authoring Agent's main loop to utilize the new CLI tools to complete the PR workflow.

**Details:**

Connect the steps: branch -> commit -> push -> pr create -> request review. Update agent context with the resulting PR details.
