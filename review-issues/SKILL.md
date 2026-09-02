---
name: review-issues
description: Finds open GitHub issues that nobody has picked up — no review label, no pull request attached — and ranks them easiest to hardest. A subagent per candidate reads the issue and the code it touches to estimate effort against fixed bands, so the ranking is grounded in the repository rather than in issue titles.
---

# Review Issues

Answer one question: **which unclaimed issue should I pick up next, and what is the cheapest one on the board.**

An issue qualifies as unclaimed when it has no review label and no pull request attached to it. Every candidate is then sized by its own subagent, which actually looks at the code, so "easy" means easy in this repository and not easy-sounding in the title.

## Arguments

- `/review-issues` — current repository
- `/review-issues owner/repo` — a different repository
- `/review-issues --label triage` — treat `triage` as the claim marker instead of the default

## Step 1: Establish context

```bash
gh repo view --json nameWithOwner,defaultBranchRef -q '.nameWithOwner'
```

Split into `<owner>` and `<repo>`. If `gh` is unauthenticated or the repo has no GitHub remote, stop and say so — there is nothing to do without the issue tracker.

## Step 2: Fetch and filter (one subagent)

`gh issue list --json` has **no field for linked pull requests**. That link only exists in the GraphQL timeline, so this query is required — do not substitute a REST call and do not infer linkage from the issue title.

Dispatch one subagent with this instruction:

> Run this and return only the JSON described below.
>
> ```bash
> gh api graphql -f owner=<owner> -f repo=<repo> -F n=100 -f query='
> query($owner:String!,$repo:String!,$n:Int!){
>   repository(owner:$owner,name:$repo){
>     issues(states:OPEN,first:$n,orderBy:{field:UPDATED_AT,direction:DESC}){
>       nodes{
>         number title body createdAt updatedAt
>         labels(first:20){nodes{name}}
>         assignees(first:5){nodes{login}}
>         comments{totalCount}
>         timelineItems(first:50,itemTypes:[CROSS_REFERENCED_EVENT,CONNECTED_EVENT]){
>           nodes{
>             __typename
>             ... on CrossReferencedEvent{ source{ ... on PullRequest{ number state } } }
>             ... on ConnectedEvent{ subject{ ... on PullRequest{ number state } } }
>           }
>         }
>       }
>     }
>   }
> }'
> ```
>
> Drop an issue when **either** holds:
> - any label matches `/review/i` (or the label given as `--label`)
> - it has a linked pull request whose state is `OPEN` or `MERGED`
>
> A linked PR in state `CLOSED` does **not** disqualify the issue — that work was abandoned and the issue is available again. Note those explicitly.
>
> Return:
> ```json
> {"candidates":[{"number":0,"title":"","bodyExcerpt":"","labels":[],"assignees":[],"comments":0,"ageDays":0,"hadAbandonedPR":null}],
>  "excluded":[{"number":0,"reason":""}]}
> ```
> `bodyExcerpt` is the first ~400 characters. Do not estimate effort; that is the next stage.

Report the counts before spending anything further: how many open, how many excluded and why, how many candidates remain.

If there are more than 12 candidates, take the 12 most recently updated and say plainly that you capped it and how many were left out. Do not silently truncate.

## Step 3: Size each candidate (one subagent per issue)

Launch these **concurrently, in a single message**. Each gets one issue and returns one JSON object.

> You are estimating implementation effort for issue #N in this repository.
>
> Title: `<title>`
> Body: `<body>`
>
> Read the repository well enough to ground the estimate — locate the files this would touch, check whether tests exist for that area, and look for anything that makes it harder than it sounds (a public API change, a migration, a dependency bump, an unresolved product question).
>
> Do not implement anything. Do not modify files.
>
> Use these bands exactly. They are fixed so estimates from different subagents are comparable:
>
> | band | meaning |
> |---|---|
> | `XS` | under 30 minutes; one file, no new tests needed |
> | `S` | under 2 hours; a few files, tests follow an existing pattern |
> | `M` | half a day; multiple modules or a new test surface |
> | `L` | 1–2 days; cross-cutting, or needs a migration or API change |
> | `XL` | more than 2 days, or needs decomposition before it can start |
>
> Return only:
> ```json
> {"number":0,"band":"","confidence":"high|medium|low","files":[""],
>  "approach":"one sentence","unknowns":[""],"blockedBy":null}
> ```
> `confidence` is `low` when the issue does not say enough to size it — say so rather than guessing a band you cannot defend. `blockedBy` names a dependency or an unanswered question if one exists, otherwise null.

## Step 4: Rank and report

Order by band (`XS` → `XL`), then within a band by fewest unknowns, then by age (oldest first — a stale easy issue is the best thing on the board).

```
<owner>/<repo> — 22 open, 14 excluded, 8 candidates sized

XS  #56  kanban-viewer: AgentName union omits Sosa
         ~20m · packages/viewer/src/types.ts · high confidence
         Add the missing union member and the two switch arms that fail without it.

S   #61  Typed ingress commands
         ~90m · 3 files · medium confidence
         Unknowns: whether the existing command enum is public API.

M   #57  Mission can end after post-checks without Task update
         ~4h · 5 files · medium confidence
         Blocked by: no repro documented.

L   #63  ateam CLI runaway heap to 76GB RSS
         low confidence — needs profiling before it can be sized honestly.
```

Then a **start here** line naming one issue and why, and a **do not start** line for anything `low` confidence or `blockedBy` — those need a decision or a repro before they are work, and picking one up is how an afternoon disappears.

Call out any issue whose linked PR was closed unmerged. Somebody already tried it, and the reason it was abandoned is usually worth knowing before starting again.

## Notes

- Read-only. This skill never comments on, labels, assigns, or closes anything.
- Effort bands are the agent's estimate against this codebase, not a commitment. A `low` confidence estimate is information about the issue's specification, not about the code.
- The GraphQL query pages at 100 issues and 50 timeline items per issue. On a busier tracker, say that the window was hit rather than reporting a partial board as complete.
