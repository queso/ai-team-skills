# designs/ — AGENTS.md

This directory contains design source files exported from v0.dev. These are
input references, not part of the application build.

## Rules for this directory

- Never import from `designs/` in application code
- Never modify v0 source files after initial drop — they're the source of truth
- Always create a new folder for each distinct page or feature
- Use kebab-case for folder names

## Relationship to app code

Files here are consumed by the `/v0-setup` skill, which reads the v0 export
and `notes.md`, then creates adapted components in `app/` and `components/`.

The v0 exports use shadcn/ui — the same component library this project uses —
so most imports translate directly. The main adaptation work is:
1. Installing any missing shadcn components
2. Mapping to project file structure conventions
3. Aligning with project theme tokens (CSS variables in globals.css)
