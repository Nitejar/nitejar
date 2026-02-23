# PRD — Agent Teams, Members, and Reporting Structure

## Summary

Add a first-class organization model with members and teams. Agents and users can be assigned to teams, and team membership determines who can approve or manage agent work. This is the foundation for approvals and reporting without introducing complex role hierarchies yet.

## Goals

- Invite and manage organization members with basic profile fields.
- Create teams and assign both users and agents to teams.
- Define a reporting structure where agents “report to” their assigned team(s).
- Allow team members to approve agent requests (no multi-level hierarchy yet).
- Keep UX simple: names, emails, avatars, role; team assignments; clear reporting.

## Non-Goals

- No per-team role hierarchy beyond a simple role field (superadmin/admin/member).
- No complex org chart dependencies or agent-to-agent reporting at this stage.
- No external SSO or enterprise identity integration.

## User Stories

- As an admin, I can invite users by email and see their status (invited, active).
- As an admin, I can assign users and agents to teams.
- As a team member, I can approve requests from agents assigned to my team.
- As a superadmin, I can approve any agent request without team membership.
- As an admin, I can view which team(s) an agent reports to.

## Requirements

### 1) Members (Users)

- Fields: `name`, `email`, `avatar_url`, `role`.
- Roles: `superadmin`, `admin`, `member` (simple string enum).
- Status: `invited`, `active`, `disabled`.

### 2) Invitations

- Invite by email.
- Store invitation token, status, and expiration.
- Accepting an invite creates or activates the user record.
- Email delivery uses React Email templates.
- Delivery mechanism uses Resend by default (no fallback transport in this iteration).

### 3) Teams

- Teams have: `name`, `description` (optional), `slug` (optional).
- Team membership links users to teams with a `role` (default `member`).

### 4) Agent Assignments

- Agents can be assigned to one or more teams.
- Each agent has a primary team (optional) for default approvals.
- Teams define who can approve agent actions.

### 5) Approvals (Policy)

- Any member of a team assigned to an agent can approve requests for that agent.
- Superadmins can approve any request regardless of team assignment.
- No multi-level approval flow in this iteration.

## Data Model

- `users`
  - id, name, email (unique), avatar_url, role, status, created_at, updated_at
- `invitations`
  - id, email, token, status, expires_at, created_at
- `teams`
  - id, name, description, slug, created_at, updated_at
- `team_members`
  - team_id, user_id, role, created_at
- `agent_teams`
  - team_id, agent_id, is_primary, created_at

## API Endpoints

- `GET /api/org/users`
- `POST /api/org/users`
- `GET /api/org/users/:id`
- `PATCH /api/org/users/:id`
- `POST /api/org/invitations`
- `POST /api/org/invitations/accept`

- `GET /api/org/teams`
- `POST /api/org/teams`
- `GET /api/org/teams/:id`
- `PATCH /api/org/teams/:id`
- `POST /api/org/teams/:id/members`
- `DELETE /api/org/teams/:id/members/:userId`

- `POST /api/org/agents/:id/teams`
- `PATCH /api/org/agents/:id/teams/:teamId`
- `DELETE /api/org/agents/:id/teams/:teamId`

## UI/UX

- Members page: list, invite flow, edit profile, role selector.
- Teams page: list, create team, assign users and agents.
- Agent detail page: show assigned teams and primary team selection.
- Org Chart (lightweight): simple “teams → members/agents” view.

## Testing

- Unit: membership assignment, invite creation.
- Integration: CRUD users/teams, team membership, agent-team assignments.
- Manual: Invite, accept, assign team, verify approvals visibility.

## Rollout

- Ship with simple roles and team approvals.
- Keep room for future team role hierarchy and agent-to-agent reporting.

## Open Questions

- Do we want a single default team created at install?
- Should agent approvals require any specific team role (admin vs member)?
- Should we allow manual invite links in addition to email?
- Where should Resend API key live (org setting vs server env)?
