# WS8: Operator Work Surface

## Summary

Nitejar now has the right primitives for work: goals, tickets, agents, sessions, receipts, costs, and heartbeats.
What it does not yet have is the right **operator surface**.

The current product still reads like a dev playground:

- it exposes raw state instead of helping the user make the next decision
- it mixes "start a chat", "inspect the system", and "manage work" on the same surfaces
- it works for a handful of tickets, but not for 20 goals, 100 tickets, or 50 agents

The product needs to shift from **showing everything** to **helping the operator accomplish one concrete job at a time**.

This spec defines:

1. the real operator jobs the app should optimize for
2. the information architecture for managing work at scale
3. the views needed for many goals, tickets, and agents
4. the implementation plan, including workstreams that can be built in parallel

This extends [WS6 Command Center](./WS6_COMMAND_CENTER.md). WS6 defined the fleet status board. WS8 defines the broader operator experience that turns the product into a work operating system rather than a debugging console.

Execution checklist: [WS8_OPERATOR_WORK_SURFACE_EXECUTION.md](./WS8_OPERATOR_WORK_SURFACE_EXECUTION.md)

## Problem Statement

Today, the product is strong on receipts and weak on focus.

That creates four UX failures:

1. **The landing page is not mode-specific.**
   It behaves like a mix of launcher, dashboard, and event feed. An operator opening the app should immediately understand what needs attention, what is progressing, and what is stuck.
2. **Work management does not scale visually.**
   Cards are fine for a few goals and tickets. They break down when the user has dozens of active items.
3. **Agents are visible, but capacity is not.**
   A roster of agents is not enough. The operator needs to know who is overloaded, idle, blocked, expensive, or unassigned.
4. **Sessions still feel primary.**
   Sessions are execution surfaces. They should be reachable from work, not act like the main organizing primitive.

If Nitejar is meant to feel like a product rather than a developer harness, every major screen should answer a clear operator question.

## Operator Jobs

These are the jobs the product should optimize for. They are the right place to document what end users are trying to accomplish.

### 1. Start a Fleet

The user wants to go from zero to a working organization:

- create the first few agents
- assign them roles
- define the first goal
- break it into tickets
- see work start moving

Primary question: **"Can I get useful work moving quickly?"**

### 2. Decide What Matters Today

The user opens the product and wants a short answer:

- what is blocked
- what needs approval
- what is stale
- what is at risk
- what is unexpectedly expensive

Primary question: **"What needs my attention right now?"**

### 3. Move Work Forward

The user is not trying to inspect raw logs. They are trying to drive outcomes:

- create a goal
- create or refine tickets
- assign or reassign owners
- start or resume execution
- check whether work is actually advancing

Primary question: **"What is the next move to get this outcome over the line?"**

### 4. Manage Capacity

Once there are many agents, the user needs to understand:

- who is overloaded
- who is underused
- which teams have queue buildup
- which goals have no clear owner

Primary question: **"Do I have the right work on the right people or agents?"**

### 5. Review Progress and Trust

The user wants to know whether the system is working:

- which goals are advancing
- which tickets are moving
- which agents are reliable
- what the cost and activity receipts say

Primary question: **"Is this actually working, and can I trust it?"**

### 6. Diagnose Exceptions

This is where receipts matter:

- inspect the session
- inspect the activity
- inspect the trace
- inspect spend

Primary question: **"What happened, exactly?"**

This is important, but it is not the primary mode for most visits. It should be one click away, not the default mental model of the whole app.

## Product Principles

### Intent First, Receipts Second

Operators think in outcomes, ownership, and risk. Receipts are how they verify those things, not how they should have to navigate by default.

### One Primary Decision Per Screen

Each top-level screen should optimize for one operator decision:

- `Command Center`: what needs attention now
- `Work`: what is planned and in flight
- `Agents`: who is doing what and how they are performing
- `Activity`: what happened
- `Costs`: what it cost

### Cards for Triage, Tables for Scale

Cards are good when the user is scanning a handful of urgent items. Tables are good when the user is managing volume. The product should use both, but in the right places.

### Sessions Are Attached to Work

Sessions should launch from a ticket, goal, agent, or routine. They are not the main product noun.

### Saved Views Beat Raw Lists

At scale, users do not want "all tickets." They want:

- `Mine`
- `My Team`
- `Blocked`
- `Stale`
- `Unclaimed`
- `At Risk`
- `Needs Review`

The product should make those views first-class.

### Health Must Be Legible

For goals, tickets, and agents, the operator should be able to tell in seconds:

- progressing
- stalled
- blocked
- overloaded
- idle

## Proposed Information Architecture

### Top-Level Navigation

- `Command Center`
- `Work`
- `Agents`
- `Activity`
- `Costs`
- `Plugins`
- `Skills`
- `Collections`
- `Evals`
- `Settings`

This is mostly already correct. The change is not the nav labels. The change is what each surface optimizes for.

### Command Center

Command Center should become a true **today view**, not a mixed dashboard/launcher.

It should answer:

1. what needs attention now
2. what changed since the last check
3. which goals are drifting
4. who is overloaded
5. whether spend or approvals need intervention

Recommended sections:

- `Needs Attention`
- `Today`
- `At-Risk Goals`
- `Blocked or Stale Tickets`
- `Overloaded Agents or Teams`
- `Recent Heartbeats`
- `Cost Warnings`

Keep prominent:

- session launch/search should remain obvious in the header, command palette, and quick actions
- setup nudges can stay for onboarding, but they should not dominate the steady-state experience
- the change is not "hide chat"; the change is "do not let chat be the only organizing surface"

### Work

`Work` should be the planning and execution surface. It should have three modes:

- `Overview`
- `Goals`
- `Tickets`

`Overview` is for triage.
`Goals` is for portfolio management.
`Tickets` is for queue management.

`Untracked Work` can remain inside Work, but it should be secondary and framed as cleanup or promotion work.

### Agents

`Agents` should become a management surface, not just a directory plus config entry point.

It should answer:

- which agents are busy
- which are overloaded
- which are idle
- which are expensive
- which goals and tickets they own
- what skills and tools they have

The existing builder/config experience remains important, but the list page needs to feel like a live roster.

### Activity and Costs

These remain secondary verification surfaces:

- `Activity` answers what happened
- `Costs` answers what it cost

They should stay rich and inspectable, but not do the job of Work or Command Center.

## Scaled UI Model

This is what the product should look like when the user has real volume.

### If There Are 100 Tickets

The default ticket management experience should be a dense table, not a card list.

Recommended default columns:

- title
- status
- priority or health
- goal
- assignee
- team
- latest update
- last movement age
- linked session or receipt count
- spend

Required interactions:

- saved views
- status filters
- owner filters
- team filters
- goal filters
- stale age filters
- sort by latest movement, status, spend, created date
- group by goal, assignee, or status
- bulk actions for assign, status change, archive

Recommended default saved views:

- `Mine`
- `My Team`
- `Blocked`
- `Stale`
- `Unclaimed`
- `Recently Updated`
- `Done This Week`

### If There Are 20 Goals

The default goals experience should be a portfolio table with optional board/grouped view.

Recommended default columns:

- title
- health
- owner
- progress
- active tickets
- blocked tickets
- stale age
- last heartbeat
- spend

Recommended progress model for v1:

- `done tickets / total tickets`
- plus a separate `health` field derived from status and heartbeat recency

Do not pretend precision where none exists. A rough progress bar plus clear health signal is better than fake exactness.

Recommended groupings:

- by owner
- by team
- by health
- by status

### If There Are 50 Agents

The agent list should become a roster table with workload and reliability signals.

Recommended default columns:

- name
- team
- role
- status
- open tickets
- active goals contributed to
- last active
- recent success or failure signal
- cost in period
- capability summary

Recommended filters:

- team
- status
- has open work
- overloaded
- idle
- expensive

Recommended quick slices:

- `Busy now`
- `Overloaded`
- `Idle`
- `Needs attention`
- `Top spenders`

## Locked Defaults

These are the default slices and health rules the product should now treat as stable.

### Default Saved Views

Goals:

- `Active`
- `Attention`
- `Done`
- `Stale`
- `All`

Tickets:

- `Mine`
- `My Team`
- `Blocked`
- `Stale`
- `Unclaimed`
- `All`

Agents:

- `All`
- `Busy`
- `Overloaded`
- `Idle`
- `High Spend`

### Health Definitions

Goals:

- explicit status wins for `draft`, `at_risk`, `blocked`, `done`, and `archived`
- otherwise, a goal becomes `blocked` if it has at least one blocked open ticket
- otherwise, a goal becomes `at_risk` if it is stale or has open work with no ready or in-progress ticket movement
- otherwise, a goal is `active`
- a goal is stale if its latest heartbeat is older than 7 days, or if it has no heartbeat and its latest work activity is older than 72 hours

Tickets:

- `inbox`, `ready`, `in_progress`, `blocked`, `done`, and `canceled` remain the source-of-truth status values
- an open ticket is stale when it has not moved for 48 hours
- a ticket is unclaimed when it has no assignee or is only assigned to a team queue

Agents:

- `busy` means the agent has active dispatch work right now
- `idle` means the agent is available and not currently running
- `offline` means the operator explicitly disabled it
- `overloaded` means any of:
  - 6 or more open tickets
  - 2 or more blocked tickets
  - 4 or more open owned goals

## Screen-by-Screen Changes

### Command Center

Current issue:

- too much emphasis on starting chats and browsing recent sessions as the main organizing frame
- not enough emphasis on work health and intervention

Refinement:

- keep "New Agent" and session launch/search prominent in header actions and quick actions
- make `Needs Attention` the primary hero block
- show the top 5 items only, each with a clear reason and action
- add `Recent Heartbeats` so goals and teams feel supervised rather than invisible
- show `Workload Hotspots` instead of only fleet activity

### Work Overview

Current issue:

- useful but still list-heavy
- good for early dogfooding, not strong enough for high-volume triage

Refinement:

- keep summary cards
- replace some card grids with ranked queues
- make `recent updates` collapsible after the top few items
- add a `Needs Review` section for approvals or ambiguous ownership later

### Goals View

Current issue:

- card list is readable at low volume only

Refinement:

- default to a table
- allow grouped board view as secondary
- expose portfolio metrics directly
- support saved views like `At Risk`, `No Owner`, `Stale`, `High Spend`

### Tickets View

Current issue:

- card list becomes unwieldy beyond low double digits

Refinement:

- default to a table with compact rows
- add saved views and filters
- add bulk actions
- add keyboard-friendly triage flow

### Goal Detail

Current issue:

- good receipts, but the operator still has to infer health manually

Refinement:

- show a compact goal health summary at top
- highlight `next move`
- show child tickets in a denser table
- show latest heartbeat prominently
- show ownership gaps clearly

### Ticket Detail

Current issue:

- the detail page is strong for a single item, but it needs stronger action framing

Refinement:

- make the primary action obvious: claim, resume, reassign, unblock, complete
- emphasize current session, last update, and blockers
- keep receipts and linked session visible but secondary

### Agents Page

Current issue:

- still feels like config plus a showcase roster

Refinement:

- make it a real operator roster
- include workload and cost posture
- make "configure" secondary to understanding who is overloaded or idle

## Multi-Agent Work Model

If Nitejar is going to manage meaningful work, the UI has to support multi-agent planning cleanly.

Recommended operating model:

1. human defines a goal
2. goal is decomposed into tickets
3. tickets are assigned to a team or specific agent
4. agents claim and execute work through linked sessions
5. heartbeats summarize progress and risk
6. operator intervenes only where needed

The UI should make that structure obvious.

### Roles

Recommended role pattern for dogfooding and real use:

- `Coordinator` or `CEO`: watches portfolio health, decomposes work, nudges owners
- `Team Leads`: own queues for a domain
- `Implementers`: execute tickets
- `Reviewers` or `QA`: validate outputs

This does not require a new top-level noun. It only requires clear ownership and team filters.

### How Progress Should Be Tracked

Progress should be visible at three levels:

#### Goal Progress

Derived from:

- ticket completion ratio
- active vs blocked ticket counts
- latest heartbeat age
- last meaningful movement

Displayed as:

- progress bar
- health badge
- last heartbeat summary

#### Ticket Progress

Derived from:

- status
- latest update
- linked session activity
- last movement age

Displayed as:

- status badge
- age
- current owner
- current session or most recent receipt

#### Agent Progress

Derived from:

- open ticket count
- active runs
- tickets completed in period
- heartbeat or recent update coverage

Displayed as:

- workload count
- recent completions
- cost and failure signals

## Data and API Additions Needed

The current work model is close, but not enough for the scaled operator surface.

### 1. Saved Views

Add persistence for saved work views.

Recommended table:

- `work_views`

Suggested fields:

- `id`
- `name`
- `scope` (`user` or `org`)
- `owner_user_id`
- `entity_kind` (`goal` or `ticket` or `agent`)
- `filters_json`
- `sort_json`
- `group_by`
- `created_at`
- `updated_at`

### 2. Portfolio Metrics

Add aggregated queries for:

- goal progress rollups
- blocked ticket counts
- stale ticket counts
- heartbeat freshness
- ticket last movement

### 3. Workload Metrics

Add server-side rollups for:

- open tickets by agent
- open tickets by team
- active runs by agent
- stalled owned work

### 4. Goal Health and Ticket Health

Add normalized health helpers so the UI does not have to reinvent this logic everywhere.

### 5. Review and Approval Queue

Not required to ship the first refinement, but the operator surface should be designed with a future `Needs Review` queue in mind.

## Parallelizable Implementation Plan

This is the part that should guide actual building work.

### Workstream A: Operator Model and Information Architecture

Owner profile:

- product or coordinator agent

Deliverables:

- finalize operator jobs
- finalize screen purposes
- define default saved views
- define health rules

Acceptance criteria:

- each top-level screen has a one-sentence purpose
- each list surface has defined default views
- health definitions are written down and reused

Dependencies:

- none

### Workstream B: Shared Data Contracts

Owner profile:

- backend engineer agent

Deliverables:

- saved view schema
- portfolio metrics queries
- workload rollups
- server-side sorting and filtering contracts

Acceptance criteria:

- goals, tickets, and agents can all be queried with stable filter payloads
- large list views do not rely on client-only filtering

Dependencies:

- Workstream A

### Workstream C: Ticket Queue at Scale

Owner profile:

- frontend engineer agent

Deliverables:

- table-based ticket view
- saved views
- filters and grouping
- bulk actions

Acceptance criteria:

- 100 tickets remain manageable
- `Mine`, `My Team`, `Blocked`, `Stale`, and `Unclaimed` are first-class

Dependencies:

- Workstream B

### Workstream D: Goal Portfolio

Owner profile:

- frontend plus backend pair

Deliverables:

- table-based goals page
- progress and health rollups
- grouped views
- last heartbeat and risk indicators

Acceptance criteria:

- 20 goals can be scanned without opening each detail page
- at-risk and stale goals stand out immediately

Dependencies:

- Workstream B

### Workstream E: Agent Roster and Capacity

Owner profile:

- frontend plus backend pair

Deliverables:

- roster table
- workload indicators
- idle/overloaded filters
- cost and recent performance indicators

Acceptance criteria:

- 50 agents can be filtered, scanned, and compared
- overloaded and idle agents are obvious

Dependencies:

- Workstream B

### Workstream F: Command Center Refinement

Owner profile:

- product-minded frontend agent

Deliverables:

- today view redesign
- needs-attention stack
- recent heartbeat summary
- workload hotspots

Acceptance criteria:

- opening the app answers "what needs my attention right now?"
- session launch is still prominent and fast, but it no longer crowds out the attention stack

Dependencies:

- Workstreams A, D, and E

### Workstream G: Dogfooding and Verification

Owner profile:

- QA or operator agent

Deliverables:

- realistic local dataset scenarios
- smoke scripts for 20 goals / 100 tickets / 50 agents
- verification checklist for each surface

Acceptance criteria:

- the product is tested against scale scenarios, not just toy datasets
- heartbeat, progress, and saved views are all verified from the UI

Dependencies:

- runs continuously alongside the others

## Recommended Build Order

### Phase 1

- Workstream A
- Workstream B

This gives the product a stable operating model and data contract.

### Phase 2

- Workstream C
- Workstream D
- Workstream E

These can largely proceed in parallel once the shared data contracts exist.

### Phase 3

- Workstream F

Command Center should be rebuilt after goals, tickets, and agents have the right rollups and views to summarize.

### Phase 4

- Workstream G
- iterative polish on detail pages

## Suggested Goal and Ticket Breakdown in Nitejar

If we want to dogfood the work layer itself, this initiative should become a real goal inside Nitejar:

### Goal

`Make Nitejar feel like an operator product, not a playground`

### Suggested Tickets

- `Document operator jobs and product IA`
- `Add saved views and shared filter contracts`
- `Replace ticket cards with a scalable queue table`
- `Build goal portfolio view with health and progress`
- `Turn agents into a workload roster`
- `Refocus Command Center around attention and intervention`
- `Create scale-test fixtures and verification checklist`

These are good parallel tickets because they have clear ownership and relatively clean boundaries.

## What Success Looks Like

The operator should be able to answer these questions in under a minute:

- What matters today?
- Which goals are in trouble?
- Which tickets are blocked or stale?
- Which agents are overloaded or idle?
- What changed since I last checked?
- Where do I click to intervene?

The receipts are still there, but they are no longer the only way to understand the product.

## Progress Checklist

- [ ] Define and ship saved views for goals, tickets, and agents
- [ ] Convert ticket management to a scalable table-first UI
- [ ] Convert goals into a portfolio-first UI
- [ ] Convert agents into a workload-first roster
- [ ] Refocus Command Center on attention and intervention
- [ ] Add scale-test fixtures for 20 goals / 100 tickets / 50 agents
- [ ] Verify the full flow locally with real linked sessions and heartbeats
