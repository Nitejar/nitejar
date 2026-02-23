# Task ID: 147

**Title:** Build profile settings page

**Status:** pending

**Dependencies:** 145 ✓

**Priority:** medium

**Description:** Create user profile settings page for viewing and editing profile information.

**Details:**

1. Create `apps/web/app/settings/page.tsx` (profile settings)
2. Create settings layout `apps/web/app/settings/layout.tsx`:
   - Sidebar navigation: Profile, Security, Sessions, API Tokens
   - Require authentication (similar to admin layout)
3. Profile page features:
   - Display current user info from session
   - Editable name field
   - Avatar URL or upload (optional)
   - Email display (read-only)
   - Role and status display (read-only)
   - Save button with optimistic update
4. Use authClient.updateUser() for updates
5. Show success/error toast on save
6. Add link to settings in admin header

**Test Strategy:**

1. Access /settings requires login
2. Test name update persists
3. Test avatar update works
4. Test validation errors display
5. Test unauthorized fields are read-only
