# v0 Design Adaptation Rules

Detailed adaptation process for integrating v0.dev designs into a project. This file
is referenced by the v0-setup skill during the adaptation step.

## Overview

v0.dev generates React + Tailwind CSS + shadcn/ui code. Projects using context-kit
use the same stack (Next.js App Router, Tailwind CSS v4, shadcn/ui). The adaptation
is primarily about mapping v0's output to project conventions — not rewriting the UI.

## Source Acquisition

There are two ways to get v0 source code into the project:

### Option A: Automatic via v0 API (preferred)

If `V0_API_KEY` is set in the environment, the fetch script pulls files directly from
a v0 chat URL. It extracts the chat ID, calls the v0 API, and writes all source files
into `designs/<feature-name>/` along with a manifest.

The chat ID can be extracted from v0 URLs in these formats:
- `https://v0.app/chat/<slug>` — slug is the chat ID
- `https://v0.dev/chat/<slug>` — slug is the chat ID
- Just the slug/ID directly

### Option B: Manual file drop

The user places exported v0 code into `designs/<feature-name>/`:
- One or more `.tsx` files exported from v0
- An optional `notes.md` with adaptation instructions

## Adaptation Process

### Pass 1: Inventory & Planning

1. Read all v0 source files in `designs/<feature-name>/`
2. Read `notes.md` if present — human overrides take priority over all defaults
3. Identify target location:
   - If `notes.md` specifies a path, use that
   - If the v0 component name suggests a route (e.g., `DashboardPage`), use `app/(dashboard)/page.tsx`
   - If it's a reusable component, use `components/features/<feature-name>/`
4. List all shadcn components imported by the v0 code
5. Check which exist locally in `components/ui/`
6. Install missing ones: `pnpm dlx shadcn@latest add <component-name>`

### Pass 2: Structural Integration

1. **Copy the v0 component structure faithfully.** Do not restructure, rename, or
   "improve" the component hierarchy unless `notes.md` explicitly requests it.

2. **Adapt imports:**
   - `@/components/ui/*` — keep as-is (shadcn convention matches)
   - `@/lib/utils` — keep as-is (standard cn() utility)
   - Custom v0 components — create in `components/features/<feature-name>/`
   - Next.js specific: `next/image`, `next/link`, `next/font` — keep as-is

3. **Handle images and assets:**
   - v0 often uses placeholder images from `placeholder.svg` or external URLs
   - Move any referenced images to `public/images/<feature-name>/`
   - Update `<Image>` or `<img>` src paths accordingly
   - If v0 generated images via AI, note these as TODOs for real assets

4. **Handle data:**
   - v0 hardcodes sample data inline — extract to typed constants at file top
   - If `notes.md` specifies an API endpoint, add a TODO comment with the endpoint
   - Do NOT wire up real data fetching unless explicitly requested

5. **Handle interactivity:**
   - v0 often uses placeholder `onClick={() => {}}` — leave as TODO comments
   - v0 may include `"use client"` directives — keep them, they're correct
   - v0 state management (useState, etc.) — keep as-is

6. **Split files only when necessary:**
   - Keep as single file if under ~300 lines
   - If over 300 lines, split into sub-components in `_components/` adjacent to the route
   - If `notes.md` requests specific splitting, follow those instructions

### Pass 3: Theme Alignment

1. **CSS Variables:** The project defines its color scheme via CSS custom properties
   in `globals.css`. v0 uses the same `hsl(var(--...))` pattern. Verify:
   - `--background`, `--foreground`, `--primary`, `--secondary`, etc. exist
   - v0's color references (`bg-primary`, `text-muted-foreground`) map correctly
   - If v0 uses raw Tailwind colors (`bg-blue-500`) check for a semantic equivalent

2. **Typography:** Don't add explicit font-family classes unless the project uses them.
   Let the project's global font stack cascade.

3. **Spacing:** Keep v0's spacing exactly as exported. Standard Tailwind scale.

4. **Dark mode:** If the project has dark mode (`.dark` in `globals.css`),
   verify v0's dark mode classes are present. v0 usually includes them.

5. **Border radius:** v0 uses `--radius` CSS variable. Ensure it matches the project's value.

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
2. Shared components (header, footer, nav) go to `components/layout/`
3. Page-specific components go to `app/<route>/_components/`
4. Shared types go to `types/`
5. Process in dependency order: layout, then shared, then individual pages

## Import Adaptation Quick Reference

| v0 Import | Project Equivalent |
|---|---|
| `@/components/ui/*` | Same — shadcn convention |
| `@/lib/utils` | Same — cn() utility |
| `lucide-react` | Same — default icon set |
| `next/image` | Same |
| `next/link` | Same |
| `next/font/*` | Same |
| Custom components | `components/features/<feature-name>/` |
