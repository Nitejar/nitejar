# Task ID: 141

**Title:** Add better-auth invitation plugin

**Status:** done

**Dependencies:** 137 ✓, 140 ✓

**Priority:** high

**Description:** Configure better-auth's invitation plugin to work with the existing invitation flow and email system.

**Details:**

1. Import invitation plugin from 'better-auth/plugins'
2. Update `apps/web/lib/auth.ts` to add invitation plugin:
   ```typescript
   plugins: [
     invitation({
       sendInvitationEmail: async ({ email, invitedBy, url }) => {
         await sendInvitationEmail({ to: email, name: email.split('@')[0], invitedBy: invitedBy.name, inviteUrl: url })
       }
     })
   ]
   ```
3. Create `apps/web/emails/InvitationEmail.tsx` (or update existing InviteEmail):
   - Include inviter name in message
   - Include accept link with token
   - Set 48-hour expiration notice
4. Add invitationClient plugin to auth-client.ts
5. Update existing orgRouter.createInvite to use better-auth invitation instead of manual token generation

**Test Strategy:**

1. Create invitation via admin UI
2. Verify email sent with correct link format
3. Test invitation acceptance creates user in better-auth tables
4. Verify invitations table updated
