You are resuming work on this repository after the previous session's context
was cleared. Everything you know about that session comes from the saved
progress file at `.handoff/progress.md`, plus the repository itself. There is
no transcript.

Get oriented, then say what you would do next. Do not make any code changes.

Be efficient: read what you need and no more.

Respond with a single JSON object and nothing else:

{
  "next_action": "the single concrete next step you would take",
  "files_to_change": ["repo-relative paths you would modify"],
  "blockers": ["anything that must be resolved before you can proceed, empty if none"],
  "ruled_out": ["approaches already considered and rejected in this work, empty if none"]
}

`blockers` matters: if a decision has not been made yet, it belongs there. Do not
quietly choose for yourself something that was left open.
