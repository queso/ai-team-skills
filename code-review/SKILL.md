---
name: code-review
description: Reviews all unmerged code in the current branch for readability, security, correctness, types, and test quality. Produces a summary of issues to fix before merging.
---

# Code Review

Review all unmerged code in the current branch.

## Step 1: Determine the Base Branch

Run `git rev-parse --verify main 2>/dev/null || git rev-parse --verify master` to identify whether the repo uses `main` or `master`.

## Step 2: Launch the Review

Use a **code-review-expert** subagent (via the Task tool) to perform a thorough review. The subagent should:

1. Run `git diff <base-branch>...HEAD` and `git log --oneline <base-branch>...HEAD` itself to collect all unmerged changes
2. Read any files it needs for additional context
3. Evaluate the changes against the criteria in the review checklist below
4. Consult the `references/` directory for language-specific and domain-specific examples of good and bad patterns

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

Present the subagent's findings to the user organized by severity:

1. **Must Fix** - Issues that should be resolved before merging (security, correctness bugs, broken tests)
2. **Should Fix** - Issues that meaningfully improve quality (readability, weak types, missing edge cases)
3. **Consider** - Optional improvements (style nits, minor refactors)

## Output Formatting Rules

For each issue:
- Reference the specific file and line
- Explain *why* it's a problem, not just *that* it's a problem
- Suggest a concrete fix or alternative
- Label severity clearly so the author knows what's blocking vs. optional

When something is done well, call it out briefly — positive reinforcement of good patterns helps the team.

Do not nitpick style preferences that aren't in the project's existing conventions. Focus effort proportionally: a race condition matters more than a variable name.
