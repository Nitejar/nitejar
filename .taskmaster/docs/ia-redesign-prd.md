# Information Architecture Redesign

## Problem

The current IA is built around a fleet-monitoring mental model: you land on an ops dashboard, configure agents through forms, and discover sessions (the actual interaction surface) as nav item 9 of 9. This works for day-30 power users managing a fleet of agents with real traffic. It fails completely for day-1 users who need to create an agent, talk to it, and feel the product's value in under 2 minutes.

### Specific Failures

1. **Empty dashboard on day 1.** New users land on Command Center showing 6 stat cards of zeros, an empty roster table, and no guidance on what to do next.
2. **Sessions buried.** The primary interaction loop (talk to an agent) is the last nav item. There's no "Chat" CTA on agent cards or detail pages.
3. **Settings junk drawer.** The settings dropdown mixes infrastructure (Gateway, Runtime), org governance (Teams, Members, Access), autonomy config (Routines), and debug tools (Event Log) with no grouping.
4. **Terminology drift.** Nav says "Sessions", breadcrumbs say "Conversations", agent detail uses "Operators", "Plugins" vs "Connections" in different contexts.
5. **No concept of "your agents."** No favorites, no recents, no quick-launch. The agent roster is a monitoring table, not an interaction surface.
6. **Agent builder is day-30 tooling at day-1 position.** The 8-step wizard (identity, soul, model, capabilities, skills, network policy, test chat, review) is powerful but overwhelming as an onboarding path. The simple form (name, handle, emoji) is closer but dumps you on a config-heavy detail page instead of into a conversation.

## Vision

**Interaction-first, not configuration-first.** The product should lead with conversations and progressively reveal configuration. The home page should adapt to your stage. Agents should be able to configure themselves through dialogue.

---

## Proposal 1: Adaptive Home Page (`/admin`)

The home page renders different content based on what exists in the system.

### State: Empty (0 agents)

**Goal:** Get to first conversation in under 2 minutes.

Show a focused onboarding flow:

```
Welcome to Nitejar.

Let's create your first agent.

  [Name]  ___________________
  [Soul]  What should this agent be good at?
          ___________________

  [ Create & Start Chatting ]

  or: Import an agent profile (.nitejar-agent.json)
```

Minimal fields: name + one-liner soul description. Handle auto-generated from name. Default model, no cost limits, no network policy. Clicking "Create & Start Chatting" creates the agent AND opens a session in one action.

Below the fold: "Want more control? Use the full agent builder" link to the wizard.

### State: Getting Started (1-3 agents, < 10 sessions)

**Goal:** Make it easy to resume conversations and iterate on agents.

```
YOUR AGENTS
  [avatar] Sloppington    3 sessions, last active 2h ago    [Chat] [Configure]
  [avatar] ResearchBot    1 session, idle                   [Chat] [Configure]

  + New Agent

RECENT SESSIONS
  "Debug the auth flow" with Sloppington — 2h ago           [Resume]
  "API design review" with ResearchBot — yesterday          [Resume]

  + New Session

GETTING STARTED                                    (dismissable)
  [ ] Connect a channel (Telegram, GitHub, webhook)
  [ ] Add skills to your agents
  [ ] Set cost limits
```

The "Getting Started" checklist tracks real state (are plugins connected? are skills attached? are cost limits set?) and disappears once complete or dismissed.

### State: Active Fleet (4+ agents OR agents with real plugin traffic)

**Goal:** Fleet monitoring with quick interaction access.

This is roughly the current Command Center, but with two additions:

1. **Quick-access bar at top** showing your most-used agents with [Chat] buttons
2. **Recent Sessions panel** in the right column (replacing or above "Quick Links")

The current summary cards, roster table, cost breakdown, active operations, and alerts all stay. They're good fleet tooling.

### Implementation Notes

- Single component with conditional rendering based on agent count + session count + plugin instance count
- "Getting Started" dismissal stored in user preferences or localStorage
- The quick-access bar queries for agents sorted by recent session activity

---

## Proposal 2: Elevate Sessions

### Nav Position

Move Sessions from position 9 to position 1 or 2:

```
Sessions          (was #9, now #1 or #2)
Agents
Command Center    (was #1, demoted for non-fleet users)
Activity
...
```

### "Chat" CTA Everywhere

Add a [Chat] or [Start Session] button to:

- **Agent cards** in the roster table (Command Center)
- **Agent list page** (`/admin/agents`) — each row gets a chat icon
- **Agent detail page** (`/admin/agents/[id]`) — prominent button in header next to status toggle
- **Home page** agent cards (see Proposal 1)

Clicking [Chat] on an agent either:
1. Resumes the most recent session with that agent (if one exists and is < 24h old)
2. Creates a new session and navigates to it

### Session List Improvements

- **Pin sessions** — mark important conversations to keep them at the top
- **Agent filter** — filter sessions by which agent(s) participated
- **Search** — search session titles and message content
- **Empty state** — instead of blank, show agent cards with "Start your first conversation" CTAs

---

## Proposal 3: Nav Restructure

### Grouped Navigation

Replace the flat 9-item nav with semantic groups:

```
INTERACT
  Sessions
  Agents

OBSERVE
  Command Center
  Activity
  Costs

CONFIGURE
  Plugins
  Skills
  Collections

EVALUATE
  Evals

SETTINGS (dropdown)
  Infrastructure: Gateway & Models, Runtime
  Features: Capabilities, Credentials
  Autonomy: Routines
  Organization: Teams, Members, Access

DEBUG (collapsed, advanced)
  Event Log (work-items)
  Traces (spans — future)
```

### Sidebar vs Top Nav

The current top nav bar works at 9 items but won't scale with grouping. Consider migrating to a left sidebar. Benefits:

- Visual group separators
- Collapsible sections
- Room for agent quick-access / favorites
- Detail pages get full-width without competing with top nav

Trade-off: sidebar reduces content width. Mitigate with collapsible sidebar (icon-only mode).

### Lexicon Enforcement

Pick Plain lexicon and do a single pass:

| Current (inconsistent) | Resolved |
|---|---|
| Sessions / Conversations | **Sessions** |
| Event Log / Work Items | **Event Log** (public) / `work_items` (internal only) |
| Plugins / Connections | **Plugins** (nav) / "connected plugins" (contextual) |
| Operators / Agents | **Agents** |

---

## Proposal 4: Self-Configuring Agent Builder (Vision)

_Inspired by OpenClaw's bootstrap ritual. This is a larger feature — captured here as a north star, not a v1 requirement._

### Concept

Instead of a form wizard, the agent configures itself through conversation. You talk to a "setup agent" that asks you questions and writes the config.

### Flow

1. User clicks "New Agent" and chooses "Let the agent set itself up" (vs "Configure manually")
2. A temporary session opens with a bootstrap agent
3. The bootstrap agent runs a conversational Q&A:
   - "What should I call this agent?" → sets name/handle
   - "What's its personality? Helpful and formal? Chaotic and creative?" → writes soul
   - "What should it be able to do?" → suggests skills, capabilities
   - "Should it have access to GitHub? Telegram?" → suggests plugin connections
   - "Any budget constraints?" → sets cost limits
4. At each step, the agent summarizes what it's configured so far
5. User says "looks good" → agent is created with full config, session converts to a real session with the new agent

### Contextual Tool Loading

During the bootstrap conversation, tools appear contextually:
- When discussing personality → soul editor tool becomes available
- When discussing capabilities → skill browser tool appears
- When discussing channels → plugin connector tool appears

This is the OpenClaw pattern of "selective injection based on current turn" applied to a setup flow.

### Editing Mode

The same pattern extends to reconfiguration. From any session, a user could say "change your personality to be more formal" or "add the web search capability" and the agent would modify its own config through conversational tools. This turns the agent detail page from the primary config surface into a "view/export" surface, with conversation as the primary config interface.

### Implementation Sketch

- Bootstrap agent is a special system agent with access to agent-config mutation tools
- Tools: `setAgentName`, `setAgentSoul`, `attachSkill`, `setModel`, `setCostLimit`, `connectPlugin`
- These tools are scoped to the agent being created/edited
- The bootstrap Q&A is driven by a structured prompt (like OpenClaw's BOOTSTRAP.md) that the agent walks through one question at a time
- On completion, the temporary agent is replaced by the real agent in the session

### Why This Matters

- **Lowers the barrier to entry dramatically.** No forms, no wizard steps, just a conversation.
- **Uses the product to sell the product.** The first thing you do is have a conversation — which is the core value prop.
- **Makes configuration discoverable.** Users learn what's possible by being asked about it, not by scanning a settings page.
- **Aligns with agent autonomy doctrine.** If agents can configure external services (OpenClaw's self-improving pattern), they should be able to configure themselves.

---

## Proposal 5: Quality of Life

### Favorites / Pinned Agents

- Star/pin agents from any agent card or list
- Pinned agents appear in a quick-access bar on the home page and optionally in the sidebar
- Stored per-user

### "Your Agents" vs "All Agents"

For multi-user orgs, distinguish between:
- **Your agents** — agents you created or frequently interact with
- **All agents** — the full roster (admin view)

Default the agents list to "Your agents" with an "All" toggle.

### Agent Quick Actions

Every agent card/row should expose:
- **Chat** — start/resume session
- **Configure** — go to detail page
- **Status toggle** — enable/disable inline

### Session Continuity

- **Auto-resume** — if you have exactly one active session, `/admin/sessions` could go straight to it instead of the list
- **Session preview on hover** — show last few messages in a tooltip/popover on the session list
- **"Continue where you left off"** banner on home page if you have an in-progress session

### Keyboard Shortcuts

- `Cmd+K` — quick switcher (jump to any agent, session, or settings page)
- `Cmd+N` — new session
- `Cmd+Shift+N` — new agent

---

## Implementation Priority

### Phase 1: Quick Wins (1-2 days)
- [ ] Reorder nav: Sessions to position 2 (after Agents or before)
- [ ] Add [Chat] button to agent detail page header
- [ ] Add [Chat] button to agent list rows
- [ ] Fix lexicon: "Conversations" → "Sessions" in breadcrumbs
- [ ] Fix lexicon: "Operators" → "Agents" in headings

### Phase 2: Adaptive Home (3-5 days)
- [ ] Implement empty-state onboarding flow (create agent + start session in one action)
- [ ] Implement "Getting Started" state with agent cards + recent sessions
- [ ] Keep current Command Center as the "Active Fleet" state
- [ ] Add recent sessions panel to Command Center right column

### Phase 3: Nav Restructure (2-3 days)
- [ ] Group nav items (Interact, Observe, Configure, Evaluate)
- [ ] Restructure settings dropdown with sub-groups
- [ ] Move Event Log out of settings
- [ ] Consider sidebar migration (design spike)

### Phase 4: Quality of Life (3-5 days)
- [ ] Agent favorites / pinning
- [ ] Session search and agent filter
- [ ] Session pinning
- [ ] Quick actions on agent cards
- [ ] Cmd+K quick switcher

### Phase 5: Self-Configuring Agent Builder (larger effort, separate PRD)
- [ ] Design bootstrap agent prompt
- [ ] Implement agent-config mutation tools
- [ ] Build contextual tool loading for setup flow
- [ ] Build "editing mode" for live agent reconfiguration
- [ ] Test and iterate on the conversational setup flow

---

## Open Questions

1. **Sidebar or top nav?** Sidebar scales better but is a bigger migration. Could start with grouped top nav and migrate later.
2. **Should the home page URL change?** Currently `/admin` redirects to `/admin/command-center`. With an adaptive home, `/admin` could render the home directly and Command Center becomes a sub-page.
3. **How does the self-configuring builder interact with the existing wizard?** Probably coexist: "Set up through conversation" vs "Configure manually" as two paths from "New Agent."
4. **Session auto-resume threshold.** How old can a session be before we create a new one instead of resuming? 24h? Configurable?
5. **Favorites storage.** User preferences table? localStorage? Both with sync?
