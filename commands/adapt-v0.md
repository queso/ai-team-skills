# /adapt-v0 — Adapt a v0 Design to This Project

Read and follow the skill at `skills/adapt-v0.md` before doing anything.

## Arguments

`$ARGUMENTS` can be one of:

1. **A v0 URL** — e.g., `https://v0.app/chat/vacation-rental-website-pCP3OQ8u3PU`
   - Extract the chat ID from the URL
   - Run `node scripts/fetch-v0.mjs <chat-id> <derived-feature-name>` to pull files
   - The feature name is derived from the URL slug (e.g., `vacation-rental-website`)
   - Then adapt from `designs/<feature-name>/`

2. **A feature folder name** — e.g., `login-page`
   - Read directly from `designs/<feature-name>/`
   - Files should already be there (manually placed by the user)

3. **A v0 URL + custom name** — e.g., `https://v0.app/chat/abc123 dashboard`
   - Pull files using the URL but name the folder with the custom name

## Steps

1. Determine input type from `$ARGUMENTS`
2. If a v0 URL is provided:
   a. Check if `V0_API_KEY` environment variable is set
   b. If yes → run `node scripts/fetch-v0.mjs` to pull source files
   c. If no → tell the user to set `V0_API_KEY` (from v0.dev/chat/settings/keys)
      or manually export the code and place it in `designs/<name>/`
3. Read all files in `designs/<feature-name>/`
4. Follow the complete adaptation process from `skills/adapt-v0.md`
5. Summarize what was created and any decisions made
