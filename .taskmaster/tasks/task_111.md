# Task ID: 111

**Title:** Admin UI - Connect & Install

**Status:** done

**Dependencies:** 106 ✓, 107 ✓

**Priority:** medium

**Description:** Build the frontend UI for admins to register the GitHub App and view installations, aligned with the existing integrations framework and tRPC flow.

**Details:**

Implement the GitHub integration settings within `apps/web/app/admin`. The UI should utilize tRPC procedures from `apps/web/server/routers/github.ts` (or similar) to handle app registration and data fetching.

Key Components:
1. **Integration Settings Panel**:
   - Add configuration fields for 'Permission Presets' (e.g., dropdown for 'Minimal' vs 'Robust' checks).
   - Add a configuration field for 'Token TTL' (Time To Live).

2. **App Registration Flow**:
   - 'Register GitHub App' button initiating the manifest flow (POST to GitHub).
   - Handle the redirect callback to save the App ID/Client ID via tRPC.

3. **Status & Management**:
   - Display connection status (Connected/Not Configured).
   - List active installations (from `GithubInstallation` table).
   - Show associated repositories per installation.
   - Include a 'Sync' button to trigger a manual refresh of repositories (call `github.syncRepositories` or similar procedure).

4. **Framework Alignment**:
   - Ensure the new page follows the design patterns in `apps/web/app/admin` using shadcn/ui components installed in Task 83.

**Test Strategy:**

1. **Manual Flow**: Click Register -> authenticate with GitHub -> Accept manifest -> Verify redirect back to Admin UI updates status to 'Connected'.
2. **Configuration**: Change Permission Preset and Token TTL, save, and verify settings persist.
3. **Data Display**: mock tRPC responses for installations and verify the list renders correctly with Shadcn UI components.
4. **Sync Action**: Click 'Sync' and verify the corresponding tRPC mutation is called.

## Subtasks

### 111.1. Scaffold GitHub Integration Page

**Status:** done  
**Dependencies:** None  

Create the main page structure in `apps/web/app/admin/integrations/github/page.tsx` (or equivalent) using existing layout components.

**Details:**

Use shadcn/ui cards and forms to structure the settings page.

### 111.2. Implement Configuration Form

**Status:** done  
**Dependencies:** 111.1  

Build the form for Permission Presets and Token TTL.

**Details:**

Add inputs for selecting permission levels and setting token duration. Persist these settings via tRPC.

### 111.3. Build Register App Flow

**Status:** done  
**Dependencies:** 111.2  

Implement the 'Register GitHub App' button and manifest form submission.

**Details:**

Construct the HTML form that posts to `https://github.com/settings/apps/new` with the manifest JSON payload.

### 111.4. Display Installations & Repositories

**Status:** done  
**Dependencies:** 111.3  

Fetch and display connected installations and their repos.

**Details:**

Use tRPC `useQuery` to get installation data. Render a list showing Installation ID, Account Name, and linked Repositories.

### 111.5. Implement Sync Functionality

**Status:** done  
**Dependencies:** 111.4  

Add a button to manually sync repositories for an installation.

**Details:**

Wire up a 'Sync' button to a tRPC mutation that triggers the repository sync logic.
