# AI Team Skills

A collection of Claude Code skills installed via the [Skills CLI](https://skills.sh/). Each skill is a self-contained directory with a `SKILL.md` definition and optional `references/` folder.

## Intent Layer

**Before modifying a skill, read its `SKILL.md` first** to understand its purpose, steps, and expected behavior.

- **code-review**: `code-review/SKILL.md` - Automated review of unmerged code on the current branch
- **write-prd**: `write-prd/SKILL.md` - Creates numbered PRDs with business context and success criteria
- **start-new-app**: `start-new-app/SKILL.md` - Scaffolds a new app from the context-kit template

## Skill Structure

Every skill follows this layout:

```
skill-name/
├── SKILL.md              # Frontmatter (name, description) + step-by-step instructions
└── references/           # Optional domain-specific guidance loaded as context
    └── *.md
```

- **`SKILL.md` frontmatter** must include `name` and `description` fields in YAML between `---` fences.
- **Steps** are numbered `## Step N:` sections that the agent follows sequentially.
- **References** are supporting docs the agent consults during execution (templates, checklists, examples). Not every skill needs them.

## Global Invariants

- Each skill is invoked via `/skill-name` in Claude Code
- Skills must be self-contained — no cross-skill imports or shared state
- The `SKILL.md` is the single source of truth for what a skill does
- Reference files provide guidance, not instructions — the SKILL.md drives execution

## Adding a New Skill

1. Create a directory named after the skill (kebab-case)
2. Add a `SKILL.md` with `name` and `description` frontmatter
3. Add `references/` with supporting docs if the skill needs domain context
4. Update `README.md` with install/usage instructions
