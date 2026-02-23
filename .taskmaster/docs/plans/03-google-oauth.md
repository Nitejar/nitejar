# Plan: Google OAuth Substrate

**Prerequisites:** None — can start immediately.
**Estimated new files:** 5
**Estimated modified files:** 2

## Architecture Decisions

- **Separate from existing MCP OAuth tables.** The existing MCP OAuth tables are for Nitejar-as-provider; these new tables are for Nitejar-as-client consuming Google APIs.
- **Schema-ready for per-user ownership.** MVP behavior is shared-per-plugin-instance (admin links one Google account, all assigned agents use it). But `oauth_connections` includes `user_id` (nullable) and `is_private` (boolean, default false) from day one.
- **Credential resolution order:** user-owned private connection → shared instance connection. Handled by `resolveConnectionForRequest()`.
- **Token encryption** uses existing AES-256-GCM at `packages/database/src/encryption.ts`.
- **Token refresh** is transparent — happens before each Google API call.
- **Scopes are per-plugin** — Calendar gets calendar scopes, Gmail gets mail scopes, etc.
- **No UI for private connections in this plan** — just the schema columns.

---

## Implementation

### New files

**`packages/database/migrations/2026MMDD_000000_provider_oauth.ts`**

Two tables:

`oauth_connections`:
- `id` (text PK)
- `provider` (text — 'google')
- `plugin_instance_id` (text FK → plugin_instances.id)
- `user_id` (text, nullable FK → users.id) — for future per-user connections
- `is_private` (boolean, default false) — for future per-user access control
- `account_email` (text) — display label for the connected account
- `scopes` (text — JSON array of granted scopes)
- `status` (text — 'active', 'expired', 'revoked')
- `created_at` (text)
- `updated_at` (text)

`oauth_tokens`:
- `id` (text PK)
- `connection_id` (text FK → oauth_connections.id)
- `access_token_encrypted` (text) — AES-256-GCM encrypted
- `refresh_token_encrypted` (text) — AES-256-GCM encrypted
- `token_type` (text — 'Bearer')
- `expires_at` (text — ISO timestamp)
- `scopes` (text — JSON array, actual scopes returned by provider)
- `created_at` (text)
- `updated_at` (text)

**`packages/database/src/repositories/oauth-connections.ts`**
- `createOAuthConnection(connection)` — insert new connection
- `getOAuthConnection(id)` — get by ID
- `getOAuthConnectionForInstance(pluginInstanceId)` — get shared connection for an instance
- `upsertOAuthToken(connectionId, tokenData)` — insert or update token
- `getValidToken(connectionId)` — get token, return null if expired
- `refreshTokenIfExpired(connectionId)` — check expiry, refresh if needed, return valid token
- `resolveConnectionForRequest(pluginInstanceId, userId?)` — credential resolution:
  1. If `userId` provided, look for private connection owned by that user
  2. Fall back to shared (non-private) connection on the instance
  3. Return null if no connection found
- `deleteOAuthConnection(id)` — remove connection + associated tokens

**`apps/web/app/api/oauth/google/authorize/route.ts`**

Initiate OAuth redirect:
- Accept `pluginInstanceId` and `scopes` as query params
- Build Google OAuth URL with:
  - `client_id` from env (`GOOGLE_CLIENT_ID`)
  - `redirect_uri` → `/api/oauth/google/callback`
  - `scope` from request
  - `state` — encrypted JSON containing `pluginInstanceId` + CSRF token
  - `access_type=offline` (to get refresh token)
  - `prompt=consent` (to always get refresh token)
- Redirect user to Google

**`apps/web/app/api/oauth/google/callback/route.ts`**

Handle OAuth callback:
- Verify `state` param (decrypt, check CSRF)
- Exchange `code` for tokens via Google token endpoint
- Extract `account_email` from ID token or userinfo endpoint
- Create `oauth_connection` row
- Encrypt and store tokens in `oauth_tokens`
- Redirect back to admin plugin instance page with success indicator

**`apps/web/server/services/oauth/google.ts`**

Token refresh utility:
- `refreshGoogleToken(refreshToken)` — POST to `https://oauth2.googleapis.com/token` with refresh token
- `getValidGoogleToken(connectionId)` — check expiry, refresh if needed, update DB, return access token
- `GOOGLE_SCOPE_TEMPLATES` — predefined scope sets:
  - `calendar`: `['https://www.googleapis.com/auth/calendar']`
  - `drive`: `['https://www.googleapis.com/auth/drive']`
  - `docs`: `['https://www.googleapis.com/auth/documents', 'https://www.googleapis.com/auth/drive.readonly']`
  - `gmail`: `['https://www.googleapis.com/auth/gmail.modify', 'https://www.googleapis.com/auth/gmail.send']`

### Modified files

- `packages/database/src/types.ts` — add `OAuthConnection`, `OAuthToken` types
- Admin UI — "Connect Google Account" button on Google plugin instance pages (exact file depends on current admin structure; likely the plugin instance detail page)

---

## Testing

**File:** `packages/database/src/repositories/oauth-connections.test.ts`

- CRUD operations on `oauth_connections` and `oauth_tokens`
- Token refresh flow (mock Google token endpoint)
- `resolveConnectionForRequest` — shared connection found, private connection preferred, no connection returns null
- Scope validation
- Encrypted token storage (verify tokens are not stored in plaintext)
- `refreshTokenIfExpired` — token not expired (no refresh), token expired (refresh + update)

**File:** `apps/web/server/services/oauth/google.test.ts`

- `refreshGoogleToken` — mock Google token endpoint
- `getValidGoogleToken` — token valid (no refresh), token expired (refresh)
- Scope template correctness

## Verification

1. `pnpm format && pnpm lint && pnpm run typecheck` — zero errors
2. `pnpm test` — all tests pass
3. Run migration: `pnpm --filter @nitejar/database db:migrate`
4. Complete OAuth flow end-to-end: click "Connect Google Account" → Google consent → callback → verify `oauth_connections` + `oauth_tokens` rows created
5. Verify token refresh: manually expire a token, call `getValidGoogleToken`, verify it refreshes

## Environment Variables Needed

Add to `apps/web/.env`:
```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

These are from a Google Cloud project with the appropriate OAuth consent screen configured.
