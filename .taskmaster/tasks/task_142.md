# Task ID: 142

**Title:** Build sign-in page

**Status:** done

**Dependencies:** 139 ✓

**Priority:** high

**Description:** Create the email+password sign-in page with forgot password link.

**Details:**

1. Create `apps/web/app/(auth)/sign-in/page.tsx`
2. Build sign-in form using shadcn/ui components:
   - Email input with validation
   - Password input with show/hide toggle
   - Submit button with loading state
   - Link to /forgot-password
   - Error display for invalid credentials
3. Use authClient.signIn.email() on submit
4. Redirect to /admin on successful login
5. Handle common errors: invalid credentials, account disabled, etc.
6. Style consistent with existing admin UI (dark theme, gradients)
7. Create (auth) layout.tsx with centered card layout

**Test Strategy:**

1. Navigate to /sign-in
2. Test form validation (empty fields, invalid email)
3. Test invalid credentials show error
4. Test successful login redirects to /admin
5. Test loading state during submission
