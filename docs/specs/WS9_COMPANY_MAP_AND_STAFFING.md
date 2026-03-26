# WS9: Company Map and Staffing

## Summary

WS8 made Nitejar workable at scale.
It did not yet make the company legible.

The remaining gap is not "more tables." It is a missing management layer for humans:

- what the company is doing right now
- which goals are active
- which teams and agents are staffed onto those goals
- where work has no owner
- where staffing is thin, overloaded, or misaligned

Today, the operator can inspect goals, tickets, and agents.
What they still cannot do quickly is understand the company as a coordinated system.

This spec adds that layer.

It defines:

1. the human management questions the product should answer
2. the UI surfaces needed to answer them quickly
3. the data rollups needed for company-level visibility
4. the execution plan for building it in parallel

This extends [WS8 Operator Work Surface](./WS8_OPERATOR_WORK_SURFACE.md).

Execution checklist: [WS9_COMPANY_MAP_AND_STAFFING_EXECUTION.md](./WS9_COMPANY_MAP_AND_STAFFING_EXECUTION.md)

## Problem Statement

The current product has the right nouns, but not the right overview.

At real volume, this creates four failures:

1. **The company is not visible as a whole.**
   The operator can see individual goals, tickets, and agents, but not the portfolio as a coordinated organization.
2. **Staffing is not legible.**
   There is no fast answer to:
   "Which goals have enough coverage?"
   "Which goals have no real owner?"
   "Which agents are working on which goals?"
3. **Teams exist in settings, not in operations.**
   Teams are currently configurable, but they are not yet first-class operational units for understanding the business.
4. **High-level progress is still too click-deep.**
   The operator should not need to open five goal detail pages to understand what the company is doing this week.

## First-Principles Model

Humans manage organizations by keeping five things legible:

### 1. Outcomes

What are we trying to accomplish?

In Nitejar, this is the goal portfolio.

### 2. Ownership

Who is responsible for each outcome?

In Nitejar, this is a mix of:

- goal owner
- staffed agents
- owning team
- human approver or manager when needed

### 3. Capacity

Who has room for more work, and who is stretched thin?

In Nitejar, this is the staffing layer across agents and teams.

### 4. Status

Is the work progressing, stalled, blocked, or drifting?

In Nitejar, this comes from ticket movement, heartbeats, stale signals, and active execution.

### 5. History

What happened, exactly?

Nitejar already has this through sessions, activity, traces, and costs.

The product is strongest when it presents those five layers in that order:

1. company state
2. portfolio state
3. staffing state
4. detailed work queues
5. receipts

## Operator Jobs

These are the new human jobs this workstream should optimize for.

### 1. Read the Company

The operator opens the app and wants to understand:

- what goals are in progress
- which teams are active
- what the company is actually working on

Primary question: **"What is the company doing right now?"**

### 2. Inspect Staffing

The operator wants to see:

- which goals have agents assigned
- which goals are understaffed
- which teams are overloaded
- which agents are attached to too many goals

Primary question: **"Do the right people and agents own the right outcomes?"**

### 3. Rebalance Work

The operator wants to move capacity:

- assign an unstaffed goal
- add an agent to a goal
- move an agent off overloaded work
- spot goals with too many tickets but too little staffing

Primary question: **"Where do I need to rebalance the org?"**

### 4. Review Portfolio Progress

The operator wants a management view:

- which goals are healthy
- which are drifting
- which are blocked
- what changed since the last review

Primary question: **"Is the portfolio moving, and where is it slipping?"**

### 5. Drop to Receipts Only When Needed

Once something looks wrong, the operator should be able to jump directly to:

- goal detail
- ticket queue
- agent detail
- session transcript
- activity or cost receipts

Primary question: **"What happened underneath this summary?"**

## Proposed Information Architecture

WS8 stays intact:

- `Command Center` = attention and intervention
- `Work` = goals and ticket execution
- `Agents` = agent roster and configuration

WS9 adds a new company-level surface:

- `Company`

Recommended top-level nav:

- `Command Center`
- `Company`
- `Work`
- `Agents`
- `Activity`
- `Costs`
- `Plugins`
- `Skills`
- `Collections`
- `Evals`
- `Settings`

### Why a New `Company` Surface

This should not be stuffed into `Settings > Organization`.
That area is for configuration.

This is an operating surface for understanding:

- the portfolio
- the teams
- the staffing map
- the company-level progress picture

It is a day-to-day management view, not an admin form.

## Company Surface

`Company` should answer:

1. what are our active goals
2. how are we staffed against them
3. which teams are carrying what work
4. where are the coverage gaps

It should have five tabs.

### 1. Overview

This is the portfolio snapshot.

Recommended sections:

- `Board Overview`
- `Company Snapshot`
- `Goals In Progress`
- `Coverage Gaps`
- `Team Load`
- `Recent Portfolio Changes`

Recommended headline cards:

- active goals
- at-risk goals
- blocked goals
- staffed goals
- unstaffed goals
- overloaded agents

This page should feel like:

- "what the company is doing"
- not "everything that happened"

### 2. Portfolio

This is the high-level goal management view.

Recommended default table columns:

- goal
- health
- owner
- owning team
- staffed agents
- open tickets
- blocked tickets
- last heartbeat
- last activity
- progress

Recommended built-in views:

- `Board Overview`
- `In Progress`
- `Coverage Gaps`
- `Blocked Portfolio`
- `Team Load`
- `Unassigned Work`

This is where a human should be able to scan 20 goals in one pass.

### 3. Teams

This is the operational org chart.

Not a corporate HR chart.
Not reporting lines.

It is a working org view built around teams as execution units.

Each team row or card should show:

- team name
- human members
- attached agents
- active goals
- queued tickets
- blocked tickets
- open staffing gaps
- latest heartbeat

This should answer:

- which teams are carrying the portfolio
- which teams are overloaded
- which teams have goals without enough agent coverage

### 4. Staffing

This is the goal-to-agent allocation view.

This is the missing management screen for scale.

Recommended layout:

- left rail: goals
- top row: teams or agents
- matrix cells: staffing coverage

Each goal row should show:

- owning team
- goal health
- staffed agent count
- active ticket count
- blocked ticket count
- capacity signal

Each agent column or row should show:

- primary team
- current goal count
- open ticket count
- overloaded flag
- recent activity

The staffing matrix should visually distinguish:

- goal owner
- team coverage
- active staffed agents
- idle available agents
- overloaded agents

The runtime also needs matrix controls that keep the screen usable at portfolio scale:

- team-grouped columns
- collapse and expand by team
- density modes for compact vs comfortable scanning
- direct management actions from the matrix row

### 5. Agents

This is the company-level allocation view across individual agents.

It should show:

- primary team
- supported goals
- owned tickets
- capacity posture
- portfolio impact
- one-click session launch

The purpose is not pixel-perfect scheduling.
The purpose is legible coverage.

## UI Model

### Command Center vs Company

The distinction should stay sharp:

- `Command Center` answers: what needs my attention now?
- `Company` answers: what is the company doing, and how is it staffed?

Command Center is urgent and time-sensitive.
Company is structural and strategic.

### Org Chart Model

Do not build a heavyweight org-chart editor in v1.

Instead, treat the org chart as:

- teams
- team leads or goal owners
- human members
- attached agents
- goals owned by that team

That gives the operator the right mental map without inventing full reporting hierarchies.

### Goal Coverage Model

Every goal should surface:

- owner
- owning team
- staffed agent count
- active ticket count
- blocked ticket count
- last heartbeat
- last activity
- coverage status

Recommended coverage statuses:

- `covered`
- `thin`
- `unstaffed`
- `overloaded`

Definitions:

- `covered`: has owner, has team or at least one staffed agent, no overloaded staffing signal
- `thin`: has owner but only one staffed agent while ticket load is above threshold
- `unstaffed`: no staffed agent and no owning team
- `overloaded`: staffed, but all staffed agents are overloaded or blocked

### Team Load Model

Every team should surface:

- active goals
- staffed agents
- queued tickets
- blocked tickets
- goals without direct agent staffing
- overloaded agent count

### Agent Allocation Model

Every agent should surface:

- primary team
- current goals
- open tickets
- blocked tickets
- last active
- recent cost
- workload signal

This should reuse WS8 workload rollups, not duplicate them.

## Data Requirements

WS9 should add server-side company rollups, not new raw primitives.

### Company Overview Rollup

Need one portfolio summary procedure that returns:

- active goals
- at-risk goals
- blocked goals
- staffed goals
- unstaffed goals
- total staffed agents on active goals
- overloaded agents on active goals
- recent portfolio changes

### Goal Coverage Rollup

For each goal:

- owner
- owning team
- staffed agent ids
- staffed team ids
- open ticket count
- blocked ticket count
- done ticket count
- latest heartbeat
- latest activity
- coverage status

### Team Portfolio Rollup

For each team:

- members
- agents
- active goals
- goal ids
- queued tickets
- blocked tickets
- goals needing staffing
- overloaded agent count

### Agent Allocation Rollup

For each agent:

- primary team
- goal ids
- open tickets
- blocked tickets
- owned goals
- active sessions
- workload signal

### Portfolio Change Feed

This should be a structured feed for company-level changes:

- goal created
- goal status changed
- goal owner changed
- staffing changed
- goal heartbeat posted

Use existing work updates where possible.

## Interaction Design

### From Company to Work

Every summary element should let the operator jump directly to execution:

- goal row -> goal detail
- team row -> team detail or filtered Work view
- staffing gap -> filtered Work or agent assignment action
- overloaded agent -> agent roster or agent detail

### Inline Management Actions

The `Company` surface should support light management actions without forcing a context switch:

- assign owning team
- assign goal owner
- add staffed agent to goal
- remove staffed agent from goal
- open filtered ticket queue

Do not add full ticket editing here.
This is a management surface, not a replacement for Work.

### Saved Views

`Company` also needs first-class saved views.

Recommended built-ins:

- `Board Overview`
- `In Progress`
- `Coverage Gaps`
- `Blocked Portfolio`
- `Team Load`
- `Unassigned Work`

## Scale Model

This should still work cleanly at:

- 20 active goals
- 100 to 150 tickets
- 50 agents
- 5 to 10 teams

What the operator should be able to do in under one minute:

1. identify every in-progress goal
2. see which goals lack staffing
3. see which teams are overloaded
4. see which agents are attached to each goal
5. drill into the right queue to fix it

## Recommended Implementation Sequence

### Phase 1: Company Rollups

Add the server-side rollups and a minimal `Company Overview` page.

Ship:

- company summary procedure
- goal coverage rollup
- team portfolio rollup
- basic Company overview cards and tables

### Phase 2: Portfolio and Team Views

Ship:

- portfolio table
- teams operational view
- company saved views
- coverage status chips

### Phase 3: Staffing Matrix

Ship:

- goal-to-agent staffing matrix
- staffing gap signals
- quick staffing actions

### Phase 4: Portfolio Change Feed and Polish

Ship:

- recent portfolio changes feed
- tighter links to Work and Agents
- improved empty states and onboarding framing

## Suggested In-Product Goal

Create this next goal in Nitejar:

- `Make the company legible at a glance`

Suggested tickets:

- `Define company-level operator questions`
- `Add company summary and portfolio rollups`
- `Build company overview and portfolio screen`
- `Build teams operational view`
- `Build staffing matrix`
- `Add portfolio change feed and drill-ins`

## Definition of Done

- a human can open the app and answer "what is the company doing right now?"
- a human can see which goals are active without opening each one
- a human can see which teams and agents are staffed onto each goal
- unstaffed and thinly staffed goals are obvious
- overloaded teams and agents are obvious in the company context
- every summary element links cleanly to Work, Agents, Activity, or sessions
- the org structure is legible without building a heavyweight org-chart editor
