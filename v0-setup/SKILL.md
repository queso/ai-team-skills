---
name: v0-setup
description: Bootstraps the v0-to-project design adaptation pipeline. Creates skills, commands, and scripts for pulling v0.dev designs via the Platform API and adapting them to project conventions.
---

# Adapt v0 — Bootstrap Guide

This skill contains everything needed to set up the v0-to-project design adaptation
pipeline. Read this file completely, then create all listed files in the
specified locations when the user runs `/v0-setup`.

## Overview

This system bridges v0.dev designs into projects that use context-kit conventions
(Next.js App Router, Tailwind CSS v4, shadcn/ui). It replaces the broken workflow of
screenshotting v0 output with Playwright by pulling actual source code via v0's
Platform API and adapting it to project conventions.

## Setup Instructions

When a user runs `/v0-setup`, create ALL of the following files in the current
project directory.

---

## File 1: `skills/adapt-v0.md`

```markdown
# Skill: Adapt v0 Designs

You are a design-to-code adaptation specialist. Your job is to take UI code from
v0.dev and integrate it into the current project while preserving visual fidelity.

## Overview

v0.dev generates React + Tailwind CSS + shadcn/ui code. Projects using context-kit
use the same stack (Next.js App Router, Tailwind CSS v4, shadcn/ui). The adaptation
is primarily about mapping v0's output to project conventions — not rewriting the UI.

## Source Acquisition

There are two ways to get v0 source code into the project:

### Option A: Automatic via v0 API (preferred)

If `V0_API_KEY` is set in the environment, use the fetch script to pull files
directly from a v0 chat URL:

node scripts/fetch-v0.mjs <v0-url-or-chat-id> <feature-name>

This extracts the chat ID from the URL, calls the v0 API, and writes all source
files into `designs/<feature-name>/`. It also generates a manifest file listing
every file pulled.

The chat ID can be extracted from v0 URLs in these formats:
- `https://v0.app/chat/<slug>` → slug is the chat ID
- `https://v0.dev/chat/<slug>` → slug is the chat ID
- Just the slug/ID directly

### Option B: Manual file drop

The user places exported v0 code into `designs/<feature-name>/`:
- One or more `.tsx` files exported from v0
- An optional `notes.md` with adaptation instructions

## Pre-Adaptation: Read Project Context

Before adapting ANY design, read these files to understand project conventions:

1. `CLAUDE.md` — Project-wide conventions, architecture patterns, coding standards
2. `components.json` — shadcn/ui configuration (path aliases, component style)
3. `app/globals.css` — CSS custom properties, theme tokens, color scheme
4. `tailwind.config.ts` (if present) — Extended theme values, custom utilities
5. `components/ui/` — List existing components so you know what's already available
6. `app/` — Existing route structure for placement decisions

## Adaptation Process

### Pass 1: Inventory & Planning

1. Read all v0 source files in `designs/<feature-name>/`
2. Read `notes.md` if present — human overrides take priority over all defaults
3. Identify target location:
   - If `notes.md` specifies a path → use that
   - If the v0 component name suggests a route (e.g., `DashboardPage`) → `app/(dashboard)/page.tsx`
   - If it's a reusable component → `components/features/<feature-name>/`
4. List all shadcn components imported by the v0 code
5. Check which exist locally in `components/ui/`
6. Install missing ones: `pnpm dlx shadcn@latest add <component-name>`

### Pass 2: Structural Integration

1. Copy the v0 component structure faithfully. Do not restructure, rename, or
   "improve" the component hierarchy unless `notes.md` explicitly requests it.

2. Adapt imports:
   - `@/components/ui/*` → Keep as-is (shadcn convention matches)
   - `@/lib/utils` → Keep as-is (standard cn() utility)
   - Custom v0 components → Create in `components/features/<feature-name>/`
   - Next.js specific: `next/image`, `next/link`, `next/font` → Keep as-is

3. Handle images and assets:
   - v0 often uses placeholder images from `placeholder.svg` or external URLs
   - Move any referenced images to `public/images/<feature-name>/`
   - Update `<Image>` or `<img>` src paths accordingly
   - If v0 generated images via AI, note these as TODOs for real assets

4. Handle data:
   - v0 hardcodes sample data inline — extract to typed constants at file top
   - If `notes.md` specifies an API endpoint → add a TODO comment with the endpoint
   - Do NOT wire up real data fetching unless explicitly requested

5. Handle interactivity:
   - v0 often uses placeholder `onClick={() => {}}` → Leave as TODO comments
   - v0 may include `"use client"` directives → Keep them, they're correct
   - v0 state management (useState, etc.) → Keep as-is

6. Split files only when necessary:
   - Keep as single file if under ~300 lines
   - If over 300 lines, split into sub-components in `_components/` adjacent to the route
   - If `notes.md` requests specific splitting → follow those instructions

### Pass 3: Theme Alignment

1. CSS Variables: The project defines its color scheme via CSS custom properties
   in `globals.css`. v0 uses the same `hsl(var(--...))` pattern. Verify:
   - `--background`, `--foreground`, `--primary`, `--secondary`, etc. exist
   - v0's color references (`bg-primary`, `text-muted-foreground`) map correctly
   - If v0 uses raw Tailwind colors (`bg-blue-500`) check for a semantic equivalent

2. Typography: Don't add explicit font-family classes unless the project uses them.
   Let the project's global font stack cascade.

3. Spacing: Keep v0's spacing exactly as exported. Standard Tailwind scale.

4. Dark mode: If the project has dark mode (`.dark` in `globals.css`),
   verify v0's dark mode classes are present. v0 usually includes them.

5. Border radius: v0 uses `--radius` CSS variable. Ensure it matches the project's value.

### Pass 4: Verification

1. Start the dev server if not running
2. Navigate to the new route/component and verify it renders
3. Run linting and type checking
4. Fix any errors — but do NOT change styling to fix errors

## Rules — Non-Negotiable

- NEVER use screenshots or Playwright to capture v0 output. Always use source code.
- NEVER simplify or "clean up" v0's Tailwind classes. If v0 used 12 utility classes
  on a div, keep all 12.
- NEVER invent new components when a shadcn component exists.
- ALWAYS read `notes.md` first. Human overrides take absolute priority.
- ALWAYS install missing shadcn components before importing them.
- ALWAYS preserve responsive breakpoints (`sm:`, `md:`, `lg:`, `xl:`, `2xl:`).
- ALWAYS preserve accessibility attributes (`aria-*`, `role`, `tabIndex`).
- NEVER delete v0 source files from `designs/`. They're the source of truth.

## Common v0 Patterns

| v0 Pattern | How to Handle |
|---|---|
| `import { Button } from "@/components/ui/button"` | Keep — matches shadcn convention |
| `<Image src="/placeholder.svg"...>` | Replace with real asset or keep as TODO |
| Long `className` strings | Keep every class exactly |
| Hardcoded arrays of data | Extract to typed const at top of file |
| `"use client"` directive | Keep — v0 places them correctly |
| `lucide-react` icon imports | Keep — lucide is shadcn's default icon set |
| `cn()` utility calls | Keep — standard shadcn class merge utility |
| Inline SVGs | Keep inline unless > 20 lines, then extract |

## Multi-Page v0 Projects

When v0 generates entire multi-page apps:
1. Each page maps to a route in `app/`
2. Shared components (header, footer, nav) → `components/layout/`
3. Page-specific components → `app/<route>/_components/`
4. Shared types → `types/`
5. Process in dependency order: layout → shared → individual pages

## Activation Triggers

This skill activates when:
- User mentions "v0", "v0.dev", "v0.app", or "design adaptation"
- User asks to "match the design" or "replicate the UI"
- User provides a v0 URL
- Work involves the `designs/` directory
- A PRD or work item references a v0 design as target UI
```

---

## File 2: `commands/adapt-v0.md`

```markdown
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
```

---

## File 3: `scripts/fetch-v0.mjs`

```javascript
#!/usr/bin/env node

/**
 * fetch-v0.mjs — Pull source files from a v0.dev chat via the Platform API
 *
 * Usage:
 *   node scripts/fetch-v0.mjs <v0-url-or-chat-id> <feature-name>
 *
 * Requirements:
 *   - V0_API_KEY environment variable (get from v0.dev/chat/settings/keys)
 *
 * Output:
 *   - Creates designs/<feature-name>/ directory
 *   - Writes all v0 source files into it
 *   - Generates a manifest.json listing all files pulled
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const V0_API_BASE = "https://api.v0.dev/v1";

function extractChatId(input) {
  const urlMatch = input.match(/v0\.(?:app|dev)\/chat\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];
  return input;
}

function deriveFeatureName(chatId) {
  const parts = chatId.split("-");
  if (parts.length > 1) {
    const last = parts[parts.length - 1];
    if (/^[a-zA-Z0-9]{6,}$/.test(last) && !/^[a-z]+$/.test(last)) {
      return parts.slice(0, -1).join("-");
    }
  }
  return chatId;
}

async function fetchChat(chatId, apiKey) {
  const response = await fetch(`${V0_API_BASE}/chats/${chatId}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`v0 API error (${response.status}): ${error}`);
  }
  return response.json();
}

async function fetchVersion(chatId, versionId, apiKey) {
  const url = `${V0_API_BASE}/chats/${chatId}/versions/${versionId}?includeDefaultFiles=false`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`v0 API version fetch error (${response.status}): ${error}`);
  }
  return response.json();
}

async function main() {
  const [, , inputArg, customName] = process.argv;

  if (!inputArg) {
    console.error("Usage: node scripts/fetch-v0.mjs <v0-url-or-chat-id> [feature-name]");
    process.exit(1);
  }

  const apiKey = process.env.V0_API_KEY;
  if (!apiKey) {
    console.error("Error: V0_API_KEY environment variable is not set.");
    console.error("Get your API key from: https://v0.dev/chat/settings/keys");
    process.exit(1);
  }

  const chatId = extractChatId(inputArg);
  const featureName = customName || deriveFeatureName(chatId);
  const outputDir = join(process.cwd(), "designs", featureName);

  console.log(`Chat ID: ${chatId}`);
  console.log(`Feature: ${featureName}`);
  console.log(`Output:  ${outputDir}\n`);

  console.log("Fetching chat metadata...");
  const chat = await fetchChat(chatId, apiKey);

  const latestVersion = chat.latestVersion;
  if (!latestVersion) {
    console.error("Error: No version found for this chat.");
    process.exit(1);
  }

  console.log(`Latest version: ${latestVersion.id} (status: ${latestVersion.status})`);

  let files = latestVersion.files;
  if (files && files.length > 0 && !files[0].content) {
    console.log("Fetching full version with file contents...");
    const fullVersion = await fetchVersion(chatId, latestVersion.id, apiKey);
    files = fullVersion.files;
  }

  if (!files || files.length === 0) {
    console.error("Error: No files found in the latest version.");
    process.exit(1);
  }

  console.log(`Found ${files.length} files\n`);
  mkdirSync(outputDir, { recursive: true });

  const manifest = {
    chatId,
    featureName,
    fetchedAt: new Date().toISOString(),
    sourceUrl: `https://v0.app/chat/${chatId}`,
    versionId: latestVersion.id,
    files: [],
  };

  for (const file of files) {
    const fileName = file.name || file.path;
    if (!fileName) { console.warn("Skipping file with no name/path"); continue; }

    const filePath = join(outputDir, fileName);
    mkdirSync(dirname(filePath), { recursive: true });

    const content = file.content || "";
    writeFileSync(filePath, content, "utf-8");

    manifest.files.push({ name: fileName, size: content.length, locked: file.locked || false });
    console.log(`  ✓ ${fileName} (${content.length} bytes)`);
  }

  writeFileSync(join(outputDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");
  console.log(`  ✓ manifest.json\n`);
  console.log(`Done! ${files.length} files written to designs/${featureName}/\n`);
  console.log(`Next steps:`);
  console.log(`  1. Optionally create designs/${featureName}/notes.md`);
  console.log(`  2. Run: /adapt-v0 ${featureName}`);
}

main().catch((err) => { console.error("Fatal error:", err.message); process.exit(1); });
```

---

## File 4: `designs/README.md`

```markdown
# designs/

Design source files from v0.dev for AI-assisted UI adaptation.

## Workflow

### Automatic (recommended)

1. Set `V0_API_KEY` in your environment (get one at v0.dev/chat/settings/keys)
2. Run `/adapt-v0 <v0-url>` in Claude Code
3. The command pulls source files via the v0 API and adapts them to project conventions

### Manual

1. Export code from v0 (Download ZIP or copy from the editor)
2. Create a folder here named after the feature (kebab-case)
3. Drop in the `.tsx` files + optional `notes.md`
4. Run `/adapt-v0 <folder-name>` in Claude Code

## Folder Structure

    designs/
      _template-notes.md        ← Copy to notes.md in any feature folder
      AGENTS.md                 ← Context for AI tools
      vacation-rental-website/
        manifest.json            ← Auto-generated by fetch script
        app/page.tsx             ← v0 source files (preserving v0's paths)
        components/...
        notes.md                 ← Optional adaptation instructions

## Tips

- Use the API path when possible — preserves v0's complete file structure.
- Name your v0 chats well — the chat title becomes the folder name.
- One v0 chat per folder — multi-page projects stay in a single folder.
- Don't delete after adaptation — these serve as design history.
```

---

## File 5: `designs/AGENTS.md`

```markdown
# designs/ — AGENTS.md

This directory contains design source files exported from v0.dev. These are
input references, not part of the application build.

## Rules for this directory

- Never import from `designs/` in application code
- Never modify v0 source files after initial drop — they're the source of truth
- Always create a new folder for each distinct page or feature
- Use kebab-case for folder names

## Relationship to app code

Files here are consumed by the `/adapt-v0` command, which reads the v0 export
and `notes.md`, then creates adapted components in `app/` and `components/`.

The v0 exports use shadcn/ui — the same component library this project uses —
so most imports translate directly. The main adaptation work is:
1. Installing any missing shadcn components
2. Mapping to project file structure conventions
3. Aligning with project theme tokens (CSS variables in globals.css)
```

---

## File 6: `designs/_template-notes.md`

```markdown
# Adaptation Notes: [Feature Name]

## Target Location
<!-- Where should this live? e.g., app/(dashboard)/page.tsx -->


## Component Overrides
<!-- Swap v0 components for project ones? e.g., "Use our AppNav instead of v0's nav" -->


## Data Handling
<!-- e.g., "Connect user list to /api/users" or "Leave as mock data" -->


## Splitting
<!-- "Keep as single file" or "Split sidebar into own component" -->


## Exclusions
<!-- Anything to skip? e.g., "Remove footer — we have a global one" -->


## Other Notes

```

---

## File 7: `commands/v0-setup.md`

```markdown
# /v0-setup — Bootstrap the v0 Design Adaptation Pipeline

Read the skill at `skills/adapt-v0-bootstrap/SKILL.md` and create every
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
```

---

## Environment Setup

The user needs `V0_API_KEY` in their environment. Options:

1. **Shell environment:** `export V0_API_KEY=your-key-here`
2. **Claude Code settings:** Add to `.claude/settings.local.json`:
   ```json
   {
     "env": {
       "V0_API_KEY": "your-key-here"
     }
   }
   ```
3. **Project `.env`:** Add `V0_API_KEY=your-key-here` (if the project loads dotenv)

Get the key from: https://v0.dev/chat/settings/keys

## .gitignore Addition

Add to the project's `.gitignore`:
```
# v0 design source files (optional — keep if you want design history in git)
# designs/*/manifest.json
```

## Testing

To verify the setup works, run:
```
/adapt-v0 https://v0.app/chat/vacation-rental-website-pCP3OQ8u3PU
```

This should:
1. Pull ~15+ files from the vacation rental v0 project
2. Write them to `designs/vacation-rental-website/`
3. Begin adapting them to the project's conventions
