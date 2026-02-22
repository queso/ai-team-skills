# AI Team Skills

A collection of open-source [Claude Code](https://claude.ai/code) skills for software teams. Install them with the [Skills CLI](https://skills.sh/) to extend your agent's capabilities.

## Skills

### code-review

Automated code review that checks unmerged changes on your current branch for:

- **Readability** — naming, function design, immutability
- **Security** — injection, secrets exposure, OWASP top 10
- **Type safety** — `any` usage, proper generics, async patterns
- **Testing** — behavior vs. implementation tests, determinism, edge cases
- **API & data** — N+1 queries, pagination, consistent response shapes
- **Infrastructure** — Ansible best practices, shell script hygiene, Docker security, YAML correctness

The skill delegates the review to a `code-review-expert` subagent, keeping your main context window clean. It produces a severity-ranked summary (**Must Fix** / **Should Fix** / **Consider**) with file references and suggested fixes.

#### Install

```bash
npx skills add queso/ai-team-skills@code-review -g -y
```

#### Usage

In Claude Code, run:

```
/code-review
```

The skill will detect your base branch, diff all unmerged changes, and return a structured review.

### write-prd

Creates a new Product Requirements Document with auto-numbered filenames. The skill:

- **Finds your PRD directory** and determines the next sequence number (`0001`, `0002`, etc.)
- **Generates a kebab-case filename** from the feature description (e.g., `0020-fix-social-sharing.md`)
- **Gathers business context** — asks you directly if the "why" isn't clear
- **Writes a structured PRD** covering problem statement, business context, success metrics, user stories, scope, requirements, edge cases, and risks
- **Reviews the draft** against a quality checklist before finalizing

Includes reference guides on PRD best practices (with good/bad examples) and a battle-tested template.

#### Install

```bash
npx skills add queso/ai-team-skills@write-prd -g -y
```

#### Usage

In Claude Code, run:

```
/write-prd
```

The skill will ask for the feature context and produce a numbered PRD in your project's PRD directory.

### start-new-app

Scaffolds a new application from the [context-kit](https://github.com/queso/context-kit) template. The skill:

- **Asks for an app name** and where to create the project
- **Clones context-kit** and removes its git history
- **Renames everything** — updates `package.json`, `CLAUDE.md`, `app/layout.tsx`, and any other "context-kit" references to your app name
- **Sets up environment** — copies `.env.example` to `.env`
- **Creates a PRD directory** at `prd/` for structured product requirements
- **Creates a docs directory** at `docs/` for technical and repo documentation
- **Makes an initial commit** so you start with a clean git history
- **Asks for your first PRD** — describe what you want to build and it will create a structured PRD to guide development

#### Install

```bash
npx skills add queso/ai-team-skills@start-new-app -g -y
```

#### Usage

In Claude Code, run:

```
/start-new-app
```

The skill will walk you through naming your project, scaffold it from the template, and prompt you to describe what you want to build.

### v0-setup

Fetches v0.dev designs via the Platform API and adapts them into projects using Next.js App Router, Tailwind CSS v4, and shadcn/ui. The skill:

- **Downloads v0 source code** — uses the zip download endpoint to reliably pull all source files into `designs/<feature-name>/v0-source/` (requires `V0_API_KEY`). This bypasses a known v0 API bug where inline JSON returns `"GENERATING"` placeholders instead of real file content.
- **Smart version selection** — enumerates all chat versions and automatically selects the most recent completed version. Supports `--version <id>` to pin a specific version and `--list-versions` to inspect available versions.
- **Classifies files** — separates custom files from v0's default scaffold files (shadcn components, configs) and reports the breakdown in `manifest.json`
- **Detects placeholder content** — warns if downloaded files still contain `"GENERATING"` stubs and suggests trying an older version
- **Analyzes project context** — reads CLAUDE.md, components.json, globals.css, and existing components to understand conventions
- **Produces an adaptation brief** — inventories fetched files, checks shadcn component availability, and identifies theme alignment needs
- **Adapts to project conventions** — follows a four-pass process (inventory, structural integration, theme alignment, verification)

#### Install

```bash
npx skills add queso/ai-team-skills@v0-setup -g -y
```

#### Usage

In Claude Code, run:

```
/v0-setup <v0-url>
/v0-setup <v0-url> <custom-name>
/v0-setup <feature-folder-name>
```

The skill fetches the v0 design, analyzes it against your project, and walks through the adaptation process.

#### CLI flags

The underlying fetch script (`fetch-v0.mjs`) supports additional flags:

```
node fetch-v0.mjs <v0-url> [name] [--output-dir <path>] [--version <id>] [--list-versions]
```

| Flag | Description |
|------|-------------|
| `--output-dir <path>` | Base directory for `designs/<feature>/v0-source/`. Defaults to cwd. |
| `--version <id>` | Download a specific version instead of the auto-selected best version. |
| `--list-versions` | Print all available versions for the chat without downloading. |

#### Architecture

The fetch pipeline is composed of four modules in `v0-setup/scripts/`:

| Module | Purpose |
|--------|---------|
| `version-list.mjs` | Enumerates chat versions with pagination and slug/hashId fallback |
| `zip-download.mjs` | Downloads and extracts version zip archives with Zip Slip protection |
| `file-filter.mjs` | Classifies files as custom vs. default and validates content |
| `placeholder-detection.mjs` | Detects `"GENERATING"` and other placeholder content |

These are orchestrated by `runPipeline()` in `fetch-v0.mjs`, which accepts injected dependencies for testability.

## Contributing

PRs welcome. Each skill lives in its own directory:

```
skill-name/
├── SKILL.md              # Skill definition (frontmatter + instructions)
└── references/           # Optional reference docs loaded as context
    └── *.md
```

### Adding a new skill

1. Create a directory with your skill name
2. Add a `SKILL.md` with `name` and `description` in the frontmatter
3. Add reference files if the skill needs domain-specific examples
4. Submit a PR

## License

MIT
