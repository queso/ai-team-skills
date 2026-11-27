---
name: code-review
description: Reviews all unmerged code in the current branch for readability, security, correctness, types, and test quality. Produces a summary of issues to fix before merging.
---

# Code Review

Review all unmerged code in the current branch.

## Step 1: Determine What to Review

First, detect the base branch: `git rev-parse --verify main 2>/dev/null || git rev-parse --verify master`.

Then determine the review scope:

- **On a feature branch with uncommitted changes**: review only the uncommitted work using `git diff HEAD`
- **On a feature branch with a clean working tree**: review all commits diverged from the base branch using `git diff <base-branch>...HEAD`
- **On the base branch with uncommitted changes**: review staged and unstaged changes using `git diff HEAD`
- **On the base branch with no uncommitted changes**: nothing to review — inform the user

## Step 2: Launch the Review

Use a **code-review-expert** subagent (via the Task tool) to perform a thorough review. The subagent should:

1. Run the appropriate diff command from Step 1, plus `git log --oneline <base-branch>...HEAD` if on a feature branch, to collect all changes under review
2. Read any files it needs for additional context
3. Evaluate the changes against the criteria in the review checklist below
4. Consult the `references/` directory for language-specific and domain-specific examples of good and bad patterns
5. For each finding, include the file path(s) it touches — this is required for the orchestrator to compute the parallelism estimate in Step 3

## Review Checklist

The subagent should verify each of these for every changed file:

- **Correctness**: Does it handle edge cases (empty arrays, null, zero, negative numbers)?
- **Error paths**: What happens when things fail? Are errors logged with context?
- **Security**: Is user input validated? Are queries parameterized? Secrets externalized?
- **Performance**: Any N+1 queries? Unbounded loops? Missing pagination? Unnecessary re-renders?
- **Types**: Any `any` usage? Are return types explicit on public interfaces?
- **Tests**: Do tests exist for the new behavior? Are they testing behavior, not implementation?
- **Naming**: Can you understand the code without reading the PR description?
- **Scope**: Does the PR do one thing? Should it be split?
- **Dependencies**: Are new dependencies justified? Are they maintained and not bloated?
- **Backwards compatibility**: Will this break existing clients/consumers?

## Step 3: Summarize

Present the subagent's findings to the user organized by severity, numbering each finding sequentially across all three tiers (so finding numbers are unique and usable in the parallelism estimate below):

1. **Must Fix** - Issues that should be resolved before merging (security, correctness bugs, broken tests)
2. **Should Fix** - Issues that meaningfully improve quality (readability, weak types, missing edge cases)
3. **Consider** - Optional improvements (style nits, minor refactors)

### Parallelism Estimate

After presenting findings by severity, analyze file independence across all review findings and report a **Parallelism Estimate** showing how many subagents could fix issues in parallel. This is an estimate only — it does not trigger launching fix agents; that is a separate decision.

**Rules for grouping:**
- Fixes that touch the same file, or whose changes must be coordinated across files (renames, shared interfaces, lockfiles, shared config), must be serialized in one agent
- Fixes that touch truly independent files can run in parallel as separate agents

**Report two groupings:**

1. **Must Fix + Should Fix** — how many parallel subagents are needed if only addressing blocking and quality issues
2. **All items** — how many parallel subagents if addressing everything including Consider items

If there are zero findings, print "0 items → 0 parallel subagents". With one finding, print "1 item → 1 parallel subagent".

**Example output:**

```
## Parallelism Estimate

**Must Fix + Should Fix (4 items) → 3 parallel subagents**
- Agent 1: #1, #3 (both touch src/parser.ts)
- Agent 2: #2 (src/api.ts)
- Agent 3: #4 (src/validator.ts)

**All items (6 items) → 3 parallel subagents**
- Agent 1: #1, #3, #5 (src/parser.ts — findings collapse into same agent)
- Agent 2: #2 (src/api.ts)
- Agent 3: #4, #6 (both touch src/validator.ts)
```

## Output Formatting Rules

For each issue:
- Reference the specific file and line
- Explain *why* it's a problem, not just *that* it's a problem
- Suggest a concrete fix or alternative
- Label severity clearly so the author knows what's blocking vs. optional

When something is done well, call it out briefly — positive reinforcement of good patterns helps the team.

Do not nitpick style preferences that aren't in the project's existing conventions. Focus effort proportionally: a race condition matters more than a variable name.
