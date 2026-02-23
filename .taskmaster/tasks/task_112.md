# Task ID: 112

**Title:** Admin UI - Capability Matrix

**Status:** done

**Dependencies:** 111 ✓

**Priority:** medium

**Description:** Build the UI for admins to assign capabilities to agents for specific repositories.

**Details:**

Create a 'Capabilities' management view within `apps/web/app/admin` (e.g., `apps/web/app/admin/capabilities/page.tsx`).

Key Requirements:
- **Manual Assignment Only**: Explicitly grant capabilities per repository; no org-level defaults.
- **Data Model**: Interact with the `agent_repo_capabilities` table using Kysely and repositories in `packages/database`. Capabilities are stored as a string array in the database (e.g., `capabilities: string[]`).
- **Valid Capabilities**: Use the PRD-aligned list: `read_repo`, `create_branch`, `push_branch`, `open_pr`, `comment`, `request_review`, `label_issue_pr`, `review_pr`, `merge_pr`.
- **tRPC Integration**: Create a new router `apps/web/server/routers/capabilities.ts` or extend `github.ts` to expose:
  - `getAgentCapabilities(agentId, repoId)`
  - `updateAgentCapabilities(agentId, repoId, capabilities[])`
- **UI Components**:
  - Agent Selector (dropdown).
  - Repository Selector (dropdown, filtered by installation, using `github_repos`).
  - Capability Checkbox Group (all 9 capability types).
  - Matrix View: A table showing active `agent_repo_capabilities` records allowing revocation.

Files to Reference:
- `packages/database/src/types.ts` (DB Type definitions)
- `packages/database/src/repositories` (Use existing or create new repository access)
- `apps/web/server/routers/github.ts` (or new router)
- `apps/web/app/admin/layout.tsx` (Add navigation item)

**Test Strategy:**

1. **Unit**: Test tRPC procedures for correctly parsing and storing capability string arrays.
2. **Integration**: Assign capabilities in the UI and verify rows are created in the `agent_repo_capabilities` table with correct array data.
3. **Revocation**: Uncheck a capability and verify the array is updated or the row is deleted if empty.
4. **UI**: Specific tests for the matrix view correctly rendering the capability tags.

## Subtasks

### 112.1. Implement tRPC Backend for Capabilities

**Status:** done  
**Dependencies:** None  

Create or update tRPC procedures to manage `agent_repo_capabilities` records using Kysely.

**Details:**

File: `apps/web/server/routers/capabilities.ts` (or extend `github.ts`).
- `list`: Return all capability assignments including Agent and Repository relations (join with `github_repos`).
- `upsert`: Accept `agentId`, `repoId`, and a `capabilities` array (strings). Insert or update the record for that pair.
- Ensure types match `packages/database/src/types.ts` and validate against the allowed capability strings: `read_repo`, `create_branch`, `push_branch`, `open_pr`, `comment`, `request_review`, `label_issue_pr`, `review_pr`, `merge_pr`.

### 112.2. Build Capability Assignment UI Form

**Status:** done  
**Dependencies:** 112.1  

Create the frontend form for selecting an Agent, a Repository, and toggling capabilities.

**Details:**

File: `apps/web/app/admin/capabilities/components/assignment-form.tsx`.
- Use `Combobox` or `Select` for Agents and Repositories (fetch via tRPC `apps/web/lib/trpc.ts`).
- Render checkboxes for all supported capabilities: `read_repo`, `create_branch`, `push_branch`, `open_pr`, `comment`, `request_review`, `label_issue_pr`, `review_pr`, `merge_pr`.
- Submit button calls the upsert procedure with the selected array of strings.

### 112.3. Build Capability Matrix View

**Status:** done  
**Dependencies:** 112.2  

Display a table of existing permissions with revocation options.

**Details:**

File: `apps/web/app/admin/capabilities/page.tsx`.
- Table columns: Agent Name, Repository Name (from `github_repos`), Capabilities (tags), Actions (Edit/Revoke).
- Implement 'Revoke' button which clears capabilities for that Agent/Repo pair.
