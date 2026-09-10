---
description: Emit a Claude Code or OpenCode workflow skeleton from a design doc.
argument-hint: <design-doc-path> [output-dir]
---

# /workflow-builder:scaffold

Reads a design doc produced by `/workflow-builder:design` and emits a workflow skeleton for Claude Code, OpenCode, or both — manifest/config, agent files, command files, hook/plugin stubs, guardrail skill placeholders, README. Every emitted file has TODO markers pointing back to the relevant `references/*.md` so the user knows where to read while filling them in.

The result is **structurally complete and content-incomplete**. The user adds domain prompts, policy text, and any specific tooling.

## Step 1: Read the design doc

If a path was passed as an argument, use it. Otherwise ask: "Path to the design doc?"

Read the file. Validate that it has all 8 sections from `references/design-template.md`:

1. Workflow goal & domain
2. Stages
3. Specialists per stage
4. Fan-out plan
5. Orchestration model
6. Verification passes
7. Enforcement
8. Guardrail skills

If any section is missing or empty, stop and tell the user which sections need filling first. Suggest re-running `/workflow-builder:design` or editing the doc manually.

## Step 2: Confirm runtime target and output location

Ask which runtime target to emit:

- **Claude Code** — emit a Claude Code plugin skeleton under `.claude-plugin/`, `agents/`, `commands/`, `skills/`, and `hooks/`.
- **OpenCode** — emit an OpenCode project skeleton under `.opencode/agents/`, `.opencode/commands/`, `.opencode/skills/`, `.opencode/plugins/`, plus `opencode.json` when config is needed.
- **Both** — emit both layouts from the same design doc.

Default to **Claude Code** unless the user asks for OpenCode or both.

Default: `./<workflow-name>-plugin/` in the user's working directory, where `<workflow-name>` comes from the design doc.

If the user passed a second positional argument, use that as the output dir.

Show the planned output path and ask: "Write the scaffold to `<path>`?"

If the path already exists, see "Re-running scaffold" below.

## Step 3: Emit files

Read each template from `references/scaffold-templates/` and substitute placeholders. Write the result into the output dir.

### Runtime manifest / config

From `references/scaffold-templates/plugin.json.template`. Substitute:

- `{{WORKFLOW_NAME}}` — from the design doc.
- `{{DESCRIPTION}}` — from the design doc's goal sentence.
- `{{VERSION}}` — `0.1.0`.

For Claude Code, write the rendered manifest to `.claude-plugin/plugin.json`.

For OpenCode, do not emit `.claude-plugin/plugin.json`. Emit `opencode.json` only when needed for global workflow config, command aliases, plugin package declarations, or permission defaults. OpenCode discovers local markdown agents, commands, skills, and plugin files from `.opencode/` without a plugin manifest.

### Agent files per specialist

For each specialist in section 3 of the design doc:

- Claude Code target: copy `references/scaffold-templates/agent.md.template` to `agents/<role>.md`.
- OpenCode target: copy `references/scaffold-templates/opencode-agent.md.template` to `.opencode/agents/<role>.md`:
  - use `description`
  - use `mode: subagent` unless the role is the human-facing orchestrator, then use `mode: primary`
  - use `permission`, not Claude's deprecated `tools` shape
  - use `permission.edit` to deny writes by default and allow only the role's write globs when those globs can be expressed cleanly
  - do not include Claude `hooks:` frontmatter

Substitute:

- `{{ROLE_NAME}}` — the specialist name.
- `{{STAGE_NAME}}` — the stage this role owns.
- `{{WRITE_GLOBS}}` — the role's write boundary, expressed as glob patterns where possible (e.g. `timeline/**`, `drafts/**/*.md`).
- `{{READ_GLOBS}}` — the role's read boundary.
- `{{RESPONSIBILITY}}` — the one-sentence responsibility from the design.

Leave the agent's `## Process` section as a TODO comment pointing at `references/role-boundaries.md` and the relevant stage example in `references/examples/`.

### Command files for user-facing commands

If the design doc names entry-point commands (e.g. `/<workflow-name>:run`, `/<workflow-name>:plan`), emit one file per command. For Claude Code, use `references/scaffold-templates/command.md.template`. For OpenCode, use `references/scaffold-templates/opencode-command.md.template`. Substitute the command name and a one-line description.

Always emit at least one entry-point command — `commands/run.md` — that kicks off a mission for one unit of work.

Target paths:

- Claude Code: `commands/<name>.md`
- OpenCode: `.opencode/commands/<name>.md`

For OpenCode command prompts, use OpenCode argument placeholders (`$ARGUMENTS`, `$1`, `$2`, etc.) instead of Claude-specific argument syntax. If a command should run as a specific OpenCode agent, note the intended agent in the command body and add an `opencode.json` command entry only when explicit agent binding is required.

### Hooks / plugins for hard-enforced boundaries

For each role whose write boundary is marked **hook-enforced** in section 7 of the design doc, copy `references/scaffold-templates/hook.js.template` to `hooks/block-<role>-out-of-scope.js` and substitute:

- `{{ROLE_NAME}}`
- `{{WRITE_GLOBS}}`

For Claude Code, wire the hook from the agent's frontmatter.

For OpenCode, emit `.opencode/plugins/workflow-boundaries.ts` from `references/scaffold-templates/opencode-boundary-plugin.ts.template`. OpenCode hooks are plugin event handlers, so boundary enforcement belongs in `tool.execute.before`, not in agent markdown frontmatter. Also set agent `permission.edit` to deny/allow as a first line of defense.

Each hook/plugin gets a TODO pointing at `references/role-boundaries.md`.

### `SKILL.md` per guardrail skill

For each guardrail skill named in section 8, copy `references/scaffold-templates/skill.md.template` to `skills/<skill-name>/SKILL.md` and substitute:

- `{{SKILL_NAME}}`
- `{{REVIEWER_ROLE}}` — which role consults this skill.

Target paths:

- Claude Code: `skills/<skill-name>/SKILL.md`
- OpenCode: `.opencode/skills/<skill-name>/SKILL.md`

Leave the body as a TODO pointing at `references/guardrail-skills.md`.

### `README.md`

Emit a minimal README with:

- Workflow name and goal sentence (from section 1 of the design).
- Install/run instructions for the selected runtime target.
- A diagram of the stages (rendered from section 2).
- A table of specialists and their stages (from section 3).
- "Next steps" — fill in the TODOs in agents, hooks, skills.

## Step 4: Each emitted file gets TODO markers

Every file the scaffold emits includes TODO comments that:

1. Name the section that needs human input.
2. Link to the relevant `references/<file>.md` so the user knows where to read.

Do not generate domain-specific prompt content. The scaffold is a skeleton — the user fills in the meat.

## Step 5: Print a summary

After all writes succeed, print a list of every file emitted with a one-line description. Example:

```
Scaffold written to ./video-pipeline-plugin/

  .claude-plugin/plugin.json          — Claude Code plugin manifest (name, version, description)
  .opencode/agents/editor.md          — OpenCode specialist for the rough-cut stage (TODO: process)
  agents/editor.md                    — Claude Code specialist for the rough-cut stage (TODO: process)
  agents/colorist.md                  — Specialist for the color-grade stage (TODO: process)
  agents/qc-agent.md                  — Specialist for the final-qc stage (TODO: process)
  commands/run.md                     — Entry-point command (TODO: dispatch logic)
  .opencode/commands/run.md           — OpenCode entry-point command (TODO: dispatch logic)
  hooks/block-editor-out-of-scope.js  — Hard boundary for editor write scope
  .opencode/plugins/workflow-boundaries.ts  — OpenCode hard-boundary plugin (TODO: allow-rules)
  skills/motion-design-standards/SKILL.md  — Guardrail skill (TODO: checklist)
  .opencode/skills/motion-design-standards/SKILL.md  — OpenCode guardrail skill (TODO: checklist)
  README.md                           — Install + usage
```

## Step 6: Tell the user what's next

Print:

```
Scaffold complete. Suggested next steps:
  1. Open each file with a TODO marker and fill it in. The TODO comments link to the references/ docs.
  2. When the agents and hooks are filled in, audit the result:
       /workflow-builder:review <output-dir>
```

## Re-running scaffold

If the output dir already exists:

- Prompt the user: "`<path>` already exists. Overwrite, merge non-conflicting additions only, or cancel?"
- **Overwrite** — back up the existing dir to `<path>.bak.<timestamp>`, then write fresh.
- **Merge** — only emit files that don't already exist; never modify a file the user has edited.
- **Cancel** — stop without writing.

Default to merge. Never silently overwrite.
