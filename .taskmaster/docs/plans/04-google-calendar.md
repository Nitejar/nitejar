# Plan: Google Calendar Plugin

**Prerequisites:** `03-google-oauth.md` must be completed first.
**Estimated new files:** 3
**Estimated modified files:** 0-1

## Architecture Decisions

- Handler relies on OAuth connection (no separate secrets in handler config).
- Tools are provider-prefixed (`google_calendar_`) to avoid collisions.
- Tools auto-appear on agents assigned to a Google Calendar plugin instance via existing `extractIntegrationTools()` wiring — no new plumbing needed.
- Watch/push notifications (real-time sync) are deferred to Phase 3+ per tech spec. Not in this plan.

---

## Implementation

### New files

**`packages/plugin-handlers/src/google-calendar/index.ts`** — `PluginHandler` implementation

Handler config fields:
- No secrets — relies entirely on OAuth connection from `03-google-oauth.md`
- Optional: `defaultCalendarId` (text, default `'primary'`)

Session key: Not applicable (Google Calendar is tool-only, not a messaging channel)
`testConnection`: Verify OAuth connection exists and is active, make a test `calendarList.list` call

**`packages/plugin-handlers/src/google-calendar/types.ts`**
- `GoogleCalendarConfig` — handler config shape
- Google Calendar API response types (Event, CalendarList, FreeBusy)

**`packages/plugin-handlers/src/google-calendar/client.ts`**

Low-level Google Calendar API client. All methods take an access token (resolved via `getValidGoogleToken` from `03-google-oauth.md`).

Base URL: `https://www.googleapis.com/calendar/v3`

Methods:
- `listEvents(token, calendarId, params)` — GET `/calendars/{id}/events`
- `getEvent(token, calendarId, eventId)` — GET `/calendars/{id}/events/{eventId}`
- `createEvent(token, calendarId, event)` — POST `/calendars/{id}/events`
- `updateEvent(token, calendarId, eventId, event)` — PATCH `/calendars/{id}/events/{eventId}`
- `deleteEvent(token, calendarId, eventId)` — DELETE `/calendars/{id}/events/{eventId}`
- `getFreeBusy(token, params)` — POST `/freeBusy`

### Integration provider

**`packages/agent/src/integrations/google-calendar.ts`**

Tools (all prefixed `google_calendar_`):

| Tool | Parameters | Description |
|---|---|---|
| `google_calendar_list_events` | `calendar_id?`, `time_min?`, `time_max?`, `max_results?`, `query?` | List events in a time range |
| `google_calendar_get_event` | `calendar_id?`, `event_id` | Get a single event's details |
| `google_calendar_create_event` | `calendar_id?`, `summary`, `start`, `end`, `description?`, `location?`, `attendees?` | Create a new event |
| `google_calendar_update_event` | `calendar_id?`, `event_id`, `summary?`, `start?`, `end?`, `description?`, `location?`, `attendees?` | Update an existing event |
| `google_calendar_delete_event` | `calendar_id?`, `event_id` | Delete an event |
| `google_calendar_check_free_busy` | `calendar_ids`, `time_min`, `time_max` | Check availability across calendars |

System prompt section: Calendar-specific context (date/time formatting expectations, timezone handling, how to interpret "next Monday" etc.)

Self-registration in integration registry.

### Pattern

- Handler: `packages/plugin-handlers/src/telegram/` for structure
- Integration: `packages/agent/src/integrations/telegram.ts` for tools + prompt + registry

---

## Testing

**File:** `packages/plugin-handlers/src/google-calendar/client.test.ts`

- Each API method with mocked Google Calendar responses
- Error handling (401 unauthorized → token refresh, 404 not found)
- Event creation with attendees
- FreeBusy response parsing

**Integration test scenario:**
1. Plugin instance with active OAuth connection
2. Agent assigned to instance
3. Agent calls `google_calendar_list_events`
4. Verify API call made with correct token
5. Verify receipt (`external_api_calls`) created

## Verification

1. `pnpm format && pnpm lint && pnpm run typecheck` — zero errors
2. `pnpm test` — all tests pass
3. With a real Google OAuth connection: create an event, list events, verify event appears

## Required OAuth Scopes

```
https://www.googleapis.com/auth/calendar
```

This is defined in `GOOGLE_SCOPE_TEMPLATES.calendar` from `03-google-oauth.md`.
