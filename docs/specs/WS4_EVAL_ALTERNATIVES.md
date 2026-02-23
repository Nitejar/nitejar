# WS4: Eval Architecture Alternatives

Status: Research document for review
Audience: Core engineering, product
Last updated: 2026-02-20

---

## 0. Context

The current WS4 spec (`WS4_EVAL_RUBRIC_SYSTEM.md`) defines a single-judge eval model: after an agent run completes, one LLM judge scores the run against a rubric of weighted criteria on a 1-5 scale. This works and ships fast. But it leaves value on the table:

- **Not everything needs an LLM to evaluate.** "Did the agent respond in under 10 seconds?" is a timer, not a judgment call. "Did the agent actually create the PR?" is a boolean check on the GitHub API, not a subjective assessment.
- **Single-judge is a single point of failure for accuracy.** If the judge model is weak on code review, every code-quality score is miscalibrated. There is no cross-check.
- **Operators want different types of confidence.** A safety check that passes 100% of the time is different from a tone score of 4.2/5.0. Conflating them into one weighted average obscures both.
- **The industry has moved past single-judge.** Braintrust, promptfoo, DeepEval, LangSmith, and Arize Phoenix all support composable evaluation pipelines where multiple evaluator types combine into an overall quality signal. The pattern is well-established.

This document surveys the landscape, proposes a taxonomy of evaluator types, compares architectural options, and recommends a path for Nitejar that starts simple and grows into a composable eval pipeline.

---

## 1. Architecture Options

Four distinct approaches, ranging from what we have now to a full composable pipeline.

### 1.1 Single LLM Judge (Current Spec)

**Description.** After a run completes, one LLM model scores the run against a rubric of weighted criteria. The rubric defines dimensions (Accuracy, Helpfulness, Tone, etc.) with 1-5 scale descriptors. The judge model reads the conversation transcript and produces per-criterion scores with reasoning. The weighted average is the overall score.

**Pros.**
- Simple to build. One prompt template, one model call, one result row.
- Easy for operators to understand. "The judge read the conversation and scored it."
- Good enough for subjective quality dimensions that genuinely require language understanding.
- Low operational cost per eval (one inference call).

**Cons.**
- Conflates objective and subjective evaluation. "Did the agent respond within 5 seconds?" does not need an LLM. "Did the agent create the file it said it would?" is a boolean check, not a judgment call.
- Single model bias. The judge has blind spots. If it consistently over-scores helpfulness or under-scores code correctness, there is no cross-check.
- Expensive for things that could be free. Checking whether a JSON response is valid schema costs tokens when it should cost zero.
- No composability. Adding a new evaluator type (safety check, human feedback, programmatic assertion) requires rethinking the scoring model.
- Cannot gate on hard requirements. "Safety must pass before quality is scored" is not expressible -- everything is a weighted criterion in the same rubric.

**Complexity.** Low. Already designed. 1-2 weeks to implement.

**Nitejar example.** Agent completes a GitHub PR review. Judge model reads the transcript, scores Accuracy: 4, Thoroughness: 3, Actionability: 5, Tone: 4. Overall: 3.89/5.0. Stored as one `eval_runs` row.

---

### 1.2 Multi-Judge Panel

**Description.** Same rubric-based approach, but multiple LLM judges score the same run independently. Scores are aggregated (average, median, or majority vote). Optionally, judges can use different models (e.g., GPT-4o + Claude Haiku + Gemini) to reduce model-specific bias.

**Pros.**
- Reduces single-model bias. If GPT-4o and Claude disagree on a score, the divergence itself is a signal.
- Confidence estimation. Agreement between judges indicates reliability. Disagreement flags runs worth human review.
- Still uses the same rubric format operators already understand.

**Cons.**
- 2-3x the inference cost per eval. For agents running 50+ jobs/day, this adds up fast.
- More complex aggregation logic. Average? Median? Weighted by model capability? Drop outliers?
- Diminishing returns. Research shows 2 judges capture most of the benefit; 3+ adds cost faster than accuracy.
- Still limited to LLM-based evaluation. Does not solve the "checking a boolean with a language model" problem.
- Slower. Multiple sequential or parallel API calls per eval run.

**Complexity.** Medium. Extends the current spec with multi-call orchestration and aggregation. 2-3 weeks additional work.

**Nitejar example.** Same PR review. GPT-4o-mini scores Accuracy: 4, Claude Haiku scores Accuracy: 3. Average: 3.5. Disagreement flag on Accuracy criterion. Operator sees "judges disagreed on accuracy -- review recommended" in the eval detail.

---

### 1.3 Typed Evaluator Pipeline

**Description.** Instead of one judge scoring everything, the system supports multiple evaluator types, each purpose-built for what it measures. An eval pipeline for an agent is a list of evaluators that run after each job. Each evaluator produces a typed result (numeric score, pass/fail, count, duration). Results are composed into an overall quality signal using configurable aggregation.

Evaluator types include:
- **LLM judge** -- subjective quality assessment (current approach, but scoped to what it is good at).
- **Programmatic** -- code-based assertions (regex match, JSON schema validation, output contains expected string).
- **Statistical** -- computed from run metadata (response time, token count, tool call count, cost).
- **Task completion** -- did the agent accomplish the stated goal? (can be LLM-judged or programmatic).
- **Safety/compliance** -- automated checks (PII detection, toxicity scoring, policy compliance).
- **Reference comparison** -- diff output against a gold-standard expected answer.

Each evaluator is a function: `(run_context) -> EvalResult`. The pipeline runs all evaluators, collects results, and composes them according to operator-defined rules (weighted average, pass/fail gates, hierarchical categories).

**Pros.**
- Right tool for the right job. Objective checks are fast, free, and deterministic. LLM judges handle the subjective parts.
- Composable. Operators can mix evaluator types per agent, per use case.
- Extensible. Adding a new evaluator type (e.g., human feedback) does not require changing the scoring model -- it is just another evaluator that produces an `EvalResult`.
- Supports gating. "Safety evaluators must all pass before quality scores are calculated." This is not possible with a single weighted rubric.
- Cost-efficient. Programmatic and statistical evaluators cost zero inference tokens.
- Aligns with industry standard. This is how Braintrust, promptfoo, LangSmith, and DeepEval work.

**Cons.**
- More complex to build. The evaluator abstraction, pipeline runner, and composition logic are real engineering work.
- More complex to configure. Operators need to understand evaluator types and composition rules, not just "fill out a rubric."
- UI surface area grows. Need to show heterogeneous result types (scores, pass/fail, counts) coherently.
- Risk of over-engineering. Most operators will start with 1-2 evaluator types. The full pipeline is power-user territory.

**Complexity.** Medium-high. 4-6 weeks for the full pipeline with 3-4 evaluator types. But the architecture can be built incrementally -- start with LLM judge, add programmatic evaluators, then statistical, etc.

**Nitejar example.** Agent completes a GitHub PR review. Eval pipeline runs:
1. **Statistical evaluator:** Response time = 4.2s (pass, under 30s threshold). Tool calls = 3 (logged). Cost = $0.012 (logged).
2. **Programmatic evaluator:** Output contains code block = true (pass). Output is not empty = true (pass).
3. **Safety evaluator:** PII check = pass. No secrets in output = pass.
4. **LLM judge evaluator:** Accuracy: 4/5, Thoroughness: 3/5, Actionability: 5/5. Rubric score: 4.0/5.0.

Composition: Safety gate passed. Overall quality score: 4.0/5.0 (from LLM judge, since programmatic checks were pass/fail and don't contribute to the numeric score). Statistical data logged as metadata. The receipt shows all four evaluator results with their individual reasoning.

---

### 1.4 Full Eval Platform (Composable + Human-in-the-Loop + Datasets)

**Description.** The typed evaluator pipeline (1.3) plus:
- **Human feedback loop.** Operators can rate runs (thumbs up/down, star rating, free-text annotation). Human ratings feed back into calibration: the system learns which LLM judge scores correlate with human preferences.
- **Dataset-driven evals.** Operators curate test datasets (input/expected-output pairs). The system can replay runs against datasets and score against expected outputs.
- **A/B comparison.** Run two agent configurations against the same inputs and compare eval results.
- **Eval versioning and regression detection.** Track eval pipeline versions, detect when scores regress after configuration changes.
- **Inter-rater reliability.** Compare human ratings to LLM judge scores to measure and improve judge accuracy over time.

**Pros.**
- Full evaluation platform. Comparable to Braintrust or LangSmith's eval capabilities.
- Human feedback closes the loop. Automated evals get calibrated against real human judgment.
- Dataset-driven testing enables regression detection and CI-style quality gates.
- A/B comparison answers "is this prompt change actually better?"

**Cons.**
- Massive scope. This is a product in itself, not a feature.
- Most operators do not need this yet. Premature investment.
- Human feedback requires engagement. If operators do not rate runs, the feedback loop is empty.
- Dataset curation is labor-intensive and domain-specific.

**Complexity.** Very high. 3-6 months for a meaningful implementation. This is a future vision, not a V1 target.

**Nitejar example.** Same PR review, but now: an operator rates the run 4/5 stars with a note "missed the race condition." The system notices the LLM judge scored Thoroughness 3/5, which aligns. Over 50 human-rated runs, the system calculates that the LLM judge's Thoroughness scores correlate 0.78 with human ratings. The operator also has a dataset of 20 "known-good PR reviews" that the agent is tested against weekly, with scores tracked over time.

---

## 2. Evaluator Types Taxonomy

A complete taxonomy of evaluator types that could exist in a composable pipeline. Not all need to ship in V1 -- this is the design space.

### 2.1 LLM Judge

**What it measures.** Subjective quality dimensions: accuracy, helpfulness, tone, creativity, thoroughness, empathy. Anything that requires language understanding and judgment.

**How it works.** An LLM model reads the run context (transcript, metadata) and scores against a rubric with criteria and scale descriptors. Produces per-criterion numeric scores (1-5) with reasoning.

**When to use it.** For open-ended quality assessment where the "right answer" is not deterministic. Tone evaluation, helpfulness scoring, accuracy assessment for free-form responses.

**When NOT to use it.** For checks that have a deterministic answer (JSON validity, regex match, response time). For binary safety checks where false negatives are unacceptable (PII detection should use dedicated tools, not an LLM).

**Complexity to implement.** Already designed in current spec. 1-2 weeks.

**Cost per eval.** ~$0.001-$0.05 depending on model and context size.

**Result type.** `{ type: 'score', value: number, scale: [1, 5], reasoning: string, criteria: CriterionScore[] }`

---

### 2.2 Programmatic Evaluator

**What it measures.** Deterministic, code-defined assertions about the output. Examples:
- Output contains expected substring.
- Output matches a regex pattern.
- Output is valid JSON / valid JSON matching a specific schema.
- Output is non-empty.
- Output length is within bounds.
- Agent called a specific tool.
- Agent did not call a forbidden tool.
- Output contains a code block.
- Output contains a URL.

**How it works.** A JavaScript/TypeScript function receives the run context and returns pass/fail with an optional score and message. No inference call. Runs in milliseconds.

**When to use it.** For structural validation, format checks, and any assertion with a deterministic correct answer. For checking tool usage patterns. For enforcing output contracts ("the agent must always include a summary section").

**When NOT to use it.** For subjective quality. "Is this response helpful?" cannot be answered with a regex.

**Complexity to implement.** Low. Define an evaluator interface, implement a small library of built-in assertion types, allow custom functions. 1-2 weeks.

**Cost per eval.** Zero. No inference calls.

**Result type.** `{ type: 'pass_fail', passed: boolean, message: string }`

---

### 2.3 Statistical Evaluator

**What it measures.** Numeric properties computed from run metadata, not from the output content. Examples:
- Response time (ms from request to final response).
- Total token count (input + output).
- Number of tool calls.
- Number of inference calls.
- Total cost (USD).
- Number of error/retry spans.
- Conversation turn count.
- Context window utilization percentage.

**How it works.** Queries the existing Nitejar data tables (`inference_calls`, `spans`, `jobs`, `messages`) and computes metrics. No inference call. These are facts about the run, not judgments.

**When to use it.** For efficiency tracking, cost monitoring, performance regression detection. For setting thresholds ("alert if response time exceeds 30 seconds" or "flag if an agent uses more than 10 tool calls for a simple question").

**When NOT to use it.** As a proxy for quality. Fast + cheap does not mean good. Use alongside quality evaluators, not instead of them.

**Complexity to implement.** Low. The data already exists in Nitejar's database. This is query logic + threshold comparison. 1 week.

**Cost per eval.** Zero. Database queries only.

**Result type.** `{ type: 'metric', name: string, value: number, unit: string, threshold?: { min?: number, max?: number }, passed?: boolean }`

---

### 2.4 Human Feedback Evaluator

**What it measures.** Direct human judgment of run quality. Can be:
- Thumbs up / thumbs down (binary).
- Star rating (1-5).
- Category-specific ratings (accuracy, helpfulness, tone).
- Free-text annotation.

**How it works.** The admin UI provides a rating interface on eval run detail pages and the agent detail timeline. Operators rate runs at their convenience. Ratings are stored and incorporated into the agent's quality metrics. Optionally, human ratings calibrate LLM judge scores over time.

**When to use it.** For ground-truth quality assessment. For calibrating automated evaluators. For high-stakes decisions where automated scoring is insufficient.

**When NOT to use it.** As the sole evaluation method (humans do not scale). For real-time scoring (too slow). For low-stakes, high-volume runs where automated evals are good enough.

**Complexity to implement.** Medium. UI components for rating, storage schema, aggregation logic, optional calibration pipeline. 2-3 weeks for basic; calibration is a longer-term investment.

**Cost per eval.** Zero compute cost, but high human-time cost.

**Result type.** `{ type: 'human_rating', rating: number, scale: [1, 5], annotation?: string, rater_id: string }`

---

### 2.5 Reference Comparison Evaluator

**What it measures.** How closely the agent's output matches a known-good reference output. Uses:
- Exact match (for structured outputs).
- Fuzzy match / edit distance (for text).
- Semantic similarity (embedding cosine distance).
- Structural diff (for code, JSON, etc.).

**How it works.** The operator provides reference outputs for specific inputs (a "golden dataset"). When the agent processes a matching input, the evaluator compares the actual output to the reference. Similarity scores are computed using embeddings or string distance algorithms.

**When to use it.** For regression testing ("the agent should produce roughly this output for this input"). For structured output validation where the expected format is known. For code generation tasks with known-correct solutions.

**When NOT to use it.** For open-ended conversations where multiple valid outputs exist. For creative tasks. For novel inputs with no reference.

**Complexity to implement.** Medium-high. Requires a dataset management system (input/expected-output pairs), similarity computation (embeddings or string distance), and a way to match incoming runs to reference data. 3-4 weeks.

**Cost per eval.** Low to medium. Embedding calls for semantic similarity are cheap. Exact/fuzzy match is free.

**Result type.** `{ type: 'similarity', score: number, scale: [0, 1], method: 'exact' | 'fuzzy' | 'semantic' | 'structural', reference_id: string }`

---

### 2.6 Safety / Compliance Evaluator

**What it measures.** Whether the agent's output violates safety or compliance policies. Examples:
- PII detection (emails, phone numbers, SSNs in output).
- Toxicity scoring (offensive language, hate speech).
- Secret/credential leakage (API keys, tokens in output).
- Policy compliance (does the output follow the agent's content policy?).
- Refusal detection (did the agent appropriately refuse a harmful request?).
- Brand safety (does the output damage the operator's brand?).

**How it works.** A combination of:
- Regex/pattern matching for PII and secret detection (fast, deterministic).
- Dedicated toxicity models (small, specialized classifiers -- not general LLMs).
- LLM-based policy compliance checks (for nuanced policy evaluation).
- Keyword blocklists.

**When to use it.** For every run, ideally. Safety checks should be the first evaluator in any pipeline. They are cheap, fast, and their failure should gate further evaluation.

**When NOT to use it.** These should always run. The question is whether they are pass/fail gates or scored metrics.

**Complexity to implement.** Low for regex-based PII/secret detection. Medium for toxicity (requires a classifier model or API). Medium-high for nuanced policy compliance (requires LLM). 1-3 weeks depending on scope.

**Cost per eval.** Zero to low. Regex is free. Toxicity APIs are cheap ($0.0001/call). LLM policy checks cost inference tokens.

**Result type.** `{ type: 'safety', passed: boolean, checks: Array<{ name: string, passed: boolean, details?: string }> }`

---

### 2.7 Task Completion Evaluator

**What it measures.** Whether the agent actually accomplished the task it was asked to do. This is distinct from "how well" -- it is about "did it happen at all." Examples:
- User asked for a PR review. Did the agent post a review on the PR?
- User asked to create a file. Does the file exist?
- User asked to schedule a meeting. Was the calendar event created?
- User asked to fix a bug. Did the CI pass after the fix?

**How it works.** Can be:
- **Programmatic** -- check external state (API call to verify PR review exists, file exists, etc.).
- **LLM-judged** -- read the transcript and assess whether the stated goal was achieved.
- **Hybrid** -- programmatic check for verifiable outcomes, LLM judgment for ambiguous cases.

**When to use it.** For agents with concrete, verifiable tasks. Especially valuable for tool-using agents where the "did it work?" question has an external source of truth.

**When NOT to use it.** For pure conversational agents where "task completion" is ambiguous (e.g., "chat with the user about their day").

**Complexity to implement.** Medium. LLM-based task completion is a specialized judge prompt. Programmatic task completion requires per-integration verification hooks (check GitHub API, check file system, etc.). 2-4 weeks.

**Cost per eval.** Varies. LLM-based: one inference call. Programmatic: one API call (usually free).

**Result type.** `{ type: 'task_completion', completed: boolean, confidence: number, method: 'programmatic' | 'llm' | 'hybrid', evidence?: string }`

---

## 3. Composition Models

How do you combine heterogeneous evaluator results into a coherent quality signal? Four approaches, from simple to sophisticated.

### 3.1 Weighted Average (Simple)

**How it works.** Every evaluator produces a numeric score (pass/fail is 0 or 1, scaled to the common range). All scores are combined via weighted average. This is what the current spec does within a single rubric.

```
overall = sum(evaluator_score * weight) / sum(weight)
```

**Pros.** Simple to implement. Simple to understand. One number at the end.

**Cons.** Conflates incommensurable things. A safety "pass" (1.0) and a tone score of 4.0/5.0 (0.8) are not the same kind of number. Averaging them obscures both. A safety failure can be hidden by high quality scores.

**When to use.** For combining scores within the same type (multiple LLM-judged criteria). Not ideal for cross-type composition.

---

### 3.2 Hierarchical (Category -> Dimension -> Overall)

**How it works.** Evaluators are grouped into categories. Each category produces a category score (aggregated from its evaluators). Category scores are then combined into an overall score with category-level weights.

```
Category: Safety
  - PII check: pass (1.0)
  - Toxicity check: pass (1.0)
  - Category score: 1.0

Category: Quality
  - LLM judge (Accuracy): 4/5 (0.8)
  - LLM judge (Helpfulness): 5/5 (1.0)
  - LLM judge (Tone): 4/5 (0.8)
  - Category score: 0.87

Category: Efficiency
  - Response time: 4.2s (pass, score: 0.9)
  - Tool call count: 3 (within range, score: 1.0)
  - Category score: 0.95

Overall = Safety(30%) * 1.0 + Quality(50%) * 0.87 + Efficiency(20%) * 0.95
        = 0.30 + 0.435 + 0.19 = 0.925
```

**Pros.** Preserves category-level visibility. Operators can see "safety is great, quality needs work" instead of just "overall: 3.7." Weights are meaningful at the category level.

**Cons.** More complex to configure. Requires operators to understand the category/dimension/overall hierarchy. Can still obscure individual evaluator results behind category averages.

**When to use.** When operators want structured quality breakdowns and the number of evaluators is large enough that flat lists are overwhelming.

---

### 3.3 Pass/Fail Gates + Scoring

**How it works.** Some evaluators are gates: they must pass for the eval to be valid. Other evaluators are scorers: they contribute to the quality score. Gates run first. If any gate fails, the overall eval is marked "failed" regardless of quality scores.

```
Gates (must all pass):
  - Safety: PII check = PASS
  - Safety: Toxicity check = PASS
  - Programmatic: Output is non-empty = PASS
  -> All gates passed. Proceed to scoring.

Scorers (weighted average):
  - LLM judge (Accuracy): 4/5
  - LLM judge (Helpfulness): 5/5
  - LLM judge (Tone): 4/5
  -> Quality score: 4.33/5.0

Overall: PASSED, score 4.33/5.0
```

If a gate fails:
```
Gates:
  - Safety: PII check = FAIL (email address found in output)
  -> Gate failed. Eval result: FAILED.

Overall: FAILED (safety gate: PII detected)
```

**Pros.** Makes hard requirements explicit. Safety is not a "weight" that can be outscored by quality -- it is a prerequisite. Simple mental model: "first it must be safe, then we score how good it is." Aligns with how operators actually think about quality.

**Cons.** Binary gate/scorer distinction may be too rigid. Some checks are "soft gates" (warn but do not fail). Requires operators to classify each evaluator as gate or scorer.

**When to use.** Always. This is the recommended default composition model for Nitejar. It matches the "receipts" doctrine: gates are the non-negotiable checks, scores are the quality signal.

---

### 3.4 Confidence-Weighted Aggregation

**How it works.** Each evaluator reports not just a score but a confidence level. High-confidence evaluators contribute more to the final score. Confidence can be derived from:
- Inter-judge agreement (multi-judge panel).
- Historical correlation with human ratings.
- Evaluator type (programmatic checks are always confidence 1.0; LLM judges vary).

```
Evaluator A: score 4.0, confidence 0.95 -> weighted contribution: 3.80
Evaluator B: score 3.0, confidence 0.60 -> weighted contribution: 1.80
Evaluator C: score 5.0, confidence 0.90 -> weighted contribution: 4.50

Overall = (3.80 + 1.80 + 4.50) / (0.95 + 0.60 + 0.90) = 10.10 / 2.45 = 4.12
```

**Pros.** Mathematically elegant. Naturally down-weights unreliable evaluators. Enables automatic calibration: as human feedback accumulates, evaluator confidences adjust.

**Cons.** Requires confidence estimation, which is its own hard problem. Opaque to operators ("why did the confidence change?"). Over-engineering for most use cases.

**When to use.** As a future enhancement when human feedback calibration is implemented (Architecture 1.4). Not for V1.

---

## 4. Recommended Approach for Nitejar

### 4.1 The Design Principle

**Start with the current spec. Extend the data model to support typed evaluators. Ship LLM judge first. Add evaluator types incrementally.**

The key insight: the difference between the current spec and a composable pipeline is mostly a data model change, not a fundamental rearchitecture. If we design the schema right, the current single-judge flow is just one evaluator type running in a pipeline of one. Adding more evaluator types later is additive, not destructive.

### 4.2 The Architecture: Typed Evaluator Pipeline with Gates

Combine Architecture 1.3 (typed evaluator pipeline) with Composition Model 3.3 (pass/fail gates + scoring). This gives us:

1. **Evaluators are typed.** Each evaluator declares its type (`llm_judge`, `programmatic`, `statistical`, `safety`, `task_completion`), its role (`gate` or `scorer`), and its output format.

2. **Pipelines are composable.** An agent's eval configuration is a list of evaluators to run, each with a role and optional weight. Operators can add/remove/reorder evaluators.

3. **Gates run first.** If any gate evaluator fails, the overall eval is marked failed. Gate results are stored as receipts regardless of pass/fail.

4. **Scorers run after gates pass.** Scorer evaluators produce numeric results that combine into the quality score. The LLM judge rubric from the current spec is one scorer among potentially many.

5. **Everything is a receipt.** Every evaluator result (gate or scorer) is stored with its type, input, output, reasoning, cost, and duration. Fully inspectable.

### 4.3 Phased Implementation

**Phase 1: Foundation (ships with V1).** Implement the typed evaluator data model. Ship with one evaluator type: the LLM judge from the current spec. The pipeline has one step. Operators see exactly what the current spec describes. The difference is in the schema, not the UI.

**Phase 2: Built-in programmatic evaluators.** Add 5-10 built-in programmatic evaluators operators can toggle on:
- Output is non-empty.
- Output length within bounds.
- Output contains code block.
- Output is valid JSON.
- Agent used at least one tool.
- Agent did not exceed N tool calls.
- No PII detected in output (regex-based).
- No secrets/API keys in output (regex-based).

These are zero-cost, instant, and deterministic. Operators add them as gates or scorers via the admin UI. No configuration beyond toggling them on.

**Phase 3: Statistical evaluators.** Surface run metadata as evaluator results:
- Response time.
- Token count.
- Tool call count.
- Cost.
- Error/retry count.

These pull from existing Nitejar tables. Operators set thresholds ("flag if response time > 30s"). Results appear alongside LLM judge scores in the eval detail.

**Phase 4: Human feedback.** Add rating UI to the admin. Operators rate runs. Ratings are stored as a `human_feedback` evaluator type. Over time, correlate human ratings with LLM judge scores to assess judge calibration.

**Phase 5: Custom evaluators.** Allow operators to define custom evaluators as JavaScript functions or webhook endpoints. The system calls the function/webhook with the run context and expects an `EvalResult` response. This is the power-user extensibility point.

### 4.4 Why This Works for Nitejar

- **Easy to start with.** Phase 1 is the current spec with a slightly richer schema. Operators do not see the evaluator pipeline abstraction -- they see a rubric and scores. Same UI, same mental model.

- **Supports growing complexity.** Each phase adds a new evaluator type. The pipeline grows. The composition logic (gates + scorers) handles heterogeneous results naturally. No rearchitecture needed.

- **Receipts, not vibes.** Every evaluator result is a receipt. The gate results are receipts. The scorer results are receipts. The overall composition is a receipt. Operators can drill from "overall: 4.2" down to "LLM judge: Accuracy 4, Tone 5" down to "judge reasoning: the agent correctly identified the race condition but missed the null pointer edge case."

- **Flexibility without ML expertise.** Operators compose pipelines by toggling built-in evaluators and adjusting weights. No custom code required for 90% of use cases. Power users get custom evaluators in Phase 5.

- **The extension points are clear.** New evaluator types are new implementations of the `Evaluator` interface. New composition models are new implementations of the `Composer` interface. The pipeline runner does not change.

### 4.5 Core Abstractions

```typescript
// Every evaluator implements this interface.
interface Evaluator {
  /** Unique type identifier, e.g. 'llm_judge', 'programmatic', 'statistical' */
  type: EvaluatorType
  /** Human-readable name, e.g. "Code Quality Judge", "PII Check" */
  name: string
  /** Does this evaluator gate the pipeline (must pass) or score (contributes to quality)? */
  role: 'gate' | 'scorer'
  /** Run the evaluator against the context. Returns a typed result. */
  evaluate(context: EvalContext): Promise<EvalResult>
}

// The context passed to every evaluator. Same for all types.
interface EvalContext {
  job: Job
  workItem: WorkItem
  agent: Agent
  messages: Message[]        // Conversation transcript
  inferenceStats: {          // Aggregated from inference_calls
    totalTokens: number
    totalCost: number
    callCount: number
  }
  spanStats: {               // Aggregated from spans
    durationMs: number
    toolCallCount: number
    errorCount: number
  }
  toolCalls: ToolCallSummary[]  // Extracted from spans
}

// Union type for evaluator results. Each type has its own shape.
type EvalResult =
  | LLMJudgeResult
  | PassFailResult
  | MetricResult
  | HumanRatingResult
  | SimilarityResult
  | SafetyResult
  | TaskCompletionResult

interface LLMJudgeResult {
  type: 'llm_judge'
  overallScore: number           // 1.0-5.0 weighted average
  criteria: CriterionScore[]     // Per-criterion breakdown
  reasoning: string              // Full judge reasoning
  model: string                  // Judge model used
  cost: { inputTokens: number, outputTokens: number, usd: number }
  durationMs: number
}

interface PassFailResult {
  type: 'pass_fail'
  passed: boolean
  message: string
  details?: Record<string, unknown>
}

interface MetricResult {
  type: 'metric'
  name: string
  value: number
  unit: string                   // 'ms', 'tokens', 'usd', 'count'
  threshold?: { min?: number, max?: number }
  passed?: boolean               // If threshold is defined
}

interface SafetyResult {
  type: 'safety'
  passed: boolean
  checks: Array<{ name: string, passed: boolean, details?: string }>
}

interface TaskCompletionResult {
  type: 'task_completion'
  completed: boolean
  confidence: number             // 0.0-1.0
  method: 'programmatic' | 'llm' | 'hybrid'
  evidence?: string
}

// Pipeline composition result. The overall eval outcome.
interface PipelineResult {
  status: 'passed' | 'failed'   // Failed if any gate failed
  gateResults: Array<{ evaluator: string, result: EvalResult }>
  scorerResults: Array<{ evaluator: string, weight: number, result: EvalResult }>
  overallScore: number | null    // Null if gates failed. Weighted average of scorer scores.
  metadata: {
    totalCostUsd: number
    totalDurationMs: number
    evaluatorCount: number
  }
}
```

### 4.6 How the Rubric Maps to This Model

The current spec's `rubrics` table and `agent_rubrics` join table remain. A rubric becomes the configuration for one LLM judge evaluator in the pipeline. The mapping:

| Current Spec Concept | Evaluator Pipeline Concept |
|---|---|
| Rubric | Configuration for an `llm_judge` evaluator |
| `agent_rubrics` assignment | One evaluator entry in the agent's eval pipeline |
| `agent_rubrics.weight` | The evaluator's weight in the pipeline's scorer composition |
| `eval_runs` row | `pipeline_result` containing all evaluator results, with the LLM judge result as one entry |
| `eval_runs.overall_score` | The pipeline's `overallScore` (may now incorporate non-LLM evaluators) |
| `eval_runs.scores_json` | The LLM judge evaluator's `criteria` array |

An operator who only uses LLM judge rubrics sees identical behavior to the current spec. The pipeline abstraction is invisible until they add a second evaluator type.

---

## 5. Impact on Current WS4 Spec

Specific changes needed to support the recommended approach. Organized by spec section.

### 5.1 Schema Changes

#### New table: `evaluators`

Replaces the concept of "rubric is the only eval configuration." Each evaluator is a configured instance of an evaluator type.

```sql
CREATE TABLE evaluators (
  id            TEXT PRIMARY KEY,                  -- UUIDv7
  type          TEXT NOT NULL,                     -- 'llm_judge' | 'programmatic' | 'statistical' | 'safety' | 'task_completion' | 'human_feedback' | 'custom'
  name          TEXT NOT NULL,                     -- Human-readable name, e.g. "Code Quality Judge", "PII Gate"
  description   TEXT,                              -- What this evaluator checks
  role          TEXT NOT NULL DEFAULT 'scorer',    -- 'gate' | 'scorer'
  config_json   TEXT NOT NULL,                     -- Type-specific configuration (see below)
  is_builtin    INTEGER NOT NULL DEFAULT 0,        -- 1 for system-provided evaluators, 0 for operator-created
  created_by    TEXT,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
);
```

**`config_json` by type:**

- `llm_judge`: `{ rubric_id: string }` -- points to the `rubrics` table. The rubric format is unchanged.
- `programmatic`: `{ check: 'non_empty' | 'contains' | 'regex' | 'json_valid' | 'json_schema' | 'min_length' | 'max_length' | 'tool_used' | 'max_tool_calls' | 'custom', params: Record<string, unknown> }`
- `statistical`: `{ metric: 'response_time' | 'token_count' | 'tool_call_count' | 'cost' | 'error_count', threshold?: { min?: number, max?: number } }`
- `safety`: `{ checks: Array<'pii' | 'secrets' | 'toxicity' | 'policy'>, policy_prompt?: string }`
- `task_completion`: `{ method: 'llm' | 'programmatic' | 'hybrid', judge_model?: string }`
- `custom`: `{ function_code?: string, webhook_url?: string }`

#### New table: `agent_evaluators`

Join table assigning evaluators to agents, analogous to `agent_rubrics` but for any evaluator type.

```sql
CREATE TABLE agent_evaluators (
  id            TEXT PRIMARY KEY,                  -- UUIDv7
  agent_id      TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  evaluator_id  TEXT NOT NULL REFERENCES evaluators(id) ON DELETE CASCADE,
  weight        REAL NOT NULL DEFAULT 1.0,         -- Relative weight (for scorers)
  is_active     INTEGER NOT NULL DEFAULT 1,
  sort_order    INTEGER NOT NULL DEFAULT 0,        -- Pipeline execution order
  sample_rate   REAL,                              -- Override sample rate
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(agent_id, evaluator_id)
);

CREATE INDEX idx_agent_evaluators_agent ON agent_evaluators(agent_id);
CREATE INDEX idx_agent_evaluators_agent_active ON agent_evaluators(agent_id, is_active);
```

#### Modified table: `eval_runs`

The `eval_runs` table stores the overall pipeline result. Individual evaluator results are stored in a new `eval_results` table.

Changes to the existing `eval_runs` schema:
- **Remove** `rubric_id` (the pipeline may not involve a rubric at all).
- **Remove** `criteria_snapshot_json` (moved to per-evaluator result).
- **Remove** `scores_json` (moved to per-evaluator result).
- **Remove** `judge_model` (each evaluator tracks its own model).
- **Remove** `judge_reasoning` (each evaluator stores its own reasoning).
- **Add** `pipeline_status` TEXT: `'passed' | 'failed'` (gate pass/fail).
- **Add** `evaluator_count` INTEGER: number of evaluators that ran.
- **Add** `gate_failed_evaluator_id` TEXT: if a gate failed, which evaluator.
- **Keep** `overall_score` (now the composed score from all scorers, null if gates failed).
- **Keep** cost/duration fields (now aggregated across all evaluators in the pipeline).

```sql
CREATE TABLE eval_runs (
  id                      TEXT PRIMARY KEY,
  job_id                  TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  agent_id                TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  work_item_id            TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  trigger                 TEXT NOT NULL DEFAULT 'auto',
  status                  TEXT NOT NULL DEFAULT 'pending',
  pipeline_status         TEXT,                    -- 'passed' | 'failed' (null while pending/running)
  overall_score           REAL,                    -- Composed score from scorers (null if gates failed or pending)
  evaluator_count         INTEGER,                 -- How many evaluators ran
  gate_failed_evaluator_id TEXT,                   -- Which gate failed (null if all passed)
  total_cost_usd          REAL,                    -- Sum of all evaluator costs
  total_duration_ms       INTEGER,                 -- Wall clock time for full pipeline
  error_text              TEXT,
  started_at              INTEGER,
  completed_at            INTEGER,
  created_at              INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at              INTEGER NOT NULL DEFAULT (unixepoch())
);
```

#### New table: `eval_results`

Individual evaluator results within a pipeline run.

```sql
CREATE TABLE eval_results (
  id                TEXT PRIMARY KEY,              -- UUIDv7
  eval_run_id       TEXT NOT NULL REFERENCES eval_runs(id) ON DELETE CASCADE,
  evaluator_id      TEXT NOT NULL REFERENCES evaluators(id) ON DELETE CASCADE,
  evaluator_type    TEXT NOT NULL,                  -- Denormalized from evaluators.type
  evaluator_name    TEXT NOT NULL,                  -- Denormalized for display
  role              TEXT NOT NULL,                  -- 'gate' | 'scorer'
  status            TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'completed' | 'failed' | 'skipped'
  result_json       TEXT,                           -- Full EvalResult (typed JSON, shape depends on evaluator_type)
  score             REAL,                           -- Normalized score (0-1) for scorers, 1.0/0.0 for gates
  passed            INTEGER,                        -- 1 if passed, 0 if failed (for gates and threshold checks)
  weight            REAL,                           -- Weight at time of evaluation (snapshot)
  reasoning         TEXT,                           -- Human-readable explanation (from LLM judge or evaluator logic)
  cost_usd          REAL,                           -- Cost of this individual evaluator
  duration_ms       INTEGER,
  config_snapshot_json TEXT,                        -- Snapshot of evaluator config at eval time
  sort_order        INTEGER NOT NULL DEFAULT 0,     -- Execution order within the pipeline
  created_at        INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_eval_results_run ON eval_results(eval_run_id);
CREATE INDEX idx_eval_results_evaluator ON eval_results(evaluator_id);
CREATE INDEX idx_eval_results_run_sort ON eval_results(eval_run_id, sort_order);
```

#### Tables that stay unchanged

- **`rubrics`** -- unchanged. A rubric is still the configuration format for the LLM judge evaluator type. It is referenced by the `evaluators.config_json` field when `type = 'llm_judge'`.
- **`improvement_suggestions`** -- unchanged. Still derived from eval results, now potentially drawing on multiple evaluator types.
- **`eval_settings`** -- unchanged. Still configures system-level defaults.

#### Table that is replaced

- **`agent_rubrics`** -- replaced by `agent_evaluators`. For backward compatibility during migration, existing `agent_rubrics` rows are migrated to `agent_evaluators` entries pointing to auto-created `evaluators` rows of type `llm_judge`.

### 5.2 tRPC Route Changes

#### New routes

```typescript
// Evaluator CRUD
evals.listEvaluators       // List evaluators (optionally by type, by agent)
evals.getEvaluator         // Get evaluator with config
evals.createEvaluator      // Create typed evaluator
evals.updateEvaluator      // Update evaluator config
evals.deleteEvaluator      // Delete evaluator

// Agent-evaluator assignment (replaces agent-rubric assignment)
evals.assignEvaluatorToAgent
evals.updateAgentEvaluator
evals.removeEvaluatorFromAgent
evals.listAgentEvaluators  // List evaluators assigned to an agent, with pipeline order

// Built-in evaluator catalog
evals.listBuiltinEvaluators  // List system-provided evaluators (PII check, output non-empty, etc.)
```

#### Routes that change

```typescript
// evals.runEval -- now runs the full pipeline, not just one rubric
evals.runEval
  input: { jobId: string, evaluatorIds?: string[] }  // Run specific evaluators or all active
  output: EvalRun  // Now includes pipeline_status and per-evaluator results

// evals.getEvalRun -- now returns pipeline result with per-evaluator breakdown
evals.getEvalRun
  output: EvalRunWithResults  // Includes eval_results joined

// evals.getEvalsForJob -- same but richer output
evals.getEvalsForJob
  output: EvalRunWithResults[]

// Trend queries -- now can filter by evaluator type
evals.getScoreTrend
  input: { agentId, evaluatorId?, evaluatorType?, days?, granularity? }

// Agent summary -- now includes gate pass rate
evals.getAgentEvalSummary
  output: {
    ...existing fields,
    gatePassRate: number,           // % of runs where all gates passed
    evaluatorBreakdown: Array<{     // Per-evaluator summary (replaces rubricBreakdown)
      evaluatorId: string
      evaluatorName: string
      evaluatorType: EvaluatorType
      role: 'gate' | 'scorer'
      avgScore: number | null       // For scorers
      passRate: number | null       // For gates
      evalCount: number
    }>
  }
```

#### Routes that stay unchanged

- Rubric CRUD routes (`createRubric`, `updateRubric`, `deleteRubric`, etc.) stay. Rubrics are still the config format for LLM judge evaluators.
- Improvement suggestion routes stay unchanged.
- `listTemplates` and `createFromTemplate` stay -- they now also create an `evaluators` row of type `llm_judge` linked to the rubric.

### 5.3 Eval Worker Changes

The eval worker (`eval-worker.ts`) changes from "run one LLM judge call" to "run a pipeline of evaluators":

```
tick():
  1. Claim pending eval_run.
  2. Load eval context (same as current spec).
  3. Load agent's active evaluators (from agent_evaluators, ordered by sort_order).
  4. Phase 1: Run gate evaluators (in order).
     - For each gate: run evaluator, store eval_result.
     - If any gate fails: mark eval_run as pipeline_status='failed',
       set gate_failed_evaluator_id, skip scorers.
  5. Phase 2: Run scorer evaluators (in order, if gates passed).
     - For each scorer: run evaluator, store eval_result.
  6. Compose overall score from scorer results (weighted average).
  7. Update eval_run with pipeline_status, overall_score, totals.
```

The LLM judge evaluator implementation is extracted from the current spec's inline judge call into a function that implements the `Evaluator` interface. Programmatic evaluators are simple functions. Statistical evaluators are database queries. All share the same `EvalContext` input and produce typed `EvalResult` outputs.

### 5.4 UI Changes

#### Eval pipeline builder (new)

Replace the "Assign Rubric" flow with an "Eval Pipeline" section on the agent detail page:
- Shows the ordered list of evaluators assigned to this agent.
- Each evaluator shows: name, type badge, role badge (gate/scorer), weight (for scorers), active toggle.
- "Add Evaluator" button opens a picker showing: built-in evaluators (toggle on), existing LLM judge rubrics (assign), or "Create New" for custom evaluators.
- Drag-to-reorder for pipeline execution order.
- Visual separator between gates (top) and scorers (bottom).

#### Eval run detail (modified)

Instead of showing only per-criterion LLM judge scores, show the full pipeline result:
- Pipeline status badge: PASSED (green) or FAILED (red, with gate failure reason).
- Gate results section: list of gate evaluators with pass/fail badges.
- Scorer results section: list of scorer evaluators with scores, weights, and reasoning.
- For LLM judge evaluators: expandable per-criterion breakdown (same as current spec).
- For programmatic evaluators: pass/fail with message.
- For statistical evaluators: metric value with threshold visualization.
- Overall score at the top (only shown if pipeline passed).

#### Rubric builder (unchanged)

The rubric builder stays exactly as designed. It creates/edits rubrics. When a rubric is assigned to an agent, it is wrapped in an `evaluators` row of type `llm_judge` and an `agent_evaluators` assignment. The rubric builder UI does not need to know about the evaluator abstraction.

### 5.5 What Does NOT Change

- **The rubric format.** `criteria_json` structure, scale descriptors, criterion weights -- all unchanged.
- **The judge prompt.** The LLM judge evaluator uses the same prompt structure described in section 4.4 of the current spec.
- **Sampling logic.** The sample rate mechanism stays the same, but now applies at the pipeline level (sample whether to run any eval, not per-evaluator).
- **Cost tracking.** Eval costs are still tracked separately from agent operational costs. Now they aggregate across all evaluators in the pipeline.
- **Improvement suggestions.** Still generated from eval results. The suggestion generator can now draw on richer data (gate failures, statistical metrics, not just LLM judge scores).
- **Eval settings singleton.** Unchanged.

---

## 6. Comparison with Existing Frameworks

How the recommended approach compares to what the industry ships.

| Feature | Nitejar (Recommended) | Braintrust | promptfoo | LangSmith | DeepEval | Arize Phoenix |
|---|---|---|---|---|---|---|
| LLM-as-judge | Yes (rubric-based) | Yes (AutoEvals) | Yes (llm-rubric, g-eval) | Yes (LLM-as-judge) | Yes (G-Eval, DAG) | Yes |
| Programmatic checks | Yes (built-in library) | Yes (code scorers) | Yes (25+ assertion types) | Yes (heuristic evaluators) | No (LLM-only) | No |
| Statistical metrics | Yes (from run data) | Yes (custom scorers) | Yes (latency, cost) | Limited | No | Yes (trace metrics) |
| Safety evaluators | Yes (PII, toxicity) | Via custom scorers | Yes (guardrails, is-refusal) | Via custom evaluators | Yes (bias, toxicity, PII) | Yes (pre-built templates) |
| Task completion | Yes (LLM + programmatic) | Via agent evals | Via custom assertions | Via custom evaluators | Yes (dedicated metric) | No |
| Human feedback | Phase 4 | Yes (annotation) | No | Yes (annotation queues) | No | Yes (annotation) |
| Composite scoring | Gates + weighted average | Independent metrics | Weighted average + derived | Per-evaluator | Composite metrics | Per-evaluator |
| Pass/fail gates | Yes (first-class) | No (all are scores) | Yes (thresholds) | No | Yes (thresholds) | No |
| Custom evaluators | Phase 5 (JS functions) | Yes (custom scorers) | Yes (JS/Python/webhook) | Yes (custom evaluators) | Yes (custom metrics) | Yes (plugin system) |
| Pipeline composition | Ordered evaluator list | Flat scorer list | YAML assertion list | Flat evaluator list | Metric list | Flat evaluator list |
| Reference comparison | Phase 5 | Yes (datasets) | Yes (expected outputs) | Yes (datasets) | Yes (expected outputs) | Yes (datasets) |
| CI/CD integration | Future | Yes | Yes (first-class) | Yes | Yes (pytest) | Limited |
| Self-hosted | Yes (core product) | No (SaaS) | Yes (OSS) | No (SaaS) | Yes (OSS) | Yes (OSS) |

**Key differentiator for Nitejar:** The eval system is embedded in the agent platform, not a standalone tool. Evaluators have direct access to the full run context (tool calls, spans, cost data, agent config, memory) without any integration work. This is something standalone eval frameworks cannot offer -- they require you to export data to them. Nitejar evaluators read from the same database the agent writes to.

---

## 7. Appendix: Framework Research Notes

### Braintrust

Braintrust organizes evaluation by architectural layer (reasoning, action, end-to-end) rather than treating agent performance as monolithic. Their key insight: "effective harnesses combine both [deterministic and LLM-as-judge] approaches." They ship 25+ built-in scorers and support custom scorers. Their composition is flat (independent metrics per function) rather than hierarchical. They emphasize trace-based scoring for agent workflows where "a bad decision in step two affects step three."

### promptfoo

The most comprehensive taxonomy of evaluator types in the space. Supports deterministic metrics (exact match, regex, JSON validation, ROUGE/BLEU), model-assisted metrics (LLM rubric, G-Eval, factuality, semantic similarity), structural validators (function call validation, trace analysis), and composite scoring via weighted assertions, derived metrics, and thresholds. Their YAML-first configuration makes it easy to define complex eval pipelines declaratively. Their negation system (any assertion can be prefixed with "not-") is elegant.

### LangSmith

Clean three-type taxonomy: heuristic evaluators (deterministic rules), LLM-as-judge, and human evaluation (annotation queues). Their insight: start with heuristic evals, add LLM judges for subjective dimensions, use human annotation to calibrate. They also support pairwise comparisons for A/B testing agent configurations.

### DeepEval

The deepest metric taxonomy: 50+ metrics organized into custom, RAG, agentic, conversational, safety, multimodal, and general-purpose categories. Their agentic metrics (task completion, argument correctness, tool correctness, step efficiency, plan adherence, plan quality) are the most relevant to Nitejar. They use three evaluation techniques: G-Eval (chain-of-thought for subjective scoring), DAG (directed acyclic graph for objective multi-step scoring), and QAG (question-answer generation for equation-based scoring). Their composite metric system allows combining any two built-in metrics.

### Arize Phoenix

Built on OpenTelemetry. Their eval system is tightly coupled to trace data (spans, attributes). Pre-built templates for hallucination, summarization, toxicity, and agent tool selection. Their extensible plugin system for custom evaluators is worth noting. The trace-first approach aligns well with Nitejar's existing span/inference call tracking.

### OpenAI Evals

Categorizes evals into quantitative (exact match, string match, ROUGE/BLEU, function call accuracy) and model-graded (LLM judge). Their best practices emphasize using a different model for grading than the one being evaluated (already in the current Nitejar spec). They recommend starting with simple deterministic evals and adding model-graded evals where deterministic is insufficient.

---

## 8. Summary

| Decision | Choice | Rationale |
|---|---|---|
| Architecture | Typed Evaluator Pipeline (1.3) | Right tool for the right job. Composable without over-engineering. |
| Composition model | Pass/fail gates + weighted average (3.3) | Separates hard requirements from quality scoring. Matches operator mental model. |
| V1 evaluator types | LLM judge only | Ship what is designed. Foundation supports expansion. |
| V1 schema | Include `evaluators`, `agent_evaluators`, `eval_results` tables | Build the right schema now. Easier than migrating later. |
| Phase 2 additions | Programmatic + safety evaluators | Zero cost, high value, fast to build. |
| Phase 3 additions | Statistical evaluators | Data already exists in Nitejar. Just query + threshold logic. |
| Phase 4 additions | Human feedback | Closes the calibration loop. Requires UI work. |
| Phase 5 additions | Custom evaluators (JS/webhook) | Power-user extensibility. |
| Rubric format | Unchanged | Rubrics are great for LLM judge config. Keep them. |
| `agent_rubrics` table | Replace with `agent_evaluators` | Same pattern, wider scope. Migrate existing rows. |

The bottom line: the current spec is a good V1. The recommended changes are mostly schema-level -- add the `evaluators` and `eval_results` tables, replace `agent_rubrics` with `agent_evaluators`, and extract the LLM judge call into an evaluator implementation. The UI and operator experience for V1 can be identical to the current spec. The schema changes pay off in Phase 2-5 when new evaluator types are added without rearchitecture.
