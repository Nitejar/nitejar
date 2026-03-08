# WS9 Company Map and Staffing: Execution Checklist

This is the compaction-safe execution plan for making the company legible at a glance.

Related spec: [WS9_COMPANY_MAP_AND_STAFFING.md](./WS9_COMPANY_MAP_AND_STAFFING.md)

## Objective

Make Nitejar answer the portfolio-and-staffing question for humans by adding:

- a company-level overview
- a portfolio view for active goals
- an operational teams view
- a staffing matrix that shows goal coverage

## Current Phase

- [x] Product framing and operator-jobs spec written
- [x] Phase 1: company rollups and overview
- [x] Phase 2: portfolio and team views
- [x] Phase 3: staffing matrix
- [x] Phase 4: change feed and polish

## Agent Assignments

These assignments are by role. If a dedicated agent does not exist yet, the Founding Engineer can temporarily absorb the work.

### CEO / Product Lead

Owns:

- company-level operator questions
- portfolio health rules
- coverage-status definitions
- navigation and IA decisions
- acceptance criteria for human readability

### Founding Engineer / Backend Lead

Owns:

- company rollup repository functions
- tRPC procedures
- staffing and coverage calculations
- tests and data contracts

### Frontend Engineer / Company Surface Lead

Owns:

- new `Company` top-level surface
- overview cards and tables
- team operational view
- staffing matrix UX
- quick staffing actions

### QA / Operator Verification

Owns:

- scale fixtures
- browser verification
- portfolio/staffing regression checklist
- receipt and drill-in validation

## Parallel Workstreams

## Workstream A: Operator Model

Owner: CEO / Product Lead

- [x] Define the company-level operator questions
- [x] Define the difference between `Command Center`, `Company`, `Work`, and `Agents`
- [x] Define coverage statuses
- [x] Define team and staffing signals
- [x] Define scale expectations

Deliverable:

- stable product contract for company visibility

## Workstream B: Company Rollups

Owner: Founding Engineer / Backend Lead

- [x] Add company overview rollup helpers
- [x] Add goal coverage rollup helpers
- [x] Add team portfolio rollup helpers
- [x] Add agent allocation rollup helpers
- [x] Add tests for rollup correctness

Deliverable:

- one sober server contract for company state

## Workstream C: Company Overview

Owner: Frontend Engineer / Company Surface Lead

- [x] Add `Company` route and nav entry
- [x] Build company snapshot cards
- [x] Build goals-in-progress table
- [x] Build coverage-gaps panel
- [x] Build recent portfolio changes section

Deliverable:

- a human-readable answer to "what is the company doing?"

## Workstream D: Portfolio and Teams

Owner: Frontend Engineer / Company Surface Lead

- [x] Build portfolio table with staffing columns
- [x] Build operational team view
- [x] Add built-in company saved views
- [x] Add filters for team, health, and coverage status
- [x] Add drill-ins into Work and Agents

Deliverable:

- active goals and execution units are readable in one place

## Workstream E: Staffing Matrix

Owner: Frontend Engineer with Backend support

- [x] Build goal-to-agent staffing matrix
- [x] Add team grouping toggle
- [x] Add staffing gap badges
- [x] Add quick staffing actions
- [x] Add overloaded and idle cues

Deliverable:

- staffing is legible instead of inferred

## Workstream F: Verification

Owner: QA / Operator Verification

- [x] Validate on realistic local scale data
- [x] Validate team and goal drill-ins
- [x] Validate coverage statuses
- [x] Validate staffing actions update portfolio state immediately
- [x] Validate routing remains clear between Company, Work, and Agents

Deliverable:

- the company layer works against real scale, not demo-size data

## Immediate Next Slice

This is the exact next implementation slice to execute first.

### Phase 1A

- [x] Add repository rollups for company overview and goal coverage
- [x] Add `company` tRPC router with `getOverview`
- [x] Add unit tests for coverage and staffing calculations

### Phase 1B

- [x] Add top-level `Company` nav item
- [x] Add `/company` overview page
- [x] Ship company snapshot cards and a goals-in-progress table
- [x] Verify locally in browser against realistic seeded data

## Suggested In-Product Goal

Create this next goal in Nitejar itself:

- [ ] `Make the company legible at a glance`

Suggested tickets:

- [ ] `Define company-level operator questions`
- [ ] `Add company summary and goal coverage rollups`
- [ ] `Build company overview surface`
- [ ] `Build portfolio and team views`
- [ ] `Build staffing matrix`
- [ ] `Validate the company layer at scale`

## Definition of Done

- [x] a human can tell what the company is doing from one screen
- [x] active goals are visible with staffing and health in one pass
- [x] team load is visible without opening Settings
- [x] goal coverage gaps are obvious
- [x] a human can jump from company summary to the right execution surface in one click
- [x] the product still keeps session launch prominent without making sessions the only organizing surface

## Verification Notes

- [x] Seeded local SQLite with 5 teams, 50 agents, 20 goals, and 133 tickets via `scripts/seed-work-scale.ts`
- [x] Verified `Company > Overview` on `http://localhost:3100/company`
- [x] Verified `Company > Portfolio` search and coverage/risk filtering
- [x] Verified `Company > Teams` operational org view and links into goals and agents
- [x] Verified `Company > Staffing` team grouping, collapse controls, density controls, and inline management actions
- [x] Verified `Company > Agents` allocation cards, impact cues, and session launch links
- [x] Verified Company drill-in navigation into `Work`, `Agents`, `Activity`, `Costs`, and sessions
- [x] Verified `Work` queue status changes reflect back into `Company` management events without stale state
- [x] Verified `Agents` and `Command Center` still read cleanly after the Company/Work split
- [x] Verified owner assignment changed `Ownership Open` from `2` to `1` immediately on `Company`
- [x] Verified staffing change changed `Coverage Gaps` from `1` to `0` immediately on `Company`
- [x] Verified queue change rendered on `Company` as `GOAL STATUS CHANGED` with `Status changed from blocked to ready.`
