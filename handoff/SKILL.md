---
name: handoff
description: Writes the session's working state to a progress file so you can clear a bloated context and resume cheaply. Rewrites rather than appends, prefers pointers over summaries, and emits a self-check file that measures whether the handoff actually preserved what mattered.
---

# Handoff

Capture the current work state into `.claude/progress.md`, so the conversation can be cleared and resumed at a fraction of the token cost.

## Why this exists

In a long agentic session every turn re-reads the entire accumulated context. A file read is not charged once — it is charged again on every remaining turn. A 20k-token read with 40 turns left costs 800k tokens.

Clearing at 40% of the window and resuming from a 20k progress file, instead of continuing at 500k, saves roughly `remaining_turns × 480k`. The point of this skill is to make that clear safe.

This is not a substitute for auto-compaction — it is a better-timed, curated replacement for it. Auto-compaction fires late and you do not choose what survives.

## Arguments

- `/handoff` — write or rewrite the progress file
- `/handoff done` — archive the progress file and clear it (work finished, or moving to something else)
- `/handoff check` — score a resumed session against the checks file

---

## Step 1: Decide which mode is running

If the argument is `done`, go to **Step 7**. If it is `check`, go to **Step 8**. Otherwise continue.

## Step 2: Locate the progress file

The progress file lives at `.claude/progress.md`, relative to the repository root (`git rev-parse --show-toplevel`). If not in a git repository, use the current working directory and say so.

Create `.claude/` if it does not exist. If `.claude/progress.md` does not exist, this is the first handoff for this work — create it. Do not treat a missing file as an error.

**If `.claude/` cannot be created or written** — some sandboxed, headless, and CI environments deny writes to it — fall back to `progress.md` at the repository root and say clearly that you did. Losing the handoff entirely because of a permission gate is far worse than writing it one directory over. Note that the session hook only auto-loads the canonical `.claude/progress.md`, so a fallback file has to be read manually when resuming.

Check whether `.claude/` is ignored by git (`git check-ignore -q .claude`). If it is not ignored and the repository has no other committed `.claude/` content, mention once that the user may want to add `.claude/progress*.md` to `.gitignore`. Do not modify `.gitignore` without being asked.

## Step 3: Read the existing file before overwriting it

If a progress file already exists, read it first. You are **rewriting** it, not appending to it, and anything still true must survive the rewrite.

**Never append.** A progress file that grows with every handoff becomes the context bloat it was meant to prevent — it gets re-read at the start of every subsequent session. The file describes the *current* state, not the history of how you got here.

If the existing file describes different work (different goal, different branch), stop and ask whether to archive it first with `/handoff done` rather than silently discarding it.

## Step 4: State the conclusion, then point

The resumed session should be able to act **without opening a single file**. A
pointer that replaces a conclusion does not save anything — it defers the cost to
the reader, who then has to go dereference it. A handoff is written once and read
once, so work moved from writing to reading is not work saved.

This is measured, not assumed. In `evals/`, a version of this skill that led with
line-precise pointers cost the resuming agent **52% more tokens and 28% more
turns** than a plain prose summary, with no improvement in what it got right. The
extra reading was the pointers being followed.

So: **write the finding, and attach the location to it.**

> The consumer acks after charging, so a failed ack redelivers and double-charges
> — `src/queue/worker.ts`, in `processMessage()`.

Not `` `src/queue/worker.ts:18` `` on its own, which forces a read to learn
anything.

Prose is required for everything that **cannot** be recovered by reading the
repository, and this is the part that must never be compressed away:

- why an approach was rejected, and the constraint that killed it
- what was tried and failed, and how it failed
- what the user actually asked for, in their framing
- what they explicitly ruled out
- decisions made and the reasoning behind them
- open questions and what they block

Paths, SHAs, and commands earn their place as *corroboration* — where to look to
confirm or go deeper. Prefer a file path to a file path plus line number: line
numbers go stale on the next edit and invite a lookup that the sentence should
already have made unnecessary.

## Step 5: Write the progress file

Use this structure. Omit sections that are genuinely empty rather than padding them.

```markdown
# Progress: <short title of the work>

repo: <repo name> | branch: <branch> | head: <short sha>
updated: <ISO 8601 timestamp>

## Goal
What we are trying to accomplish, in the user's framing. Two or three sentences.

## State
- [x] What is done (with pointers)
- [ ] What is in progress
- [ ] What is next

## Pointers
Files, line references, commands, SHAs, PRs, URLs. The map back into the work.

## Decisions
What was decided and why. Include the reasoning, not just the conclusion.

## Dead ends
What was tried that did not work, and how it failed. This is the section most
often lost in a clear, and the most expensive to rediscover.

## Open questions
Unresolved things, and what each one blocks.

## Last exchange
The final user message and the substance of the reply, verbatim enough to
re-anchor. This is the "we were exactly here" marker, not the main content.
```

Get the stamp values from `git rev-parse --abbrev-ref HEAD`, `git rev-parse --short HEAD`, and the current UTC time. These drive the staleness guard in the session hook.

## Step 6: Write the checks file

Write `.claude/progress.checks.md`. This is what makes the handoff testable instead of hoped-for.

Generate 6 to 8 questions whose answers are knowable **only** from the session that is about to be cleared — not from reading the repository. Good questions probe the lossy parts:

- "Why did we reject <approach>?"
- "What did <command> return when we ran it, and what did we conclude?"
- "What is the next step, and what is blocking it?"
- "Which file holds <thing we found>?"
- "What did the user say they did *not* want?"

Answer each one now, while full context is still live. Those answers are the ground truth.

```markdown
# Handoff checks

Generated: <timestamp> | against: progress.md @ <head sha>

Re-answer these after resuming from a cleared context, then run
`/handoff check` to score. Questions the resumed session cannot answer
are what the progress file failed to carry.

## Q1. <question>
**Expected:** <answer as of the pre-clear session>

## Q2. <question>
**Expected:** <answer>
...
```

Then tell the user the file is written, note how many checks were generated, and stop. Do not clear the context yourself — clearing is the user's action.

## Step 7: `/handoff done`

The work is finished or being set aside.

1. Read `.claude/progress.md`. If it does not exist, say so and stop.
2. Create `.claude/progress-archive/` if needed.
3. Move the file to `.claude/progress-archive/<YYYY-MM-DD>-<slug>.md`, where the slug comes from the progress title, lowercased and hyphenated. If that path exists, append `-2`, `-3`, and so on.
4. Append a closing stamp to the archived file: the final state, and one line on how the work actually ended.
5. Delete `.claude/progress.checks.md` — it describes a session that no longer exists.
6. Confirm what was archived and where.

Archive rather than delete. It costs nothing, it silences the session hook, and it leaves a record of how the work went.

## Step 8: `/handoff check`

Run this in a **resumed** session, after clearing and reloading the progress file.

1. Read `.claude/progress.checks.md`.
2. Answer every question using only what is currently in context — the progress file and anything read since. Do not consult the archive.
3. Compare each answer against its **Expected** value.
4. Report a table: question, hit or miss, and for each miss, what the progress file should have carried.
5. Give the score as `n/total`.

A miss is not a failure of the resumed session — it is a defect in the progress file. Every miss should produce a concrete fix to the template or to what Step 4 and Step 5 chose to record. Say what that fix is.

## The session hook

`scripts/session-start.sh` reloads the progress file automatically when a new session starts, so resuming requires nothing to remember.

Context reaches the model through `hookSpecificOutput.additionalContext`; plain stdout only lands in the transcript. Warnings go to `systemMessage`, since a warning is for the human, not the model.

It refuses to inject in three cases, each of which is worse than staying quiet:

- **no progress file** — nothing to say
- **stale** — a file from a different branch or from days ago arrives looking current
- **oversized** — a bloated file re-injected on every session is exactly the context bloat this skill exists to prevent

Wire it up in `settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash \"$HOME/.claude/skills/handoff/scripts/session-start.sh\""
          }
        ]
      }
    ]
  }
}
```

Tunable with `HANDOFF_MAX_AGE_DAYS` (default 3), `HANDOFF_MAX_BYTES` (default 24000, roughly 6k tokens), and `HANDOFF_IGNORE_BRANCH=1` to skip the branch check.

The script needs `jq` or `python3` to emit its JSON payload. With neither available it exits silently rather than printing text that would be mistaken for context.
