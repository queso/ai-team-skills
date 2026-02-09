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
