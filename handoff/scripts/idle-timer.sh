#!/usr/bin/env bash
# Stop hook for the `handoff` skill: arms a detached idle timer that writes
# the progress file before the session's prompt cache lapses (~1 hour), even
# if nobody remembers to run /handoff by hand.
#
# HARD CONSTRAINT: this script may NEVER trigger /clear. The handoff write is
# the user's manual signal that clearing is safe, not something to automate
# out from under them. The timer's only job is to get /handoff submitted in
# the live pane; it stops there.
#
# Mechanism, in two modes inside this one file (a single file beats keeping
# the arm/fire halves in sync across two):
#
#   Stop hook mode (no args): runs at the end of every turn. Cancels
#   whatever timer this lane already had armed, then — if the turn looks
#   like the start of an idle stretch worth protecting — spawns a detached
#   copy of this same script in `--fire` mode and returns immediately. A
#   Stop hook cannot itself wait out an idle period; it can only hand the
#   waiting off to something that outlives it.
#
#   Fire mode (`--fire ...`): the detached process. Sleeps for the
#   configured idle window, re-checks that its assumptions still hold, then
#   injects `/handoff` into the live pane via `tmux send-keys` (or herdr's
#   pane API). That injected command runs in the model's own session, which
#   is what actually writes .handoff/<lane>.md — this script cannot summarize
#   working state itself, only submit the slash command that does.
#
# Env:
#   HANDOFF_IDLE_MINUTES           idle window before firing, in minutes
#                                  (default 58 — comfortably under the ~60
#                                  minute prompt-cache TTL this exists to beat,
#                                  not a guess baked in as a literal elsewhere)
#   HANDOFF_IDLE_SECONDS           idle window in seconds, overriding
#                                  HANDOFF_IDLE_MINUTES — for tests, so they
#                                  don't have to sleep for real minutes
#   HANDOFF_IDLE_TIMER=0           disable arming at runtime without
#                                  uninstalling the hook (existing timers are
#                                  still cancelled)
#   HANDOFF_IDLE_MIN_BYTES         skip arming if the transcript is smaller
#                                  than this many bytes (default 2000) — a
#                                  turn or two in, nothing worth writing yet
#   HANDOFF_IDLE_COOLDOWN_SECONDS  skip arming if .handoff/<lane>.md was
#                                  written more recently than this many
#                                  seconds ago (default 120) — don't re-arm
#                                  immediately after a fresh handoff
#   HANDOFF_LANE / HERDR_PANE_ID / TMUX_PANE
#                                  lane resolution, delegated to lane.sh —
#                                  see there for why HERDR_PANE_ID and not
#                                  HERDR_WORKSPACE_ID
set -uo pipefail

here="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
self="$here/idle-timer.sh"

# ---------------------------------------------------------------------------
# Shared helpers (used by both modes)
# ---------------------------------------------------------------------------

# file_mtime <path> — epoch seconds on stdout, or nothing if the path does
# not exist. GNU and BSD `stat` take the flag differently (-c vs -f), the
# same split session-start.sh already works around for `date`.
file_mtime() {
  [ -e "$1" ] || return 0
  stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null
}

# write_pidfile <path> <pid> <token> — atomic write (temp file + rename) so a
# concurrent reader never sees a half-written pidfile, and a crash mid-write
# leaves the old file intact instead of a truncated one.
write_pidfile() {
  mkdir -p "$(dirname "$1")" 2>/dev/null
  tmp="$1.tmp.$$"
  printf '%s %s\n' "$2" "$3" > "$tmp" && mv -f "$tmp" "$1"
}

# pidfile_is_ours — true only if $pidfile exists and still names THIS
# process ($$) with $token. Fire mode's pidfile is a claim on the lane, and
# the claim can be taken over by a later timer at any point after it is
# written (see remove_pidfile_if_ours and arm_timer), so both places that
# act on ownership re-read the file at the moment they act rather than
# trusting that the write at startup still stands.
pidfile_is_ours() {
  [ -f "$pidfile" ] || return 1
  current_pid=""; current_token=""
  read -r current_pid current_token < "$pidfile" 2>/dev/null || return 1
  [ "$current_pid" = "$$" ] && [ "$current_token" = "$token" ]
}

# remove_pidfile_if_ours — deletes $pidfile only if it still names THIS
# process ($$) and $token. Used as the fire-mode EXIT trap instead of a bare
# `rm -f`, because a cancelling Stop hook's `kill -TERM` returns immediately
# without waiting for the signal to actually be delivered and processed. In
# the window between that `kill` and this process really exiting, the same
# Stop hook goes on to arm our replacement, which writes ITS pid into this
# same path — an unconditional `rm -f` in our own trap would then delete the
# replacement's pidfile, not ours, leaving the new timer unrecorded and able
# to fire ~58 minutes later into a pane the user is actively working in. This
# is a normal SIGTERM-delivery delay, not an exotic race, so the check has to
# hold every time, not just usually.
remove_pidfile_if_ours() {
  pidfile_is_ours && rm -f "$pidfile"
  return 0
}

# pid_is_ours <pid> <token> — true only if <pid> is a live process whose own
# command line contains <token>. A recorded pid can be recycled by an
# unrelated process (a reboot, a long-idle session), so a bare "does this pid
# exist" check is not enough before sending it a signal; the token is the
# proof that the live process at that pid is actually the timer we armed, not
# a stranger that happens to have inherited the number.
pid_is_ours() {
  pid="$1"; token="$2"
  [ -n "$pid" ] && [ -n "$token" ] || return 1
  case "$pid" in
    ''|*[!0-9]*) return 1 ;;
  esac

  if [ -r "/proc/$pid/cmdline" ]; then
    # Linux: /proc/<pid>/cmdline is NUL-separated argv; translate the NULs to
    # newlines so a plain line match can find the token as its own argument
    # rather than matching it as a substring across an argument boundary.
    tr '\0' '\n' < "/proc/$pid/cmdline" 2>/dev/null | grep -Fqx "$token" && return 0
    return 1
  fi

  # macOS (and anything else with no /proc): `ps` is the portable fallback.
  # Some platforms truncate long command lines in `ps` output, which is why
  # the token is placed early in this script's own argv (right after
  # --fire) — closer to the front survives truncation that a trailing
  # argument would not.
  ps -o command= -p "$pid" 2>/dev/null | grep -Fq "$token"
}

# cancel_existing_timer — reads $pidfile, kills the recorded timer if (and
# only if) it validates as ours, then removes the file either way. Tolerates
# a missing, empty, or corrupt pidfile without failing the hook: a stale
# pidfile is a nuisance, not a reason to stop arming future timers.
cancel_existing_timer() {
  [ -f "$pidfile" ] || return 0
  old_pid=""; old_token=""
  read -r old_pid old_token < "$pidfile" 2>/dev/null || true
  if pid_is_ours "$old_pid" "$old_token"; then
    # Negative pid targets the whole process group (see arm_timer for how
    # the timer becomes its own group leader), so its sleeping child dies
    # with it instead of being orphaned to fire on its own later.
    kill -TERM -- "-$old_pid" 2>/dev/null || true
  fi
  rm -f "$pidfile"
}

# pane_exists — re-verified at fire time because a Stop hook does not fire on
# an interrupted turn, so an armed timer can outlive a pane that closed while
# the session sat idle in a way this script never got a Stop event for.
pane_exists() {
  case "$pane_kind" in
    tmux)
      command -v tmux >/dev/null 2>&1 &&
        tmux list-panes -a -F '#{pane_id}' 2>/dev/null | grep -qx "$pane_target"
      ;;
    herdr)
      command -v herdr >/dev/null 2>&1 && herdr pane get "$pane_target" >/dev/null 2>&1
      ;;
    *) return 1 ;;
  esac
}

# write_draft_file <content> — atomic write of $draft (temp file + rename),
# shared by both salvage_draft outcomes below.
write_draft_file() {
  mkdir -p "$(dirname "$draft")" 2>/dev/null
  tmp="$draft.tmp.$$"
  printf '%s\n' "$1" > "$tmp" && mv -f "$tmp" "$draft"
}

# Claude Code's input line begins with U+276F (❯) followed immediately by a
# NON-BREAKING SPACE — U+00A0, bytes 0xC2 0xA0 in UTF-8 — not an ASCII space
# (0x20). Confirmed by hexdumping a live pane's captured input line: an empty
# box is exactly `e2 9d af c2 a0 0a` (❯, NBSP, newline). tmux trims trailing
# ASCII whitespace from a captured line but leaves the NBSP alone, which is
# the only reason an empty box's line survives capture with anything after
# the ❯ at all. Built from an explicit byte escape rather than a literal NBSP
# pasted into this file, because the character is invisible in a diff: an
# editor silently normalizing it to a plain space here would make marker
# matching quietly stop working with no visible trace in the change.
nbsp="$(printf '\xc2\xa0')"
input_marker="❯${nbsp}"

# is_blank <text> — true if <text> has nothing in it but ASCII whitespace
# and/or the NBSP above. Plain `tr -d '[:space:]'` does not reliably treat
# NBSP as whitespace (it is not in the POSIX space class), so a box holding
# only the marker's own trailing NBSP would otherwise look non-empty and get
# salvaged as if it were a real draft.
is_blank() {
  stripped="${1//$nbsp/}"
  [ -z "$(printf '%s' "$stripped" | tr -d '[:space:]')" ]
}

# is_box_rule <row> — true if <row> is one of the horizontal rules Claude
# Code draws above and below the input box. Observed in a live pane: the box
# renders as a rule of "─" characters, the marker row, another rule, then the
# status line. The rule under the box is what marks where a multi-line draft
# ends.
is_box_rule() {
  case "$1" in
    "─"*) return 0 ;;
  esac
  return 1
}

# salvage_draft — best-effort capture of whatever is currently typed in the
# input box, written to a recoverable file before we clear that box. This
# was an explicit call from Josh: the timer may interrupt a half-typed
# message, but it must never destroy one irrecoverably.
#
# We isolate just the input box rather than writing the whole screen: a raw
# full-pane dump is never whitespace-only in a live Claude Code pane (there
# is always chrome — the previous turn's output, the status line), so a
# blanket "skip if empty" guard on the full capture never actually fires,
# and a file written on every single fire regardless of whether anything was
# typed is not a recoverable draft, it is noise the user learns to ignore.
#
# Matching is anchored to the START of a row, not a substring search: plain
# scrollback commonly contains "❯ " (with an ordinary ASCII space) from past
# turns rendered back in the transcript, and a substring match can pick one
# of those instead of the real input line — confirmed against a live
# capture, where an unanchored search for the glyph matched several
# scrollback lines alongside the actual box. Anchoring also means the ASCII
# vs NBSP distinction alone isn't what protects against that mismatch: a
# scrollback line would have to begin at column zero with the exact ❯+NBSP
# byte sequence to be mistaken for the input line, which real transcript
# text does not.
#
# We take the LAST such row, since the live input box is what's rendered
# at the bottom of a multi-line capture.
#
# Two things make a draft occupy more than one screen row, and they need
# opposite treatment:
#
#   A wrapped line: one logical line longer than the pane is wide. tmux's
#   `-J` joins the wrapped rows back into the single line the user typed,
#   so a wrap never shows up as a second row here. (-J also preserves the
#   trailing spaces on every row, which is why each row is trimmed on the
#   right before it is looked at.)
#
#   A multi-line draft: the box grows one row per logical line, and Claude
#   Code renders each continuation row with a two-space indent under the
#   text after the marker. We keep the marker row and every row after it up
#   to the rule that closes the box, dropping that render indent. If no
#   closing rule ever appears (a layout this script has not seen), the box
#   is cut at the first blank row instead, so the status line cannot be
#   swallowed into the draft.
#
# Return value doubles as the go/no-go signal for injection: 0 means the
# box was found and holds at most one line, so it is safe to clear and
# submit into; 1 means fire_mode must not send any keys, for one of two
# reasons.
#
# No marker: the marker's absence is this script's own evidence that the
# pane is not showing the Claude Code input box. The likeliest thing an
# hour-idle session is showing instead is a pending permission or
# plan-approval dialog: Stop does not fire for a turn blocked on a dialog,
# so the timer armed by the previous turn stays live, and sending C-u then
# Enter into that dialog would select whichever option is highlighted.
#
# A multi-line draft: Claude Code's Ctrl+U deletes from the cursor to the
# start of the CURRENT line only (its docs say to repeat it to clear across
# lines in multiline input). This script cannot see where the cursor is or
# how many presses would empty the box, so injecting on top of a multi-line
# draft could submit the leftover lines plus /handoff as prose, exactly the
# failure the clear exists to prevent. Instead the draft file is written and
# the box is left as it was. The cost is one redundant idle turn, never a
# corrupted command.
#
# A Claude Code auto-suggested "ghost" hint renders indistinguishably from
# real typed text after the marker (confirmed in the same probe), and there
# is no reliable way to tell them apart from a plain-text capture. We do not
# try: salvaging a ghost hint as if it were a real draft is a harmless false
# positive, not the failure mode this function exists to prevent.
salvage_draft() {
  draft="$root/.handoff/$lane.draft.txt"
  captured=""
  case "$pane_kind" in
    tmux)  captured="$(tmux capture-pane -t "$pane_target" -p -J 2>/dev/null)" ;;
    # herdr's pane read has no documented equivalent of -J, so a wrapped
    # line is salvaged as it renders there: one row per wrap.
    herdr) captured="$(herdr pane read "$pane_target" --source visible 2>/dev/null)" ;;
  esac

  box=""; box_rows=0; in_box=0; box_closed=0
  while IFS= read -r row || [ -n "$row" ]; do
    row="${row%"${row##*[![:space:]]}"}"
    case "$row" in
      "$input_marker"*)
        box="${row#"$input_marker"}"; box_rows=1; in_box=1; box_closed=0 ;;
      *)
        [ "$in_box" = 1 ] || continue
        if is_box_rule "$row"; then
          in_box=0; box_closed=1
        else
          box="$box"$'\n'"${row#"  "}"; box_rows=$(( box_rows + 1 ))
        fi ;;
    esac
  done <<<"$captured"

  if [ "$box_rows" -gt 1 ] && [ "$box_closed" = 0 ]; then
    cut=""; cut_rows=0
    while IFS= read -r row; do
      if [ "$cut_rows" -gt 0 ] && is_blank "$row"; then break; fi
      if [ "$cut_rows" -eq 0 ]; then cut="$row"; else cut="$cut"$'\n'"$row"; fi
      cut_rows=$(( cut_rows + 1 ))
    done <<<"$box"
    box="$cut"; box_rows="$cut_rows"
  fi

  if [ "$box_rows" -gt 0 ]; then
    # A blank box is the common case for a timer that actually fires: the
    # session sat idle with nothing typed. Nothing to salvage — leave no
    # file rather than one that looks like a draft but isn't.
    is_blank "$box" || write_draft_file "$box"
    # More than one row means a multi-line draft: salvaged in full above,
    # but not safe to clear with a single C-u. See the header comment.
    [ "$box_rows" -eq 1 ] || return 1
    return 0
  fi

  # Marker not found at all: a pending dialog, an unexpected pane layout, a
  # UI change this script doesn't know about. Keep the full-capture fallback
  # rather than silently losing a possible draft, but label it clearly so a
  # reader opening the file knows it is scrollback-and-all, not their draft
  # isolated cleanly. A blank capture gets no file. Either way, return 1 so
  # fire_mode stops here instead of sending keys into whatever is on screen.
  is_blank "$captured" ||
    write_draft_file "$(printf '# idle-timer: could not find the input-line marker; this is the full pane capture as a fallback.\n%s' "$captured")"
  return 1
}

# clear_input — sent as its own call, before the injected command. Real
# half-typed user input left in the box concatenates with an injected
# `/handoff`, submits as prose, and silently produces no handoff — this is
# the failure mode the whole salvage-then-clear sequence exists to avoid.
#
# Its exit status is the last gate before submit_handoff: fire_mode stops
# if this returns non-zero. The herdr path in particular is unverified (see
# submit_handoff), and its four subcommands do not fail uniformly. If `pane
# get` or `pane read` is wrong the timer never fires, which is safe. If
# `pane send-keys` is wrong while `pane run` works, the box is never cleared
# and the injection lands on top of whatever was typed: the exact failure
# the clear exists to prevent. So a clear that reports failure means no
# submit, on both paths.
clear_input() {
  case "$pane_kind" in
    tmux)  tmux send-keys -t "$pane_target" C-u ;;
    herdr) herdr pane send-keys "$pane_target" ctrl+u ;;
  esac
}

# submit_handoff — `/handoff` and Enter in ONE call. Verified end to end for
# tmux: the autocomplete menu does not eat the Enter, because `/handoff`
# typed in full is itself the highlighted completion. The herdr sequence
# mirrors this shape using herdr's own pane API (`pane run` documents itself
# as atomically sending text and Enter, the same one-call shape as the
# verified tmux command) but has NOT been independently verified end to end
# against a live herdr pane the way the tmux path has — treat it as
# best-effort until someone confirms it against a real herdr session.
submit_handoff() {
  case "$pane_kind" in
    tmux)  tmux send-keys -t "$pane_target" '/handoff' Enter ;;
    herdr) herdr pane run "$pane_target" '/handoff' ;;
  esac
}

# arm_timer — spawns a detached copy of this script in --fire mode and
# returns immediately, without trying to learn its pid from $!.
#
# $! is unreliable here: `setsid` forks a child and execs into it only when
# the calling process is not already a process-group leader (it fails the
# setsid() syscall otherwise and forks to retry from a fresh child) — so the
# pid bash hands back as $! can be a short-lived wrapper that has already
# exited by the time we read it, leaving the real timer unrecorded and
# unkillable later. The fix is to sidestep the question entirely: the
# spawned process writes its OWN $$ into the pidfile as the very first thing
# it does in fire mode, which is unambiguous no matter how many forks or
# execs happened on the way there.
#
# That leaves a window between this function returning and the detached
# process writing its pidfile. Two Stop hooks fired close together (two
# turns ending back to back, or a Stop hook running while the previous one
# is still arming) each see no pidfile to cancel and each spawn a timer. Both
# timers are live, but only the second write survives, so the first is
# recorded nowhere and no later Stop hook can cancel it. This function does
# not try to close that window. Fire mode closes it instead: after the sleep,
# a timer re-reads the pidfile and exits unless the file still names its own
# pid and token. The timer that won the pidfile is the only one that can
# inject; the other one wakes, finds it does not own the file, and exits
# without touching the pane.
#
# Detaching itself has to be portable: macOS ships no setsid(1), so this
# skill cannot depend on it existing. Where it does exist it is preferred
# (it also detaches from the controlling terminal, not just the process
# group). Where it doesn't, enabling bash job control ("set -m") inside a
# throwaway subshell gets the same effect without the binary: under job
# control, each backgrounded job gets its own process group, exactly what
# setsid buys us, just via a bash builtin instead of an external command.
# `nohup` is layered on in both branches so the timer also survives a SIGHUP
# if its session's controlling terminal goes away before it fires.
arm_timer() {
  token="$(date +%s%N 2>/dev/null || date +%s)-$$-$RANDOM"
  if command -v setsid >/dev/null 2>&1; then
    setsid nohup bash "$self" --fire "$token" "$lane" "$root" "$pane_kind" "$pane_target" "$snapshot" "$idle_seconds" >/dev/null 2>&1 </dev/null &
  else
    ( set -m; nohup bash "$self" --fire "$token" "$lane" "$root" "$pane_kind" "$pane_target" "$snapshot" "$idle_seconds" >/dev/null 2>&1 </dev/null & )
  fi
}

# ---------------------------------------------------------------------------
# Fire mode: `idle-timer.sh --fire <token> <lane> <root> <pane_kind>
#                            <pane_target> <snapshot_mtime> <idle_seconds>`
# ---------------------------------------------------------------------------
fire_mode() {
  token="$1"; lane="$2"; root="$3"; pane_kind="$4"
  pane_target="$5"; snapshot="$6"; idle_seconds="$7"

  pidfile="$root/.handoff/$lane.timer.pid"
  # First action, before anything else: record our own pid, for the reason
  # explained in arm_timer above. The trap covers every exit path — the
  # normal end of this function, a cancelling SIGTERM from a later Stop
  # hook, or an early return below — so "remove its own pidfile" doesn't
  # depend on remembering to call rm on each of those paths individually.
  # It is conditional (remove_pidfile_if_ours), not a bare `rm -f` — see
  # that function for the replacement-clobbering race a bare rm would open.
  write_pidfile "$pidfile" "$$" "$token"
  trap remove_pidfile_if_ours EXIT

  # HANDOFF_IDLE_TIMER can be flipped off after this timer was already
  # armed; honor that immediately rather than sleeping out a window that is
  # now moot.
  [ "${HANDOFF_IDLE_TIMER:-1}" = "0" ] && exit 0

  # This script runs without -e, so a failing sleep (an interval that is
  # not a number, for one) would otherwise fall straight through to the
  # injection below, milliseconds after the Stop hook that armed it. Stop
  # hook mode validates the interval before arming, but this process also
  # has to defend itself: never inject unless the wait actually happened.
  sleep "$idle_seconds" || exit 0

  # Ownership gate: exit unless the pidfile still names this process. An
  # orphaned timer (two Stop hooks armed at once, see arm_timer) never owns
  # the file, so it stops here. The EXIT trap is conditional on the same
  # check, so a foreign pidfile is left in place for whoever does own it.
  pidfile_is_ours || exit 0

  # Re-verify before acting: a Stop hook does not fire on an interrupted
  # turn, so everything above could be stale by the time we wake up — the
  # pane the user was in may be long gone, or a `/handoff` run some other
  # way (or another armed timer that fired first, in a lane mixup that
  # should not happen but costs nothing to guard against) may have already
  # written the file we were about to trigger a rewrite of.
  pane_exists || exit 0

  progress="$root/.handoff/$lane.md"
  current="$(file_mtime "$progress")"
  [ "$current" = "$snapshot" ] || exit 0

  # salvage_draft returns non-zero when it cannot find the input-line marker
  # or when the draft it found spans more than one line. That is the last
  # gate before sending keys: with no marker the pane may be sitting on a
  # permission or plan-approval dialog, and Enter there selects the
  # highlighted option; with a multi-line draft a single C-u does not empty
  # the box, and Enter would submit the leftovers plus /handoff as prose.
  # Either way, exit without touching the pane at all.
  salvage_draft || exit 0
  # A clear that fails is one more reason not to submit: the draft is
  # already salvaged, and sending /handoff into an uncleared box would
  # concatenate it with the typed text. See clear_input.
  clear_input || exit 0
  submit_handoff
}

if [ "${1:-}" = "--fire" ]; then
  shift
  fire_mode "$@"
  exit 0
fi

# ---------------------------------------------------------------------------
# Stop hook mode
# ---------------------------------------------------------------------------

json="$(cat)"

if command -v jq >/dev/null 2>&1; then
  transcript_path="$(printf '%s' "$json" | jq -r '.transcript_path // empty' 2>/dev/null)"
  cwd="$(printf '%s' "$json" | jq -r '.cwd // empty' 2>/dev/null)"
  agent_id="$(printf '%s' "$json" | jq -r '.agent_id // empty' 2>/dev/null)"
elif command -v python3 >/dev/null 2>&1; then
  eval "$(printf '%s' "$json" | python3 -c '
import json, sys, shlex

try:
    data = json.load(sys.stdin)
    if not isinstance(data, dict):
        data = {}
except Exception:
    data = {}

for k in ("transcript_path", "cwd", "agent_id"):
    v = data.get(k)
    if not isinstance(v, str):
        v = ""
    print(f"{k}={shlex.quote(v)}")
' 2>/dev/null)"
else
  # Same posture as session-start.sh: with neither JSON parser available
  # there is no safe way to read the hook payload, so stay silent.
  exit 0
fi

# Subagent turns share the parent session's transcript but not its pane.
# Arming or cancelling the lane's timer on their behalf would race the real
# turns happening in that same pane — a subagent finishing has nothing to do
# with whether the human at the pane has gone idle. The Stop payload only
# carries a non-empty agent_id for subagent invocations, never for the main
# session, so this is the one check that has to run before lane resolution
# and before the cancel step, not just before arming.
[ -z "${agent_id:-}" ] || exit 0

lane="$(bash "$here/lane.sh")"

if [ -n "${cwd:-}" ] && [ -d "$cwd" ]; then
  root="$(cd "$cwd" && git rev-parse --show-toplevel 2>/dev/null)" || root="$cwd"
else
  root="$(git rev-parse --show-toplevel 2>/dev/null)" || root="$PWD"
fi

pidfile="$root/.handoff/$lane.timer.pid"

# Any real turn cancels a pending timer — the point of arming a fresh one
# every time is that only the LAST turn's timer should ever be live.
cancel_existing_timer

# Runtime off-switch, checked after cancellation so toggling this mid-session
# actually stops a timer that is already pending, not just future ones.
[ "${HANDOFF_IDLE_TIMER:-1}" = "0" ] && exit 0

# Environment precondition: a detached process has no way to inject text
# into a bare terminal (no tmux `send-keys`, no herdr pane API, and
# OS-level UI automation is a different, fragile category out of scope
# here), so without one of these there is nothing useful a timer could ever
# do — arming one would just leak a sleeping process. This also picks which
# injection method fire mode uses later.
#
# TMUX_PANE specifically, not just $TMUX: $TMUX only proves a tmux server is
# reachable, TMUX_PANE is the actual send-keys target and is set
# automatically in any real tmux pane whenever TMUX is, so checking it
# covers both without risking an empty target.
if [ -n "${TMUX_PANE:-}" ]; then
  pane_kind=tmux
  pane_target="$TMUX_PANE"
elif [ -n "${HERDR_PANE_ID:-}" ]; then
  pane_kind=herdr
  pane_target="$HERDR_PANE_ID"
else
  exit 0
fi

# Guard: transcript too small to be worth writing yet.
transcript_bytes=0
if [ -n "${transcript_path:-}" ] && [ -f "$transcript_path" ]; then
  transcript_bytes="$(wc -c < "$transcript_path" 2>/dev/null | tr -d ' ')"
  [ -n "$transcript_bytes" ] || transcript_bytes=0
fi
min_bytes="${HANDOFF_IDLE_MIN_BYTES:-2000}"
if [ "$transcript_bytes" -lt "$min_bytes" ]; then
  exit 0
fi

# Guard: .handoff/<lane>.md was written very recently — including by the
# `/handoff` this very timer might have just injected — so don't immediately
# re-arm on top of a fresh write. This is intentionally NOT a "teammates in
# this lane are still active" guard: after the seat-keying change in #8, a
# lane IS a single pane, so "other teammates in this lane" no longer means
# anything — there is nobody else to check for.
progress="$root/.handoff/$lane.md"
snapshot="$(file_mtime "$progress")"
if [ -n "$snapshot" ]; then
  now="$(date +%s)"
  cooldown="${HANDOFF_IDLE_COOLDOWN_SECONDS:-120}"
  if [ "$(( now - snapshot ))" -lt "$cooldown" ]; then
    exit 0
  fi
fi

# The interval must be a positive whole number of seconds before a timer is
# armed on it. HANDOFF_IDLE_MINUTES is a documented user knob, so a typo or
# a decimal there is plausible, and the failure mode is not a broken timer
# but the opposite: a value `sleep` rejects, or a zero, would fire the
# injection immediately after every Stop hook, clearing the input line and
# submitting /handoff after every turn. Bash arithmetic on a non-integer
# also aborts this script with an error rather than a clean exit, so the
# minutes value is checked BEFORE the multiplication, not just after it.
# On a bad value: say so on stderr once, arm nothing, exit cleanly.
if [ -n "${HANDOFF_IDLE_SECONDS:-}" ]; then
  idle_seconds="$HANDOFF_IDLE_SECONDS"
  idle_source="HANDOFF_IDLE_SECONDS=$HANDOFF_IDLE_SECONDS"
else
  idle_minutes="${HANDOFF_IDLE_MINUTES:-58}"
  idle_source="HANDOFF_IDLE_MINUTES=$idle_minutes"
  case "$idle_minutes" in
    ''|*[!0-9]*)
      echo "handoff idle-timer: $idle_source is not a whole number of minutes; not arming" >&2
      exit 0
      ;;
  esac
  idle_seconds=$(( idle_minutes * 60 ))
fi
case "$idle_seconds" in
  ''|*[!0-9]*)
    echo "handoff idle-timer: $idle_source is not a whole number of seconds; not arming" >&2
    exit 0
    ;;
esac
if [ "$idle_seconds" -eq 0 ]; then
  echo "handoff idle-timer: $idle_source gives a zero-second interval; not arming" >&2
  exit 0
fi

arm_timer
exit 0
