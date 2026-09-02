# ai-team-skills

A collection of Claude Code skills for the A(i)-Team plugin.

## Repository layout

A skill directory is a shipping unit. `skills add queso/ai-team-skills@<name>`
copies that directory verbatim into the user's global skills directory, so
every file inside it reaches every user of that skill.

```
<skill-name>/             ships to users — keep it to what the skill needs at runtime
├── SKILL.md              required: frontmatter `name` + `description`, then instructions
├── references/           optional: docs the skill loads as context
└── scripts/              optional: hooks or helpers the skill documents

evals/<skill-name>/       eval harnesses and fixtures         ]
prd/                      PRDs for `/ateam plan`              ]  never inside
tests/                    repo test suite                     ]  a skill directory
```

Two rules follow, both enforced by `tests/repo-hygiene.test.ts`:

### Nothing inside a skill directory that users should not receive

Eval harnesses, fixtures, PRDs, scratch notes, and design docs go at the repo
root instead. The handoff eval used to live at `handoff/evals/` and was 140K of
its 156K install — synthetic fixture sources landing in every user's skills
directory.

### No stray `SKILL.md` carrying a frontmatter `name:`

The Skills CLI walks **five directory levels** from the repo root, skipping only
`node_modules`, `.git`, `dist`, `build`, and `__pycache__`, and registers every
`SKILL.md` it finds keyed on frontmatter `name:`. Registration is first-come and
deduplicated by name, so:

- A named `SKILL.md` anywhere in the tree is offered to users as an installable
  skill, however deep it sits and whatever the directory is called.
- If its name collides with a real skill, it can win and be installed **in place
  of** that skill. This is ordering-dependent, so it presents as the real skill
  mysteriously missing files rather than as an obvious error.

Eval arms are the usual way this happens, because promptdiff requires each arm
to be a directory containing a `SKILL.md`. Arms therefore carry **no
frontmatter**: promptdiff strips frontmatter before inlining (`src/prompt.ts`),
so the arm's prompt is unchanged, and with no `name:` there is nothing to
register. Where an arm must be the real shipped skill, generate it at run time
into a gitignored path rather than checking in a copy or a symlink — both are
discoverable. `evals/handoff/run.sh` is the reference implementation.

## Development

- Package manager: `bun`
- Linter/formatter: Biome (`bun run lint`, `bun run check`, `bun run format`)
- Tests: `bun test` (test files in `tests/`)

## A(i)-Team Integration

This project uses the A(i)-Team plugin for PRD-driven development.

### When to Use A(i)-Team

Use the A(i)-Team workflow when:
- Implementing features from a PRD document
- Working on multi-file changes that benefit from TDD
- Building features that need structured test → implement → review flow

### Commands

- `/ateam plan <prd-file>` - Decompose a PRD into tracked work items
- `/ateam run` - Execute the mission with parallel agents
- `/ateam status` - Check current progress
- `/ateam resume` - Resume an interrupted mission

### Workflow

1. Place your PRD in the `prd/` directory **at the repo root**, never inside a
   skill directory — anything under a skill directory ships to that skill's users
2. Run `/ateam plan prd/your-feature.md`
3. Run `/ateam run` to execute

The A(i)-Team will:
- Break down the PRD into testable units
- Write tests first (TDD)
- Implement to pass tests
- Review each feature
- Probe for bugs
- Update documentation and commit

**Do NOT** work on PRD features directly without using `/ateam plan` first.
