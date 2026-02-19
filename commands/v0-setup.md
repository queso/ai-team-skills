# /v0-setup — Bootstrap the v0 Design Adaptation Pipeline

Read the skill README at `skills/adapt-v0-bootstrap/README.md` and create every
file listed in the Setup Instructions section.

## What This Creates

- `skills/adapt-v0.md` — Deep knowledge skill for design adaptation
- `commands/adapt-v0.md` — Command to run adaptations
- `scripts/fetch-v0.mjs` — Script to pull v0 source via API
- `designs/README.md` — Workflow documentation
- `designs/AGENTS.md` — AI context for the designs directory
- `designs/_template-notes.md` — Template for adaptation notes

## After Setup

1. Remind the user to set `V0_API_KEY` in their environment
   - Get from: https://v0.dev/chat/settings/keys
   - Set via shell: `export V0_API_KEY=your-key`
   - Or in `.claude/settings.local.json` under `"env"`
2. Suggest adding `designs/` to `.gitignore` if they don't want design history in git
3. Suggest testing with: `/adapt-v0 <any-v0-url>`
