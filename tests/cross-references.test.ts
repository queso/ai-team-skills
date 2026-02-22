import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { discoverSkills } from "./helpers";

const skills = discoverSkills();

describe("cross-references", () => {
  for (const skill of skills) {
    describe(skill.dirName, () => {
      const content = readFileSync(skill.skillMdPath, "utf-8");
      const skillDir = dirname(skill.skillMdPath);

      // Extract backtick-wrapped paths matching references/* and scripts/*
      const pathPattern = /`([^`]*(?:references|scripts)\/[^`]*)`/g;
      const referencedPaths: string[] = [];
      for (const match of content.matchAll(pathPattern)) {
        const p = match[1];
        // Filter to relative paths (not full example paths like .claude/skills/...)
        if (!p.startsWith(".") && !p.startsWith("~") && !p.includes("<") && !p.includes("$")) {
          referencedPaths.push(p);
        }
      }

      if (referencedPaths.length > 0) {
        for (const refPath of referencedPaths) {
          it(`referenced path exists: ${refPath}`, () => {
            const fullPath = join(skillDir, refPath);
            expect(existsSync(fullPath)).toBe(true);
          });
        }
      }

      // Check if skill references references/ generically
      const referencesGeneric = /`references\/`/.test(content) || /references\/\*/.test(content);
      if (referencesGeneric || existsSync(join(skillDir, "references"))) {
        const refsDir = join(skillDir, "references");
        if (existsSync(refsDir)) {
          it("references/ directory is non-empty", () => {
            const entries = readdirSync(refsDir);
            expect(entries.length).toBeGreaterThan(0);
          });
        }
      }
    });
  }
});
