# WS8 Operator Work Surface: Execution Checklist

This is the compaction-safe execution plan for the operator-surface work.

Related spec: [WS8_OPERATOR_WORK_SURFACE.md](./WS8_OPERATOR_WORK_SURFACE.md)

## Objective

Make Nitejar feel like an operator product instead of a developer playground by:

- focusing the app around operator jobs
- making goals, tickets, and agents manageable at real scale
- keeping sessions and receipts contextual and prominent without letting them be the only organizing surface

## Current Phase

- [x] Product framing and operator-jobs spec written
- [x] Phase 1: shared data contracts and saved views
- [x] Phase 2: ticket queue at scale
- [x] Phase 3: goal portfolio
- [x] Phase 4: agent roster and capacity
- [x] Phase 5: command center refinement
- [x] Phase 6: scale validation and polish

## Agent Assignments

These assignments are by role. If a dedicated agent does not exist yet, the Founding Engineer can temporarily absorb the work.

### CEO / Product Lead

Owns:

- operator jobs and acceptance criteria
- default saved views
- health definitions
- command-center priorities
- weekly review of whether the UI is answering the right questions

### Founding Engineer / Backend Lead

Owns:

- `work_views` schema and persistence
- shared filter/sort/group contracts
- goal/ticket/server rollups
- tRPC procedures and tests
- migration safety

### Frontend Engineer / Work Surface Lead

Owns:

- ticket queue table
- goal portfolio table
- saved-view controls
- density, grouping, and bulk actions
- command-center UI refinement

### QA / Operator Verification

Owns:

- realistic scale fixtures
- browser validation
- regression checklist
- receipts verification for goals, tickets, heartbeats, and costs

## Parallel Workstreams

## Workstream A: Operator Model

Owner: CEO / Product Lead

- [x] Write operator jobs and product principles
- [x] Define what each top-level screen is for
- [x] Define scale targets: 20 goals / 100 tickets / 50 agents
- [x] Lock default saved views for goals, tickets, and agents
- [x] Lock health definitions for goals, tickets, and agents

Deliverable:

- stable product contract for the UI and data layers

## Workstream B: Shared Data Contracts

Owner: Founding Engineer / Backend Lead

- [x] Add `work_views` table
- [x] Add repository functions for list/create/update/delete views
- [x] Add shared ticket filter contract
- [x] Add shared goal filter contract
- [x] Add sort/group contracts
- [x] Add workload rollup helpers
- [x] Add tests for repository and router behavior

Deliverable:

- the UI can ask for stable, saved, server-side work views instead of hardcoded tabs

## Workstream C: Ticket Queue at Scale

Owner: Frontend Engineer / Work Surface Lead

- [x] Replace ticket-card list with compact table view
- [x] Add built-in saved views: Mine / My Team / Blocked / Stale / Unclaimed / All
- [x] Add persisted custom views
- [x] Add filter controls
- [x] Add sorting controls
- [x] Add bulk actions for status and assignment

Deliverable:

- 100 tickets remain manageable

## Workstream D: Goal Portfolio

Owner: Frontend Engineer / Work Surface Lead

- [x] Replace goal-card list with portfolio table
- [x] Add progress rollup
- [x] Add health, last-heartbeat, and stale signals
- [x] Add groupings by owner, team, and health
- [x] Add built-in saved views: Active / At Risk / Stale / Done / All

Deliverable:

- 20 goals are readable without opening each one

## Workstream E: Agent Roster and Capacity

Owner: Frontend Engineer with Backend support

- [x] Add workload metrics to agent list
- [x] Add idle / busy / overloaded filters
- [x] Add cost and recent-performance signals
- [x] Add team grouping
- [x] Add built-in saved views: Busy / Overloaded / Idle / High Spend

Deliverable:

- 50 agents can be managed as a roster, not browsed as a gallery

## Workstream F: Command Center Refinement

Owner: CEO + Frontend Engineer

- [x] Keep chat/session launching prominent in header and quick actions without letting it crowd out the attention stack
- [x] Promote needs-attention stack to top
- [x] Add recent heartbeats block
- [x] Add workload hotspots
- [x] Add direct intervention links from each urgent item

Deliverable:

- opening the app answers "what needs my attention right now?"

## Workstream G: Scale Verification

Owner: QA / Operator Verification

- [x] Create or script a realistic local dataset
- [x] Validate 20 goals / 100 tickets / 50 agents
- [x] Validate goal and team heartbeats
- [x] Validate costs and activity links from portfolio views
- [x] Validate no-Sprites and SQLite-only local setup

Deliverable:

- product is proven against real operator volume, not only toy data

## Immediate Next Steps

This is the exact next slice to execute now.

### Phase 1A

- [x] Add `work_views` persistence
- [x] Add shared ticket and goal filter contracts
- [x] Add router procedures for saved views
- [x] Add repository and router tests

### Phase 1B

- [x] Surface built-in and custom saved views in `Work`
- [x] Add denser ticket table
- [x] Keep existing receipts/detail pages intact
- [x] Verify locally in browser

## Suggested In-Product Goal

Create this goal in Nitejar itself:

- [x] `Make Nitejar feel like an operator product, not a playground`

Suggested tickets:

- [x] `Document operator jobs and acceptance criteria`
- [x] `Add saved views and shared work contracts`
- [x] `Build scalable ticket queue`
- [x] `Build scalable goal portfolio`
- [x] `Turn agents into a workload roster`
- [x] `Refocus Command Center around attention and intervention`
- [x] `Create scale-test fixtures and QA checklist`

## Definition of Done

- [x] Command Center answers what needs attention now
- [x] Work handles 20 goals and 100 tickets cleanly
- [x] Agents page handles 50 agents cleanly
- [x] Sessions are contextual and easy to launch, not the only primary organizing surface
- [x] Saved views exist and persist
- [x] Heartbeats and receipts are reachable from every work surface
- [x] Browser verification completed against realistic local data

## Verification Notes

- [x] Local scale fixture script added at `scripts/seed-work-scale.ts`
- [x] Seeded local SQLite with 5 teams, 50 agents, 20 goals, and 100 tickets
- [x] Verified `Command Center` on refreshed dev server at `http://localhost:3101`
- [x] Verified `Work > Goals` grouping and stale/heartbeat signals in browser
- [x] Verified `Work > Tickets` bulk status mutation in browser
- [x] Verified `Agents` route now resolves to `/agents` instead of the legacy `/fleet` redirect
- [x] Verified a receipt-bearing ticket detail page still exposes linked sessions and work updates
