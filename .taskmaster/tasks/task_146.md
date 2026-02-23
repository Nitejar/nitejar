# Task ID: 146

**Title:** Link better-auth users to existing nitejar users

**Status:** done

**Dependencies:** 138 ✓, 141 ✓

**Priority:** medium

**Description:** Create mechanism to link better-auth user records to existing nitejar users table for team membership and permissions.

**Details:**

1. When invitation is accepted or user signs up:
   - Check if matching email exists in nitejar `users` table
   - If yes, update better-auth `user.nitejar_user_id` to link them
   - If no, create record in nitejar `users` table and link
2. Add afterSignUp hook in auth config:
   ```typescript
   hooks: {
     afterSignUp: async ({ user }) => {
       // Find or create nitejar user
       // Update better-auth user with nitejar_user_id
     }
   }
   ```
3. Create utility function `linkOrCreateNitejarUser(betterAuthUser)` in database package
4. Update nitejar user status to 'active' when better-auth user is verified
5. Ensure team_members FK still works via nitejar_user_id

**Test Strategy:**

1. Accept invitation - verify both user tables updated
2. Verify nitejar_user_id is set correctly
3. Test team membership queries still work
4. Test existing users can sign in and are linked
