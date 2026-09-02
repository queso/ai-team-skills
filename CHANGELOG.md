# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- New `handoff` skill: captures session working state to `.claude/progress.md` so a bloated context can be cleared and resumed cheaply
- `handoff` writes a companion `.claude/progress.checks.md` so information loss across a clear is measurable rather than assumed
- `handoff` falls back to `progress.md` at the repository root when `.claude/` cannot be written (sandboxed, headless, and CI environments deny it, and the skill previously produced no file at all)
- `handoff/evals/`, a manual three-stage promptdiff eval with two fixtures (short, and a long one built around a mid-session reversed decision): one agent writes a handoff from a synthetic session; a second answers fixed questions from that handoff alone; a third has to act on it (surface the open decision, avoid re-proposing a vetoed approach) while its ingest cost is measured. Not wired into CI — it spends real tokens
- `handoff/scripts/session-start.sh`, an optional `SessionStart` hook that reloads the progress file via `hookSpecificOutput.additionalContext` and warns via `systemMessage` instead of injecting when the file is stale (branch mismatch, older than `HANDOFF_MAX_AGE_DAYS`) or oversized (past `HANDOFF_MAX_BYTES`)
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

### Changed
- `handoff` Step 4 now says to state the finding and attach the path as corroboration, rather than preferring a bare `file.ts:42` pointer over saying it. The eval showed the pointer-first phrasing produced 11 line references across 3 replicates that the resuming agent then dereferenced; the current phrasing produces 0 with recall unchanged at 18/18
- `extractChatId()` now returns `{ slug, hashId, featureName }` instead of a plain string, correctly parsing v0 URL slugs (#WI-141)
- Fetch pipeline uses zip download endpoint (`/versions/{id}/download`) instead of inline JSON file content (#WI-144)
- Output directory structure changed to `designs/<feature>/v0-source/` to separate v0 source from skill metadata (#WI-147)
- `main()` rewritten as `runPipeline(options, deps)` with dependency injection (#WI-147)
- Chat ID fallback: tries full slug first, falls back to hash ID on 404 (#WI-141)

### Removed
- `fetchChat()` and `fetchVersion()` functions replaced by the modular pipeline (#WI-147)
