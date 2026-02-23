# Task ID: 139

**Title:** Set up better-auth API route handler

**Status:** done

**Dependencies:** 137 ✓, 138 ✓

**Priority:** high

**Description:** Create the Next.js API route that handles all better-auth endpoints.

**Details:**

1. Create `apps/web/app/api/auth/[...all]/route.ts`
2. Import auth from '@/lib/auth'
3. Import toNextJsHandler from 'better-auth/next-js'
4. Export GET and POST handlers: `export const { POST, GET } = toNextJsHandler(auth)`
5. Ensure route is not caught by any middleware
6. Add route segment config for edge compatibility if needed

**Test Strategy:**

1. Start dev server
2. Test GET /api/auth/session returns null or session
3. Test POST /api/auth/sign-in/email with invalid creds returns error
4. Check no CORS or routing issues
