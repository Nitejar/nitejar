# WS10: Product Hierarchy and Navigation

> Historical planning note: this draft explored an `initiative` layer above goals. The current branch removed initiatives and keeps **goals** as the top stable execution layer. Read any remaining initiative references below as superseded exploration, not the current product model.

## Summary

Nitejar now has enough primitives to feel dense.
It does not yet have enough hierarchy to feel inevitable.

The current product can answer many questions, but it does not yet present a clear ladder of:

- what the company is
- how the organization is structured
- what the company is trying to accomplish
- how work decomposes
- where receipts live underneath that work

This is the taste problem.
Not a lack of capability.
Not a lack of saved views, filters, or controls.

The product currently has too many peer-level entry points and too many surfaces trying to summarize the same system from different angles.
That makes the UI feel additive instead of editorial.

This spec defines the hierarchy contract that should govern the next iteration.

It covers:

1. the canonical object model
2. the organization hierarchy
3. the work hierarchy
4. the top-level navigation model
5. the role of each major surface
6. what should be promoted, demoted, or hidden by default
7. the data-model additions required to make the hierarchy real

This extends:

- [WS8 Operator Work Surface](./WS8_OPERATOR_WORK_SURFACE.md)
- [WS9 Company Map and Staffing](./WS9_COMPANY_MAP_AND_STAFFING.md)

Execution checklist: [WS10_PRODUCT_HIERARCHY_AND_NAVIGATION_EXECUTION.md](./WS10_PRODUCT_HIERARCHY_AND_NAVIGATION_EXECUTION.md)

## Problem Statement

The product currently has three structural weaknesses.

### 1. The organization is not modeled as a hierarchy

Today, teams exist, but they behave mostly like buckets:

- a team can have people
- a team can have agents
- a team can appear in staffing and ownership

What is missing:

- higher-order org units
- parent-child reporting structure
- a clear path from company -> function -> team -> member
- explicit organizational leadership and responsibility structure

This means the app can show staffing, but not the shape of the company.

### 2. The work model is not fully hierarchical

Today, Nitejar has:

- goals
- tickets
- optional `parent_goal_id`

What is missing from the product model:

- visible goal trees
- a first-class issue or sub-issue hierarchy
- a clear distinction between planning objects and execution objects

This means the app can show work, but not the planning ladder that contains it.

### 3. Too many surfaces are peers

The current presentation still flattens:

- structure
- action
- receipts
- staffing
- activity
- sessions

This creates visual equality where there should be rank.

The result:

- `Company` tries to be both hierarchy view and control center
- `Work` can drift into portfolio summary
- `Agents` can drift into staffing matrix
- receipts and sessions remain more visually primary than they should be

## Product Principle

The product should always tell the operator two things immediately:

1. what level of the system they are looking at
2. what question this screen is for

Every screen should have one dominant object and one dominant question.

## Canonical Object Model

Nitejar should have two intersecting hierarchies plus one subordinate receipt layer.

### 1. Organization Hierarchy

- `Company`
- `Org Unit`
- `Team`
- `Person`
- `Agent`

This is how responsibility and management structure are represented.

### 2. Work Hierarchy

- `Company`
- `Initiative`
- `Goal`
- `Ticket`
- `Sub-ticket` or `Issue relation` when needed

This is how planning and execution are represented.

### 3. Receipt Layer

- `Run`
- `Session`
- `Activity event`
- `Cost entry`
- `Evaluation`

These are receipts.
They explain what happened beneath work.
They do not define the primary hierarchy.

## Hierarchy Rules

These rules should stay stable across the product.

### Rule 1: Org owns work

- org units own initiatives
- teams own goals
- people and agents own tickets or execution slices

### Rule 2: Receipts attach downward

- receipts belong to tickets, goals, agents, or sessions
- receipts never become the top-level organizing primitive

### Rule 3: Default hierarchy stays shallow

The product should support hierarchy without encouraging arbitrary deep trees.

Preferred depth:

- initiative -> goal -> ticket
- team -> agent
- org unit -> team

Allowed but secondary:

- goal -> child goal
- ticket -> sub-ticket

### Rule 4: Every surface chooses one hierarchy

- `Company` = org hierarchy plus portfolio hierarchy
- `Work` = work hierarchy
- `Agents` = actor hierarchy
- `Activity` = receipt chronology
- `Command Center` = urgent intervention

## Organization Hierarchy

Nitejar needs a first-class organizational model.

### Missing Concept: Org Units

Add an `org_units` layer above teams.

Recommended structure:

- `Company`
  - `Revenue`
    - `Revenue Ops`
    - `Customer Success`
  - `Product`
    - `Product Delivery`
  - `Infrastructure`
    - `Platform Reliability`
  - `Strategy`
    - `Market Intelligence`

Recommended semantics:

- `Org Unit` represents a function, department, or division
- `Team` represents an execution unit within that org unit
- `Person` and `Agent` belong to teams

### Organization Object Responsibilities

#### Company

Answers:

- what is the company doing?
- where is the company weak?
- which parts of the org need intervention?

#### Org Unit

Answers:

- what is this function responsible for?
- which teams roll up here?
- how healthy is the portfolio under this part of the business?

#### Team

Answers:

- what outcomes does this team own?
- who is on it?
- which agents support it?
- what load is it carrying?

#### Person / Agent

Answers:

- what are they responsible for?
- what are they currently carrying?
- are they overloaded, idle, blocked, or underused?

### Organizational Relationships

The product should support:

- parent org unit -> child org unit
- org unit -> team
- team lead
- people managers when needed
- agent team assignment
- agent dotted-line team membership when needed

The product should not start with:

- arbitrary matrix reporting UI
- HR-style reporting diagrams as the primary experience
- separate people and agent org chart products

The initial goal is legibility, not HR completeness.

## Work Hierarchy

Historical note: this draft explored an initiative layer above goals. The current branch moved the other direction and removed initiatives, keeping **goals** as the top stable execution layer so the product stays simpler and more legible.

### Goal

A goal is an operational outcome.

A goal should:

- have a single clear owner
- have an owning team or clear staffing context
- roll down into tickets
- optionally have child goals in rare cases

### Ticket

A ticket is a unit of execution.

A ticket should:

- belong to a goal
- optionally belong to a parent ticket
- optionally block or depend on other tickets
- be the primary launch point for sessions and live execution

### Ticket Hierarchy

Nitejar does not need infinite nesting.

It does need:

- parent-child sub-ticket relationships
- blocking relationships
- related-work relationships

That is enough to match how planning actually works without turning the system into a generic graph editor.

## Navigation Model

Top-level navigation should reflect product rank, not feature inventory.

Recommended grouping:

### Operate

- `Command Center`
- `Company`
- `Work`
- `Agents`

### Verify

- `Activity`
- `Costs`
- `Evals`

### Build

- `Plugins`
- `Skills`
- `Collections`
- `Settings`

This is close to the current app, but the copy and ordering should be stricter.

The important point is not the labels.
It is the precedence:

- operate first
- verify second
- configure third

## Surface Roles

Each top-level surface should optimize for one primary question.

### Command Center

Primary question:

- what needs attention right now?

This is the intervention surface.

It should prioritize:

- blocked work
- stale work
- queue hot spots
- spend warnings
- approval needs
- overloaded teams or agents

It should not be a structural browse surface.

### Company

Primary question:

- how is the company organized, and where is it weak?

This is the structure surface.

It should prioritize:

- org hierarchy
- initiative hierarchy
- team ownership
- staffing coverage
- management events

It should not feel like a dashboard of unrelated widgets.

### Work

Primary question:

- what work exists, and how is it moving?

This is the execution surface.

It should prioritize:

- initiatives
- goals
- tickets
- queue movement
- blockers
- execution detail

### Agents

Primary question:

- who is carrying work, and how are they performing?

This is the actor surface.

It should prioritize:

- roster
- team membership
- capacity
- owned work
- reliability
- spend

### Activity

Primary question:

- what happened?

This is the receipt surface.

It should prioritize:

- timelines
- run receipts
- audit trail
- debugability

## Company Information Architecture

The current Company surface has useful ingredients but too many equal-weight modes.

The refined model should be:

- `Overview`
- `Organization`
- `Portfolio`

Everything else becomes secondary.

### 1. Overview

Purpose:

- board-level and operator-level snapshot

Contains:

- company health summary
- active initiatives
- top risks
- top staffing gaps
- key management events

This should be the one executive page.

### 2. Organization

Purpose:

- org tree and responsibility map

Contains:

- org unit tree
- teams within org units
- leads
- people and agent membership
- load and posture rolled up by node

This is where the missing company structure becomes visible.

### 3. Portfolio

Purpose:

- planning hierarchy and portfolio health

Contains:

- goal hierarchy
- health
- owner
- owning team
- staffing state
- progress and blocked load

This should be the main browse surface for company planning.

### Secondary Modes Inside Company

These should exist, but not as equal-weight top-level tabs:

- staffing matrix
- saved views
- change feed
- density controls
- advanced grouping
- advanced filters

These become:

- a display mode
- a side panel
- a command-menu action
- a view preset

The principle:

- structure first
- controls second
- receipts third

## Work Information Architecture

`Work` should become a list-detail product, not another summary surface.

Recommended main modes:

- `Overview`
- `Goals`
- `Tickets`

But the hierarchy should be clearer:

- overview = triage
- goals = goal list / tree
- tickets = queue list

### Detail Pattern

Use a consistent three-part layout:

- list or tree in the center
- content/detail in the main pane
- properties panel on the right

This is the strongest pattern in Linear and Paperclip.

It keeps:

- context visible
- editing local
- receipts attached to the object

### Work Must Not Do

- it should not be the org browser
- it should not be the company staffing map
- it should not summarize every management concern already covered by Company

## Agents Information Architecture

`Agents` should stop being a partial staffing surface and become a roster-and-profile surface.

Default grouping:

- group by org unit or team

Default answer:

- which team is this agent part of?
- which initiatives, goals, and tickets do they support?
- what is their current capacity posture?

Agent detail should show:

- org placement
- current work
- recent runs
- reliability
- spend
- session launch

Session launch should remain prominent.
It should not dominate the page's hierarchy.

## Receipts and Sessions

Sessions are not the hierarchy.
They are attached execution context.

Runs, sessions, and activity should be reachable from:

- ticket detail
- goal detail
- agent detail
- command center attention item

They should rarely be where a user starts unless they are already diagnosing a specific exception.

## Presentation Rules

These are the taste constraints.

### Rule 1: One dominant object per screen

If a screen cannot name its primary object in one noun, it is too broad.

### Rule 2: Advanced controls stay quiet

Saved views, filters, sorting, grouping, density, and display modes should not all sit at equal visual weight above the fold.

Preferred order:

- one default view
- one compact view switcher
- one filter trigger
- one display trigger

### Rule 3: Hierarchy before telemetry

Structure should appear before trend charts and secondary summaries.

### Rule 4: Receipts are downstream

Activity, sessions, live runs, and costs should appear as attached receipts beneath work or actor objects.

### Rule 5: Repetition is a bug

If Company, Work, and Agents each answer the same question with different visual systems, the product loses trust.

## What To Demote

These things stay in the product, but move out of the first impression:

- always-visible saved-view chips
- full-width filter bars
- staffing matrix as default landing state
- feed-style change history competing with hierarchy
- duplicated portfolio summaries across multiple surfaces
- session-first calls to action at the same weight as structural navigation

## What To Promote

These should become more explicit:

- org tree
- initiative tree
- consistent right-side properties panel
- clear breadcrumb path through hierarchy
- clear ownership model at each level
- drill-in path from company -> initiative -> goal -> ticket -> receipt

## Required Data Model Additions

### Organization

Add `org_units`

Suggested columns:

- `id`
- `parent_org_unit_id`
- `name`
- `slug`
- `kind` (`company`, `function`, `department`, `team_group`)
- `owner_kind`
- `owner_ref`
- `lead_title`
- `sort_order`
- `created_at`
- `updated_at`

Add `team.org_unit_id`

Optional follow-up:

- `team.parent_team_id` only if later needed
- `users.manager_user_id` only if person hierarchy becomes important

### Work

Add `initiatives`

Suggested columns:

- `id`
- `parent_initiative_id`
- `title`
- `summary`
- `status`
- `health`
- `owner_kind`
- `owner_ref`
- `org_unit_id`
- `team_id`
- `target_date`
- `started_at`
- `created_at`
- `updated_at`
- `archived_at`

Add `goals.initiative_id`

Keep `goals.parent_goal_id`, but make initiative the default planning container.

### Tickets

Add ticket hierarchy and dependency model:

- `tickets.parent_ticket_id`
- `ticket_relations`
  - `source_ticket_id`
  - `target_ticket_id`
  - `kind` (`blocks`, `related`, `duplicate`, `parent_child`)

This is enough to support:

- sub-issues
- blockers
- related work

without overbuilding.

## Migration Strategy

Roll this out in layers.

### Phase 1: Hierarchy Contract

- ship org unit and initiative data model
- attach teams to org units
- attach goals to initiatives
- add breadcrumbs and hierarchy-aware drill-ins

### Phase 2: Company Reframe

- replace equal-weight Company tabs with hierarchy-first modes
- add organization tree
- make portfolio default to initiative -> goal structure
- demote advanced controls

### Phase 3: Work Reframe

- add goal tree and ticket hierarchy
- move to stronger list-detail layout
- attach receipts consistently in detail view

### Phase 4: Agent Reframe

- group agents by org/team by default
- clarify agent placement in org and work hierarchies
- keep session launch visible but subordinate

## Definition of Done

This hierarchy pass is done when:

- a user can tell where they are in the organization at all times
- a user can tell where they are in the work tree at all times
- `Company` reads like structure, not like a mixed dashboard
- `Work` reads like execution, not like another company summary
- `Agents` reads like a roster, not like a duplicate staffing matrix
- receipts remain one click away, but they do not dominate the hierarchy
- advanced power features remain available without flattening the default experience

## Non-Goals

This pass should not attempt:

- full HR software
- arbitrary graph editing
- infinite nested planning trees
- replacing tickets with sessions
- adding more top-level product nouns

The goal is not to expand scope.
The goal is to impose hierarchy and rank on the scope that already exists.
