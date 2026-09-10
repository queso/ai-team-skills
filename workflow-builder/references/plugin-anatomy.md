# Plugin Anatomy

This reference covers how workflow-builder turns abstract workflow patterns (stages, specialists, reviewers, guardrails) into runnable files. It supports two output targets:

- **Claude Code plugin** — packaged as a plugin with `.claude-plugin/plugin.json`.
- **OpenCode workflow skeleton** — project-local `.opencode/` agents, commands, skills, plugins, and optional `opencode.json`.

These are different runtime layouts. Do not treat `.claude-plugin/plugin.json` as portable to OpenCode.

---

## Top-Level Structure

### Claude Code target

```
my-workflow-plugin/
|-- .claude-plugin/
|   `-- plugin.json          # Claude Code manifest
|-- agents/
|   `-- <role>.md            # one file per specialist
|-- commands/
|   `-- <name>.md            # slash commands (entry points)
|-- skills/
|   `-- <name>/
|       `-- SKILL.md         # guardrail skills, auto-discovered
`-- hooks/                   # optional: enforcement scripts
    `-- <name>.js
```

Every directory is optional except `.claude-plugin/plugin.json`. A plugin with only commands is valid. A plugin with only agents is valid. The runtime auto-discovers everything it finds.

The reference implementation: `/home/josh/Code/TheAITeam/the-ai-team-plugin/` follows this layout. List its top-level directories to see a working plugin in production.

### OpenCode target

```
my-workflow/
|-- opencode.json                     # optional; only needed for config bindings/defaults
`-- .opencode/
    |-- agents/
    |   `-- <role>.md                 # one file per specialist
    |-- commands/
    |   `-- <name>.md                 # slash commands
    |-- skills/
    |   `-- <name>/
    |       `-- SKILL.md              # guardrail skills
    `-- plugins/
        `-- workflow-boundaries.ts    # optional hard boundary enforcement
```

OpenCode does not use `.claude-plugin/plugin.json`. Local OpenCode plugins are JavaScript/TypeScript modules in `.opencode/plugins/`. Agents, commands, and skills are discovered from `.opencode/` project directories.

---

## `plugin.json`

The manifest. One file per plugin, lives at `.claude-plugin/plugin.json`.

```json
{
  "name": "ai-team",
  "description": "Parallel Agent Orchestration - The A(i)-Team transforms PRDs into working, tested code",
  "version": "1.6.0",
  "minCliVersion": "1.6.0",
  "author": {
    "name": "Josh / Arcane Ops"
  }
}
```

Source: `.claude-plugin/plugin.json:1-9`.

| Field | Purpose |
|---|---|
| `name` | The plugin's identifier. Used as the namespace for slash commands (`/<name>:<command>`) and for skill references (`<name>:<skill>`). Lowercase, no spaces. |
| `description` | One sentence describing what the plugin does. Shown in the plugin list. |
| `version` | Semver. Bump on every release. |
| `minCliVersion` | The lowest Claude Code CLI version that supports the features this plugin uses. Bump when you adopt a new Claude Code capability (a new hook event, a new tool, native teams mode, etc.). |
| `author` | Object with `name`. Optional. |

When the plugin loads, every `<name>:<command>` slash command, every `<name>:<skill>` skill reference, and every `subagent_type: "<name>:<role>"` resolves through this `name`.

---

## Agent Files (`agents/<role>.md`)

Claude Code target path: `agents/<role>.md`.

One markdown file per specialist. The frontmatter declares the runtime contract; the body is the role definition the agent reads on every invocation.

```markdown
---
name: hannibal
description: Orchestrator for A(i)-Team missions
tools: Task, Bash, Read, Glob
skills:
  - ateam-cli
  - work-breakdown
hooks:
  PreToolUse:
    - matcher: "Write|Edit"
      hooks:
        - type: command
          command: "node ${CLAUDE_PLUGIN_ROOT}/scripts/hooks/block-hannibal-writes.js"
---

# Hannibal - Orchestrator

You coordinate the team. You do NOT write code yourself.

## Process
1. ...
```

Source: `agents/hannibal.md:1-34`.

### Frontmatter fields

- **`name`** — The agent's identifier. Used as `subagent_type: "<plugin>:<name>"` when another agent dispatches it.
- **`description`** — One-sentence role summary.
- **`model`** — Optional. `opus`, `sonnet`, or `haiku`. Sets the model for this agent. If omitted, inherits the parent's model.
- **`tools`** — Comma-separated list of tools the agent can use. Omitting `Write` and `Edit` is the cheapest way to enforce "this agent does not modify files."
- **`skills`** — List of skills the agent loads automatically on invocation. The skill content is appended to the agent's context. Use this to attach guardrail skills to reviewers.
- **`hooks`** — Optional. Inline hook declarations scoped to this agent. Hooks fire before/after tool calls. The most common pattern is a `PreToolUse` hook with a `matcher` regex that blocks specific tool calls (e.g., block `Write|Edit` on certain file paths).
- **`permissionMode`** — Optional. `acceptEdits` skips per-edit confirmation prompts for background-running agents.

### Agent body

The body is plain markdown, read by the agent at the start of every invocation. Keep it focused:

1. **Role statement** — what the agent is and what it owns.
2. **Write boundary** — what it modifies and what it must not touch.
3. **Process** — the steps the agent runs, in order.
4. **Output format** — what the agent produces (a file, a message, a verdict).
5. **Forbidden actions** — explicit don'ts. The strongest signal you can give.

The A(i)-Team plugin's agent files (`agents/hannibal.md`, `agents/murdock.md`, `agents/lynch.md`, etc.) are good references. They average 200-500 lines.

### OpenCode agent files

OpenCode target path: `.opencode/agents/<role>.md`.

OpenCode markdown agents should use OpenCode frontmatter:

```markdown
---
description: Reviews draft copy against brand voice
mode: subagent
permission:
  edit: deny
  bash: deny
  task: deny
---

# Voice Reviewer

Annotate only. Do not rewrite the draft.
```

Use `mode: subagent` for most specialists. Use `mode: primary` for a human-facing orchestrator only if the user should interact with that role directly. Use `permission`, not Claude Code `tools`, for tool access. If hard write boundaries are needed, combine `permission.edit` with `.opencode/plugins/workflow-boundaries.ts`.

---

## Command Files (`commands/<name>.md`)

Claude Code target path: `commands/<name>.md`.

Slash commands. One file per entry point. Commands are how humans (or other agents) start workflows.

```markdown
---
model: sonnet
---
# /ai-team:run

Execute the mission with the pipeline flow.

## Usage

```
/ai-team:run [--wip N] [--max-wip M]
```

## Arguments
- `--wip N` (optional): Set WIP limit (default: 3)
...
```

Source: `commands/run.md:1-14`.

### Frontmatter fields

- **`model`** — Optional. The model that runs this command. If omitted, inherits the user's selected model.
- **`description`** — Optional. Shown in the slash-command picker.

### Command naming

When the plugin's `name` is `ai-team`, the slash commands appear as `/ai-team:plan`, `/ai-team:run`, `/ai-team:status`, etc. The file at `commands/run.md` becomes `/ai-team:run` automatically — no manifest entry needed.

The A(i)-Team plugin ships these commands: `commands/plan.md`, `commands/run.md`, `commands/status.md`, `commands/resume.md`, `commands/setup.md`, `commands/healthcheck.md`, `commands/unblock.md`, `commands/retro.md`, `commands/perspective-test.md`. Each maps to a `/ai-team:<name>` slash command.

### Command body

A command body is a *script the runtime follows*. Plain prose with embedded shell, structured steps, and decision points. This is where you put the procedural logic of "when this command runs, do these things in order." Commands often dispatch agents via `Task` and coordinate the result.

### OpenCode command files

OpenCode target path: `.opencode/commands/<name>.md`.

OpenCode command files are markdown prompts. Arguments use `$ARGUMENTS` or positional placeholders like `$1`, `$2`, and `$3`. Commands can also be configured in `opencode.json` when they need an explicit agent binding.

---

## Skill Files (`skills/<name>/SKILL.md`)

Claude Code target path: `skills/<name>/SKILL.md`.

Skills are reusable knowledge units. Reference them from agent frontmatter, and the runtime loads them into the agent's context automatically.

```markdown
---
name: motion-design-standards
description: Animation principles, easing curves, and dwell-time rules for motion graphics work.
---

# Motion Design Standards

Every motion clip must follow these rules.

## Banned anti-patterns
1. Linear easing on camera moves...
```

### Layout

- **Path:** `skills/<name>/SKILL.md`. The skill name is the directory name; the file is always `SKILL.md`.
- **Frontmatter:** `name` and `description`. The description is what the runtime matches against to decide when a skill is relevant.
- **Body:** the checklist, examples, and self-check sections (see `references/guardrail-skills.md`).

### Discovery

Skills are auto-discovered. Adding `skills/<name>/SKILL.md` to the plugin makes the skill available; no manifest registration. Reference it from an agent via:

```yaml
skills:
  - <skill-name>
```

The runtime resolves `<skill-name>` against (a) skills inside this plugin, (b) skills declared by other installed plugins as `<plugin>:<skill-name>`. The A(i)-Team plugin uses both forms — see `agents/lynch.md:5-15` for an agent that loads seven skills.

### OpenCode skill files

OpenCode target path: `.opencode/skills/<name>/SKILL.md`.

OpenCode also discovers `SKILL.md` files from `.claude/skills/` and `.agents/skills/`, but scaffolded OpenCode workflows should emit native `.opencode/skills/<name>/SKILL.md` so the layout is self-contained.

---

## Hooks (`hooks/` or `scripts/hooks/`)

Claude Code target paths: `hooks/` or `scripts/hooks/`.

Hooks are scripts that fire on lifecycle events. They enforce boundaries the prompt can't (because prompts can be ignored or misread).

The runtime supports three hook categories:

| Event | Fires | Use for |
|---|---|---|
| `PreToolUse` | Before a tool call executes. Hook can return a "block" decision, which prevents the call. | Hard boundary enforcement. "This agent cannot Write to `src/**`." |
| `PostToolUse` | After a tool call completes. Hook receives the tool's output. | Side-effect logging, observability, telemetry. |
| `Stop` | When an agent's session ends. Hook can return a "block" decision, which forces the agent to keep working. | Completion enforcement. "Don't stop until you've called `agentStop`." |

### Wiring

Hooks are wired in two places:

1. **In agent frontmatter** — scoped to that one agent. The A(i)-Team uses this for most enforcement (e.g., `block-hannibal-writes.js` runs only when Hannibal tries to Write).
2. **In `settings.json`** — global to the plugin. Used for cross-cutting telemetry that should run for every agent.

Source: `agents/hannibal.md:8-30` shows three hooks scoped to one agent.

### Hook script shape

A hook is a JavaScript or shell script. It reads JSON from stdin (the tool call context) and writes JSON to stdout (the decision). Example:

```javascript
// hooks/block-writes-to-protected-paths.js
import { readFileSync } from 'fs';
const input = JSON.parse(readFileSync(0, 'utf8'));

if (input.tool_input.file_path.startsWith('/protected/')) {
  console.log(JSON.stringify({
    decision: 'block',
    reason: 'This path is protected; only the build agent may modify it.'
  }));
  process.exit(0);
}

// Otherwise allow
process.exit(0);
```

The A(i)-Team plugin keeps hooks in `scripts/hooks/`. List that directory for ~30 working examples.

### OpenCode boundary plugins

OpenCode target path: `.opencode/plugins/workflow-boundaries.ts`.

OpenCode hooks live in JavaScript/TypeScript plugin modules. For write-boundary enforcement, use a `tool.execute.before` hook and throw an error when a role attempts to write outside its allowed globs. Also encode broad first-line restrictions in each agent's `permission` frontmatter.

---

## Discovery Summary

When the plugin is installed:

| Files | Discovered as | Trigger |
|---|---|---|
| `commands/*.md` | Slash commands `/<plugin>:<name>` | User types the command |
| `agents/*.md` | Subagents addressable via `Task(subagent_type: "<plugin>:<name>")` | Another agent dispatches |
| `skills/*/SKILL.md` | Skills referenced as `<plugin>:<name>` | Agent frontmatter or `Skill` tool |
| Hooks declared in agent frontmatter or `settings.json` | Lifecycle event handlers | Tool call or stop event |

No central manifest lists what the plugin exports. The directory layout *is* the manifest.

For OpenCode, discovery is project-local under `.opencode/`:

| Files | Discovered as | Trigger |
|---|---|---|
| `.opencode/commands/*.md` | Slash commands `/<name>` | User types the command |
| `.opencode/agents/*.md` | Primary agents or subagents | User switches/mentions, or another agent invokes a subagent |
| `.opencode/skills/*/SKILL.md` | Skills loaded by the skill tool | Agent chooses the skill |
| `.opencode/plugins/*.js` / `.opencode/plugins/*.ts` | Plugin hooks and custom tools | Startup loads the module |

---

## `minCliVersion` — When to Bump

`minCliVersion` is the lowest Claude Code CLI version that supports the features your plugin uses. Bump it when you adopt:

- A new hook event type the older CLI doesn't recognize.
- A new tool the older CLI doesn't expose.
- A new agent-frontmatter field (e.g., `permissionMode`).
- Native teams mode (peer-to-peer agent messaging) — A(i)-Team gates this on a feature flag, not `minCliVersion`, but the underlying `SendMessage` capability has a minimum.

Bumping `minCliVersion` tells the CLI: "I won't load this plugin into older versions." That's safer than silently failing on a missing feature.

---

## Putting It Together

A minimal Claude Code plugin for a video-editing workflow might look like:

```
video-editor/
|-- .claude-plugin/
|   `-- plugin.json                      # name: video-editor, version: 0.1.0
|-- agents/
|   |-- editor.md                        # owns timeline files
|   |-- motion-designer.md               # owns motion-graphics layers
|   |-- colorist.md                      # owns grade nodes
|   |-- motion-reviewer.md               # loads motion-design-standards skill
|   `-- audio-reviewer.md                # loads audio-loudness-spec skill
|-- commands/
|   |-- run.md                           # /video-editor:run
|   `-- status.md                        # /video-editor:status
|-- skills/
|   |-- motion-design-standards/SKILL.md
|   |-- audio-loudness-spec/SKILL.md
|   `-- cutting-rhythm-guide/SKILL.md
`-- hooks/
    `-- block-non-owner-writes.js        # editor can only touch *.tlproj, etc.
```

This is a structurally complete plugin. Add the bodies to each file and it runs.
