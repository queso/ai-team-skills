---
name: address-pr-feedback
description: Runs an unattended review loop on a pull request. Fetches review comments, categorizes each as Will Fix / Won't Fix / New Issue, fixes what should be fixed using TDD, commits, pushes, replies to every thread, then rechecks every 5 minutes and repeats until 15 minutes pass with no new feedback.
---

# Address PR Feedback

Fetch all review comments on a pull request, categorize them, fix what should be fixed using TDD, push, reply to every thread, and then keep watching the PR. Each pass handles only feedback that arrived since the previous pass. The loop ends once 15 minutes go by with nothing new to act on.

This skill runs **without confirmation prompts**. It decides categories and reply wording itself and posts them. Once started, the only reasons it stops early are listed under "Exit conditions" in Step 7.

## Arguments

- A PR number or URL. Optional. Falls back to the current branch's PR.
- `--once`: run a single pass and stop. Skips Step 7.
- `--create-issues`: open a GitHub issue for each New Issue item. Off by default because issue creation is visible to the whole repo and is not reversible by this skill.

## Step 1: Identify the Pull Request

Determine which PR to work on using this priority order:

1. **`$ARGUMENTS` provided**: if the user passed a PR number or URL, use it directly.
   - A number like `42` → `gh pr view 42`
   - A URL like `https://github.com/owner/repo/pull/42` → extract the number and use it
2. **Current branch has a PR**: run `gh pr view --json number,url,title,state` to detect a PR for the current branch.
3. **Ask the user**: if neither works, ask for a PR number or URL. This is the one point where the skill waits on input.

Validate that the PR is in an `OPEN` state. If it is merged or closed, inform the user and stop.

Store these for later steps:

- PR number, URL, and head branch name
- Repo owner and name: `gh repo view --json owner,name --jq '.owner.login + "/" + .name'`
- PR author login: from `gh pr view --json author`
- Operator login, the account this skill posts as: `gh api user --jq .login`

The operator is usually the PR author, but not always. Both logins are excluded when filtering feedback so the skill never treats its own replies as new review comments.

Confirm the local checkout is on the PR's head branch and is clean. If it is on a different branch, check out the head branch. If there are uncommitted changes, stop and tell the user; the skill must not commit work it did not produce.

## Step 2: Fetch Review Comments

Collect comments from three GitHub API sources. Consult `references/gh-api-examples.md` for the exact commands and response shapes.

### 2a. Inline code review comments

```bash
gh api repos/{owner}/{repo}/pulls/{number}/comments --paginate
```

Capture: `id`, `node_id`, `body`, `path`, `line` (or `original_line`), `diff_hunk`, `user.login`, `user.type`, `created_at`, `in_reply_to_id`. The `node_id` is needed later to look up thread IDs for resolution.

### 2b. Conversation-level comments

```bash
gh api repos/{owner}/{repo}/issues/{number}/comments --paginate
```

Capture: `id`, `body`, `user.login`, `user.type`, `created_at`.

### 2c. Review summaries

```bash
gh pr view {number} --json body,reviews,author
```

Extract actionable feedback from review bodies, especially those with `CHANGES_REQUESTED` state.

### 2d. Filter out noise

Skip comments that are:

- **From the PR author or the operator**: self-comments and this skill's own replies
- **CI/infrastructure bots**: `dependabot`, `codecov`, `netlify`, `vercel`, and similar bots that do not review code. **Keep** comments from code review bots like `coderabbitai`, `github-actions`, `pr-agent`, `codeclimate`, `sonarcloud`. Those are categorized like any other reviewer
- **Non-substantive**: fewer than 10 characters after stripping whitespace and emoji
- **Already resolved**: inline threads whose `isResolved` is true

Group reply chains together. If a comment has `in_reply_to_id`, attach it to the parent thread rather than treating it as separate feedback.

### 2e. Keep a ledger

Maintain an in-memory ledger for the whole run:

- `seen_ids`: every comment and review ID fetched so far, regardless of whether it was actionable
- `last_fetch_at`: the timestamp of the most recent fetch, in ISO 8601 UTC
- `quiet_since`: the time the most recent batch of replies was posted, or the run start time if nothing has been posted yet
- `passes`: how many passes have completed

On the first pass, every unresolved actionable comment is in scope. On later passes, only comments whose ID is not in `seen_ids` are in scope. See Step 7 for how that narrows the work.

Log the count: "Pass N: found **X** actionable review comments (Y inline, Z conversation-level)."

If zero actionable comments on the first pass, say so and go straight to Step 7 with `quiet_since` set to the run start. The PR may still receive comments.

## Step 3: Categorize Each Comment

Assign one of three categories to each comment or thread. Do this without asking the user. Print the table so the decision is visible in the transcript.

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

### Tie-break rules

Because no one confirms these decisions, apply these rules when a comment could go either way:

- If the fix is small, local to files this PR already changes, and does not alter public behavior beyond what the reviewer asked for, choose **Will Fix** over Won't Fix.
- If the point is valid but the change would touch files outside the diff, choose **New Issue** over Won't Fix.
- Choose **Won't Fix** only when you can state a concrete reason a maintainer would accept: a project convention with a file to cite, a factual misreading you can point at in the code, or an existing implementation elsewhere.
- A reviewer replying inside a thread the skill already answered is new feedback. If they say a fix is incomplete, treat it as a new Will Fix item. If they push back on a Won't Fix with a reason you had not considered, re-evaluate it fresh. If they push back on the same Won't Fix a second time, do not argue in the thread. Reply once that you are leaving the decision to the PR author, then stop the loop and hand off to the user (see Step 7).

### Print the categorization

| # | Comment (truncated) | Author | Category | Rationale |
|---|---------------------|--------|----------|-----------|
| 1 | "This should handle null..." | reviewer1 | Will Fix | Valid edge case in changed code |
| 2 | "Consider using a factory..." | reviewer2 | New Issue | Refactor beyond PR scope |
| 3 | "I'd prefer const here..." | reviewer3 | Won't Fix | Project uses let per convention |

Number items continuously across passes so a reply can be traced back to a row in the transcript.

## Step 4: Execute Fixes (TDD Style)

Delegate all coding work to **SDET subagents**, specialized test-and-fix agents. See `references/sdet-agent.md` for the full agent prompt.

If there are no Will Fix items in this pass, skip to Step 6.

### 4a. Detect the test framework (once per run)

Check the project for its test setup and cache the result for every pass:

- Read `package.json` for test scripts and dependencies (`jest`, `vitest`, `bun:test`, `mocha`, `pytest`, `rspec`, etc.)
- Look for config files (`jest.config.*`, `vitest.config.*`, `pytest.ini`, `.rspec`, etc.)
- Examine existing test files for import patterns and naming conventions
- Determine the test run command (e.g., `bun test`, `npm test`, `pytest`)

### 4b. Group fixes for parallelization

Analyze the Will Fix items and group them by file independence:

- **Independent fixes** touch different files. These can run in parallel.
- **Dependent fixes** touch the same file, or need coordinated changes across files (renames, shared interfaces, lockfiles, shared config). These run sequentially inside one agent.

| Group | Fixes | Why |
|-------|-------|-----|
| Agent 1 | #1, #2 | Both touch `parser.ts`, run sequentially within one agent |
| Agent 2 | #3 | Independent, `api.ts` |
| Agent 3 | #4 | Independent, `validator.ts` |

### 4c. Spawn SDET subagents

For each group, spawn a **general-purpose** subagent with `model: "sonnet"`. Launch all groups as **parallel Agent tool calls in a single message**.

Each agent prompt must include:

1. The SDET role and workflow from `references/sdet-agent.md`
2. The test framework details from step 4a
3. The specific Will Fix item(s) assigned to this agent: reviewer's comment body, file path and line, and the diff hunk if available
4. Instructions to follow the TDD loop: write failing test, implement fix, verify, run full suite

### 4d. Collect results

Each agent reports which comments it addressed, files changed, tests added or modified, whether the suite passes, and any issues. If an agent reports a failing suite, spawn one more SDET agent to resolve it.

### 4e. Final test suite run

After all agents complete, run the full test suite once more to catch cross-agent conflicts. If it fails, spawn one SDET agent to fix the conflicts. If the suite still fails after that, do not commit. Stop the loop and report the failure to the user (see Step 7).

## Step 5: Commit and Push

### 5a. Stage changes

Stage only files modified by the fixes with `git add <specific-files>`. Do not use `git add -A` or `git add .`.

### 5b. Commit

```
Address PR #<number> review feedback (pass <N>)

- Fix: <brief description of fix 1>
- Fix: <brief description of fix 2>
- Test: <brief description of tests added/updated>

Addresses review comments from <reviewer1>, <reviewer2>.
```

Record the short SHA. Replies in Step 6 cite it.

### 5c. Push

```bash
git push
```

If the push fails because the remote has new commits, rebase and retry:

```bash
git pull --rebase && git push
```

If the rebase produces conflicts, abort the rebase, stop the loop, and report to the user. Do not auto-resolve.

## Step 6: Reply and Resolve

Every categorized comment gets a reply in the same pass. No draft review. Write the reply, post it, resolve the thread.

### 6a. New Issue handling

If `--create-issues` was passed, create an issue for each New Issue item before replying so the reply can link it:

```bash
gh issue create --title "<suggested title>" --body "<context from review comment, link to PR>"
```

Otherwise, the reply explains the deferral and the final summary lists the suggested issue titles for the user.

### 6b. Reply wording

Keep replies short, specific, and free of hedging. One to three sentences. Name what changed, or why nothing changed.

**Will Fix**: cite the commit and say what changed.

```
Fixed in <short-sha>. Added a null check on the input parameter and a test for the empty-input case.
```

**Won't Fix**: give the concrete reason from the tie-break rules.

```
Keeping the current approach. The project uses `let` for variables reassigned in this pattern, see CONTRIBUTING.md under "Variable declarations".
```

**New Issue**: reference the created issue, or explain the deferral.

```
Agreed, and this predates the PR. Split into #89.
```

```
Valid point, but out of scope here. The factory pattern would touch several modules this PR does not change. Suggest a follow-up.
```

Do not thank the reviewer in every reply, and do not apologize. Do not restate the reviewer's comment back to them.

### 6c. Post replies

Post each reply using the endpoints in `references/gh-api-examples.md`:

- **Inline review comments** (have a `path` and `line`): reply in the thread using the review comment replies endpoint
- **Conversation-level comments**: post a new issue comment that quotes enough of the original to make the target clear

Add every reply's ID to `seen_ids` as soon as it is posted.

### 6d. Resolve threads

Resolve every inline thread you replied to, in all three categories, using the GraphQL `resolveReviewThread` mutation. Get the thread ID from the root comment's `node_id` as shown in the reference. Batch the mutations when there are several.

Do not resolve a thread where you handed a decision back to the PR author (the second-pushback case in Step 3).

### 6e. Update the ledger

Set `quiet_since` to now. Increment `passes`. Print a pass summary:

**Pass N summary**

| # | Comment | Author | Category | Action | Thread |
|---|---------|--------|----------|--------|--------|
| 1 | "Handle null input..." | reviewer1 | Will Fix | Null check + test, `abc1234` | Replied, resolved |
| 2 | "Factory pattern..." | reviewer2 | New Issue | Deferred, suggested issue | Replied, resolved |
| 3 | "Use const..." | reviewer3 | Won't Fix | Cited CONTRIBUTING.md | Replied, resolved |

Include the test result line: "All N tests passing (M new, K modified). Commit `abc1234` pushed to `<branch>`."

If `--once` was passed, stop here.

## Step 7: Wait, Recheck, Repeat

The loop gives reviewers and review bots time to respond to the push, then handles whatever arrived.

### 7a. Wait

Sleep for 5 minutes using a single Bash call:

```bash
sleep 300
```

Set the Bash tool timeout to at least 330 seconds so the call is not cut short. Do not poll more often than this. Do not busy-wait with shorter sleeps.

### 7b. Recheck

Confirm the PR is still open. Then run Step 2 again. Use the `since` query parameter with `last_fetch_at` on both comment endpoints to keep the fetch small, and still drop anything already in `seen_ids`. Update `last_fetch_at`.

Fetch the review list again as well. A new review with state `CHANGES_REQUESTED` and a non-empty body counts as new feedback even if it has no inline comments.

Log one line: "Recheck at HH:MM UTC: X new actionable comments. Quiet for M minutes."

### 7c. Decide

- **New actionable feedback**: run Steps 3 through 6 on only the new items. Then return to 7a.
- **Nothing new, and now minus `quiet_since` is under 15 minutes**: return to 7a.
- **Nothing new, and now minus `quiet_since` is 15 minutes or more**: the loop is done. Go to the final summary.

With a 5-minute wait, the earliest normal exit is three consecutive quiet rechecks after the last reply batch.

### Exit conditions

The loop ends early, with a message explaining why, when any of these happen:

- The PR is merged or closed
- A push fails with rebase conflicts
- The test suite cannot be made green after one repair attempt
- A reviewer pushes back a second time on a Won't Fix decision (the skill will not argue in a thread)
- A reviewer asks the skill, or the author, to stop auto-replying
- Ten passes have completed. Review bots that re-review on every push can generate feedback indefinitely, and ten rounds is a reasonable ceiling for one unattended session

On early exit, still print the final summary and say exactly what needs a human decision.

### Final summary

When the loop ends, print a run-level summary covering every pass:

- Number of passes, commits pushed (with SHAs), total comments handled by category
- Suggested issue titles for New Issue items if `--create-issues` was not used
- Any threads left unresolved and why
- The exit reason
