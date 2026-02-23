# M5 — Notifications

**Goal:** Smart notification system that replaces GitHub notifications.

**Dependencies:** M4 complete (routing and subscriptions build on extensibility)

## Overview

GitHub notifications are noisy and miss context. M5 creates a notification system that's smarter - digest vs immediate, customizable rules, multiple channels, and subscriptions that actually make sense.

## Features

### 1. Notification Rules Engine

**What it does:** Define rules for when and how to notify users.

**Rule structure:**

```json
{
  "name": "Urgent issues immediate",
  "conditions": {
    "event": "work_item.created",
    "labels": ["urgent", "critical"],
    "repo": "nitejar/nitejar"
  },
  "actions": {
    "notify": "immediate",
    "channels": ["slack", "email"],
    "escalate_after": "30m"
  }
}
```

**Supported conditions:**

- Event type (work_item.created, job.completed, job.failed, etc.)
- Labels/tags
- Repository
- Agent
- Priority
- Time of day
- User mentions

**Supported actions:**

- Notify immediately
- Add to digest
- Escalate after timeout
- Suppress (don't notify)
- Route to specific channel

**Rule priority:**

- Rules evaluated in priority order
- First matching rule wins
- Default rule for unmatched events

**Implementation:**

```sql
CREATE TABLE notification_rules (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL, -- or team_id
  name TEXT NOT NULL,
  priority INTEGER DEFAULT 0,
  conditions JSONB NOT NULL,
  actions JSONB NOT NULL,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_data JSONB NOT NULL,
  status TEXT NOT NULL, -- pending, sent, digested, suppressed
  channels_sent JSONB DEFAULT '[]',
  created_at TIMESTAMP DEFAULT NOW(),
  sent_at TIMESTAMP
);
```

### 2. Multi-Channel Delivery

**What it does:** Send notifications via multiple channels.

**Initial channels:**

1. **Email:**
   - HTML email with context
   - Action buttons (view, respond)
   - Thread grouping by work item
   - Provider: SendGrid, Resend, or SES

2. **Slack:**
   - Rich message with blocks
   - Action buttons
   - Thread replies for updates
   - Webhook or Slack App

**Future channels:**

- Discord (webhook)
- Microsoft Teams
- SMS (Twilio)
- Push notifications (mobile app)

**Channel configuration:**

```sql
CREATE TABLE notification_channels (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL, -- email, slack, discord
  config JSONB NOT NULL, -- webhook_url, email, etc.
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);
```

**Per-channel preferences:**

- Which events go to which channel
- Quiet hours per channel
- Format preferences (verbose vs compact)

### 3. Subscriptions

**What it does:** Let users follow entities and get notified of activity.

**Subscribable entities:**

- Work items (specific item)
- Repositories (all activity in repo)
- Agents (all activity from agent)
- Labels (items with label)
- Users (activity involving user)

**Subscription levels:**

- **All activity:** Every event
- **Important only:** Completions, failures, mentions
- **Mentions only:** Only when explicitly mentioned

**Implementation:**

```sql
CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  entity_type TEXT NOT NULL, -- work_item, repo, agent, label
  entity_id TEXT NOT NULL,
  level TEXT NOT NULL, -- all, important, mentions
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, entity_type, entity_id)
);
```

**Auto-subscriptions:**

- Automatically subscribed to work items you create
- Automatically subscribed when mentioned
- Can unsubscribe at any time

**UI:**

- Subscribe button on work items, repos, agents
- Subscription management page
- Bulk subscribe/unsubscribe

### 4. Digest Aggregation

**What it does:** Summarize updates on a schedule instead of spamming.

**Digest types:**

- **Daily digest:** Summary of yesterday's activity
- **Weekly digest:** Summary of the week
- **Custom schedule:** Configurable frequency

**Digest content:**

- Completed work items (with outcomes)
- Failed jobs (with errors)
- Pending items needing attention
- New subscriptions activity
- Mentions

**Digest format:**

```markdown
# Your Nitejar Daily Digest

## Completed (5)

- [#123] Fixed auth bug → PR #456 merged
- [#124] Updated docs → Completed
  ...

## Needs Attention (2)

- [#125] Deploy failed - tests failing
- [#126] Waiting for approval

## New Activity (3 repos)

- nitejar/nitejar: 12 events
- acme/api: 3 events
  ...
```

**Digest delivery:**

- Configurable time (e.g., 9am daily)
- Timezone-aware
- Skip if no activity

**Implementation:**

```sql
CREATE TABLE digest_preferences (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  frequency TEXT NOT NULL, -- daily, weekly, custom
  schedule JSONB, -- cron or specific times
  timezone TEXT DEFAULT 'UTC',
  enabled BOOLEAN DEFAULT true
);

CREATE TABLE digest_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  notification_id TEXT REFERENCES notifications(id),
  digest_date DATE NOT NULL,
  included_in_digest BOOLEAN DEFAULT false
);
```

## User Experience

### Notification Center (Web UI)

- List of all notifications
- Filter by type, status, date
- Mark as read/unread
- Archive/delete
- Quick actions (view, respond)

### Settings Page

- Channel configuration
- Rule management
- Subscription management
- Digest preferences
- Quiet hours

### Inline Actions

- One-click actions in notifications
- "Approve", "Reject", "View", "Respond"
- Works in email and Slack

## Exit Criteria

- [ ] Notification rules engine implemented
- [ ] Rules support conditions (event, labels, repo, etc.)
- [ ] Rules support actions (immediate, digest, escalate)
- [ ] Email notification channel working
- [ ] Slack notification channel working
- [ ] Users can subscribe to work items
- [ ] Users can subscribe to repos/agents/labels
- [ ] Auto-subscription on creation/mention
- [ ] Daily digest generation works
- [ ] Weekly digest generation works
- [ ] Digest includes summary of activity
- [ ] Users rely on Nitejar notifications over GitHub notifications
- [ ] Configurable notification preferences per user
- [ ] Notification center in web UI
- [ ] Quiet hours respected
