# WS10 Product Hierarchy and Navigation: Execution Checklist

This is the execution plan for turning Nitejar from a capable surface set into a coherent product hierarchy.

Related spec: [WS10_PRODUCT_HIERARCHY_AND_NAVIGATION.md](./WS10_PRODUCT_HIERARCHY_AND_NAVIGATION.md)

## Objective

Make Nitejar read like one product by:

- defining a canonical org hierarchy
- defining a canonical work hierarchy
- reducing peer-level surface competition
- demoting advanced controls from the default impression
- making drill-in paths consistent from company structure down to receipts

## Current Phase

- [x] Problem framed as hierarchy and taste, not raw feature count
- [x] Canonical object model documented
- [x] Phase 1: data model additions for org and work hierarchy
- [x] Phase 2: navigation and Company reframe
- [x] Phase 3: Work and Agents reframe
- [x] Phase 4: polish, receipts, and verification

## Implementation Status

Completed on March 8, 2026:

- added `org_units`, `initiatives`, `goals.initiative_id`, `tickets.parent_ticket_id`, and `ticket_relations`
- seeded realistic org-unit, initiative, goal-tree, and sub-ticket structure
- reframed `Company` into `Overview`, `Organization`, and `Portfolio`
- pulled staffing matrix and agent allocation views under `Portfolio` instead of giving them peer-level tabs
- added initiative and ticket hierarchy awareness to `Work`
- browser-verified hierarchy rendering on `http://localhost:3100/company` and `http://localhost:3100/work`

## Workstreams

## Workstream A: Hierarchy Contract

Owner: CEO / Product Lead

- [x] Define the canonical object model
- [x] Define the org hierarchy
- [x] Define the work hierarchy
- [x] Define receipts as subordinate to work
- [x] Define screen roles with one primary question per surface

Deliverable:

- stable product hierarchy contract

## Workstream B: Data Model

Owner: Founding Engineer / Backend Lead

- [x] Add `org_units` table
- [x] Add `teams.org_unit_id`
- [x] Add `initiatives` table
- [x] Add `goals.initiative_id`
- [x] Add `tickets.parent_ticket_id`
- [x] Add `ticket_relations` table
- [x] Add rollups for org-unit load, initiative health, and hierarchy breadcrumbs
- [x] Add tests for hierarchy traversal and rollup correctness

Deliverable:

- sober database contract for org and work hierarchy

## Workstream C: Navigation Model

Owner: Frontend Engineer / Product Lead

- [x] Refine top-level nav into clearer rank order
- [ ] Group top-level nav by operate / verify / build
- [ ] Keep current nouns stable where possible
- [ ] Add breadcrumb pattern that follows hierarchy consistently
- [x] Remove duplicated surface framing where multiple screens answer the same question

Deliverable:

- top-level navigation that reflects hierarchy, not feature inventory

## Workstream D: Company Reframe

Owner: Frontend Engineer / Company Surface Lead

- [x] Replace equal-weight Company tabs with hierarchy-first modes
- [x] Add `Organization` mode with org-unit -> team -> member tree
- [x] Add `Portfolio` mode with initiative -> goal hierarchy
- [x] Keep `Overview` as the board/operator summary
- [x] Move staffing matrix into a display mode or subordinate mode
- [ ] Move saved views, filters, grouping, and density behind quieter controls
- [ ] Keep management actions available without making them primary chrome

Deliverable:

- Company reads as structure first, controls second, receipts third

## Workstream E: Work Reframe

Owner: Frontend Engineer / Work Surface Lead

- [x] Add initiative awareness to Work
- [x] Add visible goal hierarchy in Goals mode
- [x] Add ticket hierarchy and dependency cues in Tickets mode
- [ ] Move Work toward a stronger list-detail pattern
- [ ] Standardize right-side properties panel
- [ ] Make live runs, comments, activity, and sub-items attached detail views

Deliverable:

- Work reads as execution and decomposition, not another company summary

## Workstream F: Agents Reframe

Owner: Frontend Engineer / Agents Surface Lead

- [x] Group agents by org or team by default
- [x] Show org placement on the list and detail views
- [ ] Show supported initiatives, goals, and tickets on agent detail
- [x] Keep session launch prominent but subordinate
- [x] Remove duplicate staffing summary patterns already covered by Company

Deliverable:

- Agents reads as a roster-and-profile surface

## Workstream G: Receipts and Detail Views

Owner: Backend Lead with Frontend support

- [ ] Make ticket detail the primary receipt launch point
- [ ] Make goal detail the primary summary-to-receipt bridge
- [x] Ensure activity, runs, sessions, and costs attach beneath the work object
- [ ] Align breadcrumb and back-navigation behavior across all detail screens

Deliverable:

- receipts are easy to reach without becoming the primary hierarchy

## Workstream H: Editorial Simplification

Owner: Product Lead with Frontend support

- [ ] Reduce always-visible chips and toolbar clutter
- [ ] Collapse advanced controls into compact menus
- [x] Establish one default view per surface
- [x] Remove duplicate summaries across Company, Work, and Agents
- [x] Audit first-impression screens for competing visual weights

Deliverable:

- the product feels edited instead of accumulated

## Surface Defaults

These are the defaults the implementation should optimize around.

### Command Center

- default to urgent intervention
- no structural browsing above the fold

### Company

- default to `Overview`
- next most important mode is `Organization`
- `Portfolio` is the planning hierarchy
- staffing matrix is secondary

### Work

- default to list-detail
- center on goal and ticket movement

### Agents

- default group by team or org unit
- roster first, configuration second

### Activity

- timeline and receipts only

## Required UI Decisions

These must be resolved in implementation, not left fuzzy.

- [ ] Final names for `Org Unit`, `Initiative`, and `Ticket` in user-facing copy
- [ ] Whether `Projects` remains a future synonym or stays internal-only
- [ ] Whether `Teams` stays visible as its own Company mode or lives inside `Organization`
- [ ] Whether `Sub-ticket` or `Sub-issue` is the public term
- [ ] Final command-bar placement for advanced filters and display modes

## Suggested In-Product Goals

These should become real Nitejar goals and tickets.

- [ ] `Make the product hierarchy legible`
- [ ] `Add org structure above teams`
- [ ] `Add initiative structure above goals`
- [ ] `Add ticket hierarchy and blockers`
- [ ] `Refine Company into a hierarchy-first structure surface`
- [ ] `Refine Work into a list-detail execution surface`
- [ ] `Refine Agents into a roster-and-profile surface`
- [ ] `Demote advanced controls and remove duplicate summaries`

## Verification Checklist

- [x] A user can tell whether they are looking at org structure, work structure, or receipts
- [ ] Every major detail view has a clear breadcrumb path
- [x] Company no longer feels like a mixed dashboard and control panel
- [x] Work no longer duplicates company-level summary logic
- [x] Agents no longer duplicates staffing management logic
- [x] Sessions remain easy to launch without becoming the primary noun
- [x] The default impression of each surface is calmer and more opinionated than before
- [ ] Advanced controls are available but do not dominate the first screen

## Definition of Done

- [x] Org hierarchy is modeled and visible
- [x] Initiative hierarchy is modeled and visible
- [x] Ticket hierarchy exists for sub-work and blockers
- [x] Command Center, Company, Work, Agents, and Activity each answer one primary question
- [x] Hierarchy is visible before telemetry and controls
- [x] Receipts are consistently downstream from work
- [x] The product reads as one system rather than adjacent feature surfaces
