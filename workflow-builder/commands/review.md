---
description: Audit a built Claude Code or OpenCode workflow against pattern fidelity, anti-patterns, and coverage.
argument-hint: <plugin-root> [--against <design-doc>]
---

# /workflow-builder:review

Audits a Claude Code plugin or OpenCode workflow skeleton built from a workflow design. Produces a scorecard plus a tiered findings list. Each finding links to the relevant `references/*.md` so fixes are guided.

Three layers run in order: **coverage** (binary), **anti-patterns** (binary), **pattern fidelity** (graded, lenient). With `--against <design.md>` a fourth **drift** check compares the plugin to its design.

## Three review layers

### 1. Coverage (binary)

Required pieces present? Each missing piece is a `BLOCKER`.

- Runtime shape is present:
  - Claude Code: `.claude-plugin/plugin.json` exists and has `name` + `description`.
  - OpenCode: `.opencode/` exists with at least one of `.opencode/agents/`, `.opencode/commands/`, `.opencode/skills/`, or `.opencode/plugins/`.
- At least one agent file exists: `agents/*.md` for Claude Code or `.opencode/agents/*.md` for OpenCode.
- At least one declared stage flow — either a command file that names stages, a transition matrix file, or a stages list in config/manifest.
- At least one identifiable verification pass — at least one agent whose stage or role name implies review (e.g. `review`, `qc`, `audit`, `verify`, `critic`).

### 2. Anti-patterns (binary)

Scan the plugin for known bad shapes. Each match is `HIGH`. List from `references/anti-patterns.md`:

- **Orchestrator codes** — an agent file whose role suggests orchestration (`orchestrator`, `coordinator`, `dispatcher`, `runner`) but whose prompt mentions Write/Edit on source artifacts. Orchestrators dispatch; they do not produce.
- **Opinion-only review** — a reviewer agent file with no `Skill` reference and no checklist file mentioned. Reviewers should consult a guardrail skill, not "use your judgment."
- **Collapsed angles** — only one reviewer agent for the whole pipeline. Multi-pass verification with distinct angles is the headline pattern.
- **Polling loop** — orchestrator prompt mentions "poll" / "check every N seconds" when a `SendMessage` mechanism is available. Event-driven beats polling.
- **Hooks bypassed** — any mention of `--no-verify` or analogous skip flags in agent prompts.
- **Stage without transition rule** — a stage referenced in agent files that doesn't appear in any transition declaration (matrix gap).

### 3. Pattern fidelity (graded, lenient)

For each pattern that's *implemented*, how well realized? Lenient mode — patterns are options, not requirements. Choosing central orchestration over P2P is fine. Choosing nothing is not. Apply each pattern's "when to use this variant" rule from its reference doc rather than enforcing the A(i)-Team-specific choice.

For each pattern, grade:

- `OK` — implemented and well-shaped.
- `PARTIAL` — implemented but with gaps.
- `WEAK` — implemented in name only.
- `MISSING` — not implemented (only flagged if the design doc or coverage check expected it).

Patterns to grade:

- Pipeline stages (`references/pipeline-stages.md`).
- Orchestration model (`references/orchestration-and-fan-out.md`).
- Fan-out (per-stage WIP, instance pools).
- Multi-pass verification (distinct angles, rejection routing, rejection cap).
- Role boundaries (declared, hook-enforced where required).
- Guardrail skills (reviewer agents reference skills, not opinion).

## Severity tiers

- **BLOCKER** — won't work or fundamentally broken. The plugin can't run as designed.
- **HIGH** — anti-pattern present. Will produce wrong outputs or silently degrade.
- **MEDIUM** — recommended pattern missing where it should be. Usable but fragile.
- **INFO** — suggestion or nice-to-have.

## Output: scorecard + findings

Write a markdown report. Default location: `<plugin-root>/.workflow-review.md`. Override with `--out <path>`.

```markdown
# Workflow Review: <plugin-name>

Reviewed: <date>
Against design: <path or "patterns only">

## Scorecard

| Pattern | Status | Notes |
|---|---|---|
| Pipeline stages | OK | 7 stages, transition matrix complete |
| Orchestration | OK | hybrid (P2P + central wakeup) |
| Fan-out | PARTIAL | declared but no per-stage WIP |
| Multi-pass verification | WEAK | 1 reviewer, no distinct angles |
| Role boundaries | OK | 6/6 declared, 4/6 hook-enforced |
| Guardrail skills | MISSING | reviewers reference no skills |

## Findings

### BLOCKER
- ...

### HIGH
- ...

### MEDIUM
- ...

### INFO
- ...
```

Each finding format:

```
- `<location>` — <one-line description>.
  Fix: <one-line suggestion>.
  See: `references/<file>.md`.
```

Example:

```
- `agents/editor.md:42` — orchestrator prompt instructs Write to `timeline/**`.
  Fix: orchestrators dispatch only; move write logic into a specialist agent.
  See: `references/anti-patterns.md`.
```

## Drift detection (opt-in)

Only when `--against <design.md>` is passed:

1. Read the design doc.
2. For each role in section 3, find the matching `agents/<role>.md`. Flag missing roles or extra roles.
3. For each role, compare the design's write boundary to the agent file's declared `{{WRITE_GLOBS}}`. Flag mismatches — particularly when the plugin's scope is **broader** than the design's.
4. For each stage in section 2, confirm a transition is declared.
5. For each verification pass in section 6, confirm an agent exists.
6. For each guardrail skill in section 8, confirm `skills/<name>/` exists with a non-empty SKILL.md.

Drift findings are tagged with severity per the rules above (missing role → BLOCKER; broader-than-designed scope → HIGH; missing skill placeholder → MEDIUM).

Format drift findings the same way:

```
- `agents/editor.md` — design says editor's write boundary is `timeline/*` but agent declares `**/*`.
  Fix: tighten the write glob to match the design, or update the design intentionally.
  See: `references/role-boundaries.md`.
```

## Process steps the assistant runs

1. Validate `<plugin-root>` exists and contains either `.claude-plugin/plugin.json` or `.opencode/`. If neither exists, stop with a clear error.
2. Detect target runtime(s). For Claude Code, read `.claude-plugin/plugin.json`. For OpenCode, read `opencode.json` if present and list `.opencode/agents/`, `.opencode/commands/`, `.opencode/skills/`, `.opencode/plugins/`.
3. **Coverage check** — binary. Record any missing required piece as a BLOCKER finding.
4. **Anti-pattern scan** — read each agent prompt fully and judge against the list in `references/anti-patterns.md`. For OpenCode, also inspect `.opencode/plugins/*.js` and `.opencode/plugins/*.ts` when hard boundaries are expected. Cap at the first 12 agent files; if more are present, note: "deep review on first 12, sampling beyond."
5. **Fidelity grading** — for each pattern, score `OK / PARTIAL / WEAK / MISSING` per the lenient-mode rules.
6. **Drift comparison** — only if `--against` was passed. Read the design and run the role/stage/skill comparisons above.
7. Write the full report to the output path (default `<plugin-root>/.workflow-review.md`).
8. Print the scorecard table to chat.
9. Suggest the top 3 fixes — pick the highest-severity findings, list each with its reference doc link.

## Reading the report

- **BLOCKER** — fix before running the workflow at all. The plugin will not behave as designed.
- **HIGH** — fix before relying on the workflow's output. Anti-patterns silently degrade quality.
- **MEDIUM** — fix when you have time. The workflow runs but is missing a recommended pattern.
- **INFO** — at your discretion. Suggestions for polish.

The scorecard is a quick read; the findings list is the actionable view. Each finding's `See:` link is where to read before applying the fix.
