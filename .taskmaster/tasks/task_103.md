# Task ID: 103

**Title:** Approvals Policy Hook

**Status:** pending

**Dependencies:** 98 ✓

**Priority:** medium

**Description:** Wire approval checks to team membership.

**Details:**

When an approval is needed, allow any member of an agent's assigned teams to approve. Superadmins can approve any request regardless of team membership. Implement server-side policy check.

**Test Strategy:**

Integration test: approval succeeds for team members and fails for non-members.
