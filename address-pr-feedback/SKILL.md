---
name: address-pr-feedback
description: Fetches PR review comments, categorizes each as Will Fix / Won't Fix / New Issue, addresses fixable feedback using TDD, commits, pushes, and posts a summary.
---

# Address PR Feedback

Fetch all review comments on a pull request, categorize them, fix what should be fixed using TDD, and summarize the results.

## Step 1: Identify the Pull Request

Determine which PR to work on using this priority order:

1. **`$ARGUMENTS` provided** — If the user passed a PR number or URL, use it directly:
   - A number like `42` → `gh pr view 42`
   - A URL like `https://github.com/owner/repo/pull/42` → extract the number and use it
2. **Current branch has a PR** — Run `gh pr view --json number,url,title,state` to detect a PR for the current branch
3. **Ask the user** — If neither works, ask: "I couldn't detect a PR for the current branch. Please provide a PR number or URL."

Validate that the PR is in an `OPEN` state. If it is merged or closed, inform the user and stop.

Store the PR number, URL, repo owner, and repo name for later steps. Extract owner and repo with:

```bash
gh repo view --json owner,name --jq '.owner.login + "/" + .name'
```

## Step 2: Fetch All Review Comments

Collect comments from three GitHub API sources. Consult `references/gh-api-examples.md` for the expected response shapes.

### 2a. Inline code review comments

```bash
gh api repos/{owner}/{repo}/pulls/{number}/comments --paginate
```

These are comments attached to specific lines in the diff. Capture: `id`, `body`, `path`, `line` (or `original_line`), `diff_hunk`, `user.login`, `user.type`, `created_at`, `in_reply_to_id`.

### 2b. Conversation-level comments

```bash
gh api repos/{owner}/{repo}/issues/{number}/comments --paginate
```

These are general comments on the PR conversation thread. Capture: `id`, `body`, `user.login`, `user.type`, `created_at`.

### 2c. Review summaries

```bash
gh pr view {number} --json body,reviews,author
```

Extract actionable feedback from review summaries, especially those with `CHANGES_REQUESTED` state.

### 2d. Filter out noise

Skip comments that are:

- **From the PR author** — self-comments are usually context, not feedback
- **Bot-generated** — check `user.type == "Bot"` or known bot logins like `github-actions`, `dependabot`, `codecov`
- **Non-substantive** — less than 10 characters after stripping whitespace and emoji (pure reactions)
- **Already resolved** — check review thread resolution status via `gh api repos/{owner}/{repo}/pulls/{number}/comments` and look for threads where the conversation has been marked resolved

Group reply chains together — if a comment has `in_reply_to_id`, attach it to the parent thread rather than treating it as separate feedback.

Present the count: "Found **N** actionable review comments (M inline, K conversation-level). Proceeding with categorization."

If zero actionable comments, inform the user and stop: "No actionable review comments found on PR #N. Nothing to address."

## Step 3: Categorize Each Comment

For each comment or comment thread, assign one of three categories:

### Will Fix

The feedback is valid, actionable, and within the scope of this PR:

- Points out a bug, missing edge case, or incorrect behavior
- Requests a reasonable improvement to code this PR touches
- Identifies a missing or inadequate test
- Flags a security or performance concern in changed code

### Won't Fix

The feedback is not worth acting on:

- Style preference that contradicts the project's established conventions
- Suggestion that would significantly expand PR scope without clear benefit
- Based on a misunderstanding of the code or requirements
- Already addressed in a different part of the code (explain where)

### New Issue

The feedback is valid but out of scope for this PR:

- Identifies a real problem in code this PR did not change
- Suggests a feature enhancement beyond the PR's intent
- Points out tech debt that predates this PR
- Requests a refactor that would touch many files beyond the diff

### Present and confirm

Show the categorization as a table:

| # | Comment (truncated) | Author | Category | Rationale |
|---|---------------------|--------|----------|-----------|
| 1 | "This should handle null..." | reviewer1 | Will Fix | Valid edge case in changed code |
| 2 | "Consider using a factory..." | reviewer2 | New Issue | Refactor beyond PR scope |
| 3 | "I'd prefer const here..." | reviewer3 | Won't Fix | Project uses let per convention |

Ask: "Here's how I'd categorize the feedback. Want to adjust any categories before I start making fixes?"

**Wait for the user to confirm or adjust before proceeding to Step 4.**

## Step 4: Execute Fixes (TDD Style)

For each "Will Fix" item, follow the TDD loop below.

### 4a. Detect the test framework (once)

Check the project for its test setup — cache the result for all fixes:

- Read `package.json` for test scripts and dependencies (`jest`, `vitest`, `bun:test`, `mocha`, `pytest`, `rspec`, etc.)
- Look for config files (`jest.config.*`, `vitest.config.*`, `pytest.ini`, `.rspec`, etc.)
- Examine existing test files for import patterns and naming conventions
- Determine the test run command (e.g., `bun test`, `npm test`, `pytest`)

### 4b. TDD loop for each fix

1. **Read the relevant code** — open the file(s) referenced by the comment and understand current behavior
2. **Write or update a test** — create a test capturing the expected behavior from the feedback. Add to an existing test file if one exists for the module; otherwise create one following the project's naming convention
3. **Run the test to confirm it fails** — verify it fails for the expected reason. If it already passes, the behavior may already be correct — investigate and note this
4. **Implement the fix** — make the minimal code change to address the feedback
5. **Run the test to confirm it passes** — execute the specific test
6. **Run the full test suite** — check for regressions. If an unrelated test breaks, investigate and fix before moving to the next item

### 4c. Non-testable fixes

If a "Will Fix" comment doesn't lend itself to a test (e.g., improving a log message, fixing a typo, updating documentation), skip the TDD loop and make the fix directly. Note this in the summary.

### 4d. Track progress

For each fix, record:

- Which comment it addresses (by ID and summary)
- Which files were changed
- Which tests were added or modified
- Whether the full suite passes

## Step 5: Commit and Push

After all fixes are complete:

### 5a. Stage changes

Stage only files modified as part of the fixes. Use `git add <specific-files>` — do not use `git add -A` or `git add .`.

### 5b. Commit

Write a descriptive commit message referencing the PR number:

```
Address PR #<number> review feedback

- Fix: <brief description of fix 1>
- Fix: <brief description of fix 2>
- Test: <brief description of tests added/updated>

Addresses review comments from <reviewer1>, <reviewer2>.
```

### 5c. Push

```bash
git push
```

If the push fails because the remote has new commits, rebase and retry:

```bash
git pull --rebase && git push
```

If the rebase produces conflicts, **stop and inform the user** rather than auto-resolving.

## Step 6: Post Summary

### 6a. Summary table

Present a complete summary to the user:

**Will Fix (N items) — All addressed**

| Comment | Author | What was done | Files changed |
|---------|--------|---------------|---------------|
| "Handle null input..." | reviewer1 | Added null check + test | src/parser.ts, tests/parser.test.ts |

**Won't Fix (N items)**

| Comment | Author | Reason |
|---------|--------|--------|
| "Use const instead of let" | reviewer3 | Project convention uses let for reassigned variables |

**New Issue (N items)**

| Comment | Author | Suggested issue title |
|---------|--------|----------------------|
| "Factory pattern would help" | reviewer2 | Refactor: Extract factory for widget creation |

Include test results and the commit SHA: "All N tests passing (M new, K modified). Commit `abc1234` pushed to branch `feature/my-branch`."

### 6b. Post a PR comment (optional)

Ask: "Want me to post a summary comment on the PR listing what was addressed?"

If yes, use `gh pr comment {number} --body "..."` to post a markdown comment with:

- Which comments were addressed (with what was changed)
- Which were categorized as Won't Fix (with brief explanations)
- Which were deferred as New Issues

### 6c. Create issues for "New Issue" items (optional)

Ask: "Want me to create GitHub issues for the N 'New Issue' items?"

If yes, for each item:

```bash
gh issue create --title "<suggested title>" --body "<context from review comment, link to PR>"
```

Report back the created issue numbers and URLs.
