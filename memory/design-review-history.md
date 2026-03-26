# Design Review History

## 2026-03-24

### Round 1

- Surfaces: `Goal Detail`, `Ticket Detail`
- Goal Detail average: `2.9`
- Ticket Detail average: `3.1`
- Cross-surface coherence average: `2.8`
- Main fixes chosen:
  - Make Goal Detail execution-first instead of splitting attention across child goals, tickets, and updates.
  - Restore honest error/not-found states instead of treating missing data as endless loading.
  - Improve Ticket Detail navigation and drill-in coherence.

### Round 2

- Surfaces: `Goal Detail`, `Ticket Detail`
- Goal Detail average: `3.5`
- Ticket Detail average: `3.6`
- Notable gains:
  - Goal Detail now leads with one execution structure and demotes updates.
  - Ticket Detail now has stronger back-navigation, clearer execution framing, and better quiet/completion states.
- Remaining gaps called out by blind grading:
  - Parent/detail parity with the list-side detail panels.
  - Inline relationship editing on the full pages.
  - More meaningful motion and completion payoff.

### Round 3

- Surfaces: `Goal Detail`, `Ticket Detail`
- Implemented follow-up:
  - Added inline parent-goal editing to Goal Detail.
  - Added inline goal and parent-ticket editing to Ticket Detail.
  - Added explicit ticket assignment and cancelable note composer on Ticket Detail.
- Verification:
  - `pnpm run typecheck`
  - Browser-checked both pages against the local dev server on `http://localhost:3000`
- Stop note:
  - The biggest structural issues are addressed.
  - Remaining work is mostly parity polish, micro-feedback, and progressive-power improvements rather than a broken composition.

### Round 4

- Goal Detail average: `4.1`
- Ticket Detail average: `3.9`
- Cross-surface note:
  - Goals and tickets now mostly share the same tree/detail vocabulary.
  - The remaining coherence issue is the lack of one shared canonical detail shell between side panels and full-page detail views.
- Highest-leverage remaining fix:
  - Collapse the duplicated header/property patterns into one reusable detail shell shared by both list-side panels and full detail pages.

### Round 5

- Trigger:
  - Human review overruled the evaluator on Goal Detail and surfaced real interaction failures.
  - Blind regrade confirmed Goal Detail was over-focused while Ticket Detail was under-reviewed.
- Blind grader summary:
  - Goal Detail strongest remaining issue: edit-state layout shift in the property shell.
  - Ticket Detail strongest remaining issue: it still used an older, noisier property-editing pattern and lagged behind Goal Detail.
- Implemented follow-up:
  - Moved Goal Detail property editing into a stable editor tray under the property cards to remove grid jumpiness.
  - Brought Ticket Detail onto the same card-plus-tray detail shell with calmer goal, parent-ticket, and assignee editing.
  - Simplified Ticket Detail session controls so assignment editing and session launching no longer compete in the same inline control cluster.
- Verification:
  - `corepack pnpm run typecheck`
  - Browser-checked Goal Detail and Ticket Detail against the local dev server on `http://localhost:3000`
- Current note:
  - The shared detail shell is now meaningfully closer across both pages.
  - Remaining work is more polish and rhythm than basic interaction-model mismatch.

### Round 6 (2026-03-24) — Detail pages + list-to-detail navigation

- Surfaces: `Goal Detail`, `Ticket Detail`, `Goals List`, `Tickets List`
- Focus: user-requested review of detail pages, list→detail navigation, and Asana-style toolbar
- Round 6a (blind grade):
  - Goal Detail: 3.0
  - Ticket Detail: 3.0
  - Goals List: 3.6
  - Tickets List: 3.6
  - Cross-surface: 3.4
  - Top issues: "Open full page" buried at bottom of detail panel, no action toolbar on detail pages, card-grid+editor-zone property editing is a different paradigm from panel's inline Combobox editing
- Round 6a (implement):
  - Added prominent "Open" button + status picker to detail panel headers (both lists)
  - Removed buried "Open full page" link from bottom of both detail panels
  - Added action toolbar to both detail pages (status picker, mark complete, copy link, settings)
  - Replaced card-grid + editor-zone with inline key-value property rows (auto-save on change)
  - Removed GoalPropertyRow, TicketPropertyCard, activeEditor pattern, and 214px editor placeholder
- Round 6b (blind grade):
  - Goal Detail: 3.1
  - Ticket Detail: 3.3
  - Goals List: 3.3
  - Tickets List: 3.3
  - Cross-surface: 3.2
  - Top issues: progress config always visible, no inline sub-item creation on detail pages, GoalTicketTreeRow uses read-only StatusDot
- Round 6b (implement):
  - Collapsed progress config behind disclosure toggle on Goal Detail
  - Added inline sub-goal creation on Goal Detail
  - Added inline sub-ticket creation on Ticket Detail
  - Replaced StatusDot with InlineStatusPicker in GoalTicketTreeRow
  - Added updateTicketStatusMutation to Goal Detail for ticket status changes
- Round 6c (blind grade — final):
  - Goal Detail: 3.1
  - Ticket Detail: 3.3
  - Goals List: 3.3
  - Tickets List: 3.3
  - Cross-surface: 3.3
  - Scores plateaued. Remaining issues are widget consistency (Combobox in panels vs NativeSelect on pages), stat card visual weight, and polish (skeleton loading in panels, success toasts)
- Round 6d (implement):
  - Unified all relational fields to Combobox (searchable) on both detail pages
  - Collapsed stat cards into compact inline text on both execution lanes
  - Added skeleton loading to both detail panels (replacing "Loading..." text)
  - Added success toasts for sub-item creation and mark-complete actions
- Round 6d (blind grade):
  - Goal Detail: 3.5, Ticket Detail: 3.5, Goals List: 3.6, Tickets List: 3.6, Cross-surface: 3.6
- Round 6e (implement):
  - Collapsed Properties sections behind disclosure toggles with inline summaries (both detail pages)
  - Fixed double back-navigation on ticket detail (removed duplicate from page.tsx)
  - Unified breadcrumb pattern (ArrowLeft + text) across both detail pages
  - Added fadeSlideIn animation to completion banners, scalePulse to ProgressRing at 100%
- Round 6e (blind grade):
  - Goal Detail: 3.4, Ticket Detail: 3.3, Goals List: 3.4, Tickets List: 3.4, Cross-surface: 3.5
- Round 6f (implement):
  - Added inline title editing to both detail panels (uncontrolled input with onBlur save)
  - Added inline sub-goal creation to goal detail panel
  - Added inline sub-ticket creation to ticket detail panel
  - Added emerald completion coloring to TicketProgress when done === total
- Round 6f (blind grade — final):
  - Goal Detail: 3.3, Ticket Detail: 3.3, Goals List: 3.7, Tickets List: 3.7, Cross-surface: 3.7
  - Scores plateaued across 3 consecutive rounds (3.3-3.7 range)
- Stop note:
  - **List views and cross-surface coherence are strong at 3.7.** Shared tree components, keyboard nav, drag-and-drop, inline editing all work well.
  - **Detail pages plateau at 3.3.** Every grader identifies the same root cause: too many equally-weighted sections (toolbar, title, properties, outcome/description, execution, updates, settings) competing on a single scroll. Pushing past 3.5 requires a composition rethink — not more features.
  - **Changes made this session:** action toolbar, simplified property editing (Combobox auto-save), progress disclosure, inline sub-item creation on detail pages and panels, panel title editing, unified breadcrumbs, completion animations, skeleton loading, success toasts
  - **Remaining design decisions for future rounds:** (1) promote execution tree as dominant detail page body (demote outcome/description to expandable line), (2) extract shared EditableTitle component used by both panels and pages, (3) add error states to list views and optimistic status updates on detail pages

### Round 7 (2026-03-25) — Composition rethink for detail pages

- Focus: flatten detail page composition so execution trees dominate, demote secondary sections
- Round 7a (implement — ticket detail):
  - Merged toolbar into title area (single title block with status, mark done, start session, copy link)
  - Collapsed description into expandable line with truncated preview
  - Removed execution lane card wrapper — sub-tickets and linked work render directly
  - Moved completion banner to title area
  - Moved properties below execution content, moved post-update to bottom area
- Round 7a (implement — goal detail):
  - Same pattern: merged toolbar into title area, outcome always visible, removed execution lane card
  - Split into strategic zone (title, outcome, sub-goals) and operational zone (tickets, updates, settings)
  - Added zone separator with `my-8 border-t`
- Round 7a (blind grade):
  - Ticket Detail: **3.6** (up from 3.3)
  - Goal Detail: **3.1** (down — too many collapsed sections created "gallery of drawers" problem)
- Round 7b (implement — goal detail only):
  - Two-zone layout: tighter spacing in strategic zone (space-y-4), wider in operational (space-y-8)
  - Promoted tickets header with cost summary
  - Improved empty state copy with personality
- Round 7b (blind grade): Goal Detail: **3.1** (no change — composition still weak)
- Round 7c (implement — goal detail only):
  - Moved owner + initiative into metadata line as inline Combobox pickers
  - Moved parent goal into sub-goals section as expand-on-click picker
  - Moved progress config near outcome with "Edit" toggle
  - **Killed the Properties disclosure section entirely**
  - More breathing room: zone separator `my-8`, operational zone `space-y-8`
- Round 7c (blind grade): Goal Detail: **3.5** (significant jump — composition scores improved)
  - One dominant object: 4.0, Negative space: 3.5, No competing: 3.5, Right form: 4.0
- Round 7d (implement — goal detail only):
  - Added ProgressRing (size 24) to title area between title and status picker
  - Demoted parent goal picker: hidden behind "+ Set parent goal" link, expands on click
  - Moved owner People/Agents toggle inside Combobox dropdown (invisible until dropdown open)
  - Fixed parent goal triple-mention bug (removed redundant "under" link from sub-goals header)
- Round 7d (blind grade): Goal Detail: **3.3** (stable — remaining issues are optimistic updates, heartbeat UX, reward moments)
- Final scores this session:
  - Goal Detail: 3.3-3.5, Ticket Detail: 3.6, Goals List: 3.6-3.7, Tickets List: 3.5-3.7, Cross-surface: 3.6-3.7
- Stop note:
  - **Ticket detail is the strongest detail page** at 3.6 — simpler structure benefits from the composition rethink
  - **Goal detail stabilized at 3.3-3.5** — fundamentally more complex (sub-goals + tickets + progress + heartbeat + initiatives). The two-zone layout and inline properties helped but the page is inherently information-dense.
  - **Remaining improvements require code architecture changes, not design:** (1) optimistic status updates throughout, (2) heartbeat cron presets instead of raw input, (3) reward animations on completion. These are not composition issues.
