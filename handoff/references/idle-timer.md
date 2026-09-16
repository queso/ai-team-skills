# Idle timer: installation, files written, and variables

Operational detail for the idle timer described under **The idle timer** in `SKILL.md`. That section says what the timer does and the one rule it never breaks (it never triggers `/clear`); this file holds how to install and remove it, what it writes, and the variables that tune it.

## Installing and removing it

It is opt-in on purpose: auto-submitting text into a session someone is actively typing in is intrusive, so a plain `/handoff install` never registers it.

- `/handoff install --idle-timer` registers both the timer and the `SessionStart` reload hook.
- `/handoff install --uninstall --idle-timer` removes only the timer, leaving the reload hook in place.
- `/handoff install --uninstall` (no `--idle-timer`) removes both.
- `HANDOFF_IDLE_TIMER=0` disables the timer without touching the installed hook. Set it in the `env` block of Claude Code's `settings.json`, or export it before launching Claude Code; hooks inherit the environment Claude Code was launched with, so exporting it in a shell during a session has no effect. Any timer already armed is still cancelled by the next turn's Stop hook; the switch just stops a new one from replacing it.

## What it writes

Two extra files show up in `.handoff/`, both scoped to the lane:

- `<lane>.timer.pid` — the armed timer's pid and a random token, so the next turn's Stop hook can find and cancel it. The token guards against a recycled pid being mistaken for the timer that wrote it.
- `<lane>.draft.txt` — appears only if there was text sitting in the input box when the timer fired. Injecting `/handoff` has to clear that line first, or the injected command concatenates with whatever was typed and submits as prose, silently producing no handoff. Before clearing the line, the timer salvages it into this file rather than destroying it. A long line that wrapped at the pane width is joined back into the one line you typed. A draft spanning several lines is salvaged in full, and in that case the timer writes the file and stops: it sends no `Ctrl+U` and no `/handoff`, because `Ctrl+U` in Claude Code clears only the current line and the leftover lines would submit with the command as prose. The cost is one redundant idle turn. When the pane is not showing the input box at all (no prompt marker, such as a pending permission dialog), the timer injects nothing; if the screen has any text on it, that full capture is written to this file under a header saying the marker was not found, otherwise no file is written.

The draft file holds the typed text verbatim, so if a password or private prose was sitting in the input box, that is what lands in the file. Nothing prunes it: it stays in `.handoff/` until you read it back and delete it. Keep both files out of git. This repo ignores `.handoff/` in its `.gitignore`; in another repo, `/handoff install --project --idle-timer` lists `.handoff/*.draft.txt` and `.handoff/*.timer.pid` in that repo's `.git/info/exclude`, while a user-level install is not tied to one repo and relies on the `.gitignore` reminder in Step 2.

## Environment variables

- `HANDOFF_IDLE_MINUTES` (default `58`) — idle window before firing
- `HANDOFF_IDLE_SECONDS` — overrides `HANDOFF_IDLE_MINUTES` in raw seconds, for tests that should not sleep for real minutes
- `HANDOFF_IDLE_TIMER=0` — disable arming without uninstalling (set in the `settings.json` `env` block or before launching Claude Code; a mid-session shell export does not reach the hook)
- `HANDOFF_IDLE_MIN_BYTES` (default `2000`) — transcript-size floor below which nothing arms
- `HANDOFF_IDLE_COOLDOWN_SECONDS` (default `120`) — skip re-arming this soon after a fresh `.handoff/<lane>.md` write
