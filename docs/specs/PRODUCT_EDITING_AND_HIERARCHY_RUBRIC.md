# Product Editing and Hierarchy Rubric

This is the durable product-editing rubric for Nitejar.
Use it when adding, refining, or reviewing any user-facing surface in the app.

The goal is simple:

- build depth without flattening everything into peer-level UI
- make hierarchy visible before controls become visible
- make the product feel authored instead of accumulated

This extends the product doctrine in [AGENTS.md](../../AGENTS.md) and complements [WS10 Product Hierarchy and Navigation](./WS10_PRODUCT_HIERARCHY_AND_NAVIGATION.md).

## Core Standard

Every major screen must answer two questions in the first few seconds:

1. What level of the system am I looking at?
2. What is this screen for?

If the answer is not obvious, the screen is not edited enough.

## Screen Roles

These roles should stay stable across the app.

- `Command Center`: urgent attention and intervention
- `Company`: organization and portfolio structure
- `Work`: execution queues, decomposition, and status
- `Agents`: roster, capacity, ownership, and impact
- `Activity` and receipts: what happened

Any new screen should either fit one of these roles or prove that it introduces a genuinely new noun.

## Composition Rules

### 1. One dominant object

Each screen gets one primary object.

Examples:

- `Company > Organization`: the org structure
- `Company > Portfolio`: the portfolio hierarchy
- `Work`: goals or tickets in execution context
- `Agent detail`: one agent and its current load

If two things both feel primary, one of them needs to move down.

### 2. One dominant reading path

Users should know where to look first, second, and third.

Preferred order:

- primary structure or queue
- contextual actions and properties
- receipts and secondary controls

Avoid layouts where summaries, controls, feeds, and management tools all claim equal weight.

### 3. Form follows relationship

Choose the UI form that matches the information relationship.

- Hierarchy and reporting: tree, outline, indented table, split-pane explorer
- Queue and execution: list-detail, board, grouped table
- Comparison and staffing load: matrix, heatmap, structured table
- Narrative and evidence: timeline, transcript, log, ledger
- Overview: a small number of strong summary blocks with clear drill-ins

Cards are valid when items are peers to browse.
Cards are a weak default for hierarchy, chain of command, dense operations, or workflow progression.

### 4. Progressive disclosure

Advanced controls should not dominate the first impression.

Demote by default:

- saved views
- filter builders
- sort and grouping controls
- density controls
- mode switches that only matter for power users

Promote by default:

- the actual objects being managed
- ownership
- health
- blocked state
- load and coverage signals

### 5. Subtract when adding

When a feature is added, ask what should become quieter.

Refinement work should usually do at least one of these:

- remove a competing section
- demote a control into a menu, toolbar, or command palette
- collapse repeated summaries
- merge two views that answer the same question
- replace generic containers with a stronger organizing structure

## Hierarchy Rules

These are the core product hierarchy rules.

- Org owns work.
- Work owns receipts.
- Receipts do not own the product structure.
- Parent-child relationships should be visible without reading long labels.
- Deep trees are allowed, but the default mental model should stay shallow and legible.

Preferred ladders:

- `Org Unit -> Team -> Person/Agent`
- `Initiative -> Goal -> Ticket`
- `Ticket/Goal/Agent -> Run/Session/Activity`

## Design Workflow

Use this workflow before implementing any significant UI change.

### Step 1: Define the screen sentence

Write a one-line sentence:

- "This screen is for operators to see X and do Y."

If that sentence has two nouns or two primary verbs, split or demote something.

### Step 2: Name the primary and secondary layers

For the target screen, explicitly state:

- primary object
- primary question
- secondary context
- hidden or deferred controls

### Step 3: Explore more than one direction

For new surfaces or meaningful refactors, sketch or describe 2-3 materially different directions before implementation.

The directions should differ in composition, not just component styling.

Examples of meaningful differences:

- tree/detail vs. outline table vs. map
- list-detail vs. board-detail
- left-nav hierarchy vs. inline hierarchy

Examples of non-differences:

- the same card grid with different spacing
- the same layout with different accent colors

### Step 4: Choose by clarity, not convenience

Pick the direction that makes hierarchy, ownership, and next action obvious fastest.
Do not choose the direction just because it reuses the most existing components.

## Review Checklist

Before shipping a UI change, ask:

- Can a user tell where they are in the hierarchy within 5 seconds?
- Can a user tell what this object belongs to?
- Does the screen answer one primary question cleanly?
- Are advanced controls quieter than the underlying objects?
- Are receipts reachable without becoming the main composition?
- Is any section visually equal when it should be subordinate?
- Did the implementation fall back to repeated cards where a stronger organizing structure was needed?
- Would removing one section improve the page?

If several answers are "no", the screen needs another editing pass.

## Specific Anti-Patterns

Treat these as product-smell warnings, not hard bans.

- a grid of cards representing a reporting hierarchy
- a page that starts with controls before showing the thing being controlled
- multiple dashboards summarizing the same entities on different top-level screens
- sessions or runs presented as peers to goals, tickets, or company structure
- top-level tabs that are really alternative visualizations of the same underlying object
- "overview" pages that are only collections of unrelated modules

## What Good Looks Like

Good product editing in Nitejar should feel like this:

- the default screen is calm
- structure is obvious
- weak points stand out quickly
- advanced power is there but not shouting
- users can drill down without losing their place
- the same nouns mean the same thing across screens
- the UI feels opinionated enough to guide, but not rigid enough to trap
