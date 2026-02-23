# Task ID: 164

**Title:** Update admin members page with invite button

**Status:** done

**Dependencies:** 141 ✓, 145 ✓

**Priority:** medium

**Description:** Update the existing members page to use better-auth invitation flow and add invite button.

**Details:**

1. Update `apps/web/app/admin/members/page.tsx`
2. Add 'Invite Member' button that opens dialog
3. Invite dialog form:
   - Email input
   - Role select (member, admin)
   - Submit button
4. On submit, call better-auth invitation endpoint via authClient
5. Show success message with invitation link (for development/debugging)
6. Display pending invitations in separate section
7. Allow resending or canceling pending invitations
8. Update member list to show better-auth user status

**Test Strategy:**

1. Open invite dialog
2. Submit invitation
3. Verify email sent
4. Verify invitation appears in pending list
5. Test resend invitation
6. Test cancel invitation
