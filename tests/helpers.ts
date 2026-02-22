import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import matter from "gray-matter";

export const REPO_ROOT = resolve(import.meta.dir, "..");

/**
 * Walks repo root directories and returns skill info for each dir containing a SKILL.md.
 */
export function discoverSkills(): { dirName: string; skillMdPath: string }[] {
  const entries = readdirSync(REPO_ROOT);
  const skills: { dirName: string; skillMdPath: string }[] = [];

  for (const entry of entries) {
    const fullPath = join(REPO_ROOT, entry);
    if (!statSync(fullPath).isDirectory()) continue;
    const skillMd = join(fullPath, "SKILL.md");
    try {
      statSync(skillMd);
      skills.push({ dirName: entry, skillMdPath: skillMd });
    } catch {
      // not a skill directory
    }
  }

  return skills;
}

/**
 * Reads a file and returns the gray-matter parsed result.
 */
export function parseFrontmatterSync(filePath: string) {
  const content = readFileSync(filePath, "utf-8");
  return matter(content);
}
