---
name: review-repo
description: Reports what is in flight in a repository — open pull requests and local branches that are unpushed, PR-less, or already merged. Gathers PR and branch state in parallel subagents so the raw command output never enters the main context, then cross-references them into one prioritized picture.
---

# Review Repo

Answer one question: **what is outstanding in this repository right now, and what needs my attention first.**

Two sources — GitHub's view (pull requests) and the local checkout's view (branches) — collected concurrently by subagents, then reconciled. The subagents exist so that pages of `gh` and `git` output stay in their contexts and only the conclusions come back.

## Step 1: Establish context

```bash
gh repo view --json nameWithOwner,defaultBranchRef -q '.nameWithOwner + " default=" + .defaultBranchRef.name'
```

If this fails, there is no GitHub remote or `gh` is not authenticated. Say so and fall back to the branch half only — it still works with plain `git`.

Use the reported default branch everywhere below; do not assume `main`. Call it `<base>`.

## Step 2: Dispatch both collectors in parallel

Launch these as **two subagents in a single message** so they run concurrently. Each returns a compact JSON payload and nothing else.

### Subagent A — pull requests

> Run this and return only the JSON described below.
>
> ```bash
> gh pr list --state open --limit 100 --json number,title,author,isDraft,createdAt,updatedAt,headRefName,baseRefName,reviewDecision,mergeable,mergeStateStatus,statusCheckRollup,additions,deletions,changedFiles
> ```
>
> For each PR, reduce `statusCheckRollup` to one of `passing`, `failing`, `pending`, or `none` — it is an array of check runs, and any failure makes the PR `failing`, otherwise any pending makes it `pending`.
>
> Return:
> ```json
> {"prs":[{"number":0,"title":"","headRefName":"","isDraft":false,"ageDays":0,"staleDays":0,"reviewDecision":"","mergeable":"","checks":"","size":0}]}
> ```
> `ageDays` is from `createdAt`, `staleDays` from `updatedAt`, `size` is `additions + deletions`. Do not editorialize; return data.

### Subagent B — local branches

> Run these and return only the JSON described below.
>
> ```bash
> git for-each-ref --format='%(refname:short)|%(upstream:short)|%(upstream:track)|%(committerdate:iso8601)|%(authorname)' refs/heads
> git branch --no-merged <base> --format='%(refname:short)'
> git branch --merged <base> --format='%(refname:short)'
> git worktree list --porcelain
> ```
>
> `%(upstream:track)` is empty when in sync, `[gone]` when the remote branch was deleted, and `[ahead N]` / `[behind N]` / `[ahead N, behind M]` otherwise.
>
> For each local branch return:
> ```json
> {"branches":[{"name":"","upstream":null,"track":"","mergedIntoBase":false,"lastCommitDays":0,"author":"","inWorktree":false}]}
> ```
> `upstream` is null when the branch has never been pushed. Do not editorialize; return data.

## Step 3: Cross-reference

Join the two payloads on branch name (`headRefName` ↔ `name`) and classify every branch into exactly one bucket:

| bucket | condition | why it matters |
|---|---|---|
| **At risk** | no upstream, not merged into `<base>` | work that exists only on this machine — an unbacked-up branch is the only genuinely lossy state here |
| **Needs a PR** | has upstream, no open PR, not merged | pushed and then forgotten |
| **Needs attention** | open PR that is failing, blocked, conflicted, or has changes requested | someone is waiting on you |
| **Waiting on others** | open PR, green, `REVIEW_REQUIRED` or approved-and-unmerged | you are not the blocker |
| **Draft** | open PR marked draft | in progress by choice |
| **Deletable** | merged into `<base>`, or upstream `[gone]` | cleanup |

A PR whose `headRefName` matches no local branch is still reported — it just means the branch is not checked out here.

`mergeable` is frequently `UNKNOWN`: GitHub computes it lazily and returns that until the background job finishes. **`UNKNOWN` is not a conflict.** Report it as unknown, or re-request that one PR to settle it — never bucket it as blocked on the strength of a value GitHub has not computed yet.

## Step 4: Report

Lead with the counts, then the buckets in the order above. Within each bucket sort by staleness, oldest first.

```
<owner>/<repo> — 3 open PRs, 7 local branches

AT RISK (never pushed)
  spike/queue-backpressure    11 days old, 4 commits ahead of <base>

NEEDS A PR
  fix/webhook-ordering        pushed 6 days ago, no PR

NEEDS ATTENTION
  #42 Fix double-charge       CI failing, 3 days stale, +180/-22
  #38 Bump deps               conflicted with <base>

WAITING ON OTHERS
  #45 Add retry logic         approved, unmerged for 2 days

DELETABLE
  chore/lint-pass             merged into <base>
  old/experiment              upstream gone
```

Then a short **what I would do first** — at most three items, each naming the concrete next command or action. Prefer the At risk and Needs attention buckets; a branch that exists only locally and a PR that is blocking someone are the two things that actually cost something to leave alone.

If a bucket is empty, omit it rather than printing a header with nothing under it.

## Notes

- Everything here is read-only. This skill never pushes, deletes, merges, or closes anything. If cleanup is warranted, say what to run and let the user run it.
- On a repo with no GitHub remote, Step 2 runs subagent B only and the report contains just the branch buckets.
- `gh` older than 2.x may not support every `--json` field above; if a field is rejected, drop it and note the degraded output rather than failing.
