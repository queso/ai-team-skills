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

Bootstraps the v0-to-project design adaptation pipeline for projects using Next.js App Router, Tailwind CSS v4, and shadcn/ui. The skill:

- **Creates an `adapt-v0` skill** — a design-to-code adaptation specialist that preserves visual fidelity when integrating v0.dev output
- **Creates an `/adapt-v0` command** — accepts a v0 URL or feature folder name and runs the full adaptation process
- **Creates a `fetch-v0.mjs` script** — pulls source files directly from v0's Platform API (requires `V0_API_KEY`)
- **Sets up a `designs/` directory** — with AGENTS.md context, a README, and a template for adaptation notes
- **Replaces screenshot workflows** — uses actual v0 source code instead of Playwright screenshots

#### Install

```bash
npx skills add queso/ai-team-skills@v0-setup -g -y
```

#### Usage

In Claude Code, run:

```
/v0-setup
```

The skill will create all the files in your project. After setup, use `/adapt-v0 <v0-url>` to pull and adapt designs.

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
