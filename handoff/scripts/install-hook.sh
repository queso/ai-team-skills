#!/usr/bin/env bash
# Registers handoff hooks in a Claude Code settings file: SessionStart always,
# and -- opt-in only -- the Stop-hook idle timer that auto-submits /handoff
# before an idle session's prompt cache lapses.
#
# `skills add` copies a skill directory and stops — it has no hook-installation
# mechanism (verified against skills CLI v1.5.18: the only "hooks" string in the
# bundle is simple-git's `allowUnsafeHooksPath`). So `scripts/session-start.sh`
# and `scripts/idle-timer.sh` ship as inert files until something wires them
# up. This is that something.
#
# Idempotent: re-running is a no-op that reports what is already there.
#
# Usage:
#   install-hook.sh [--user|--local|--project|--target <file>] [--idle-timer] [--dry-run]
#   install-hook.sh --uninstall [...]
#
#   --user        ~/.claude/settings.json         (default; syncs with dotfiles)
#   --local       ~/.claude/settings.local.json   (machine-local, usually gitignored)
#   --project     <repo>/.claude/settings.json    (this repo only). With
#                 --idle-timer, also lists the timer's scratch files
#                 (.handoff/*.draft.txt, .handoff/*.timer.pid) in that repo's
#                 .git/info/exclude, since the draft holds typed text verbatim.
#   --target      an explicit settings file path
#   --idle-timer  also register the Stop-hook idle timer (opt-in: a plain
#                 install never touches it, since auto-submitting text into a
#                 live session is intrusive). Combined with --uninstall,
#                 removes ONLY the idle timer, leaving SessionStart in place —
#                 that's how you turn the timer off without losing the reload.
#   --dry-run     print the resulting file to stdout, write nothing
#   --uninstall   remove the handoff hook entries, pruning empty structures.
#                 With no --idle-timer, removes BOTH hooks.
set -uo pipefail

mode=user
target=""
dry_run=0
action=install
idle_timer=0

while [ $# -gt 0 ]; do
  case "$1" in
    --user) mode=user ;;
    --local) mode=local ;;
    --project) mode=project ;;
    --target) target="${2:-}"; mode=explicit; shift ;;
    --idle-timer) idle_timer=1 ;;
    --dry-run) dry_run=1 ;;
    --uninstall) action=uninstall ;;
    -h|--help) sed -n '2,29p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "install-hook: unknown argument '$1'" >&2; exit 2 ;;
  esac
  shift
done

# Resolve this script's sibling hook scripts through any symlinks, so the
# recorded command still points at a real file when ~/.claude/skills/handoff is
# a link into ~/.agents/skills (which is how the skills CLI installs it).
here="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Which (event, script) pairs this invocation touches:
#   install:   SessionStart always; Stop only with --idle-timer, since the
#              timer is opt-in and must never arrive switched on by default.
#   uninstall: both by default, so "get me out" is one command; --idle-timer
#              narrows it to Stop only, so turning the timer off doesn't also
#              tear out the SessionStart reload hook.
if [ "$action" = "uninstall" ] && [ "$idle_timer" = "1" ]; then
  hook_events=(Stop)
  hook_scripts=(idle-timer.sh)
elif [ "$action" = "uninstall" ]; then
  hook_events=(SessionStart Stop)
  hook_scripts=(session-start.sh idle-timer.sh)
elif [ "$idle_timer" = "1" ]; then
  hook_events=(SessionStart Stop)
  hook_scripts=(session-start.sh idle-timer.sh)
else
  hook_events=(SessionStart)
  hook_scripts=(session-start.sh)
fi

# Prefer a $HOME-relative command so a settings.json tracked in dotfiles stays
# portable across machines. Fall back to the absolute path otherwise.
#
# $HOME is resolved through symlinks before comparing, because each hook
# script's path already is: on macOS a home under /var (or any symlinked
# parent) yields /private/var from `cd -P`, and an unresolved $HOME would fail
# to prefix-match a path that is genuinely inside it.
home_real="$(cd -P "$HOME" 2>/dev/null && pwd)" || home_real="$HOME"
command_for() {
  case "$1" in
    "$home_real"/*) printf 'bash "$HOME%s"' "${1#"$home_real"}" ;;
    "$HOME"/*)      printf 'bash "$HOME%s"' "${1#"$HOME"}" ;;
    *)              printf 'bash "%s"' "$1" ;;
  esac
}

hook_commands=()
for script_name in "${hook_scripts[@]}"; do
  hook_script="$here/$script_name"
  if [ ! -f "$hook_script" ]; then
    echo "install-hook: cannot find $script_name next to this script ($here)" >&2
    exit 1
  fi
  hook_commands+=("$(command_for "$hook_script")")
done

case "$mode" in
  user)     target="$HOME/.claude/settings.json" ;;
  local)    target="$HOME/.claude/settings.local.json" ;;
  project)
    root="$(git rev-parse --show-toplevel 2>/dev/null)" || {
      echo "install-hook: --project requires being inside a git repository" >&2; exit 1; }
    target="$root/.claude/settings.json" ;;
esac

if [ -z "$target" ]; then
  echo "install-hook: --target requires a path" >&2
  exit 2
fi

if ! command -v python3 >/dev/null 2>&1; then
  {
    echo "install-hook: python3 is required to edit settings JSON safely."
    echo
    echo "Add this to $target by hand instead:"
    echo
    echo '  "hooks": {'
    last=$(( ${#hook_events[@]} - 1 ))
    for i in "${!hook_events[@]}"; do
      comma=","
      [ "$i" -eq "$last" ] && comma=""
      printf '    "%s": [\n' "${hook_events[$i]}"
      printf '      { "hooks": [ { "type": "command", "command": "%s" } ] }\n' "${hook_commands[$i]}"
      printf '    ]%s\n' "$comma"
    done
    echo '  }'
  } >&2
  exit 1
fi

export HANDOFF_TARGET="$target"
export HANDOFF_DRY_RUN="$dry_run"
export HANDOFF_ACTION="$action"
export HANDOFF_HOOK_COUNT="${#hook_events[@]}"
export HANDOFF_MULTI_HOOK=$([ "${#hook_events[@]}" -gt 1 ] && echo 1 || echo 0)
for i in "${!hook_events[@]}"; do
  export "HANDOFF_HOOK_${i}_EVENT=${hook_events[$i]}"
  export "HANDOFF_HOOK_${i}_SCRIPT=${hook_scripts[$i]}"
  export "HANDOFF_HOOK_${i}_COMMAND=${hook_commands[$i]}"
done

python3 <<'PY'
import json, os, shutil, sys

# Resolve the target through symlinks before writing. A settings.json tracked in
# a dotfiles repo is commonly a symlink into it, and the atomic-rename write
# below would otherwise replace the link itself with a regular file, silently
# detaching it from the repo it is supposed to be tracked in.
target     = os.path.realpath(os.environ["HANDOFF_TARGET"])
dry_run    = os.environ["HANDOFF_DRY_RUN"] == "1"
action     = os.environ["HANDOFF_ACTION"]
multi_hook = os.environ["HANDOFF_MULTI_HOOK"] == "1"

hook_count = int(os.environ["HANDOFF_HOOK_COUNT"])
hooks_spec = [
    {
        "event": os.environ[f"HANDOFF_HOOK_{i}_EVENT"],
        "script": os.environ[f"HANDOFF_HOOK_{i}_SCRIPT"],
        "command": os.environ[f"HANDOFF_HOOK_{i}_COMMAND"],
    }
    for i in range(hook_count)
]

# A hook is "ours" for a given script if it invokes that script from a handoff
# skill directory. Matching on filename rather than the exact command string
# means a hook installed from a different path (an older install, a moved
# skills dir) is recognised and updated in place instead of duplicated
# alongside the new one. Each script gets its own matcher (session-start.sh vs
# idle-timer.sh) so one hook's entry is never mistaken for the other's.
def is_ours(hook, script_name):
    cmd = hook.get("command", "") if isinstance(hook, dict) else ""
    return script_name in cmd and "handoff" in cmd

if os.path.exists(target):
    try:
        with open(target) as fh:
            text = fh.read()
        settings = json.loads(text) if text.strip() else {}
    except json.JSONDecodeError as exc:
        sys.exit(f"install-hook: {target} is not valid JSON ({exc}); refusing to touch it")
    if not isinstance(settings, dict):
        sys.exit(f"install-hook: {target} does not contain a JSON object; refusing to touch it")
    existed = True
else:
    settings, existed = {}, False

hooks = settings.setdefault("hooks", {})
if not isinstance(hooks, dict):
    sys.exit(f"install-hook: 'hooks' in {target} is not an object; refusing to touch it")

results = []  # (event, verb) in request order, for the summary printed below
changed = False

for spec in hooks_spec:
    event, script_name, command = spec["event"], spec["script"], spec["command"]

    event_existed = event in hooks
    matchers = hooks.get(event, [])
    if not isinstance(matchers, list):
        sys.exit(f"install-hook: 'hooks.{event}' in {target} is not an array; refusing to touch it")

    found = [(m, h) for m in matchers if isinstance(m, dict)
                    for h in m.get("hooks", []) if is_ours(h, script_name)]

    if action == "uninstall":
        if not found:
            results.append((event, "absent", command))
            continue
        for matcher in matchers:
            if isinstance(matcher, dict) and isinstance(matcher.get("hooks"), list):
                matcher["hooks"] = [h for h in matcher["hooks"] if not is_ours(h, script_name)]
        # Prune what we emptied, but leave anything the user put there.
        matchers[:] = [m for m in matchers
                       if not (isinstance(m, dict) and set(m) <= {"hooks"} and not m.get("hooks"))]
        if not matchers:
            hooks.pop(event, None)
        results.append((event, "removed", command))
        changed = True
    elif found:
        stale = [h for _, h in found if h.get("command") != command]
        if not stale:
            results.append((event, "already", command))
            continue
        for _, hook in found:
            hook["command"] = command
        results.append((event, "updated", command))
        changed = True
    else:
        if not event_existed:
            matchers = []
        matchers.append({"hooks": [{"type": "command", "command": command}]})
        hooks[event] = matchers
        results.append((event, "added", command))
        changed = True

# Only ever drops a key that this run itself emptied out (an event key that
# still holds someone else's unrelated hooks is never touched above, and a
# leftover empty entry for a hook we didn't even process is never created,
# since matchers above is built without mutating `hooks` unless we act).
if not hooks:
    settings.pop("hooks", None)

if not changed:
    if action == "uninstall":
        print(f"handoff hook: not present in {target}; nothing to remove")
    else:
        print(f"handoff hook: already registered in {target} — no change")
    sys.exit(0)

rendered = json.dumps(settings, indent=2) + "\n"

if dry_run:
    sys.stdout.write(rendered)
    sys.exit(0)

os.makedirs(os.path.dirname(target) or ".", exist_ok=True)

# Back up before overwriting, so a bad merge is always recoverable.
if existed:
    shutil.copy2(target, target + ".handoff-backup")

tmp = target + ".handoff-tmp"
with open(tmp, "w") as fh:
    fh.write(rendered)
os.replace(tmp, target)

verb_word = {"removed": "removed from", "updated": "updated in", "added": "added to"}
for event, verb, command in results:
    if verb in ("already", "absent"):
        continue
    suffix = f" ({event})" if multi_hook else ""
    print(f"handoff hook: {verb_word[verb]} {target}{suffix}")
    if action != "uninstall":
        print(f"  command: {command}")
if existed:
    print(f"  backup:  {target}.handoff-backup")
print("Start a new session (or /clear) for it to take effect.")
PY
status=$?
[ "$status" -eq 0 ] || exit "$status"

# A --project install scopes the hooks to one repository, so the idle timer's
# scratch files can be excluded in that same repository. The draft file holds
# whatever was typed in the input box, verbatim, so it must not reach a commit
# by accident. .git/info/exclude is used rather than .gitignore because it is
# local to the clone and never lands in a commit itself. A --user or --local
# install is repo-agnostic (the timer fires in whichever repo the session runs
# in), so it writes nothing here; SKILL.md tells the user what to exclude.
if [ "$action" = "install" ] && [ "$idle_timer" = "1" ] && [ "$mode" = "project" ] && [ "$dry_run" = "0" ]; then
  if git_dir="$(git rev-parse --git-dir 2>/dev/null)"; then
    exclude="$git_dir/info/exclude"
    mkdir -p "$(dirname "$exclude")"
    added=()
    for pattern in '.handoff/*.draft.txt' '.handoff/*.timer.pid'; do
      grep -qxF -- "$pattern" "$exclude" 2>/dev/null && continue
      printf '%s\n' "$pattern" >> "$exclude"
      added+=("$pattern")
    done
    if [ "${#added[@]}" -gt 0 ]; then
      echo "handoff hook: excluded ${added[*]} in $exclude"
    fi
  fi
fi
