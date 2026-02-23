# WS4: Eval & Rubric System

Status: Draft for review
Audience: Core engineering, product, operator docs
Last updated: 2026-02-20
Supersedes: Earlier rubric-only draft. Now uses extensible evaluator pipeline schema.

---

## 1. Overview

### 1.1 What evals are

An eval is a structured, repeatable assessment of how well an agent performed on a unit of work. Every agent run produces observable artifacts: messages, tool calls, spans, cost data, and a final response. Evals score those artifacts against defined criteria so operators can answer "how good was that run?" with numbers and receipts, not vibes.

### 1.2 Why evals matter (receipts doctrine)

Nitejar's core doctrine is "receipts, not vibes." Today, the platform tracks *what* happened (spans, inference calls, activity log) and *what it cost* (cost tracking, ledger). What is missing is *how well* it happened. Without evals:

- Operators cannot compare agent quality across runs, models, or prompt changes.
- There is no structured feedback loop from observed quality back to agent configuration.
- "The agent is good" is a vibe. "The agent scored 4.2/5.0 on accuracy across 47 runs this week, up from 3.8 after the soul prompt change" is a receipt.

### 1.3 How evals fit the platform

Evals sit between the existing run infrastructure and the admin UI. The eval system uses an **extensible evaluator pipeline** where multiple evaluator types can run per agent, though v1 ships only the LLM judge type:

```
Work Item --> Job --> [Agent Run] --> Job Completed --> [Eval Trigger]
                                                            |
                                                   Eval Pipeline Runner
                                                     /       |       \
                                              [Gate Evals]  ...   [Scorer Evals]
                                                     \       |       /
                                                   Pipeline Result (eval_run)
                                                     + Per-evaluator results (eval_results)
                                                            |
                                             Score + Improvement Suggestions
```

Evals are a **post-run concern**. They do not affect the agent's response to the user. They run asynchronously after a job completes and store results as new receipt rows. The pipeline model means safety gates can block scoring evaluators, and different evaluator types (LLM judge, programmatic, statistical) can compose into an overall quality signal. For v1, the pipeline contains a single step: the LLM judge.

---

## 2. Database Schema

All tables use the existing Nitejar conventions: UUIDv7 primary keys, Unix timestamp integers for `created_at`/`updated_at`, SQLite-compatible types, Kysely migrations.

The schema supports a **typed evaluator pipeline** where LLM judge (rubric-based) is one evaluator type among many. For v1, only `llm_judge` is fully implemented; the other types are defined in the schema so their execution logic can ship in later phases without migration.

### 2.1 `rubrics`

A rubric is a named, versioned scoring template for LLM judge evaluators. Rubrics are standalone entities that define criteria and scale descriptors. They serve as the configuration format for evaluators of type `llm_judge` -- when you create an LLM judge evaluator, its `config_json` references a rubric by ID.

Rubrics remain a first-class table (rather than being folded into `evaluators.config_json` inline) because they are reusable templates: an operator may clone and customize rubrics independently of evaluator assignments, and the rubric builder UI operates on this table directly.

```sql
CREATE TABLE rubrics (
  id            TEXT PRIMARY KEY,                  -- UUIDv7
  name          TEXT NOT NULL,                     -- Human-readable name, e.g. "Code Quality"
  description   TEXT,                              -- Optional longer description
  criteria_json TEXT NOT NULL,                     -- JSON array of RubricCriterion (see section 3)
  version       INTEGER NOT NULL DEFAULT 1,        -- Monotonic version counter
  judge_model   TEXT,                              -- Override judge model for this rubric (null = use default)
  created_by    TEXT,                              -- 'admin' | user ID
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
);
```

**Design notes:**

- `criteria_json` stores the full rubric definition as a JSON text column (same pattern as `schema_json` in `collections`, `config_json` in `plugin_instances`, `rule_json` in `routines`).
- `version` increments on each edit. Old eval results snapshot the evaluator config at eval time (stored on `eval_results.evaluator_config_snapshot_json`), so historical scores remain interpretable even after rubric changes.
- `judge_model` allows per-rubric model override. Null means use the system default judge model (configured in the `eval_settings` singleton table -- see section 2.6).
- Rubrics do not have an `agent_id` column. A single rubric can be shared across agents via evaluator assignments. This decoupling simplifies rubric reuse without duplication.

### 2.2 `evaluators`

An evaluator is a configured instance of an evaluator type. This is the core extension point: instead of rubrics being the only evaluation mechanism, the system supports multiple evaluator types, each purpose-built for what it measures.

```sql
CREATE TABLE evaluators (
  id            TEXT PRIMARY KEY,                  -- UUIDv7
  name          TEXT NOT NULL,                     -- Human-readable name, e.g. "Code Quality Judge", "PII Gate"
  description   TEXT,                              -- What this evaluator checks
  type          TEXT NOT NULL,                     -- Evaluator type (see below)
  config_json   TEXT NOT NULL,                     -- Type-specific configuration (see below)
  judge_model   TEXT,                              -- Only used for llm_judge type
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
);
```

**Evaluator types:**

| Type | Description | v1 Status |
|------|-------------|-----------|
| `llm_judge` | LLM model scores against a rubric. Subjective quality assessment. | Fully implemented |
| `programmatic` | Code-based assertions (regex, JSON schema, output checks). Zero inference cost. | Schema only |
| `statistical` | Computed from run metadata (response time, token count, cost). Zero inference cost. | Schema only |
| `safety` | Automated safety checks (PII detection, toxicity, secret leakage). | Schema only |
| `human_feedback` | Direct human judgment (ratings, annotations). | Schema only |
| `task_completion` | Did the agent accomplish the stated goal? LLM or programmatic. | Schema only |
| `custom` | Operator-defined function or webhook. | Schema only |

**`config_json` by type:**

- `llm_judge`: `{ rubric_id: string }` -- references the `rubrics` table. The rubric criteria, scale descriptors, and weights are stored there.
- `programmatic`: `{ check: 'non_empty' | 'contains' | 'regex' | 'json_valid' | 'json_schema' | 'min_length' | 'max_length' | 'tool_used' | 'max_tool_calls' | 'custom', params: Record<string, unknown> }`
- `statistical`: `{ metric: 'response_time' | 'token_count' | 'tool_call_count' | 'cost' | 'error_count', threshold?: { min?: number, max?: number } }`
- `safety`: `{ checks: Array<'pii' | 'secrets' | 'toxicity' | 'policy'>, policy_prompt?: string }`
- `task_completion`: `{ method: 'llm' | 'programmatic' | 'hybrid', judge_model?: string }`
- `human_feedback`: `{ scale: [number, number], categories?: string[] }`
- `custom`: `{ function_code?: string, webhook_url?: string }`

**Design notes:**

- `judge_model` is only meaningful for `llm_judge` (and optionally `task_completion` with `method: 'llm'`). For other types, it is null.
- For `llm_judge`, the `config_json.rubric_id` points to the `rubrics` table rather than inlining criteria. This keeps rubrics as independently editable templates.
- The `type` column is not constrained to an enum at the database level (TEXT, not CHECK) so new types can be added without migration. Validation happens in application code.

### 2.3 `agent_evaluators`

Join table assigning evaluators to agents. Replaces the earlier `agent_rubrics` concept with a wider scope: any evaluator type can be assigned to any agent.

```sql
CREATE TABLE agent_evaluators (
  id            TEXT PRIMARY KEY,                  -- UUIDv7
  agent_id      TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  evaluator_id  TEXT NOT NULL REFERENCES evaluators(id) ON DELETE CASCADE,
  weight        REAL NOT NULL DEFAULT 1.0,         -- Relative weight for scoring evaluators
  is_active     INTEGER NOT NULL DEFAULT 1,        -- 0/1; multiple active evaluators per agent allowed
  sample_rate   REAL,                              -- Per-assignment override (null = use agent/system default)
  is_gate       INTEGER NOT NULL DEFAULT 0,        -- If 1, this evaluator must pass before scoring evaluators run
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(agent_id, evaluator_id)                   -- An agent cannot have the same evaluator assigned twice
);

CREATE INDEX idx_agent_evaluators_agent ON agent_evaluators(agent_id);
CREATE INDEX idx_agent_evaluators_evaluator ON agent_evaluators(evaluator_id);
CREATE INDEX idx_agent_evaluators_agent_active ON agent_evaluators(agent_id, is_active);
```

**Design notes:**

- `weight` determines how much this evaluator contributes to the agent's overall score. Only meaningful for scoring evaluators (`is_gate = 0`). Weights are relative: if an agent has three scoring evaluators with weights 3, 2, and 1, they contribute 50%, 33%, and 17% respectively. Normalized at query time, not stored as percentages.
- `is_gate` controls pipeline behavior. Gate evaluators run first and must pass before any scoring evaluators execute. If a gate fails, the pipeline is marked as failed and scoring is skipped. This is the hook for future safety/compliance gates. For v1 LLM judge evaluators, `is_gate` defaults to 0 (scorer).
- `sample_rate` allows per-assignment override. If null, falls back to the agent-level or system-level default (see section 4.5).
- Multiple evaluators can be active simultaneously for one agent. The pipeline runs all active evaluators (gates first, then scorers) and composes their results.

### 2.4 `eval_runs`

An eval run is a **pipeline-level container** for one evaluation of one job. It stores the overall pipeline outcome (did gates pass? what is the aggregate score?) while individual evaluator results live in `eval_results` (section 2.5).

```sql
CREATE TABLE eval_runs (
  id                      TEXT PRIMARY KEY,       -- UUIDv7
  job_id                  TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  agent_id                TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  work_item_id            TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  trigger                 TEXT NOT NULL DEFAULT 'auto',  -- 'auto' | 'manual'
  status                  TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'running' | 'completed' | 'failed'
  overall_score           REAL,                    -- Weighted aggregate across all scoring evaluators (null if gates failed or pending)
  gates_passed            INTEGER,                 -- 1 if all gate evaluators passed, 0 if any failed (null while pending)
  pipeline_result_json    TEXT,                     -- JSON: overall pipeline outcome metadata
  total_cost_usd          REAL DEFAULT 0,          -- Sum of all evaluator costs in this pipeline run
  error_text              TEXT,                    -- Error message if status='failed'
  started_at              INTEGER,
  completed_at            INTEGER,
  created_at              INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at              INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_eval_runs_job ON eval_runs(job_id);
CREATE INDEX idx_eval_runs_agent ON eval_runs(agent_id);
CREATE INDEX idx_eval_runs_agent_created ON eval_runs(agent_id, created_at);
CREATE INDEX idx_eval_runs_status ON eval_runs(status);
```

**Design notes:**

- `overall_score` is the pre-computed weighted average across all scoring evaluators. Storing it as a column enables efficient trend queries. This is null if any gate evaluator failed (the pipeline did not produce a valid quality score).
- `gates_passed` is a denormalized boolean for fast filtering. If 0, operators know to check `eval_results` for the specific gate failure.
- `pipeline_result_json` stores the composed pipeline outcome: gate evaluator IDs and pass/fail, scorer evaluator IDs and weights, the composition formula used, and any pipeline-level metadata. This is the "receipt" for how the overall score was derived.
- `total_cost_usd` is the sum of all evaluator costs in this pipeline run. For v1 with only LLM judge, this equals the single judge call cost. For future multi-evaluator pipelines, it aggregates across all evaluators.
- The old `rubric_id`, `criteria_snapshot_json`, `scores_json`, `judge_model`, and `judge_reasoning` columns are removed. These are now per-evaluator concerns stored on `eval_results`.
- `trigger` distinguishes automatic post-run evals from manual "Run Evaluation" button presses.

### 2.5 `eval_results`

Per-evaluator results within a pipeline run. Each row is one evaluator's output for one eval run. This is where the detailed scoring data lives.

```sql
CREATE TABLE eval_results (
  id                              TEXT PRIMARY KEY,       -- UUIDv7
  eval_run_id                     TEXT NOT NULL REFERENCES eval_runs(id) ON DELETE CASCADE,
  evaluator_id                    TEXT NOT NULL REFERENCES evaluators(id) ON DELETE CASCADE,
  result_type                     TEXT NOT NULL,           -- 'score' | 'pass_fail' | 'classification' | 'metrics'
  score                           REAL,                    -- Normalized 0-1 score (null for non-scoring types)
  passed                          INTEGER,                 -- For gate evaluators: 1 = passed, 0 = failed (null for non-gates)
  details_json                    TEXT,                     -- Type-specific result details (see below)
  evaluator_config_snapshot_json  TEXT NOT NULL,            -- Snapshot of evaluator config at eval time
  cost_usd                        REAL DEFAULT 0,          -- Cost of this specific evaluation (for llm_judge type)
  duration_ms                     INTEGER,
  created_at                      INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_eval_results_run ON eval_results(eval_run_id);
CREATE INDEX idx_eval_results_evaluator ON eval_results(evaluator_id);
```

**`details_json` by evaluator type:**

- `llm_judge`: `{ criteria_scores: CriterionScore[], judge_reasoning: string, judge_model: string, input_token_count: number, output_token_count: number }` -- the full per-criterion breakdown, reasoning text, and token usage.
- `programmatic`: `{ assertions: Array<{ name: string, passed: boolean, message: string }> }` -- each assertion result.
- `statistical`: `{ metrics: Array<{ name: string, value: number, unit: string, threshold?: object, passed?: boolean }> }` -- computed metrics with threshold checks.
- `safety`: `{ checks: Array<{ name: string, passed: boolean, details?: string }> }` -- individual safety check results.
- `task_completion`: `{ completed: boolean, confidence: number, method: string, evidence?: string }`.
- `human_feedback`: `{ rating: number, scale: [number, number], annotation?: string, rater_id: string }`.

**Design notes:**

- `evaluator_config_snapshot_json` captures the exact evaluator configuration used for this result. For `llm_judge`, this includes the full rubric criteria snapshot. This ensures historical eval results remain self-documenting even after evaluator or rubric edits.
- `result_type` indicates the shape of the result. `score` means the evaluator produced a numeric quality score (used by scoring evaluators). `pass_fail` means a binary pass/fail (used by gate evaluators). `classification` and `metrics` are for future evaluator types.
- `score` is normalized to 0-1 for cross-evaluator comparability. For `llm_judge`, the 1-5 rubric score is stored in `details_json` and the normalized score is `(rubric_score - 1) / 4`. For programmatic pass/fail, `score` is 1.0 (pass) or 0.0 (fail).
- `cost_usd` is non-zero only for evaluators that make inference calls (primarily `llm_judge`). Programmatic and statistical evaluators have zero cost.
- Every eval result is a receipt -- inspectable, traceable, stored with the config snapshot that produced it.

### 2.6 `improvement_suggestions`

AI-generated improvement suggestions derived from eval results. Created on demand (via "Suggest Improvements" button) or optionally after a batch of evals.

```sql
CREATE TABLE improvement_suggestions (
  id              TEXT PRIMARY KEY,                -- UUIDv7
  agent_id        TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  eval_run_ids    TEXT NOT NULL,                   -- JSON array of eval_run IDs that informed this suggestion
  category        TEXT NOT NULL,                   -- 'soul' | 'tools' | 'model' | 'memory' | 'general'
  title           TEXT NOT NULL,                   -- Short summary, e.g. "Improve error handling tone"
  description     TEXT NOT NULL,                   -- Detailed suggestion with specific recommendations
  priority        TEXT NOT NULL DEFAULT 'medium',  -- 'low' | 'medium' | 'high'
  status          TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'accepted' | 'dismissed' | 'applied'
  applied_by      TEXT,                            -- User ID who accepted/applied
  applied_at      INTEGER,
  dismissed_at    INTEGER,
  judge_model     TEXT,                            -- Model used to generate suggestion
  cost_usd        REAL,                            -- Cost of generating this suggestion
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_improvement_suggestions_agent ON improvement_suggestions(agent_id);
CREATE INDEX idx_improvement_suggestions_agent_status ON improvement_suggestions(agent_id, status);
```

**Design notes:**

- `eval_run_ids` is a JSON array because a suggestion may synthesize patterns across multiple eval runs (e.g., "across 12 recent runs, the agent consistently scores low on conciseness").
- `category` enables filtering suggestions by what they affect. Maps to agent config sections: soul prompt, tool usage patterns, model selection, memory configuration, or general behavior.
- `status` lifecycle: `pending` (new) -> `accepted` (operator agrees) -> `applied` (operator made the change). Or `pending` -> `dismissed` (operator disagrees). `accepted` vs `applied` distinction is for tracking intent vs. action.

### 2.7 `eval_settings`

Singleton table for system-level eval configuration. Uses the singleton pattern (single row, `id = 'default'`).

```sql
CREATE TABLE eval_settings (
  id                  TEXT PRIMARY KEY DEFAULT 'default',  -- Singleton row
  judge_model         TEXT,                                -- Default judge model (e.g. 'openai/gpt-4o-mini')
  max_daily_evals     INTEGER NOT NULL DEFAULT 50,         -- Max auto-eval runs per agent per day
  sample_rate_default REAL NOT NULL DEFAULT 1.0,           -- Default sample rate (0.0-1.0)
  sample_rate_high_volume_threshold INTEGER NOT NULL DEFAULT 20,  -- Runs/day above which auto-throttle kicks in
  sample_rate_high_volume REAL NOT NULL DEFAULT 0.2,       -- Sample rate when above threshold
  eval_cost_budget_usd REAL,                               -- Optional daily eval cost budget (null = no limit)
  created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at          INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Seed the singleton row on migration
INSERT INTO eval_settings (id) VALUES ('default');
```

**Design notes:**

- This is a dedicated table, not a row in `capability_settings`. Eval settings are complex enough (multiple typed fields, default values) that a structured table is clearer than a JSON config blob.
- `sample_rate_default` + `sample_rate_high_volume_threshold` + `sample_rate_high_volume` implement the adaptive sampling behavior: 100% when under the threshold, auto-throttle to the configured rate above it. Per-agent or per-evaluator overrides in `agent_evaluators.sample_rate` take precedence.
- `eval_cost_budget_usd` is an optional daily budget for eval costs across all agents. Null means no limit. This is separate from agent cost limits (see section 4.5).

---

## 3. Rubric Format

### 3.1 Criteria JSON structure

The `criteria_json` column on `rubrics` stores an array of criterion objects:

```typescript
interface RubricCriterion {
  /** Stable identifier for this criterion within the rubric. Auto-generated slug. */
  id: string
  /** Human-readable name, e.g. "Accuracy", "Helpfulness", "Tone" */
  name: string
  /** What this criterion measures. Shown to the judge model. */
  description: string
  /** Relative weight for overall score calculation. Weights are normalized to sum to 1.0. */
  weight: number
  /** Per-level descriptors that anchor the 1-5 scale for the judge. */
  scale: {
    1: string  // e.g. "Completely inaccurate or fabricated information"
    2: string  // e.g. "Mostly inaccurate with some correct elements"
    3: string  // e.g. "Partially accurate but missing key details"
    4: string  // e.g. "Accurate with minor omissions"
    5: string  // e.g. "Fully accurate and comprehensive"
  }
}
```

### 3.2 Score result JSON structure

Per-criterion scores are stored in `eval_results.details_json` (within the `criteria_scores` array) for `llm_judge` evaluator results:

```typescript
interface CriterionScore {
  /** Matches RubricCriterion.id */
  criterion_id: string
  /** The criterion name (denormalized for readability) */
  criterion_name: string
  /** Score from the judge, 1-5 integer */
  score: number
  /** Judge's explanation for this specific score */
  reasoning: string
}
```

### 3.3 Example rubric

```json
{
  "name": "Customer Support Quality",
  "criteria": [
    {
      "id": "accuracy",
      "name": "Accuracy",
      "description": "How factually correct and technically accurate is the response?",
      "weight": 3,
      "scale": {
        "1": "Response contains fabricated or dangerously wrong information",
        "2": "Multiple factual errors that undermine usefulness",
        "3": "Mostly correct but with notable gaps or inaccuracies",
        "4": "Accurate with at most minor, non-critical imprecisions",
        "5": "Fully accurate, well-sourced, no errors detected"
      }
    },
    {
      "id": "helpfulness",
      "name": "Helpfulness",
      "description": "Did the response actually solve or advance the user's problem?",
      "weight": 3,
      "scale": {
        "1": "Response does not address the user's question at all",
        "2": "Tangentially related but does not solve the problem",
        "3": "Partially addresses the problem, user still needs significant help",
        "4": "Substantially solves the problem with minor follow-up needed",
        "5": "Completely resolves the user's issue, actionable and clear"
      }
    },
    {
      "id": "tone",
      "name": "Tone & Communication",
      "description": "Is the communication style appropriate for the context?",
      "weight": 2,
      "scale": {
        "1": "Rude, dismissive, or inappropriately formal/casual",
        "2": "Awkward tone that detracts from the message",
        "3": "Acceptable but generic, no personality",
        "4": "Natural and appropriate, consistent with agent personality",
        "5": "Excellent tone that builds rapport while staying professional"
      }
    },
    {
      "id": "efficiency",
      "name": "Efficiency",
      "description": "Did the agent use its tools and context window efficiently?",
      "weight": 1,
      "scale": {
        "1": "Excessive tool calls, wasted tokens, or circular reasoning",
        "2": "Notably inefficient but eventually completed the task",
        "3": "Adequate efficiency, some unnecessary steps",
        "4": "Efficient execution with minor optimization opportunities",
        "5": "Optimal tool usage, minimal wasted tokens, direct path to solution"
      }
    }
  ]
}
```

### 3.4 Rubric templates

The system ships with a small set of built-in rubric templates that operators can clone and customize:

| Template | Criteria | Use case |
|----------|----------|----------|
| General Assistant | Accuracy, Helpfulness, Tone, Efficiency | Default for most agents |
| Code Review | Correctness, Thoroughness, Actionability, Tone | GitHub-focused agents |
| Customer Support | Accuracy, Resolution, Empathy, Response Time Awareness | Support-focused agents |
| Research & Analysis | Accuracy, Depth, Source Quality, Clarity | Research-focused agents |

Templates are stored as static JSON in the application code (similar to how default soul templates work), not in the database. Operators create rubrics from templates, which become independent database rows they own.

---

## 4. Auto-Eval Flow (Pipeline Model)

### 4.1 Trigger: post-run hook

After a job completes successfully (status = `COMPLETED`), the run-dispatch worker checks whether the agent has any active evaluators (via `agent_evaluators`). If so, a single pipeline eval run is enqueued (subject to sampling -- see section 4.5). The pipeline run will execute all active evaluators for the agent.

**Integration point in the existing codebase:**

The `run-dispatch-worker.ts` calls `finalizeRunDispatch` after `runAgent` completes. The eval trigger inserts after finalization, before the `finally` block:

```
runAgent() completes
  -> completeJob()
  -> recordCompletedActivity()
  -> finalizeRunDispatch()
  -> [NEW] enqueueEvalPipeline() if agent has active evaluators
  -> effect outbox processing
```

The eval is enqueued, not executed inline. The enqueue function:

1. Looks up all active evaluators for the agent (via `agent_evaluators` where `is_active = 1`).
2. If no active evaluators exist, returns immediately (no-op).
3. If the job was a triage-pass (no substantive response), skips eval.
4. Applies sampling logic (see section 4.5) at the pipeline level -- either the whole pipeline runs or it does not. Per-evaluator sample rates on `agent_evaluators.sample_rate` can further reduce which evaluators execute within the pipeline.
5. Creates a single `eval_runs` row with `status = 'pending'`.
6. Inserts a `background_tasks`-style record or uses the existing `scheduled_items` table to schedule async processing.

### 4.2 Async pipeline execution

Eval runs execute asynchronously so they never block the agent's response delivery. Two implementation options (choose one):

**Option A: Background task queue (recommended).** Add a new `eval-worker` tick loop alongside the existing `run-dispatch-worker` and `effect-outbox-worker`. The eval worker:

1. Claims pending eval runs (`status = 'pending'`, with lease-based claiming like `run_dispatches`).
2. Assembles the eval context (see section 7).
3. Loads the agent's active evaluators (from `agent_evaluators`, ordered so gates come first).
4. **Phase 1 -- Gates:** For each gate evaluator (`is_gate = 1`), run the evaluator and store an `eval_results` row. If any gate fails, mark the `eval_runs` row as `gates_passed = 0`, skip scoring evaluators, and proceed to step 7.
5. **Phase 2 -- Scorers:** For each scoring evaluator (`is_gate = 0`), run the evaluator and store an `eval_results` row.
6. Compose the overall score: weighted average of all scoring evaluator results (see section 8).
7. Update `eval_runs` with `overall_score`, `gates_passed`, `pipeline_result_json`, `total_cost_usd`, and `status = 'completed'` (or `'failed'` on error).

**Option B: Inline async.** Fire-and-forget an async function from the dispatch worker after finalization. Simpler but less durable (no retry on crash).

**Recommendation:** Option A, using the same lease-based pattern as `run_dispatches` and `effect_outbox`. This gives durability, crash recovery, and observability for free.

**v1 note:** With only the `llm_judge` evaluator type implemented, the pipeline has exactly one step (the LLM judge call). The gate/scorer distinction exists in the schema but the pipeline runner treats a single LLM judge as a scorer with no gates. The pipeline execution code should still implement the full gate-then-score flow so it is ready for Phase 2 evaluator types.

### 4.3 Judge model selection

The judge model MUST be different from the agent's own model. Evaluating with the same model introduces self-assessment bias. Selection priority:

1. Evaluator-level override (`evaluators.judge_model`), if set.
2. Rubric-level override (`rubrics.judge_model`), if set (for `llm_judge` evaluators that reference a rubric).
3. System-level default judge model (stored in `eval_settings.judge_model`).
4. Hardcoded fallback: a capable model from the model catalog that is not the agent's model (e.g., if the agent uses `arcee-ai/trinity-large-preview:free`, the judge defaults to `openai/gpt-4o-mini`; if the agent uses a GPT model, the judge defaults to `anthropic/claude-3.5-haiku`).

The judge model resolution function:

```typescript
function resolveJudgeModel(
  agentModel: string,
  evaluatorJudgeModel: string | null,
  rubricJudgeModel: string | null
): string {
  if (evaluatorJudgeModel) return evaluatorJudgeModel
  if (rubricJudgeModel) return rubricJudgeModel
  // System default from eval_settings singleton
  const systemDefault = await getEvalSettings().then(s => s.judge_model)
  if (systemDefault) return systemDefault
  // Fallback: pick a different model family
  if (agentModel.includes('openai') || agentModel.includes('gpt')) {
    return 'anthropic/claude-3.5-haiku'
  }
  return 'openai/gpt-4o-mini'
}
```

**Note:** Judge model selection only applies to evaluator types that use inference (`llm_judge`, and in the future `task_completion` with `method: 'llm'`). Programmatic, statistical, and safety evaluators do not use a judge model.

### 4.4 Eval prompt structure

The judge model receives a structured prompt with:

1. **System instructions:** You are an independent quality evaluator. Score the following agent interaction using the provided rubric. Be objective and calibrated.
2. **Rubric definition:** Full criteria with scale descriptions.
3. **Work item context:** Title, source, source_ref, payload summary.
4. **Conversation transcript:** The full message history for this job (user messages + assistant responses + tool call summaries). Tool call results are truncated to keep the eval context manageable.
5. **Agent metadata:** Agent name, role/title, model used.
6. **Cost/performance data:** Token counts, duration, tool call count.
7. **Output format instructions:** Return a JSON object with per-criterion scores and reasoning.

The prompt explicitly instructs the judge to:
- Score each criterion independently on the 1-5 scale using the provided descriptors.
- Provide specific reasoning for each score citing evidence from the transcript.
- Not penalize the agent for limitations outside its control (e.g., tool unavailability, user ambiguity).
- Consider the agent's configured personality/soul when evaluating tone.

### 4.5 Rate limiting, sampling, and cost controls

**Cost attribution: evals are a platform concern.** Eval inference costs are tracked separately and do NOT count against agent cost limits. Evals are a platform/operator concern, not an agent operational cost. This means:

- Eval inference calls are tracked in the existing `inference_calls` table with a distinguishing attribute (e.g., `tool_call_names = '["__eval_judge__"]'` or a new `is_eval` column).
- Eval costs are shown separately in the cost dashboard (not mixed into the agent's operational cost totals).
- Agent cost limit checks (`maxDailyCostUsd`, `maxMonthlyCostUsd`) explicitly exclude rows flagged as eval calls.
- Eval costs have their own optional budget cap via `eval_settings.eval_cost_budget_usd`.
- Per-evaluator costs are stored on `eval_results.cost_usd` and aggregated to `eval_runs.total_cost_usd`.

**Auto-eval sampling.** Not every run needs to be evaluated. Sampling operates at two levels:

1. **Pipeline level:** Whether to run the eval pipeline at all for a completed job. Uses adaptive defaults from `eval_settings`: if the agent's completed runs today are below `sample_rate_high_volume_threshold` (default: 20), use `sample_rate_default` (default: 1.0 = 100%). Above the threshold, use `sample_rate_high_volume` (default: 0.2 = 20%).

2. **Per-evaluator level:** `agent_evaluators.sample_rate` can further reduce which evaluators execute within the pipeline. If set, a random float [0, 1) is compared to the per-evaluator sample rate; if the float exceeds the rate, that evaluator is skipped for this pipeline run. This allows operators to run cheap gate evaluators at 100% while sampling expensive LLM judge evaluators at a lower rate.

The pipeline-level sampling gate runs during enqueue. Per-evaluator sampling gates run during pipeline execution.

**Rate limiting:**

- A configurable maximum eval runs per agent per day (`eval_settings.max_daily_evals`, default: 50). After the limit, auto-evals are silently skipped until the next day. Manual evals are not subject to this limit.
- Operators can disable auto-eval per agent by setting all `agent_evaluators.is_active = 0` while keeping manual eval available.

---

## 5. tRPC Routes

New router: `apps/web/server/routers/evals.ts`, registered in `_app.ts` as `evals: evalsRouter`.

### 5.1 Evaluator CRUD

```typescript
// List evaluators (optionally filtered by type or agent assignment)
evals.listEvaluators
  input: { type?: EvaluatorType, agentId?: string }
  output: EvaluatorWithAssignment[]  // Evaluator + optional agent_evaluators join data

// Get single evaluator with config
evals.getEvaluator
  input: { id: string }
  output: Evaluator | null

// Create evaluator
evals.createEvaluator
  input: {
    name: string
    description?: string
    type: EvaluatorType        // 'llm_judge' | 'programmatic' | 'statistical' | 'safety' | etc.
    configJson: object         // Type-specific config (see section 2.2)
    judgeModel?: string        // Only for llm_judge type
  }
  output: Evaluator

// Update evaluator
evals.updateEvaluator
  input: {
    id: string
    name?: string
    description?: string
    configJson?: object
    judgeModel?: string
  }
  output: Evaluator

// Delete evaluator (cascades to agent_evaluators and eval_results)
evals.deleteEvaluator
  input: { id: string }
  output: { success: boolean }

// Assign evaluator to agent (creates agent_evaluators row)
evals.assignEvaluatorToAgent
  input: {
    agentId: string
    evaluatorId: string
    weight?: number     // default 1.0 (only meaningful for scorers)
    isActive?: boolean  // default true
    isGate?: boolean    // default false
    sampleRate?: number // optional per-assignment override
  }
  output: AgentEvaluator

// Update agent-evaluator assignment (weight, active, gate, sample rate)
evals.updateAgentEvaluator
  input: {
    id: string          // agent_evaluators.id
    weight?: number
    isActive?: boolean
    isGate?: boolean
    sampleRate?: number | null  // null to clear override
  }
  output: AgentEvaluator

// Remove evaluator from agent
evals.removeEvaluatorFromAgent
  input: { id: string }  // agent_evaluators.id
  output: { success: boolean }

// List evaluator assignments for an agent (with evaluator details and weights)
evals.listAgentEvaluators
  input: { agentId: string }
  output: AgentEvaluatorWithDetails[]  // agent_evaluators row + joined evaluator data + normalized weight %
```

### 5.2 Rubric CRUD (convenience wrappers)

Rubric-specific routes remain as convenience wrappers. Under the hood, creating a rubric and assigning it to an agent creates both a `rubrics` row and an `evaluators` row of type `llm_judge`, then creates an `agent_evaluators` assignment. These routes simplify the common v1 workflow where operators only use LLM judge evaluators.

```typescript
// List rubrics (optionally filtered by agent assignment)
evals.listRubrics
  input: { agentId?: string }
  output: RubricWithAssignment[]  // Rubric + optional agent_evaluators join data (via evaluator)

// Get single rubric with criteria
evals.getRubric
  input: { id: string }
  output: Rubric | null

// Create rubric (also creates an evaluators row of type llm_judge referencing it)
evals.createRubric
  input: {
    name: string
    description?: string
    criteriaJson: RubricCriterion[]
    judgeModel?: string
  }
  output: { rubric: Rubric, evaluator: Evaluator }

// Update rubric (increments version)
evals.updateRubric
  input: {
    id: string
    name?: string
    description?: string
    criteriaJson?: RubricCriterion[]
    judgeModel?: string
  }
  output: Rubric

// Delete rubric (cascades to associated evaluator and agent_evaluators)
evals.deleteRubric
  input: { id: string }
  output: { success: boolean }

// Assign rubric to agent (convenience: creates evaluator if needed, then agent_evaluators)
evals.assignRubricToAgent
  input: {
    agentId: string
    rubricId: string
    weight?: number     // default 1.0
    isActive?: boolean  // default true
    sampleRate?: number // optional per-assignment override
  }
  output: AgentEvaluator

// List built-in rubric templates
evals.listTemplates
  input: {}
  output: RubricTemplate[]

// Create rubric from template and optionally assign to agent
evals.createFromTemplate
  input: { templateId: string, agentId?: string, weight?: number }
  output: { rubric: Rubric, evaluator: Evaluator }  // + AgentEvaluator if agentId provided
```

### 5.3 Eval run operations

```typescript
// Trigger manual eval pipeline for a specific job
evals.runEval
  input: { jobId: string, evaluatorIds?: string[] }  // If evaluatorIds omitted, runs all active evaluators
  output: EvalRun  // Returns created eval_run with status='pending'

// Get eval run result (with per-evaluator breakdown)
evals.getEvalRun
  input: { id: string }
  output: EvalRunWithResults | null  // eval_run + joined eval_results

// List eval runs for an agent (with pagination)
evals.listEvalRuns
  input: {
    agentId: string
    evaluatorId?: string     // Filter by specific evaluator
    status?: string
    gatesPassed?: boolean    // Filter by pipeline gate outcome
    limit?: number
    cursor?: { createdAt: number, id: string }
  }
  output: { runs: EvalRunSummary[], nextCursor: ... | null }

// Get eval run for a specific job (pipeline result with all evaluator results)
evals.getEvalsForJob
  input: { jobId: string }
  output: EvalRunWithResults[]
```

### 5.4 Trend and aggregation queries

```typescript
// Score trend over time for an agent
evals.getScoreTrend
  input: {
    agentId: string
    evaluatorId?: string       // Filter by specific evaluator
    evaluatorType?: string     // Filter by evaluator type
    days?: number              // default 30
    granularity?: 'day' | 'week'  // default 'day'
  }
  output: Array<{
    date: string
    avgScore: number
    evalCount: number
    evaluatorBreakdown: Array<{
      evaluatorId: string
      evaluatorName: string
      evaluatorType: string
      avgScore: number | null     // For scorers
      passRate: number | null     // For gates
    }>
  }>

// Summary stats for an agent's eval performance (aggregated across all evaluators)
evals.getAgentEvalSummary
  input: { agentId: string }
  output: {
    totalEvals: number
    avgOverallScore: number                         // Weighted average across scoring evaluators (see section 8)
    gatePassRate: number                            // % of pipeline runs where all gates passed
    recentTrend: 'improving' | 'declining' | 'stable' | 'insufficient_data'
    evaluatorBreakdown: Array<{                     // Per-evaluator summary
      evaluatorId: string
      evaluatorName: string
      evaluatorType: string
      isGate: boolean
      weight: number
      normalizedWeight: number                      // Percentage (0-1), for scorers only
      avgScore: number | null                       // For scorers
      passRate: number | null                       // For gates
      evalCount: number
    }>
    lowestEvaluator: { name: string, avgScore: number } | null
    highestEvaluator: { name: string, avgScore: number } | null
    lastEvalAt: number | null
    evalCostTotal: number
  }
```

### 5.5 Improvement suggestions

```typescript
// Generate improvement suggestions from recent eval runs
evals.suggestImprovements
  input: {
    agentId: string
    evalRunIds?: string[]  // Specific runs to analyze, or null for recent runs
    maxSuggestions?: number  // default 5
  }
  output: ImprovementSuggestion[]  // Returns the created suggestions

// List suggestions for an agent
evals.listSuggestions
  input: {
    agentId: string
    status?: 'pending' | 'accepted' | 'dismissed' | 'applied'
  }
  output: ImprovementSuggestion[]

// Accept/dismiss/apply a suggestion
evals.updateSuggestionStatus
  input: {
    id: string
    status: 'accepted' | 'dismissed' | 'applied'
  }
  output: ImprovementSuggestion
```

---

## 6. Admin UI Pages

All eval UI lives under the existing admin layout. Uses the established patterns: Tailwind + shadcn/ui components, tRPC hooks for data fetching, Recharts for charts, Tabler icons.

### 6.1 Evaluator list page

**Route:** `/admin/evals`

Accessible from the admin sidebar navigation (new "Evals" item under the existing navigation structure in `AdminNav.tsx`).

**Content:**
- Page header: "Evals" with description "Score agent performance with structured evaluators."
- Table listing all evaluators, columns: Evaluator Name, Type (badge), Assigned Agents, Gate/Scorer, Last Score/Pass Rate, Created.
- Filters: Type dropdown (llm_judge, programmatic, etc.), Agent dropdown (show evaluators assigned to this agent), Active/Inactive toggle.
- "New Rubric" button (primary action for v1, links to the rubric builder). "New Evaluator" button (links to evaluator type picker, for future types).
- Each row links to the evaluator detail/edit page. For `llm_judge` evaluators, this links through to the rubric builder.

**v1 note:** The list page primarily shows LLM judge evaluators since those are the only type with a creation UI. The type column and filter are present for future-proofing but will only show "LLM Judge" in v1.

### 6.2 Rubric builder (create/edit)

**Route:** `/admin/evals/rubrics/new` and `/admin/evals/rubrics/[id]/edit`

**Content:**
- Rubric name and description fields.
- Judge model selector (optional override, dropdown from model catalog).
- Agent assignment section: multi-select of agents to assign this rubric to, with weight input per agent. Can also be done after creation from the agent detail page.
- Template selector: "Start from template" with a dropdown of built-in templates. Selecting a template populates the criteria section.
- **Criteria builder:** Dynamic list of criterion cards. Each card has:
  - Name (text input)
  - Description (textarea)
  - Weight (number input, 1-10)
  - Scale descriptors: 5 text inputs for levels 1 through 5
  - Remove button
- "Add Criterion" button at the bottom.
- Drag-to-reorder criteria (optional, can defer).
- Save button. On save: create/update rubric, increment version.
- Weight normalization display: show the normalized percentage next to each weight (e.g., "3 (33.3%)").

### 6.3 Eval dashboard

**Route:** `/admin/evals/dashboard`

Global eval dashboard showing aggregate performance across all agents.

**Content:**
- Summary cards row: Total Evals (all time), Avg Score (30d), Eval Cost (30d), Agents with Rubrics.
- Agent score comparison chart: horizontal bar chart showing each agent's average overall score (30d).
- Score trend chart (line chart, 30d): one line per agent showing overall score over time.
- Recent eval runs table: Agent, Work Item, Score, Status, Trigger, Date. Links to eval detail.

### 6.4 Agent detail eval section

**Location:** New section component on the existing agent detail page (`/admin/agents/[id]`), placed in position 11 of the canonical agent detail page section order:

1. Identity
2. Soul / Personality
3. Model Configuration
4. Skills (WS3)
5. Memory
6. Session
7. Network Policy
8. Triage
9. Capabilities / Plugins
10. Cost Limits
11. **Eval Performance (WS4)**

**Component:** `EvalSection.tsx` (in `apps/web/app/admin/agents/[id]/`)

**Content:**
- Section header: "Eval Performance" with icon.
- If no evaluators assigned: empty state with "Assign a rubric to start scoring this agent's work." and an "Assign Rubric" button (opens a picker of existing rubrics or links to the rubric builder).
- If evaluators assigned:
  - **Evaluator assignments table:** Lists each assigned evaluator with its type badge, gate/scorer role, weight (absolute + normalized %, for scorers), active status toggle, sample rate, and average score or pass rate. Inline controls to adjust weight, toggle active, toggle gate/scorer, or remove the assignment. "Assign Rubric" button to add more LLM judge evaluators.
  - **Score overview card:** Overall agent score (weighted average across scoring evaluators, large number), gate pass rate badge, trend indicator (up/down arrow with delta), total eval count, eval cost.
  - **Score trend chart** (line chart, 30d): overall agent score over time with per-evaluator breakdown available on hover.
  - **Per-evaluator breakdown:** Horizontal bar chart showing average score per scoring evaluator (weighted). For gate evaluators, shows pass rate bars. Click into an LLM judge evaluator to see its per-criterion breakdown.
  - **Action buttons row:**
    - "Run Evaluation" -- opens a modal to select a recent completed job, then triggers a manual eval pipeline. Shows the pending/running/completed state with a progress indicator.
    - "Suggest Improvements" -- triggers `evals.suggestImprovements`, shows suggestions in a list below.
  - **Recent eval runs table:** Pipeline Status (passed/failed), Score, Work Item Title, Source, Trigger, Date. Expandable rows showing per-evaluator results: gate pass/fail badges, scorer scores with reasoning. For LLM judge results, further expandable to per-criterion scores.
  - **Improvement suggestions section:** List of pending suggestions with Accept/Dismiss buttons. Each suggestion shows category badge, title, description, and priority.

**v1 note:** Since v1 only ships the LLM judge evaluator type, the evaluator assignments table will primarily show rubric-based evaluators. The UI labels can use "Rubrics" as the primary noun for v1, with the evaluator abstraction visible in the type badge column. The gate/scorer toggle exists but operators will not use gates until Phase 2 evaluator types ship.

### 6.5 Eval run detail page

**Route:** `/admin/evals/runs/[id]`

Linked from eval run tables. Shows the full detail of a single pipeline evaluation.

**Content:**
- Header: Work item title, agent name, eval date, overall score, pipeline status badge (PASSED/FAILED).
- **Pipeline overview:** Ordered list of evaluator results in the pipeline. Gates shown first with pass/fail badges. Scorers shown second with scores and weights. Visual separator between gates and scorers.
- Two-column detail layout (for the selected evaluator result):
  - **Left column:** For LLM judge: per-criterion scores with reasoning. Each criterion shows: name, score (1-5 with visual bar), weight, judge's reasoning text. For programmatic: assertion list with pass/fail. For statistical: metric values with threshold visualization.
  - **Right column:** Metadata card (evaluator type, judge model if applicable, cost, duration, token counts), evaluator config snapshot, work item summary, link to full run detail/timeline.
- "Re-run Evaluation" button (triggers a new pipeline eval on the same job).

---

## 7. Agent Runtime Integration

### 7.1 Post-run eval hook

The eval hook integrates at the run-dispatch-worker level, not inside the agent runner itself. This keeps the agent runtime clean and ensures eval logic is a platform concern, not an agent concern.

**File:** `apps/web/server/services/eval-worker.ts` (new)

The eval worker is a tick-based background loop (same pattern as `run-dispatch-worker.ts` and `effect-outbox-worker.ts`):

```
start() -> setInterval(tick, EVAL_TICK_MS)

tick():
  1. Claim a pending eval_run (lease-based, same as run_dispatches)
  2. Load context:
     a. Job details (from jobs table)
     b. Work item details (from work_items table)
     c. Message transcript (from messages table, for this job only)
     d. Agent config (model, soul, etc.)
     e. Inference call summary (from inference_calls table: total tokens, cost, call count)
     f. Span summary (from spans table: duration, tool count, error count)
  3. Load agent's active evaluators (from agent_evaluators, gates first, then scorers)
  4. Phase 1 - Gates:
     For each gate evaluator (is_gate = 1):
       a. Check per-evaluator sample rate -> skip if not sampled
       b. Run evaluator (dispatch to type-specific handler)
       c. Store eval_result row
       d. If gate fails: mark eval_run as gates_passed = 0, skip Phase 2, jump to step 6
  5. Phase 2 - Scorers:
     For each scoring evaluator (is_gate = 0):
       a. Check per-evaluator sample rate -> skip if not sampled
       b. Run evaluator (dispatch to type-specific handler)
       c. Store eval_result row
  6. Compose overall score (weighted average of scoring evaluator results)
  7. Update eval_run with overall_score, gates_passed, pipeline_result_json,
     total_cost_usd, and status = 'completed' (or 'failed' on error)
```

**v1 note:** With only the `llm_judge` type implemented, the type-specific handler dispatch in step 4b/5b routes to the LLM judge handler (which builds the judge prompt, calls the model, and parses the response). The dispatch mechanism should be a simple switch on `evaluator.type` so adding new handlers for `programmatic`, `statistical`, etc. is additive.

### 7.2 Context assembly

The eval context builder assembles all data the judge needs to score the run. Each piece maps to an existing database query:

| Data | Source | Query |
|------|--------|-------|
| Work item metadata | `work_items` | `findWorkItemById(workItemId)` |
| Job metadata | `jobs` | `findJobById(jobId)` |
| Agent config | `agents` | `findAgentById(agentId)` then `parseAgentConfig` |
| Message transcript | `messages` | `listMessagesByJob(jobId)` |
| Inference summary | `inference_calls` | `listByJob(jobId)` aggregated |
| Span summary | `spans` | `getJobSpanSummary(jobId)` |
| Activity log entry | `activity_log` | `findActivityByJobId(jobId)` |

**Transcript formatting for the judge:**

Messages are formatted as a simplified conversation transcript. Tool calls are summarized (tool name + brief result), not shown in full. Assistant reasoning is included. The total transcript is truncated to a configurable maximum (default: 8000 tokens) to control eval cost.

```
[User] How do I fix the CI failure on PR #42?

[Assistant] Let me check the CI logs for PR #42.
  [Tool: bash] Ran `gh pr checks 42` -> found 1 failing check: "lint"
  [Tool: bash] Ran `gh pr view 42 --json files` -> 3 changed files

[Assistant] The CI failure is a lint error in `src/utils.ts` on line 47. You have a
missing semicolon. Here's the fix: ...

[User] Thanks, that worked!

[Assistant] Happy to help. The PR should pass CI now after that fix.
```

### 7.3 Enqueue function

Called from `run-dispatch-worker.ts` after `finalizeRunDispatch`. Enqueues a single pipeline eval run (not one per evaluator -- the pipeline runner handles individual evaluators):

```typescript
async function maybeEnqueueEvalPipeline(jobId: string, agentId: string, workItemId: string): Promise<void> {
  // 1. Check if agent has any active evaluators
  const assignments = await findActiveEvaluatorsForAgent(agentId)  // agent_evaluators JOIN evaluators
  if (assignments.length === 0) return

  // 2. Check daily eval limit
  const settings = await getEvalSettings()
  const todayCount = await countEvalRunsForAgentToday(agentId)
  if (todayCount >= settings.max_daily_evals) return

  // 3. Check if this job was a triage-pass (no substantive work)
  const job = await findJobById(jobId)
  if (!job || job.status !== 'COMPLETED') return
  const activity = await findActivityByJobId(jobId)
  if (activity?.status === 'passed') return

  // 4. Apply pipeline-level sampling
  const todayRunCount = await countCompletedRunsForAgentToday(agentId)
  const effectiveSampleRate = todayRunCount < settings.sample_rate_high_volume_threshold
    ? settings.sample_rate_default
    : settings.sample_rate_high_volume
  if (Math.random() >= effectiveSampleRate) return

  // 5. Enqueue a single pipeline eval run
  // The eval worker will load the agent's active evaluators and run them.
  await createEvalRun({
    job_id: jobId,
    agent_id: agentId,
    work_item_id: workItemId,
    trigger: 'auto',
    status: 'pending',
  })
}
```

**Key difference from the earlier rubric-per-run model:** The enqueue function creates one `eval_runs` row per job, not one per evaluator. The eval worker (section 7.1) handles running each evaluator in the pipeline and creating `eval_results` rows. This simplifies enqueue logic and ensures the pipeline runs atomically.

---

## 8. Scoring Model (Pipeline Aggregation)

The scoring model has two layers: per-evaluator scoring and pipeline-level aggregation. Gates produce pass/fail results. Scorers produce numeric scores. The pipeline combines them.

### 8.1 Pipeline execution: gates then scorers

The eval pipeline runs in two phases:

1. **Gates first.** All evaluators with `is_gate = 1` run in order. Each must pass. If any gate fails, the pipeline is marked as `gates_passed = 0`, scoring evaluators are skipped, and `overall_score` is null.

2. **Scorers second.** All evaluators with `is_gate = 0` run after gates pass. Each produces a numeric score. The scores are aggregated into `overall_score`.

This separation means hard requirements (safety, format validation) are never outweighed by quality scores. A run that leaks PII is failed, period, regardless of how helpful the response was.

### 8.2 Per-evaluator scoring

Each evaluator type produces results differently:

**LLM judge (v1).** Each criterion receives an integer score from 1 to 5. The judge model is instructed to use the scale descriptors as anchors and to output exactly one integer per criterion. The per-rubric score is a weighted average of criteria:

```
rubric_score = sum(criterion_score * criterion_weight) / sum(criterion_weight)
```

Example with the rubric from section 3.3:

| Criterion | Weight | Score | Weighted |
|-----------|--------|-------|----------|
| Accuracy | 3 | 4 | 12 |
| Helpfulness | 3 | 5 | 15 |
| Tone | 2 | 4 | 8 |
| Efficiency | 1 | 3 | 3 |
| **Total** | **9** | | **38** |

`rubric_score = 38 / 9 = 4.22`

The rubric score is normalized to 0-1 for cross-evaluator comparability: `normalized = (rubric_score - 1) / 4 = 0.805`. Both the raw 1-5 score and the normalized 0-1 score are stored: raw in `eval_results.details_json`, normalized in `eval_results.score`.

**Programmatic (future).** Pass/fail. Score is 1.0 (pass) or 0.0 (fail). Stored in `eval_results.passed` and `eval_results.score`.

**Statistical (future).** Numeric metric value compared against optional thresholds. If within thresholds, score is 1.0. If outside, score is 0.0 or a degraded value based on distance from threshold.

**Safety (future).** Composite pass/fail from individual checks. All checks must pass for the evaluator to pass.

### 8.3 Pipeline-level aggregation (overall score)

The `overall_score` on `eval_runs` is the weighted average across all **scoring** evaluators (non-gate), using weights from `agent_evaluators.weight`:

```
overall_score = sum(evaluator_score * agent_evaluators_weight) / sum(agent_evaluators_weight)
```

Where `evaluator_score` is the normalized 0-1 score from `eval_results.score`.

Example: an agent with one gate and two scoring evaluators:

| Evaluator | Type | Role | Weight | Score | |
|-----------|------|------|--------|-------|-|
| PII Check | safety | gate | -- | PASS | (does not contribute to overall_score) |
| Code Quality Judge | llm_judge | scorer | 3 (60%) | 0.805 | 2.415 |
| Accuracy Judge | llm_judge | scorer | 2 (40%) | 0.90 | 1.80 |
| **Total** | | | **5** | | **4.215** |

`overall_score = 4.215 / 5 = 0.843`

If the PII Check gate had failed, `overall_score` would be null and `gates_passed` would be 0.

**v1 note:** With only LLM judge evaluators, the overall score is the weighted average across rubric scores. If only one evaluator is assigned (the common v1 case), the overall score equals that evaluator's score.

### 8.4 Trend calculation

Trends are calculated as moving averages over configurable time windows:

- **Daily granularity (default for 30d view):** Average `overall_score` across all eval runs per day, filtered to runs where `gates_passed = 1`.
- **Weekly granularity (for 90d view):** Average `overall_score` across all eval runs per calendar week.
- **Trend direction:** Compare the average of the most recent 7 days to the average of the 7 days before that.
  - `improving`: recent > previous by more than 0.02 (on 0-1 scale)
  - `declining`: recent < previous by more than 0.02
  - `stable`: difference is within 0.02
  - `insufficient_data`: fewer than 3 eval runs in either window

SQL pattern for daily trend (mirrors the existing `getDailyTrend` in `inference-calls.ts`):

```sql
SELECT
  date(created_at, 'unixepoch') AS date,
  avg(overall_score) AS avg_score,
  count(*) AS eval_count
FROM eval_runs
WHERE agent_id = ?
  AND status = 'completed'
  AND gates_passed = 1
  AND created_at >= ?
GROUP BY date(created_at, 'unixepoch')
ORDER BY date ASC
```

Gate pass rate trend uses the same pattern but counts `gates_passed = 1` vs total.

### 8.5 Per-evaluator trend

For the per-evaluator breakdown chart, trends are computed from `eval_results` joined to `eval_runs`:

```sql
SELECT
  date(er.created_at, 'unixepoch') AS date,
  er.evaluator_id,
  avg(er.score) AS avg_score,
  count(*) AS eval_count
FROM eval_results er
JOIN eval_runs run ON er.eval_run_id = run.id
WHERE run.agent_id = ?
  AND run.status = 'completed'
  AND er.created_at >= ?
GROUP BY date(er.created_at, 'unixepoch'), er.evaluator_id
ORDER BY date ASC
```

For LLM judge evaluators, the per-criterion breakdown is extracted from `eval_results.details_json` in application code (same approach as before -- parse the JSON criteria scores and compute per-criterion averages).

---

## 9. Open Questions

### Resolved

The following questions have been decided and are reflected in the spec above:

- **Q9 (Judge model default):** Resolved. Configurable per evaluator via `evaluators.judge_model`, per rubric via `rubrics.judge_model`, with system-level default in `eval_settings.judge_model`, and a hardcoded fallback that avoids self-assessment bias. See section 4.3.
- **Q10 (Eval cost attribution):** Resolved. Eval costs are tracked separately and do NOT count against agent cost limits. Evals are a platform concern. Per-evaluator costs stored on `eval_results.cost_usd`, aggregated to `eval_runs.total_cost_usd`. See section 4.5.
- **Q11 (Auto-eval sampling):** Resolved. Pipeline-level adaptive sampling: 100% when under 20 runs/day, 20% above. Per-evaluator overrides via `agent_evaluators.sample_rate`. System-level config in `eval_settings`. See section 4.5.
- **Q16 (Eval settings storage):** Resolved. New `eval_settings` singleton table (NOT `capability_settings`). See section 2.7.
- **Q17 (Evaluator architecture):** Resolved. Typed evaluator pipeline with gates + scoring composition. Schema supports multiple evaluator types from day one; v1 ships LLM judge only. See sections 2.2-2.5 and the companion document `WS4_EVAL_ALTERNATIVES.md` for the full analysis.

### Still open

#### 9.1 Improvement suggestion scope

**Question:** When "Suggest Improvements" is triggered, should it:
- **A)** Analyze only the eval runs the operator selected.
- **B)** Automatically pull the last N eval runs (e.g., 20) and synthesize patterns.
- **C)** Both -- default to recent runs, but allow selecting specific runs.

**Recommendation:** Option C. The tRPC route already supports both via the optional `evalRunIds` parameter.

#### 9.2 Auto-eval opt-in vs. opt-out

**Question:** When an operator assigns an evaluator to an agent and marks it active, should auto-eval be:
- **A)** Enabled by default (eval every completed run, subject to sampling).
- **B)** Disabled by default (operator must explicitly enable auto-eval, otherwise only manual evals).

**Recommendation:** Option A. Active assignment means the operator wants eval data. Sampling controls keep costs manageable without requiring a separate opt-in.

### Deferred to post-v1

- **Q13 (Multi-agent eval comparison):** Defer. V1 shows per-agent trends and the global comparison bar chart. Explicit side-by-side A/B comparison of two agents on the same rubric can come in a follow-up.
- **Q14 (Eval retention):** Keep eval runs indefinitely for v1. They are receipts. If storage becomes a concern, add configurable retention policies later (same approach as `inference_calls` today -- no purge yet).
- **Q15 (Rubric versioning):** No re-scoring on rubric edits. Each eval result snapshots the evaluator config it was scored against (`evaluator_config_snapshot_json` on `eval_results`). Old scores remain valid for the config version they used. Trend charts should note config version boundaries with a visual marker. Operators who want fresh scores under a new rubric version can manually re-run evals.

---

## 10. Migration Plan

### 10.1 Migration file

Single migration file: `packages/database/migrations/2026MMDD_000000_eval_system.ts`

Creates seven tables (`rubrics`, `evaluators`, `agent_evaluators`, `eval_runs`, `eval_results`, `improvement_suggestions`, `eval_settings`) with all indexes and seeds the `eval_settings` singleton row. Follows the existing pattern of `createTable(...).ifNotExists()` and `createIndex(...).ifNotExists()`.

### 10.2 Type definitions

Add to `packages/database/src/types.ts`:

- `RubricTable`, `Rubric`, `NewRubric`, `RubricUpdate`
- `EvaluatorTable`, `Evaluator`, `NewEvaluator`, `EvaluatorUpdate`
- `AgentEvaluatorTable`, `AgentEvaluator`, `NewAgentEvaluator`, `AgentEvaluatorUpdate`
- `EvalRunTable`, `EvalRun`, `NewEvalRun`, `EvalRunUpdate`
- `EvalResultTable`, `EvalResult`, `NewEvalResult`
- `ImprovementSuggestionTable`, `ImprovementSuggestion`, `NewImprovementSuggestion`, `ImprovementSuggestionUpdate`
- `EvalSettingsTable`, `EvalSettings`, `EvalSettingsUpdate`

Add to `Database` interface: `rubrics`, `evaluators`, `agent_evaluators`, `eval_runs`, `eval_results`, `improvement_suggestions`, `eval_settings`.

### 10.3 Repository module

New file: `packages/database/src/repositories/evals.ts`

Export from `packages/database/src/repositories/index.ts`.

The repository should include functions for:
- Rubric CRUD (create, read, update, delete, list)
- Evaluator CRUD (create, read, update, delete, list, list by type)
- Agent-evaluator assignment management (assign, update, remove, list active for agent)
- Eval run management (create, claim pending, update status, list by agent/job)
- Eval result management (create, list by eval run)
- Eval settings singleton access

### 10.4 Implementation order

1. **Schema + types + repository** -- database layer, no UI. Includes `rubrics`, `evaluators`, `agent_evaluators`, `eval_runs`, `eval_results`, `improvement_suggestions`, `eval_settings`.
2. **tRPC routes** -- evaluator CRUD, rubric CRUD (convenience wrappers), eval run queries.
3. **Rubric builder UI** -- admin page for creating/editing rubrics. Creating a rubric also creates the associated `evaluators` row.
4. **Eval worker + pipeline runner** -- background eval execution engine with gate/scorer phases.
5. **Agent detail eval section** -- evaluator assignments, score display, and manual eval trigger.
6. **Eval dashboard** -- global view with gate pass rate.
7. **Improvement suggestions** -- AI-generated suggestions feature.

Each step is independently deployable and testable. Steps 1-4 are the backend foundation. Steps 5-7 are the admin UI.

---

## 11. Receipts Mapping

Every eval system feature produces or extends a receipt:

| Feature | Receipt | Where to verify |
|---------|---------|-----------------|
| Rubric created/edited | `rubrics` row with version history | Admin > Evals > Rubrics |
| Evaluator created | `evaluators` row with type and config | Admin > Evals > Evaluators |
| Evaluator assigned to agent | `agent_evaluators` row with weight, gate/scorer role | Admin > Agents > [agent] > Eval section |
| Pipeline eval completed | `eval_runs` row with overall score, gate status, total cost | Admin > Agents > [agent] > Eval section |
| Per-evaluator result | `eval_results` row with score, pass/fail, reasoning, config snapshot, cost | Admin > Evals > Runs > [id] |
| Judge model call | `inference_calls` row + `eval_results.cost_usd` | Admin > Costs, Eval run detail |
| Gate failure | `eval_runs.gates_passed = 0` + `eval_results.passed = 0` on the failing gate | Admin > Evals > Runs > [id] |
| Evaluator config at eval time | `eval_results.evaluator_config_snapshot_json` | Eval run detail > Per-evaluator view |
| Improvement suggestion | `improvement_suggestions` row with source eval IDs | Admin > Agents > [agent] > Improvements |
| Suggestion accepted/dismissed | Status change with timestamp and user ID | Admin > Agents > [agent] > Improvements |
| Score trend | Aggregated from `eval_runs.overall_score` | Admin > Evals > Dashboard, Agent detail |
| Gate pass rate trend | Aggregated from `eval_runs.gates_passed` | Admin > Evals > Dashboard, Agent detail |
| Eval cost | `eval_results.cost_usd` (per evaluator) + `eval_runs.total_cost_usd` (pipeline total) | Admin > Costs |

---

## 12. Non-Goals for V1

1. **Agent self-improvement loop.** V1 generates suggestions for human review. Automatic prompt/config changes based on eval scores are explicitly out of scope.
2. **User-facing eval scores.** Eval results are admin-only. Agents do not see their own scores (no eval data in the agent's context window).
3. **Custom scoring scales.** V1 uses 1-5 for all LLM judge criteria. Custom scale ranges (e.g., 1-10, pass/fail) can come later. (Note: the evaluator pipeline supports pass/fail natively via gates, but the LLM judge rubric format is fixed at 1-5.)
4. **Multi-judge consensus.** V1 uses a single judge model per eval. Running multiple judges and averaging is a future enhancement.
5. **Eval on streaming/partial responses.** V1 evaluates completed jobs only.
6. **Public API for evals.** V1 is admin UI only. An API for external eval pipelines can come later.
7. **Non-LLM-judge evaluator execution.** The schema supports `programmatic`, `statistical`, `safety`, `human_feedback`, `task_completion`, and `custom` evaluator types. V1 only ships the execution logic for `llm_judge`. The other types are defined in the schema and type system so they can be implemented incrementally in later phases without migration.
8. **Confidence-weighted aggregation.** V1 uses simple weighted average for scorer composition. Confidence-weighted aggregation (where evaluator reliability affects its contribution) is a future enhancement requiring human feedback calibration data.
