# PRD: Nitejar Authentication & Team MCP Server

## Overview

Build a comprehensive authentication system for nitejar using [better-auth](https://www.better-auth.com/) with email+password sign-in and forgot password functionality. Then create an MCP (Model Context Protocol) server that allows authenticated team members to manage agents they have access to via AI tools like Claude Code.

## Problem Statement

Currently, all nitejar admin functionality is publicly accessible with no authentication. Team members cannot:

- Securely access the admin UI or agent configuration
- Reset forgotten passwords
- Access agent configuration from their AI tools (Claude Code, etc.)
- Make changes to agents they're responsible for without full admin access
- Have audit trails of who made what changes

## Goals

### Phase 0: Authentication Foundation

1. **better-auth Integration** - Add better-auth to the Next.js app
2. **Email Provider Setup** - Configure Resend/SMTP for transactional emails
3. **Invitation Flow** - Admins invite users via email, users accept and set password
4. **Email+Password Auth** - Sign in, sign out flows
5. **Forgot Password** - Password reset via email
6. **Protected Routes** - Admin UI requires authentication
7. **User-Account Linking** - Connect better-auth users to existing nitejar users table
8. **Profile Settings Page** - View/edit profile, change password, manage sessions

### Phase 1: MCP Server (MVP)

7. **MCP Server Package** - Create `packages/mcp-server`
8. **API Token Management** - Generate/revoke tokens in profile settings
9. **Session Validation** - MCP validates API tokens
10. **Basic Agent Read Access** - List and view agents the user has access to
11. **Basic Agent Updates** - Edit agent identity fields (name, title, emoji, avatar)

### Phase 2: Enhanced Capabilities

12. **Two-Factor Authentication** - TOTP-based 2FA with recovery codes
13. **Soul Editing** - Update agent soul/identity documents
14. **Model Configuration** - Adjust model settings (with guardrails)
15. **Team Context** - View team information and membership
16. **Audit Logging** - Track all changes made via MCP

## User Stories

### Authentication (Phase 0)

- As an admin, I want to invite new team members by email
- As an invited user, I want to receive an invitation email with a link to join
- As an invited user, I want to set my password when accepting the invitation
- As a team member, I want to sign in to the admin UI securely
- As a team member, I want to reset my password if I forget it (via email)
- As a team member, I want to sign out when I'm done
- As a team member, I want to view and edit my profile (name, avatar)
- As a team member, I want to change my password from settings
- As a team member, I want to see and revoke active sessions

### Two-Factor Authentication (Phase 2)

- As a team member, I want to enable 2FA for additional security
- As a team member, I want to use an authenticator app (TOTP)
- As a team member, I want recovery codes in case I lose my device

### MCP Access (Phase 1)

- As a team member, I want to authenticate my MCP client using my nitejar credentials
- As a team member, I want to list all agents my team has access to
- As a team member, I want to view and update agent details from Claude Code

### Access Control

- As a team member, I can only see agents assigned to my team(s)
- As an admin, I can see all agents in the organization
- As a superadmin, I have full access to all resources

## Technical Design

### Architecture

```
┌─────────────────────┐     ┌─────────────────────┐
│  Browser            │     │  Next.js App        │
│  (Admin UI)         │────▶│  /app/api/auth/*    │──┐
└─────────────────────┘     └─────────────────────┘  │
                                                      │
┌─────────────────────┐     ┌─────────────────────┐  │
│  MCP Client         │     │  Nitejar MCP Server │  │
│  (Claude Code,etc)  │────▶│  (Node.js)          │──┤
└─────────────────────┘     └─────────────────────┘  │
                                                      │
                            ┌─────────────────────┐  │
                            │  better-auth        │◀─┘
                            │  (Session Manager)  │
                            └──────────┬──────────┘
                                       │
              ┌────────────────────────┼────────────────────────┐
              │                        │                        │
    ┌─────────▼─────────┐   ┌─────────▼─────────┐   ┌─────────▼─────────┐
    │ SQLite Database   │   │ Email Provider    │   │ Audit Log         │
    │ (better-auth +    │   │ (Resend/SMTP)     │   │ System            │
    │  nitejar tables)  │   └───────────────────┘   └───────────────────┘
    └───────────────────┘
```

### Phase 0: better-auth Integration

#### Installation

```bash
pnpm add better-auth resend
```

#### Email Provider Setup (`apps/web/lib/email.ts`)

```typescript
import { Resend } from "resend"

const resend = new Resend(process.env.RESEND_API_KEY)

export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string
  subject: string
  html: string
}) {
  await resend.emails.send({
    from: "Nitejar <noreply@yourdomain.com>",
    to,
    subject,
    html,
  })
}
```

#### Auth Configuration (`apps/web/lib/auth.ts`)

```typescript
import { betterAuth } from "better-auth"
import { invitation } from "better-auth/plugins"
import Database from "better-sqlite3"
import { sendEmail } from "./email"

export const auth = betterAuth({
  database: new Database("./data/nitejar.db"),

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,

    // Password reset flow
    sendResetPassword: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: "Reset your Nitejar password",
        html: `
          <h1>Password Reset</h1>
          <p>Click the link below to reset your password:</p>
          <a href="${url}">Reset Password</a>
          <p>This link expires in 1 hour.</p>
        `,
      })
    },
  },

  plugins: [
    invitation({
      sendInvitationEmail: async ({ email, invitedBy, url }) => {
        await sendEmail({
          to: email,
          subject: "You're invited to join Nitejar",
          html: `
            <h1>You've Been Invited!</h1>
            <p>${invitedBy.name} has invited you to join Nitejar.</p>
            <p>Click the link below to accept and create your account:</p>
            <a href="${url}">Accept Invitation</a>
            <p>This link expires in 48 hours.</p>
          `,
        })
      },
    }),
  ],

  // Custom user fields
  user: {
    additionalFields: {
      role: {
        type: "string",
        defaultValue: "member",
      },
      status: {
        type: "string",
        defaultValue: "active",
      },
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // Update session every 24 hours
  },
})

export type Session = typeof auth.$Infer.Session
```

#### Invitation Flow

1. **Admin invites user** (from `/admin/members` page):

   ```typescript
   await authClient.invitation.sendInvitation({
     email: "newuser@example.com",
     role: "member", // or "admin"
   })
   ```

2. **User receives email** with invitation link:

   ```
   https://nitejar.example.com/accept-invitation?token=xxx
   ```

3. **User accepts invitation** (sets name and password):
   ```typescript
   await authClient.invitation.acceptInvitation({
     token: "xxx",
     name: "New User",
     password: "securePassword123",
   })
   ```

#### Database Tables (invitation plugin adds)

```sql
CREATE TABLE "invitation" (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  inviterId TEXT NOT NULL REFERENCES "user"(id),
  role TEXT,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, accepted, canceled
  expiresAt INTEGER NOT NULL,
  createdAt INTEGER NOT NULL
);
```

#### API Route (`apps/web/app/api/auth/[...all]/route.ts`)

```typescript
import { auth } from "@/lib/auth"
import { toNextJsHandler } from "better-auth/next-js"

export const { POST, GET } = toNextJsHandler(auth)
```

#### Auth Client (`apps/web/lib/auth-client.ts`)

```typescript
import { createAuthClient } from "better-auth/react"

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
})

export const { signIn, signUp, signOut, useSession } = authClient
```

#### Database Tables (created by better-auth CLI)

```sql
-- better-auth creates these tables automatically
CREATE TABLE "user" (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  emailVerified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  -- Custom fields
  role TEXT NOT NULL DEFAULT 'member',
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE "session" (
  id TEXT PRIMARY KEY,
  expiresAt INTEGER NOT NULL,
  ipAddress TEXT,
  userAgent TEXT,
  userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);

CREATE TABLE "account" (
  id TEXT PRIMARY KEY,
  accountId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  accessToken TEXT,
  refreshToken TEXT,
  idToken TEXT,
  expiresAt INTEGER,
  password TEXT -- For email/password auth
);

CREATE TABLE "verification" (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expiresAt INTEGER NOT NULL
);
```

#### Migration Strategy

Since we have an existing `users` table, we have two options:

**Option A: Use better-auth tables (Recommended)**

- Let better-auth manage its own `user` table
- Add `nitejar_user_id` column to link to existing `users` table
- Sync relevant fields on sign-up/update

**Option B: Adapt existing table**

- Rename `users` → `user`
- Add required better-auth columns
- Run better-auth with `skipMigration: true`

_Recommendation_: Option A for cleaner separation

#### Auth UI Pages

```
apps/web/app/
├── (auth)/
│   ├── sign-in/
│   │   └── page.tsx          # Email + password form
│   ├── accept-invitation/
│   │   └── page.tsx          # Set password for invited user (with token)
│   ├── forgot-password/
│   │   └── page.tsx          # Request reset email
│   └── reset-password/
│       └── page.tsx          # Set new password (with token)
├── settings/
│   ├── page.tsx              # Profile settings (name, avatar)
│   ├── security/
│   │   └── page.tsx          # Change password, 2FA (Phase 2)
│   ├── sessions/
│   │   └── page.tsx          # Active sessions, revoke
│   └── api-tokens/
│       └── page.tsx          # Generate/manage API tokens for MCP
└── admin/
    ├── layout.tsx            # Protected - requires auth
    └── members/
        └── page.tsx          # Existing page - add "Invite" button
```

#### Protected Admin Layout (`apps/web/app/admin/layout.tsx`)

```typescript
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export default async function AdminLayout({ children }) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/sign-in");
  }

  // Check user status
  if (session.user.status === "disabled") {
    redirect("/account-disabled");
  }

  return <>{children}</>;
}
```

### Phase 1: MCP Server

#### Package Structure (`packages/mcp-server`)

```
packages/mcp-server/
├── src/
│   ├── index.ts              # Entry point & CLI
│   ├── server.ts             # MCP server setup
│   ├── auth/
│   │   ├── session.ts        # Validate better-auth sessions
│   │   └── middleware.ts     # Auth middleware for tools
│   ├── tools/
│   │   ├── index.ts          # Tool registry
│   │   ├── auth-tools.ts     # login, logout, whoami
│   │   ├── agent-tools.ts    # list_agents, get_agent, update_agent
│   │   └── team-tools.ts     # list_teams, get_team
│   └── types.ts
├── package.json
└── tsconfig.json
```

#### MCP Authentication Flow

Since better-auth manages sessions server-side, the MCP server needs to:

1. **Option A: API Token Generation** (Recommended)
   - User generates an API token in the web UI
   - Token stored in `api_tokens` table linked to user
   - MCP server validates token directly against database

2. **Option B: Session Cookie Forwarding**
   - User copies session cookie from browser
   - MCP server validates against better-auth session table
   - Less secure, sessions expire

**API Token Implementation:**

```sql
-- New table for MCP API tokens
CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                    -- "Claude Code", "My Laptop", etc.
  token_hash TEXT NOT NULL UNIQUE,       -- bcrypt hash
  last_used_at INTEGER,
  expires_at INTEGER,                    -- NULL = never expires
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
```

#### MCP Tools

##### Authentication Tools

```typescript
// Generate login URL - opens web UI to create API token
tool: "auth_login"
input: {}
output: {
  url: string,           // URL to open: /settings/api-tokens
  message: string        // "Open this URL to create an API token..."
}

// Set API token for this session
tool: "auth_set_token"
input: {
  token: string          // The API token from web UI
}
output: {
  success: boolean,
  user?: { id, name, email, role }
}

// Check authentication status
tool: "auth_whoami"
input: {}
output: {
  authenticated: boolean,
  user?: {
    id: string,
    name: string,
    email: string,
    role: string,
    teams: Array<{ id: string, name: string, role: string }>
  }
}

// Logout / clear token from MCP session
tool: "auth_logout"
input: {}
output: { success: boolean }
```

##### Agent Tools

```typescript
// List agents accessible to the authenticated user
tool: "list_agents"
input: {
  team_id?: string,      // Optional filter by team
  status?: string        // Optional filter by status
}
output: {
  agents: Array<{
    id: string,
    handle: string,
    name: string,
    title: string | null,
    emoji: string | null,
    status: string,
    team: { id: string, name: string } | null
  }>
}

// Get full agent details
tool: "get_agent"
input: {
  id?: string,           // Agent UUID
  handle?: string        // Or agent handle (one required)
}
output: {
  id: string,
  handle: string,
  name: string,
  title: string | null,
  emoji: string | null,
  avatar_url: string | null,
  status: string,
  soul: string | null,
  model: string | null,
  teams: Array<{ id: string, name: string, is_primary: boolean }>,
  created_at: string,
  updated_at: string
}

// Update agent details
tool: "update_agent"
input: {
  id: string,
  updates: {
    name?: string,
    title?: string,
    emoji?: string,
    avatar_url?: string
  }
}
output: {
  success: boolean,
  agent: { /* updated agent */ }
}
```

##### Team Tools (Phase 2)

```typescript
// List teams the user belongs to
tool: "list_teams"
input: {}
output: {
  teams: Array<{
    id: string,
    name: string,
    description: string | null,
    role: string,
    agent_count: number,
    member_count: number
  }>
}

// Get team details
tool: "get_team"
input: { id: string }
output: {
  id: string,
  name: string,
  description: string | null,
  agents: Array<{ id: string, handle: string, name: string }>,
  members: Array<{ id: string, name: string, role: string }>
}
```

### Phase 2: Two-Factor Authentication

better-auth provides a [two-factor authentication plugin](https://www.better-auth.com/docs/plugins/two-factor) that supports TOTP (authenticator apps).

#### Server Configuration

```typescript
import { betterAuth } from "better-auth"
import { twoFactor } from "better-auth/plugins"

export const auth = betterAuth({
  // ... existing config
  plugins: [
    twoFactor({
      issuer: "Nitejar", // Shows in authenticator app
      totpOptions: {
        digits: 6,
        period: 30,
      },
    }),
  ],
})
```

#### Client Usage

```typescript
import { createAuthClient } from "better-auth/react"
import { twoFactorClient } from "better-auth/client/plugins"

export const authClient = createAuthClient({
  plugins: [twoFactorClient()],
})

// Enable 2FA - returns QR code URI
const { data } = await authClient.twoFactor.enable()

// Verify setup with code from authenticator
await authClient.twoFactor.verifyTotp({ code: "123456" })

// Generate backup codes
const { data: backupCodes } = await authClient.twoFactor.generateBackupCodes()

// Disable 2FA
await authClient.twoFactor.disable({ password: "userPassword" })
```

#### Database Tables (added by 2FA plugin)

```sql
CREATE TABLE "twoFactor" (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  secret TEXT NOT NULL,
  backupCodes TEXT NOT NULL,  -- JSON array of hashed codes
  createdAt INTEGER NOT NULL
);
```

### Access Control Rules

```typescript
type Role = "superadmin" | "admin" | "member"

// Agent access rules
function canAccessAgent(user: User, agent: Agent): boolean {
  if (user.role === "superadmin" || user.role === "admin") {
    return true
  }
  // Members can only access agents in their teams
  const userTeamIds = user.teams.map((t) => t.id)
  const agentTeamIds = agent.teams.map((t) => t.id)
  return userTeamIds.some((id) => agentTeamIds.includes(id))
}

// Agent update rules
function canUpdateAgent(user: User, agent: Agent): boolean {
  if (user.role === "superadmin") {
    return true
  }
  if (user.role === "admin") {
    return true
  }
  // Members can update agents in their teams
  return canAccessAgent(user, agent)
}

// Model configuration rules (Phase 2)
function canUpdateAgentModel(user: User, agent: Agent): boolean {
  return user.role === "superadmin" || user.role === "admin"
}
```

### Environment Variables

```bash
# better-auth (required)
BETTER_AUTH_SECRET=<openssl rand -base64 32>
BETTER_AUTH_URL=http://localhost:3000

# Email provider (required for invitations & password reset)
RESEND_API_KEY=re_xxx
RESEND_FROM_EMAIL=noreply@yourdomain.com

# MCP Server
MCP_DATABASE_PATH=./data/nitejar.db
```

### MCP Server Configuration

Users configure in their `.mcp.json`:

```json
{
  "mcpServers": {
    "nitejar": {
      "command": "npx",
      "args": ["@nitejar/mcp-server"],
      "env": {
        "SLOPBOT_URL": "http://localhost:3000",
        "MCP_DATABASE_PATH": "/path/to/nitejar/apps/web/data/nitejar.db"
      }
    }
  }
}
```

Or for local development:

```json
{
  "mcpServers": {
    "nitejar": {
      "command": "pnpm",
      "args": ["--filter", "@nitejar/mcp-server", "start"],
      "cwd": "/path/to/nitejar"
    }
  }
}
```

## Success Metrics

### Phase 0

- [ ] Users can sign up with email+password
- [ ] Users can sign in and sign out
- [ ] Users can reset forgotten passwords
- [ ] Admin UI is protected (redirects to sign-in)
- [ ] better-auth tables created and working

### Phase 1

- [ ] MCP server package created and runnable
- [ ] Users can generate API tokens in web UI
- [ ] MCP can authenticate with API tokens
- [ ] Authenticated users can list/view/update agents
- [ ] Access control enforced (team-based)

### Phase 2

- [ ] Users can edit agent souls via MCP
- [ ] Admins can modify model settings
- [ ] Team tools available
- [ ] All changes audit logged

## Out of Scope (for now)

- **Email verification** - Start without, add later
- **Agent creation/deletion via MCP** - Only updates
- **Real-time subscriptions** - Polling only
- **Multi-org support** - Single organization assumed

## Dependencies

### Phase 0

- `better-auth` - Authentication framework (with invitation plugin)
- `resend` - Email delivery for invitations & password reset

### Phase 1

- `@modelcontextprotocol/sdk` - MCP server SDK
- `@nitejar/database` - Existing database package
- `bcrypt` - Token hashing

## Risks & Mitigations

| Risk                           | Impact   | Mitigation                                      |
| ------------------------------ | -------- | ----------------------------------------------- |
| better-auth schema conflicts   | High     | Use separate tables, link via ID                |
| Email delivery (invites/reset) | Medium   | Use reliable provider (Resend), add retry logic |
| API token security             | High     | bcrypt hashing, optional expiration             |
| Session hijacking              | Medium   | Secure cookies, HTTPS in production             |
| Access control bypass          | Critical | Unit tests for all access rules                 |

## Task Breakdown

### Phase 0: Authentication (~11 tasks)

1. Install better-auth and configure auth instance
2. Set up email provider (Resend) for transactional emails
3. Create database migration for better-auth tables (user, session, account, verification, invitation) + api_tokens
4. Set up API route handler for better-auth
5. Create auth client for React (with invitation plugin)
6. Build sign-in page
7. Build invitation flow: admin invite UI + accept-invitation page
8. Build forgot-password and reset-password pages
9. Add protected layout for admin routes
10. Build profile settings page (name, avatar)
11. Build security settings page (change password) + sessions management

### Phase 1: MCP Server (~6 tasks)

1. Create `packages/mcp-server` package structure
2. Build API token management UI (/settings/api-tokens)
3. Implement API token validation in MCP server
4. Implement auth tools (login, set_token, whoami, logout)
5. Implement agent read tools (list_agents, get_agent)
6. Implement agent write tools (update_agent) with access control

### Phase 2: Enhanced (~6 tasks)

1. Add two-factor authentication (TOTP) with better-auth plugin
2. Add 2FA setup UI in security settings
3. Add update_agent_soul tool
4. Add model configuration tool (admin-only)
5. Add team tools (list_teams, get_team)
6. Add audit logging for MCP changes

**Total: ~23 tasks**

## Example User Flows

### Invitation Flow (New User Onboarding)

```
1. Admin goes to /admin/members and clicks "Invite Member"
2. Admin enters new user's email and selects role (member/admin)
3. System sends invitation email via Resend
4. New user receives email with "Accept Invitation" link
5. New user clicks link → /accept-invitation?token=xxx
6. New user enters their name and sets a password
7. Account created, user redirected to /admin
```

### Web Sign-In Flow

```
1. User visits /admin → redirected to /sign-in
2. User enters email + password
3. better-auth validates credentials
4. Session created, user redirected to /admin
5. Admin layout checks session, renders dashboard
```

### Password Reset Flow

```
1. User clicks "Forgot password?" on sign-in page
2. User enters email on /forgot-password
3. better-auth sends reset email via configured provider
4. User clicks link in email → /reset-password?token=xxx
5. User enters new password
6. better-auth validates token, updates password
7. User redirected to /sign-in with success message
```

### MCP Authentication Flow

```
User: List my agents
Claude: [calls list_agents tool]
→ Error: Not authenticated. Use auth_login to get started.

User: Log me in
Claude: [calls auth_login tool]
→ Open http://localhost:3000/settings/api-tokens to create an API token.
   Then use auth_set_token to authenticate.

[User opens URL, creates token named "Claude Code", copies token]

User: Here's my token: sbot_xxxxxxxxxxxx
Claude: [calls auth_set_token with token]
→ Authenticated as josh@example.com (admin)

User: List my agents
Claude: [calls list_agents tool]
→ You have access to 3 agents:
  1. @mary (Mary) - DevOps Engineer - idle
  2. @alex (Alex) - Frontend Developer - busy
  3. @sam (Sam) - QA Engineer - idle

User: Update mary's title to "Platform Engineer"
Claude: [calls update_agent tool]
→ Updated @mary's title to "Platform Engineer"
```

## Appendix

### better-auth Resources

- [Installation Guide](https://www.better-auth.com/docs/installation)
- [Email & Password Auth](https://www.better-auth.com/docs/authentication/email-password)
- [Email Configuration](https://www.better-auth.com/docs/concepts/email)
- [Client Library](https://www.better-auth.com/docs/concepts/client)
- [GitHub Repository](https://github.com/better-auth/better-auth)

### Existing Database Schema Reference

```typescript
// Current nitejar users table (will be linked, not replaced)
interface UserTable {
  id: Generated<string>
  name: string
  email: string
  avatar_url: string | null
  role: Generated<string> // 'superadmin' | 'admin' | 'member'
  status: Generated<string> // 'invited' | 'active' | 'disabled'
  created_at: Generated<number>
  updated_at: Generated<number>
}

interface TeamMemberTable {
  team_id: string
  user_id: string
  role: Generated<string>
  created_at: Generated<number>
}

interface AgentTeamTable {
  team_id: string
  agent_id: string
  is_primary: Generated<number>
  created_at: Generated<number>
}
```
