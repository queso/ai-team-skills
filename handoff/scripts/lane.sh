#!/usr/bin/env bash
# Resolves the handoff lane name and prints it to stdout.
#
# A lane is whatever survives /clear for this seat: a herdr pane, a tmux
# pane, or an explicit override. Shared by session-start.sh and the `handoff`
# skill itself (SKILL.md Step 2), so lane resolution lives in exactly one
# place instead of drifting between a script and a doc.
#
# Lane resolution, first set wins:
#   $HANDOFF_LANE, $HERDR_PANE_ID, $TMUX_PANE, else "progress"
#
# HERDR_PANE_ID, not HERDR_WORKSPACE_ID: a herdr workspace holds many tabs,
# each with many panes, so keying on the workspace would collapse every
# teammate in it onto one lane — the exact collision this skill exists to
# avoid. HERDR_PANE_ID is herdr's pane-scoped id (values look like "%1", the
# same shape as $TMUX_PANE), which is what herdr-rebalance itself targets.
#
# Sanitized so an env var cannot walk the path outside .handoff/ or otherwise
# produce a surprising filename. Forced to the C locale so the sanitizer is
# byte-based: under a UTF-8 locale, tr's character-class matching treats
# multi-byte sequences differently, so two distinct non-ASCII lane names could
# collapse to the same sanitized value depending on the environment's locale.
set -uo pipefail

lane="${HANDOFF_LANE:-${HERDR_PANE_ID:-${TMUX_PANE:-progress}}}"
lane="$(printf '%s' "$lane" | LC_ALL=C tr -c 'A-Za-z0-9._-' '_')"
[ -n "$lane" ] || lane="progress"

printf '%s\n' "$lane"
