---
name: handoff
description: Writes the session's working state to a progress file so you can clear a bloated context and resume cheaply. Rewrites rather than appends, prefers pointers over summaries, and emits a self-check file that measures whether the handoff actually preserved what mattered.
---

# Handoff

Capture the current work state into `.handoff/<lane>.md`, so the conversation can be cleared and resumed at a fraction of the token cost. The lane keys the file to the seat you are running in (see Step 2), not to the repository, so multiple sessions sharing a repo each get their own file.

## Why this exists

In a long agentic session every turn re-reads the entire accumulated context. A file read is not charged once — it is charged again on every remaining turn. A 20k-token read with 40 turns left costs 800k tokens.

Clearing at 40% of the window and resuming from a 20k progress file, instead of continuing at 500k, saves roughly `remaining_turns × 480k`. The point of this skill is to make that clear safe.

This is not a substitute for auto-compaction — it is a better-timed, curated replacement for it. Auto-compaction fires late and you do not choose what survives.

## Arguments

- `/handoff` — write or rewrite the progress file
- `/handoff done` — archive the progress file and clear it (work finished, or moving to something else)
- `/handoff check` — score a resumed session against the checks file
- `/handoff install` — register the session hook, so the progress file reloads by itself; `--idle-timer` also arms an opt-in Stop hook that submits `/handoff` for you if the session goes idle

---

## Step 1: Decide which mode is running

If the argument is `done`, go to **Step 7**. If it is `check`, go to **Step 8**. If it is `install`, go to **Step 9**. Otherwise continue.

## Step 2: Locate the progress file

Resolve the **lane** first. A lane is whatever survives `/clear` (a pane, not the workspace it sits in), not the repository, so keying the filename by lane is what lets several sessions share a repo without overwriting each other's state. Get it by running the shared resolver script rather than re-deriving it:

```bash
lane="$(bash "$CLAUDE_SKILL_DIR/scripts/lane.sh")"
```

If that variable is not set, use the directory this `SKILL.md` was loaded from. `lane.sh` takes the first of these that is set, sanitized so an unexpected value cannot walk the path outside `.handoff/`:

1. `$HANDOFF_LANE`
2. `$HERDR_PANE_ID` (herdr's pane-scoped id — not `$HERDR_WORKSPACE_ID`, which is shared by every tab and pane in a workspace and would collapse them onto one lane)
3. `$TMUX_PANE`
4. the literal `progress`, if none of the above are set — this reproduces today's single-file behavior for a session with no resolvable lane

The progress file lives at `.handoff/<lane>.md`, relative to the repository root (`git rev-parse --show-toplevel`). If not in a git repository, use the current working directory and say so.

Create `.handoff/` if it does not exist. If `.handoff/<lane>.md` does not exist, this is the first handoff for this lane — create it. Do not treat a missing file as an error.

**Stale lanes are not cleaned up.** Nothing prunes `.handoff/<lane>.md` when its pane or workspace closes without `/handoff done`. A tmux or herdr pane id can be reused after a restart, so a session that inherits a reused or hand-set lane id also inherits whatever stale state a previous, unrelated session left in that file. There is no automatic detection for this today; treat an unexpectedly-populated lane file as a sign the id may be recycled.

**Deliberately not `.claude/`.** That directory is treated as a sensitive path and writes to it are denied outright in sandboxed, headless, and CI contexts, with no way to grant permission non-interactively. A handoff that silently produces no file is worse than no handoff at all. `.handoff/` is an ordinary directory, so there is one canonical location and no fallback to reason about. `.claude/` is also Claude Code's *configuration* directory — settings, skills, agents — and session state is not configuration.

Check whether `.handoff/` is ignored by git (`git check-ignore -q .handoff`). If it is not, mention once that the user may want to add `.handoff/` to `.gitignore`. Do not modify `.gitignore` without being asked.

## Step 3: Read the existing file before overwriting it

If a progress file already exists, read it first. You are **rewriting** it, not appending to it, and anything still true must survive the rewrite.

**Never append.** A progress file that grows with every handoff becomes the context bloat it was meant to prevent — it gets re-read at the start of every subsequent session. The file describes the *current* state, not the history of how you got here.

If the existing file describes different work (different goal, different branch), stop and ask whether to archive it first with `/handoff done` rather than silently discarding it.

## Step 4: State the conclusion, then point

The resumed session should be able to act **without opening a single file**. A
pointer that replaces a conclusion does not save anything — it defers the cost to
the reader, who then has to go dereference it. A handoff is written once and read
once, so work moved from writing to reading is not work saved.

This is measured, not assumed. In `evals/handoff/`, a version of this skill that led with
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

Write `.handoff/<lane>.checks.md`, using the same lane resolved in Step 2. This is what makes the handoff testable instead of hoped-for.

Generate 6 to 8 questions whose answers are knowable **only** from the session that is about to be cleared — not from reading the repository. Good questions probe the lossy parts:

- "Why did we reject <approach>?"
- "What did <command> return when we ran it, and what did we conclude?"
- "What is the next step, and what is blocking it?"
- "Which file holds <thing we found>?"
- "What did the user say they did *not* want?"

Answer each one now, while full context is still live. Those answers are the ground truth.

```markdown
# Handoff checks

Generated: <timestamp> | against: <lane>.md @ <head sha>

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

1. Resolve the lane as in Step 2.
2. Read `.handoff/<lane>.md`. If it does not exist, say so and stop.
3. Create `.handoff/progress-archive/` if needed.
4. Move the file to `.handoff/progress-archive/<YYYY-MM-DD>-<lane>-<slug>.md`, where the slug comes from the progress title, lowercased and hyphenated. If that path exists, append `-2`, `-3`, and so on.
5. Append a closing stamp to the archived file: the final state, and one line on how the work actually ended.
6. Delete `.handoff/<lane>.checks.md` — it describes a session that no longer exists.
7. Confirm what was archived and where.

Archive rather than delete. It costs nothing, it silences the session hook, and it leaves a record of how the work went.

## Step 8: `/handoff check`

Run this in a **resumed** session, after clearing and reloading the progress file.

1. Resolve the lane as in Step 2, then read `.handoff/<lane>.checks.md`.
2. Answer every question using only what is currently in context — the progress file and anything read since. Do not consult the archive.
3. Compare each answer against its **Expected** value.
4. Report a table: question, hit or miss, and for each miss, what the progress file should have carried.
5. Give the score as `n/total`.

A miss is not a failure of the resumed session — it is a defect in the progress file. Every miss should produce a concrete fix to the template or to what Step 4 and Step 5 chose to record. Say what that fix is.

## Step 9: `/handoff install`

Register the session hook. Run `scripts/install-hook.sh` from this skill's own directory:

```bash
bash "$CLAUDE_SKILL_DIR/scripts/install-hook.sh"
```

If that variable is not set, use the directory this `SKILL.md` was loaded from. The script writes to `~/.claude/settings.json` by default; pass `--local` for `~/.claude/settings.local.json` (machine-local, usually gitignored), `--project` for the current repo's `.claude/settings.json`, or `--target <file>` for anything else. Ask which scope the user wants only if they have not already said — otherwise take the default.

Pass `--idle-timer` to also register the idle timer described in **The idle timer** below. It is opt-in — a plain install only ever registers the session-reload hook, since auto-submitting text into a live session is intrusive enough that it must not arrive switched on by default.

It is idempotent. Re-running reports "already registered" and changes nothing, so it is safe to offer whenever the hook does not appear to be firing. Report what it printed, and that a new session or `/clear` is needed for the hook to take effect.

`--uninstall` reverses it, removing both hooks. Combined with `--idle-timer` (`--uninstall --idle-timer`), it removes only the idle timer and leaves the session-reload hook in place — that is how to turn the timer off without losing the reload. `--dry-run` prints the resulting file without writing.

If the script is missing — an older install, or a copy that did not ship it — fall back to editing the settings file directly with the JSON in **The session hook** below.

## The session hook

`scripts/session-start.sh` reloads the progress file automatically when a new session starts, so resuming requires nothing to remember. It resolves the lane the same way Step 2 does and loads only that lane's file, never another seat's.

Context reaches the model through `hookSpecificOutput.additionalContext`; plain stdout only lands in the transcript. Warnings go to `systemMessage`, since a warning is for the human, not the model.

It refuses to inject in three cases, each of which is worse than staying quiet:

- **no progress file for this lane** — nothing to say
- **stale** — a file from a different branch or from days ago arrives looking current
- **oversized** — a bloated file re-injected on every session is exactly the context bloat this skill exists to prevent

### Installing it

`/handoff install` (Step 9) is the supported path. Nothing registers this hook on your behalf: `skills add` copies a skill directory and stops — it has no hook-installation mechanism at all — so until something writes it into a settings file, `session-start.sh` ships as an inert file and the skill silently behaves as though it had no hook.

The equivalent by hand, in `settings.json`:

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

Tunable with `HANDOFF_LANE` to name the seat explicitly (falls back to `$HERDR_PANE_ID`, then `$TMUX_PANE`, then `progress`), `HANDOFF_MAX_AGE_DAYS` (default 3), `HANDOFF_MAX_BYTES` (default 24000, roughly 6k tokens), and `HANDOFF_IGNORE_BRANCH=1` to skip the branch check.

If a lane var resolves to a file that has never been written but a pre-seat-keying `.handoff/progress.md` exists, the hook reports that once via `systemMessage` instead of silently doing nothing — that file is orphaned and needs a manual rename to `.handoff/<lane>.md`, or a `/handoff done` to archive it.

The script needs `jq` or `python3` to emit its JSON payload. With neither available it exits silently rather than printing text that would be mistaken for context. `install-hook.sh` requires `python3` specifically, and prints the JSON block above if it is missing.

## The idle timer

`scripts/idle-timer.sh` is an opt-in `Stop` hook. At the end of every turn it cancels whatever timer the lane already had armed, then arms a fresh detached one for `HANDOFF_IDLE_MINUTES` (default 58) — comfortably under the ~60 minute prompt-cache TTL this exists to beat. If the session actually goes idle that long, the timer injects `/handoff` into the live pane, so the progress file gets written before the cache lapses and the next turn re-uploads the whole accumulated context at the write rate instead of resuming from cache.

**It never triggers `/clear`.** The handoff write is the user's manual signal that clearing is safe, not something to automate out from under them. The timer's only job is to get `/handoff` submitted in the live pane; it stops there.

The timer cannot write the progress file itself: summarizing working state has to happen in the model's own session, not in a detached script. Injecting the slash command into the live pane is the only way to hand the writing back to the session that can actually do it.

### It requires tmux or herdr

Injection needs something to inject into. With neither `$TMUX_PANE` nor `$HERDR_PANE_ID` set, there is no way to submit text into a bare terminal — OS-level UI automation is a different, fragile category and out of scope here — so the hook exits without arming anything. A session running in a plain terminal sees no timer and no error; that is the intended behavior, not a bug to chase down.

### Installing and removing it

It is opt-in on purpose: auto-submitting text into a session someone is actively typing in is intrusive, so a plain `/handoff install` never registers it.

- `/handoff install --idle-timer` registers both the timer and the `SessionStart` reload hook.
- `/handoff install --uninstall --idle-timer` removes only the timer, leaving the reload hook in place.
- `/handoff install --uninstall` (no `--idle-timer`) removes both.
- `HANDOFF_IDLE_TIMER=0` disables the timer at runtime without touching the installed hook. Any timer already armed is still cancelled by the next turn's Stop hook; the runtime switch just stops a new one from replacing it.

### What it writes

Two extra files show up in `.handoff/`, both scoped to the lane:

- `<lane>.timer.pid` — the armed timer's pid and a random token, so the next turn's Stop hook can find and cancel it. The token guards against a recycled pid being mistaken for the timer that wrote it.
- `<lane>.draft.txt` — appears only if there was text sitting in the input box when the timer fired. Injecting `/handoff` has to clear that line first, or the injected command concatenates with whatever was typed and submits as prose, silently producing no handoff. Before clearing the line, the timer salvages it into this file rather than destroying it.

### Guards

Three things make the Stop hook a no-op:

- **a subagent turn** — a subagent shares the parent session's transcript but not its pane, and arming or cancelling on its behalf would race the real turns happening in that same pane. This is checked before anything else, so a subagent turn skips even cancelling the lane's existing timer.
- **the transcript is under `HANDOFF_IDLE_MIN_BYTES`** (default 2000) — a turn or two in, there is nothing worth writing yet, though any previously-armed timer is still cancelled.
- **`.handoff/<lane>.md` was written within the last `HANDOFF_IDLE_COOLDOWN_SECONDS`** (default 120) — including by the `/handoff` this same timer might have just injected, so a fresh write does not immediately get a new timer armed on top of it. Again, the old timer is still cancelled.

### The herdr path is unverified

The tmux injection (`tmux send-keys`) was confirmed end to end against a live session. The herdr equivalent (`herdr pane run`) is implemented by analogy to the same one-call send-and-submit shape, but has not been run against a real herdr pane the way the tmux path has — treat it as best-effort until someone confirms it.

### Environment variables

- `HANDOFF_IDLE_MINUTES` (default `58`) — idle window before firing
- `HANDOFF_IDLE_SECONDS` — overrides `HANDOFF_IDLE_MINUTES` in raw seconds, for tests that should not sleep for real minutes
- `HANDOFF_IDLE_TIMER=0` — disable arming at runtime without uninstalling
- `HANDOFF_IDLE_MIN_BYTES` (default `2000`) — transcript-size floor below which nothing arms
- `HANDOFF_IDLE_COOLDOWN_SECONDS` (default `120`) — skip re-arming this soon after a fresh `.handoff/<lane>.md` write
