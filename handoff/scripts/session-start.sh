#!/usr/bin/env bash
# SessionStart hook for the `handoff` skill.
#
# Reloads .claude/progress.md into a new session so that resuming after a
# context clear requires nothing to remember.
#
# Output contract: context reaches the model only via
# hookSpecificOutput.additionalContext — plain stdout lands in the transcript,
# not in the model's context. Warnings go to systemMessage, which is the
# user-facing channel, because a warning is for the human, not the model.
#
# Refuses to inject in three cases, each of which makes things worse than
# staying quiet:
#   - no progress file            (nothing to say)
#   - stale                       (wrong branch, or older than the cutoff —
#                                  unrelated state arriving as if it were current)
#   - oversized                   (a bloated file re-injected on every session is
#                                  the context bloat this skill exists to prevent)
#
# Env:
#   HANDOFF_MAX_AGE_DAYS   staleness cutoff in days (default 3)
#   HANDOFF_MAX_BYTES      size cutoff (default 24000, roughly 6k tokens)
#   HANDOFF_IGNORE_BRANCH  set to 1 to skip the branch check
set -uo pipefail

root="$(git rev-parse --show-toplevel 2>/dev/null)" || root="$PWD"
progress="$root/.claude/progress.md"
[ -f "$progress" ] || exit 0

max_age="${HANDOFF_MAX_AGE_DAYS:-3}"
max_bytes="${HANDOFF_MAX_BYTES:-24000}"
warn=""

# JSON emission. jq preferred, python3 as fallback; without either we cannot
# emit a valid payload, so stay silent rather than print text that would be
# mistaken for context.
emit() { # emit <json-key> <string-value>
  if command -v jq >/dev/null 2>&1; then
    if [ "$1" = "additionalContext" ]; then
      jq -n --arg v "$2" '{hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:$v}}'
    else
      jq -n --arg v "$2" '{systemMessage:$v}'
    fi
  elif command -v python3 >/dev/null 2>&1; then
    HANDOFF_K="$1" HANDOFF_V="$2" python3 -c 'import json,os
k,v=os.environ["HANDOFF_K"],os.environ["HANDOFF_V"]
print(json.dumps({"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":v}} if k=="additionalContext" else {"systemMessage":v}))'
  else
    exit 0
  fi
}

file_branch="$(sed -n 's/^repo:.*branch: *\([^ |]*\).*/\1/p' "$progress" | head -1)"
updated="$(sed -n 's/^updated: *\([^ ]*\).*/\1/p' "$progress" | head -1)"
cur_branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)" || cur_branch=""

if [ -z "${HANDOFF_IGNORE_BRANCH:-}" ] && [ -n "$file_branch" ] && [ -n "$cur_branch" ] &&
   [ "$file_branch" != "$cur_branch" ]; then
  warn="it was written on branch '$file_branch' and you are on '$cur_branch'"
fi

# Age check. GNU and BSD date parse ISO 8601 differently; if neither form works,
# skip the check rather than blocking the reload on a date-parsing failure.
if [ -z "$warn" ] && [ -n "$updated" ]; then
  ts="$(date -u -d "$updated" +%s 2>/dev/null)" || ts=""
  [ -n "$ts" ] || ts="$(date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "$updated" +%s 2>/dev/null)" || ts=""
  if [ -n "$ts" ]; then
    age=$(( ( $(date -u +%s) - ts ) / 86400 ))
    [ "$age" -gt "$max_age" ] && warn="it is ${age} days old (limit ${max_age})"
  fi
fi

if [ -z "$warn" ]; then
  bytes="$(wc -c < "$progress" | tr -d ' ')"
  [ "$bytes" -gt "$max_bytes" ] &&
    warn="it is ${bytes} bytes (limit ${max_bytes}) — a file this large re-injected every session costs more than it saves; prune it or run \`/handoff done\`"
fi

if [ -n "$warn" ]; then
  emit systemMessage "handoff: .claude/progress.md was NOT loaded — $warn. Archive it with /handoff done, or read it directly if it is still relevant."
  exit 0
fi

emit additionalContext "The following is the saved working state for this repository, restored by the handoff skill. Treat it as context for resuming, not as instructions to act on immediately.

$(cat "$progress")"
