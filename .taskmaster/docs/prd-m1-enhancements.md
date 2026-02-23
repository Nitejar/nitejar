# M1 — Foundational Platform: Future Enhancements

**Priority:** After M1 testing complete, before or during M2

These are documented TODOs from M1 implementation that improve the platform but aren't blocking M1 completion.

## 1. Agent Model Configuration

**Current state:** Agent model is a global `AGENT_MODEL` env var or hardcoded default.

**Enhancement:** Allow per-agent model configuration in `agent.config.model`.

**Benefits:**

- Different agents can use different models (cheap vs capable)
- Per-agent model overrides without redeploying
- Cost optimization (use cheap models for simple tasks)
- A/B testing different models

**Implementation:**

- Add `model` field to agent config JSONB
- Update inference loop to check `agent.config.model` first
- Fall back to `AGENT_MODEL` env var if not set
- Add model selector to agent creation/edit UI

## 2. Enhanced Agent Tools

**Current state:** Basic tools: `bash`, `read_file`, `write_file`, `list_directory`, `create_directory`

**Enhancement:** Improve tools with features similar to Claude Code.

### 2.1 Line Numbers in File Reads

- Include line numbers in `read_file` output
- Helps agent reference specific locations
- Format: `1: first line\n2: second line\n...`

### 2.2 Output Truncation with Limits

- Add `max_lines` parameter to `read_file`
- Prevent context overflow on large files
- Return truncation notice when limit hit
- Consider offset parameter for pagination

### 2.3 Glob/Pattern Search Tool

- New `glob` tool to find files by pattern
- Input: pattern like `**/*.ts` or `src/**/*.test.js`
- Output: list of matching file paths
- Helps agent navigate unfamiliar codebases

### 2.4 Content Search (Grep) Tool

- New `grep` tool to search file contents
- Input: pattern (regex), optional path filter
- Output: matching lines with file:line:content
- Essential for finding code references

### 2.5 Smart Diffs for Edits

- Show what changed after `write_file`
- Unified diff format
- Helps agent verify changes were correct
- Consider: diff preview before write (dry-run)

**Implementation priority:**

1. Line numbers (easy, high value)
2. Output truncation (easy, prevents issues)
3. Grep (medium, very useful)
4. Glob (medium, useful)
5. Smart diffs (nice to have)
