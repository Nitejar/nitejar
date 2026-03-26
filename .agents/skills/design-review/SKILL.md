---
name: design-review
description: Run an autonomous design review and refinement loop on app UI surfaces. Use when the user wants iterative grading and implementation passes against a UI/design rubric across one or more product screens.
metadata:
  short-description: Run iterative UI review
---

# Design Review & Refinement Loop

Run a structured design review and refinement loop on the app's UI surfaces. This is an **autonomous loop** — do NOT pause to ask the user between steps. Grade → strategize → implement → grade → strategize → implement until the stopping criteria are met.

## How it works

1. **Blind Grader** (agent) — reads the code fresh, scores against the rubric, identifies top fixes
2. **You** (strategist) — interpret the grades, prioritize, write specific implementation instructions
3. **Implementer** (agent) — makes targeted code changes, typechecks
4. **Repeat from step 1** — launch a new blind grader immediately after the implementer finishes. Do not ask the user whether to continue. The loop is autonomous.

The grader and implementer never share context. You are the brain in the middle.

**Round numbering:** Check `memory/design-review-history.md` for the last round number and continue from there. Update the history file after each complete cycle.

## The Rubric: 15 Design Principles (1-5 each)

### Composition (how it looks)

1. **One dominant object/question** — Can you tell in 3 seconds what this screen is about and what question it answers?
2. **Spatial hierarchy** — Are parent-child relationships obvious from layout (indentation, nesting, containment), not just labels?
3. **Controls invisible until needed** — Are filters, sorts, and configuration secondary to the actual content?
4. **Negative space** — Does the page breathe, or is it stuffed?
5. **No competing main things** — Is there one clear focal point, not multiple co-equal panes or sections?
6. **Right form factor** — Are rows, cards, trees, and tables used appropriately for the data relationships? (Cards for browseable peers, trees for hierarchy, tables for comparison, lists for scanning.)

### Interaction (how it flows)

7. **Direct manipulation** — Can you act on objects inline (status, assignee, priority) without opening panels or forms? Does clicking feel like touching, not navigating?
8. **Progressive power** — Does the UI reward skilled repeated use? Keyboard shortcuts, bulk operations, contextual hover actions — fast paths that emerge with familiarity?
9. **Zero-prerequisite value** — Can a new user do something useful immediately without building infrastructure first? If the product requires setting up org structure, teams, or config before the first meaningful action, that's a tax. The happy path should work with zero setup.
10. **Inline everything** — Can you create, edit, and act where you are? "Click the bottom of the list and start typing" beats "open a dialog with 6 fields." Every modal or form that interrupts flow is friction. Inline creation, inline editing, inline status changes.
11. **Error & edge-case resilience** — Do mutations show errors to the user when they fail, or silently swallow them? Are loading/disabled states visible during async operations? Can you dismiss/close pickers and dropdowns by clicking outside? Do destructive actions explain consequences before executing? Empty states, no-data states, and partial-failure states should all be handled visibly — never silently.
12. **Skeleton loading states** — Do lists, detail panels, and data-driven sections show skeleton/shimmer placeholders while loading, or do they flash blank/empty before content arrives? Skeletons should match the shape of the eventual content (rows for lists, property grids for detail panels). A bare "Loading..." string or a spinner over empty space is not sufficient — the user should see the structure of what's coming before the data lands.

### Delight (how it feels)

13. **Micro-feedback** — Do state changes have visible transitions? Does the UI respond with motion (fade, slide, scale, spring), not just instant replacement? Status changes, panel open/close, item creation/deletion, selection — these should all have perceptible but fast animation. Snap-in is not delight; physics is.
14. **Personality in dead ends** — Do empty states, zero-data states, and completion states have voice? "No goals match this view" is functional. A message with character, a suggestion, or a visual that reflects the product's personality is delightful. The nightjar bird, a witty line, a contextual nudge — dead ends should feel designed, not default.
15. **Reward & momentum** — Does finishing feel different from starting? When a goal hits 100%, when the attention feed is cleared, when all tickets are done — is there a visual payoff? Progress should feel like progress. Completion should feel like completion. The UI should celebrate milestones, not just record them.

### Cross-Surface Coherence (5 dimensions, 1-5 each)

A. **Shared interaction vocabulary** — Same patterns for same actions across all surfaces
B. **Clear responsibility boundaries** — Each surface has a distinct non-overlapping job
C. **Consistent density & rhythm** — Same toolbar shape, row heights, spacing, typography
D. **Navigation clarity** — Always know where you are and how to get back
E. **Cross-surface flow** — Natural movement between surfaces when following a thread

## Running the loop

### To grade (launch a blind grader agent):

Tell the agent:
- Read all target files thoroughly
- Score each surface on all 15 principles (Composition 1-6, Interaction 7-12, Delight 13-15)
- Score cross-surface coherence on all 5 dimensions
- Output score tables + top 3 most impactful remaining fixes
- Be brutally honest — rate what's actually in the code

The grader should NEVER be told what changed. It reviews the current state blind.

### To implement (launch an implementer agent):

Based on the grader's feedback, write specific instructions:
- Which files to modify
- Exactly what to change (be surgical — 2-3 changes per round)
- What NOT to change
- Run typecheck after changes

### Score targets:
- **Individual surface average ≥ 4.0** — the surface is well-edited
- **Cross-surface coherence ≥ 4.0** — the app feels like one product
- **No individual score below 3** — no principle is neglected

### When to stop:
- Scores plateau across 2-3 rounds (same grader variance, no real signal)
- All surfaces average ≥ 4.0 and coherence ≥ 4.0
- Or: you've addressed the top structural issues and remaining fixes are taste/polish

## Anti-patterns to watch for

- **Self-grading** — never let the implementer grade its own work. Scores inflate to 5/5 immediately.
- **Cosmetic-only passes** — if scores stagnate, the problem is structural, not visual. Step back.
- **Per-surface tunnel vision** — optimizing one page in isolation makes cross-surface coherence worse.
- **Over-engineering** — adding keyboard hints, micro-summaries, status badges. If the grader calls it noise, strip it.
- **Prerequisite tax** — if the product requires setup before value, that's a design failure, not a feature gap.
- **Partial borders with border-radius** — never apply `border-b`, `border-t`, or any single-side border to an element that has `rounded-*`. A radius implies a complete shape; a partial border breaks it. Use a full `border` or remove the radius.

## The surfaces

### Top-level (Operate area list views)

- **Command Center** (`AdminHome.tsx`) — "What needs attention now?"
- **Company** (`company/CompanyClient.tsx`) — "How is the company organized and where is it weak?"
- **Goals** (`goals/GoalsClient.tsx`) — "What are we trying to achieve and how far along are we?"
- **Tickets** (`tickets/TicketsClient.tsx`) — "What is moving, blocked, or waiting?"
- **Agents** (`agents/page.tsx` + `agents/AgentsTable.tsx`) — "Who is carrying load?"

### Detail pages (drill-in from list views)

- **Goal detail** (`goals/[id]/GoalDetailClient.tsx`) — "What is this goal's full context, progress, and linked work?"
- **Ticket detail** (`tickets/[id]/TicketDetailClient.tsx`) — "What is this ticket's full context, history, and execution state?"
- **Team detail** (`company/teams/[id]/TeamDetailClient.tsx`) — "Who is on this team, what do they own, and how are they performing?"
- **Session detail** (`sessions/[sessionKey]/SessionDetailClient.tsx`) — "What happened in this conversation?"

Grade detail pages with the same 12-principle rubric. For cross-surface coherence, additionally check:
- **Parent ↔ detail consistency** — Does the detail page feel like a natural drill-in from its parent list? Same interaction vocabulary, same density?
- **Back-navigation** — Can you always get back to the parent list? Breadcrumbs?
- **Inline editing parity** — Can you do the same inline edits (status, assignee) on the detail page as on the list row?

Do NOT grade agent profile pages (`agents/[id]`).

## Usage

```
/design-review                    # Run one grade → implement → grade cycle
/design-review grade              # Just run the blind grader
/design-review loop 5             # Run N full cycles
/design-review surface Work       # Focus on a single surface
```
