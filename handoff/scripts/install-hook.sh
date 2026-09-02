#!/usr/bin/env bash
# Registers the handoff SessionStart hook in a Claude Code settings file.
#
# `skills add` copies a skill directory and stops — it has no hook-installation
# mechanism (verified against skills CLI v1.5.18: the only "hooks" string in the
# bundle is simple-git's `allowUnsafeHooksPath`). So `scripts/session-start.sh`
# ships as an inert file until something wires it up. This is that something.
#
# Idempotent: re-running is a no-op that reports what is already there.
#
# Usage:
#   install-hook.sh [--user|--local|--project|--target <file>] [--dry-run]
#   install-hook.sh --uninstall [...]
#
#   --user      ~/.claude/settings.json         (default; syncs with dotfiles)
#   --local     ~/.claude/settings.local.json   (machine-local, usually gitignored)
#   --project   <repo>/.claude/settings.json    (this repo only)
#   --target    an explicit settings file path
#   --dry-run   print the resulting file to stdout, write nothing
#   --uninstall remove the handoff hook entry, pruning empty structures
set -uo pipefail

mode=user
target=""
dry_run=0
action=install

while [ $# -gt 0 ]; do
  case "$1" in
    --user) mode=user ;;
    --local) mode=local ;;
    --project) mode=project ;;
    --target) target="${2:-}"; mode=explicit; shift ;;
    --dry-run) dry_run=1 ;;
    --uninstall) action=uninstall ;;
    -h|--help) sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "install-hook: unknown argument '$1'" >&2; exit 2 ;;
  esac
  shift
done

# Resolve this script's sibling session-start.sh through any symlinks, so the
# recorded command still points at a real file when ~/.claude/skills/handoff is
# a link into ~/.agents/skills (which is how the skills CLI installs it).
here="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
hook_script="$here/session-start.sh"

if [ ! -f "$hook_script" ]; then
  echo "install-hook: cannot find session-start.sh next to this script ($here)" >&2
  exit 1
fi

# Prefer a $HOME-relative command so a settings.json tracked in dotfiles stays
# portable across machines. Fall back to the absolute path otherwise.
#
# $HOME is resolved through symlinks before comparing, because hook_script
# already is: on macOS a home under /var (or any symlinked parent) yields
# /private/var from `cd -P`, and an unresolved $HOME would fail to prefix-match
# a path that is genuinely inside it.
home_real="$(cd -P "$HOME" 2>/dev/null && pwd)" || home_real="$HOME"
case "$hook_script" in
  "$home_real"/*) command_str="bash \"\$HOME${hook_script#"$home_real"}\"" ;;
  "$HOME"/*)      command_str="bash \"\$HOME${hook_script#"$HOME"}\"" ;;
  *)              command_str="bash \"$hook_script\"" ;;
esac

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
  cat >&2 <<EOF
install-hook: python3 is required to edit settings JSON safely.

Add this to $target by hand instead:

  "hooks": {
    "SessionStart": [
      { "hooks": [ { "type": "command", "command": "$command_str" } ] }
    ]
  }
EOF
  exit 1
fi

HANDOFF_TARGET="$target" \
HANDOFF_COMMAND="$command_str" \
HANDOFF_DRY_RUN="$dry_run" \
HANDOFF_ACTION="$action" \
python3 <<'PY'
import json, os, shutil, sys

# Resolve the target through symlinks before writing. A settings.json tracked in
# a dotfiles repo is commonly a symlink into it, and the atomic-rename write
# below would otherwise replace the link itself with a regular file, silently
# detaching it from the repo it is supposed to be tracked in.
target  = os.path.realpath(os.environ["HANDOFF_TARGET"])
command = os.environ["HANDOFF_COMMAND"]
dry_run = os.environ["HANDOFF_DRY_RUN"] == "1"
action  = os.environ["HANDOFF_ACTION"]

# A hook is "ours" if it invokes session-start.sh from a handoff skill directory.
# Matching on the filename rather than the exact string means a hook installed
# from a different path (an older install, a moved skills dir) is recognised and
# updated in place instead of being duplicated alongside the new one.
def is_ours(hook):
    cmd = hook.get("command", "") if isinstance(hook, dict) else ""
    return "session-start.sh" in cmd and "handoff" in cmd

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
matchers = hooks.setdefault("SessionStart", [])
if not isinstance(matchers, list):
    sys.exit(f"install-hook: 'hooks.SessionStart' in {target} is not an array; refusing to touch it")

found = [(m, h) for m in matchers if isinstance(m, dict)
                for h in m.get("hooks", []) if is_ours(h)]

if action == "uninstall":
    if not found:
        print(f"handoff hook: not present in {target}; nothing to remove")
        sys.exit(0)
    for matcher in matchers:
        if isinstance(matcher, dict) and isinstance(matcher.get("hooks"), list):
            matcher["hooks"] = [h for h in matcher["hooks"] if not is_ours(h)]
    # Prune what we emptied, but leave anything the user put there.
    matchers[:] = [m for m in matchers
                   if not (isinstance(m, dict) and set(m) <= {"hooks"} and not m.get("hooks"))]
    if not matchers:
        del hooks["SessionStart"]
    if not hooks:
        del settings["hooks"]
    verb = "removed from"
elif found:
    stale = [h for _, h in found if h.get("command") != command]
    if not stale:
        print(f"handoff hook: already registered in {target} — no change")
        sys.exit(0)
    for _, hook in found:
        hook["command"] = command
    verb = "updated in"
else:
    matchers.append({"hooks": [{"type": "command", "command": command}]})
    verb = "added to"

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

print(f"handoff hook: {verb} {target}")
if action != "uninstall":
    print(f"  command: {command}")
if existed:
    print(f"  backup:  {target}.handoff-backup")
print("Start a new session (or /clear) for it to take effect.")
PY
