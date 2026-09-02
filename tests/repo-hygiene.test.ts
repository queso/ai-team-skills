import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { discoverSkills, parseFrontmatterSync, REPO_ROOT } from "./helpers";

/** Mirrors the `skills` CLI: walks 5 levels, skipping only these directories. */
const CLI_SKIP_DIRS = ["node_modules", ".git", "dist", "build", "__pycache__"];
const CLI_MAX_DEPTH = 5;

function findSkillMdLikeCli(dir = REPO_ROOT, depth = 0): string[] {
  if (depth > CLI_MAX_DEPTH) return [];
  const found = existsSync(join(dir, "SKILL.md")) ? [join(dir, "SKILL.md")] : [];
  for (const entry of readdirSync(dir)) {
    if (CLI_SKIP_DIRS.includes(entry)) continue;
    const child = join(dir, entry);
    if (!statSync(child).isDirectory()) continue;
    found.push(...findSkillMdLikeCli(child, depth + 1));
  }
  return found;
}

describe("repo hygiene", () => {
  const staleDirs = ["commands", "scripts", "designs", "skills"];

  for (const dir of staleDirs) {
    it(`no stale ${dir}/ directory at repo root`, () => {
      expect(existsSync(join(REPO_ROOT, dir))).toBe(false);
    });
  }

  // `skills add` registers any SKILL.md it finds within 5 levels, keyed on
  // frontmatter `name:`. A named SKILL.md outside a top-level skill directory
  // is therefore offered to users as an installable skill — and if its name
  // collides with a real one, it can win and be installed in its place.
  it("no installable SKILL.md outside a top-level skill directory", () => {
    const shipped = new Set(discoverSkills().map((s) => s.skillMdPath));
    const strays = findSkillMdLikeCli()
      .filter((p) => !shipped.has(p))
      .filter((p) => Boolean(parseFrontmatterSync(p).data?.name))
      .map((p) => relative(REPO_ROOT, p));

    expect(strays).toEqual([]);
  });

  // Anything inside a skill directory is copied into every user's skills
  // directory on install, so fixtures and eval harnesses live outside them.
  it("no eval directory nested inside a skill directory", () => {
    const nested = discoverSkills()
      .map((s) => join(REPO_ROOT, s.dirName, "evals"))
      .filter((p) => existsSync(p))
      .map((p) => relative(REPO_ROOT, p));

    expect(nested).toEqual([]);
  });
});
