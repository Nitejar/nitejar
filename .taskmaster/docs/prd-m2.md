# M2 — Agent Soul

**Goal:** Make agents configurable and persistent with memory.

**Dependencies:** M1 complete (all testing passed)

## Overview

Currently agents are stateless between jobs - they don't remember past interactions. M2 adds the "soul" - persistent memory, learned patterns, and configurable personality that makes each agent unique.

## Features

### 1. Memory System

**What it does:** Agents remember past conversations and context across sessions.

**Implementation:**

- New `memories` table: `(id, agent_id, content, type, importance, created_at, accessed_at)`
- Memory types: `conversation`, `fact`, `preference`, `context`
- Importance scoring (1-10) for retrieval prioritization
- Automatic memory creation during inference
- Memory decay: reduce importance over time if not accessed

**Memory creation triggers:**

- User states a preference ("I prefer TypeScript")
- User provides context ("This repo uses pnpm")
- Important conversation conclusions
- Explicit "remember this" commands

**Storage considerations:**

- Start with full text storage
- Consider embeddings for semantic search later
- Memory size limits per agent
- Cleanup job for old/low-importance memories

### 2. Learnings Storage

**What it does:** Track synthesized insights the agent discovers over time.

**Difference from memory:** Memories are raw facts/events. Learnings are patterns and insights derived from memories.

**Implementation:**

- New `learnings` table: `(id, agent_id, insight, confidence, evidence_count, created_at, updated_at)`
- Examples:
  - "User prefers concise responses" (derived from feedback)
  - "This codebase uses barrel exports" (derived from code analysis)
  - "PRs should include test updates" (derived from review feedback)

**Learning creation:**

- Agent reflects on patterns after completing jobs
- Explicit teaching ("Always run tests before committing")
- Reinforcement from repeated observations

**Usage:**

- Learnings included in system prompt
- Higher confidence = more prominent in prompt
- Can be edited/deleted by humans

### 3. Personality/Behavior Configuration

**What it does:** Humans can configure how the agent behaves.

**Configuration options:**

- **Tone:** professional, casual, friendly, terse
- **Verbosity:** minimal, normal, detailed, exhaustive
- **Expertise areas:** list of topics agent is expert in
- **Constraints:** things agent should never do
- **Custom instructions:** free-form system prompt additions

**Implementation:**

- Store in `agent.config.personality` JSONB
- Personality config merged into system prompt
- UI for editing personality settings
- Presets: "Professional Developer", "Helpful Assistant", "Code Reviewer"

**System prompt structure:**

```
[Base system prompt]
[Personality: tone, verbosity]
[Expertise areas]
[Constraints]
[Custom instructions]
[Relevant learnings]
[Relevant memories]
[Current context]
```

### 4. Context Retrieval

**What it does:** Surface relevant history to agent during inference.

**Implementation:**

- When job starts, query for relevant context:
  - Recent memories from same user/repo
  - Learnings applicable to current task
  - Previous jobs on same work item
- Retrieval methods:
  - Keyword matching (simple, fast)
  - Recency weighting (recent = more relevant)
  - Semantic search (future: embeddings)

**Context window management:**

- Limit total context tokens
- Prioritize by: recency, importance, relevance
- Truncate/summarize if needed

### 5. Admin UI for Agent Soul

**What it does:** Let humans view and manage agent memory/personality.

**Pages:**

- **Memory browser:** List all memories with search/filter, edit/delete
- **Learnings list:** View learned patterns, adjust confidence, delete
- **Personality editor:** Configure tone, verbosity, constraints, custom instructions
- **System prompt preview:** See what the agent's full prompt looks like

**Memory browser features:**

- Filter by type (conversation, fact, preference)
- Sort by recency, importance
- Search by content
- Bulk delete old memories
- Manual memory creation

## Data Model

```sql
-- Memories table
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  content TEXT NOT NULL,
  type TEXT NOT NULL, -- conversation, fact, preference, context
  importance INTEGER DEFAULT 5, -- 1-10
  metadata JSONB, -- source job, user, repo, etc.
  created_at TIMESTAMP DEFAULT NOW(),
  accessed_at TIMESTAMP DEFAULT NOW()
);

-- Learnings table
CREATE TABLE learnings (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  insight TEXT NOT NULL,
  confidence REAL DEFAULT 0.5, -- 0-1
  evidence_count INTEGER DEFAULT 1,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Update agents table
ALTER TABLE agents ADD COLUMN personality JSONB DEFAULT '{}';
```

## Exit Criteria

- [ ] Agent remembers context from previous conversations
- [ ] Memories persist across sessions and restarts
- [ ] Humans can view/edit agent memory via admin UI
- [ ] Humans can view/edit agent learnings via admin UI
- [ ] Humans can configure agent personality via admin UI
- [ ] Agent behavior adapts based on configured personality
- [ ] Relevant context automatically included in inference
- [ ] Memory importance decays over time
- [ ] System prompt preview shows full agent prompt
