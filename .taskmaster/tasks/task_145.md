# Task ID: 145

**Title:** Protect admin routes with authentication

**Status:** done

**Dependencies:** 139 ✓, 142 ✓

**Priority:** high

**Description:** Update admin layout to require authentication and redirect unauthenticated users to sign-in.

**Details:**

1. Update `apps/web/app/admin/layout.tsx`:
   - Import auth from '@/lib/auth'
   - Import headers from 'next/headers'
   - Get session: `const session = await auth.api.getSession({ headers: await headers() })`
   - If no session, redirect('/sign-in')
   - If session.user.status === 'disabled', redirect('/account-disabled')
2. Create `apps/web/app/(auth)/account-disabled/page.tsx`:
   - Display message that account is disabled
   - Include sign-out button
   - Contact admin message
3. Pass session to AdminProviders if needed for client-side auth state
4. Create SessionProvider context if needed for useSession hook
5. Test that all /admin/* routes redirect when not logged in

**Test Strategy:**

1. Access /admin without session - verify redirect to /sign-in
2. Sign in - verify access granted
3. Disable user status - verify redirect to account-disabled
4. Test all admin subroutes are protected
