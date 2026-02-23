# Plan: Plugin Catalog UI Update

**Prerequisites:** All other plans (01-07) should be completed first, or at minimum the handler registrations from each.
**Estimated new files:** 0
**Estimated modified files:** 1

## Architecture Decisions

- This is a UI-only change — adding new plugins to the admin catalog.
- Each plugin needs an icon, display name, description, and category.
- The catalog already supports the pattern (Telegram, GitHub exist).

---

## Implementation

### Modified file

**`apps/web/app/admin/plugins/PluginCatalogClient.tsx`**

Add the following plugins to the active catalog:

| Plugin | Icon | Category | Description |
|---|---|---|---|
| Discord | Discord logo (use `MessageSquare` or similar from lucide-react, or import Discord SVG) | Communication | Connect agents to Discord servers via slash commands and channel messaging |
| Google Calendar | `Calendar` from lucide-react | Productivity | Read and manage Google Calendar events, check availability |
| Google Drive | `HardDrive` from lucide-react | Productivity | Search, upload, download, and manage files in Google Drive |
| Google Docs | `FileText` from lucide-react | Productivity | Create, read, and edit Google Docs documents |
| Gmail | `Mail` from lucide-react | Communication | Search, read, and send emails via Gmail |

Each catalog entry should include:
- `type` — matches the handler registration key (e.g., `'discord'`, `'google-calendar'`, `'google-drive'`, `'google-docs'`, `'gmail'`)
- `name` — display name
- `description` — one-line description
- `icon` — Lucide icon component
- `category` — grouping in the catalog UI
- `configFields` — the handler config fields (from each plugin's types)
- `sensitiveFields` — which config fields are secrets (e.g., Discord's `botToken`)

### Config fields per plugin

**Discord:**
- `applicationId` (text, required)
- `publicKey` (text, required)
- `botToken` (text, required, **sensitive**)
- `guildId` (text, required)

**Google Calendar:**
- `defaultCalendarId` (text, optional, default: 'primary')
- OAuth connection button (not a text field — special UI component)

**Google Drive:**
- `rootFolderId` (text, optional)
- OAuth connection button

**Google Docs:**
- `defaultFolderId` (text, optional)
- OAuth connection button

**Gmail:**
- `defaultSendAs` (text, optional)
- OAuth connection button

### OAuth connection UI

For the four Google plugins, the config form needs a "Connect Google Account" button that:
1. Initiates the OAuth flow (redirects to `/api/oauth/google/authorize?pluginInstanceId={id}&scopes={scopes}`)
2. Shows connection status (connected email, or "Not connected")
3. Allows disconnecting (deletes OAuth connection)

This component was defined in `03-google-oauth.md` — this step wires it into the catalog config forms.

---

## Testing

- Visual verification: navigate to `/admin/plugins`, verify all 5 new plugins appear
- Click each plugin, verify config form renders with correct fields
- For Google plugins, verify OAuth button appears and initiates flow
- Use the **agent-browser** skill to screenshot and verify UI

## Verification

1. `pnpm format && pnpm lint && pnpm run typecheck` — zero errors
2. `pnpm test` — all tests pass
3. Visual check: all plugins visible in catalog with correct icons/descriptions
4. Config forms render correctly for each plugin type
