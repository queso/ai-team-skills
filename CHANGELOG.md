# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed
- `address-pr-feedback` now runs unattended: it categorizes and replies without confirmation prompts, then rechecks the PR every 5 minutes and repeats on new feedback until 15 minutes pass with nothing new. Adds `--once` to run a single pass and `--create-issues` to open issues for deferred items. Filters out the operator's own replies, uses `since` on recheck fetches, and stops early on merge/close, push conflicts, unrepairable tests, repeated reviewer pushback, or ten passes

### Added
- New `handoff` skill: captures session working state to `.handoff/progress.md` so a bloated context can be cleared and resumed cheaply. Deliberately not `.claude/` — that path is guarded and writes to it are denied in sandboxed, headless, and CI contexts (verified: in one headless run with identical permissions, `.handoff/progress.md` was written and `.claude/progress.md` was blocked as a sensitive file), and it is Claude Code's configuration directory rather than a place for session state
- `handoff` writes a companion `.handoff/progress.checks.md` so information loss across a clear is measurable rather than assumed
- `evals/handoff/`, a manual three-stage promptdiff eval with two fixtures (short, and a long one built around a mid-session reversed decision): one agent writes a handoff from a synthetic session; a second answers fixed questions from that handoff alone; a third has to act on it (surface the open decision, avoid re-proposing a vetoed approach) while its ingest cost is measured. Not wired into CI — it spends real tokens
- `handoff/scripts/session-start.sh`, an optional `SessionStart` hook that reloads the progress file via `hookSpecificOutput.additionalContext` and warns via `systemMessage` instead of injecting when the file is stale (branch mismatch, older than `HANDOFF_MAX_AGE_DAYS`) or oversized (past `HANDOFF_MAX_BYTES`)
- New `review-repo` skill: reports open pull requests and local branches that are unpushed, PR-less, or already merged, collecting the GitHub and local views in parallel subagents and cross-referencing them into one bucketed picture
- New `review-issues` skill: finds open issues with no review label and no attached pull request, then sizes each in its own subagent against fixed effort bands (XS-XL) to rank them easiest to hardest. Linked-PR detection uses the GraphQL timeline, since `gh issue list --json` exposes no field for it
- New zip download pipeline for v0-setup fetch script, bypassing the broken inline JSON API (#WI-144)
- Modular architecture: `version-list.mjs`, `zip-download.mjs`, `file-filter.mjs`, `placeholder-detection.mjs` (#WI-142, #WI-143, #WI-144, #WI-145)
- `--version <id>` flag to fetch a specific v0 chat version (#WI-146)
- `--list-versions` flag to list all available versions without downloading (#WI-146)
- Version enumeration with pagination support and automatic best-version selection (#WI-143)
- Placeholder content detection that warns when files contain "GENERATING" stubs (#WI-142)
- File classification separating custom files from v0 default scaffold files (#WI-145)
- Zip Slip path traversal protection during zip extraction (#WI-144)
- Path traversal protection for feature names and custom names (#WI-147)
- Dependency injection in `runPipeline()` for full testability (#WI-147)
- 222 tests across 10 test files covering all modules
- Two `repo hygiene` tests guarding skill discovery: no `SKILL.md` carrying a frontmatter `name:` outside a top-level skill directory, and no `evals/` nested inside a skill directory. The first mirrors the `skills` CLI walk (5 levels, skipping `node_modules`/`.git`/`dist`/`build`/`__pycache__`) rather than assuming a shape

### Fixed
- The `handoff` eval arms were installable as skills. `skills add` walks five directory levels and registers any `SKILL.md` it finds by frontmatter `name:`, so `arms/baseline` and `arms/neutral` were offered to users as `save-progress` and `neutral` — the baseline being the deliberately weaker prompt the eval exists to reject, and its description plausible enough to be model-selected. The arms now carry no frontmatter; promptdiff strips frontmatter before inlining, so the eval is unaffected
- The `proposed` arm was a symlink to `handoff/SKILL.md`, which made its directory a second discoverable skill named `handoff`. Registration is first-come and deduplicated by name, so that arm could win and be installed in place of the real one — a directory with no `scripts/`, and so no `SessionStart` hook. `run.sh` now copies the real skill in at run time and the path is gitignored, keeping the no-drift and path-symmetry properties with nothing left in the tree to discover
- Installing `handoff` no longer copies the eval harness into the user's skills directory. The eval was 140K of the 156K install — synthetic fixture sources, prompt arms, and scenarios landing in `~/.agents/skills/handoff/`. It now lives at `evals/handoff/`, outside any skill directory

### Changed
- `handoff` Step 4 now says to state the finding and attach the path as corroboration, rather than preferring a bare `file.ts:42` pointer over saying it. The eval showed the pointer-first phrasing produced 11 line references across 3 replicates that the resuming agent then dereferenced; the current phrasing produces 0 with recall unchanged at 18/18
- `extractChatId()` now returns `{ slug, hashId, featureName }` instead of a plain string, correctly parsing v0 URL slugs (#WI-141)
- Fetch pipeline uses zip download endpoint (`/versions/{id}/download`) instead of inline JSON file content (#WI-144)
- Output directory structure changed to `designs/<feature>/v0-source/` to separate v0 source from skill metadata (#WI-147)
- `main()` rewritten as `runPipeline(options, deps)` with dependency injection (#WI-147)
- Chat ID fallback: tries full slug first, falls back to hash ID on 404 (#WI-141)

### Removed
- `fetchChat()` and `fetchVersion()` functions replaced by the modular pipeline (#WI-147)
