# Task ID: 122

**Title:** Refine Agent System Prompts for Workflow Adherence

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** Update the system prompts (LLM instructions) for both Author and Reviewer agents to enforce the new workflow rules and mandate CLI-based GitHub interactions.

**Details:**

1. Author Agent Prompt:
   - 'After pushing code, you must open a PR and request a review.'
   - 'Do not merge without human approval via Telegram.'
   - 'When GitHub integration is enabled, prioritize using CLI tools (git, gh, curl) over Octokit helpers.'
   - 'Authenticate using GH_TOKEN or GITHUB_TOKEN environment variables.'

2. Reviewer Agent Prompt:
   - 'When asked to review, examine the diff and submit a formal GitHub review decision.'
   - 'Use the `gh` CLI tool to fetch PR details and submit reviews.'

3. Implementation:
   - Inject these instructions dynamically into the agent's context window based on enabled integrations.
   - Explicitly instruct the LLM to avoid mentioning or attempting to use 'Octokit' wrapper functions if direct CLI access is available.

**Test Strategy:**

Prompt engineering validation. Interact with the agent in a dry-run mode to ensure it outlines a plan using `git` and `gh` commands rather than internal API helpers before executing.

## Subtasks

### 122.1. Update Author Agent System Prompt

**Status:** done  
**Dependencies:** None  

Modify the base system prompt for the Author Agent to include instructions on using git/gh CLI tools with token authentication for PR creation.

**Details:**

Add text ensuring the agent uses standard CLI commands (git push, gh pr create) using the provided environment tokens (GH_TOKEN/GITHUB_TOKEN) instead of looking for Octokit wrappers.

### 122.2. Update Reviewer Agent System Prompt

**Status:** done  
**Dependencies:** None  

Modify the base system prompt for the Reviewer Agent to mandate using `gh` CLI for checking out PRs and submitting reviews.

**Details:**

Ensure the prompt instructs the agent to use `gh pr checkout` and `gh pr review` commands.
