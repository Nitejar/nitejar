# Task ID: 96

**Title:** Database Schema for Org Members and Teams

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** Add tables for users, invitations, teams, team_members, and agent_teams.

**Details:**

Create migrations for: users (name, email, avatar_url, role, status), invitations (email, token, status, expires_at), teams (name, description, slug), team_members (team_id, user_id, role), agent_teams (team_id, agent_id, is_primary). Roles include superadmin/admin/member.

**Test Strategy:**

Run migration locally and verify tables and constraints exist.
